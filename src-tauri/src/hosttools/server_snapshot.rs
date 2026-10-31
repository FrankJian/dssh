//! Bounded concurrent read-only probes. Each exec owns its output, deadline and
//! channel permit; merging only after completion prevents section interleaving.
use std::future::Future;

use crate::{
    error::AppResult,
    models::ssh_profile::SshProfile,
    ssh::{CommandOutput, SshConnectionPool, command::run_ssh_command_with_limit},
};

#[derive(Clone, Copy)]
enum Probe {
    System,
    Disks,
    Docker,
}

const PROBES: [Probe; 3] = [Probe::System, Probe::Disks, Probe::Docker];

impl Probe {
    fn script(self) -> &'static str {
        match self {
            Self::System => include_str!("snapshot.sh"),
            Self::Disks => include_str!("snapshot-disks.sh"),
            Self::Docker => include_str!("snapshot-docker.sh"),
        }
    }

    fn limits(self) -> (u64, usize) {
        match self {
            Self::System | Self::Disks => (15, 256 * 1024),
            Self::Docker => (5, 128 * 1024),
        }
    }
}

async fn collect_with<R, F>(run: R) -> [AppResult<CommandOutput>; 3]
where
    R: Fn(Probe) -> F,
    F: Future<Output = AppResult<CommandOutput>>,
{
    // At most three additional channels, all from the original pooled transport.
    let (system, disks, docker) =
        tokio::join!(run(Probe::System), run(Probe::Disks), run(Probe::Docker));
    let mut results = [system, disks, docker];
    let some_channel_worked = results.iter().any(Result::is_ok);
    if some_channel_worked {
        // A low-MaxSessions server may admit only one of the parallel probes.
        // All initial permits are released now; retry only channel admission
        // failures, once each, sequentially. Never retry auth/host-key/exec policy
        // failures or timed-out/truncated commands.
        for (probe, result) in PROBES.into_iter().zip(results.iter_mut()) {
            if result.as_ref().is_err_and(|error| {
                matches!(
                    error.code.as_str(),
                    "ssh_channel_limit" | "ssh_channel_open_rejected"
                )
            }) {
                *result = run(probe).await;
            }
        }
    }
    results
}

fn merge_results(results: [AppResult<CommandOutput>; 3]) -> AppResult<CommandOutput> {
    let [system, disks, docker] = results;
    if system.is_err() && disks.is_err() {
        return system;
    }
    let mut output = CommandOutput {
        stdout: String::new(),
        stderr: String::new(),
        exit_code: Some(0),
        timed_out: false,
        output_truncated: false,
    };
    for (result, end_marker) in [(system, "@@DSSH:SYSTEM_END"), (disks, "@@DSSH:DISK_END")] {
        match result {
            Ok(part) => {
                if part.exit_code != Some(0) || !part.stdout.lines().any(|line| line == end_marker)
                {
                    output.exit_code = Some(1);
                }
                output.stdout.push('\n');
                output.stdout.push_str(&part.stdout);
                output.stderr.push_str(&part.stderr);
                output.timed_out |= part.timed_out;
                output.output_truncated |= part.output_truncated;
            }
            Err(_) => output.exit_code = Some(1),
        }
    }
    output.stdout.push_str("\n@@DSSH:END\n");
    match docker {
        Ok(part) => {
            output.stdout.push_str(&part.stdout);
            if part.timed_out || part.output_truncated || part.exit_code != Some(0) {
                output.stdout.push_str("\n@@DSSH:DOCKER_WARNING\nDocker 采集超时、截断或未完整结束；部分容器数据可能缺失。\n");
            }
        }
        Err(_) => output
            .stdout
            .push_str("\n@@DSSH:DOCKER_STATUS\nunavailable\n"),
    }
    Ok(output)
}

pub async fn snapshot(profile: SshProfile, pool: &SshConnectionPool) -> AppResult<CommandOutput> {
    let results = collect_with(|probe| {
        let profile = profile.clone();
        async move {
            let command = format!("sh -c '{}'", probe.script().replace('\'', "'\"'\"'"));
            let (timeout, limit) = probe.limits();
            run_ssh_command_with_limit(profile, command, timeout, limit, pool).await
        }
    })
    .await;
    merge_results(results)
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use std::time::Duration;

    use tokio::sync::{Barrier, Semaphore};

    use super::{Probe, collect_with, merge_results};
    use crate::{error::AppError, ssh::CommandOutput};

    fn output(probe: Probe) -> CommandOutput {
        let stdout = match probe {
            Probe::System => "@@DSSH:HOST\nexample\n@@DSSH:SYSTEM_END\n",
            Probe::Disks => "@@DSSH:DISK\nfilesystem rows\n@@DSSH:DISK_END\n",
            Probe::Docker => "\n@@DSSH:DOCKER_STATUS\nnot_installed\n",
        };
        CommandOutput {
            stdout: stdout.into(),
            stderr: String::new(),
            exit_code: Some(0),
            timed_out: false,
            output_truncated: false,
        }
    }

    fn index(probe: Probe) -> usize {
        match probe {
            Probe::System => 0,
            Probe::Disks => 1,
            Probe::Docker => 2,
        }
    }

    #[tokio::test]
    async fn all_three_probes_start_before_any_finishes_and_merge_without_interleaving() {
        let barrier = Arc::new(Barrier::new(3));
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let results = tokio::time::timeout(
            Duration::from_secs(2),
            collect_with(|probe| {
                let (barrier, active, peak) = (barrier.clone(), active.clone(), peak.clone());
                async move {
                    let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(count, Ordering::SeqCst);
                    barrier.wait().await;
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok(output(probe))
                }
            }),
        )
        .await
        .expect("sequential dispatch would deadlock at the barrier");
        assert_eq!(peak.load(Ordering::SeqCst), 3);
        let merged = merge_results(results).unwrap();
        assert!(merged.stdout.starts_with("\n@@DSSH:HOST\nexample\n"));
        assert!(merged.stdout.contains("@@DSSH:SYSTEM_END\n\n@@DSSH:DISK\n"));
        assert!(
            merged
                .stdout
                .contains("@@DSSH:DISK_END\n\n@@DSSH:END\n\n@@DSSH:DOCKER_STATUS")
        );
        assert_eq!(merged.exit_code, Some(0));
    }

    #[tokio::test]
    async fn low_channel_limit_retries_rejected_probes_sequentially_after_release() {
        let capacity = Arc::new(Semaphore::new(1));
        let attempts = Arc::new(std::array::from_fn::<_, 3, _>(|_| AtomicUsize::new(0)));
        let results = collect_with(|probe| {
            let (capacity, attempts) = (capacity.clone(), attempts.clone());
            async move {
                attempts[index(probe)].fetch_add(1, Ordering::SeqCst);
                let _permit = capacity
                    .try_acquire_owned()
                    .map_err(|_| AppError::new("ssh_channel_open_rejected", "MaxSessions"))?;
                tokio::task::yield_now().await;
                Ok(output(probe))
            }
        })
        .await;
        assert!(results.iter().all(Result::is_ok));
        assert_eq!(
            attempts.each_ref().map(|n| n.load(Ordering::SeqCst)),
            [1, 2, 2]
        );
        assert_eq!(capacity.available_permits(), 1);
    }

    #[tokio::test]
    async fn exec_policy_rejections_are_not_retried() {
        let attempts = AtomicUsize::new(0);
        let results = collect_with(|probe| {
            attempts.fetch_add(1, Ordering::SeqCst);
            std::future::ready(match probe {
                Probe::System => Ok(output(probe)),
                _ => Err(AppError::new("ssh_exec_rejected", "policy")),
            })
        })
        .await;
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
        let merged = merge_results(results).unwrap();
        assert_eq!(merged.exit_code, Some(1));
        assert!(merged.stdout.contains("example"));
    }

    #[test]
    fn blocked_disks_and_failed_docker_keep_existing_system_data() {
        let mut disk = output(Probe::Disks);
        disk.stdout = "@@DSSH:DISK_TYPED\n".into();
        disk.timed_out = true;
        disk.output_truncated = true;
        disk.exit_code = None;
        let merged = merge_results([
            Ok(output(Probe::System)),
            Ok(disk),
            Err(AppError::new("ssh_channel_limit", "busy")),
        ])
        .unwrap();
        assert!(merged.timed_out && merged.output_truncated);
        assert_eq!(merged.exit_code, Some(1));
        assert!(merged.stdout.contains("example"));
        assert!(merged.stdout.contains("@@DSSH:DOCKER_STATUS\nunavailable"));
    }

    #[test]
    fn docker_timeout_is_optional_and_does_not_mark_system_incomplete() {
        let mut docker = output(Probe::Docker);
        docker.timed_out = true;
        docker.exit_code = None;
        let merged = merge_results([
            Ok(output(Probe::System)),
            Ok(output(Probe::Disks)),
            Ok(docker),
        ])
        .unwrap();
        assert_eq!(merged.exit_code, Some(0));
        assert!(!merged.timed_out);
        assert!(merged.stdout.contains("@@DSSH:DOCKER_WARNING"));
    }

    #[test]
    fn transport_or_auth_failure_still_returns_the_original_error() {
        let result = merge_results([
            Err(AppError::new("ssh_host_key_changed", "changed")),
            Err(AppError::new("ssh_host_key_changed", "changed")),
            Err(AppError::new("ssh_host_key_changed", "changed")),
        ]);
        assert_eq!(result.unwrap_err().code, "ssh_host_key_changed");
    }
}
