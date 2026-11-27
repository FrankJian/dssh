//! Explicit opt-in only: a user-selected saved connection and a fresh child of an authorized root.
//! Passwords go directly from a read-only repository query to OpenSSH's askpass pipe, never logs.
use std::{
    collections::HashMap, panic::AssertUnwindSafe, path::PathBuf, process::Stdio, time::Duration,
};

use futures::FutureExt;
use rusqlite::{Connection, OpenFlags};
use russh::keys::ssh_key::{HashAlg, PublicKey};
use russh_sftp::protocol::{FileAttributes, StatusCode};
use std::os::unix::fs::PermissionsExt;

use super::EditorSftpIo;
use crate::editor::{
    text::{self, LineEnding, TextEncoding, TextMetadata},
    workspaces::{EditorManager, FileSource},
};

struct Remote {
    host: String,
    port: u16,
    username: String,
    profile_id: String,
    profile_name: String,
    database: PathBuf,
    helper: PathBuf,
    hosts: PathBuf,
}

impl Remote {
    async fn connect(&self) -> (EditorSftpIo, tokio::process::Child) {
        let mut child = tokio::process::Command::new("ssh")
            .args([
                "-F",
                "/dev/null",
                "-T",
                "-s",
                "-o",
                "BatchMode=no",
                "-o",
                "StrictHostKeyChecking=yes",
                "-o",
                "GlobalKnownHostsFile=/dev/null",
                "-o",
                "PubkeyAuthentication=no",
                "-o",
                "KbdInteractiveAuthentication=no",
                "-o",
                "PreferredAuthentications=password",
                "-o",
                "NumberOfPasswordPrompts=1",
                "-o",
                "ConnectTimeout=10",
                "-o",
                "ClearAllForwardings=yes",
                "-o",
                "PermitLocalCommand=no",
            ])
            .arg("-o")
            .arg(format!("UserKnownHostsFile={}", self.hosts.display()))
            .arg("-p")
            .arg(self.port.to_string())
            .arg("-l")
            .arg(&self.username)
            .arg(&self.host)
            .arg("sftp")
            .env("SSH_ASKPASS", &self.helper)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env("DISPLAY", "duo-editor-verification")
            .env("DSSH_EDITOR_REMOTE_DATABASE", &self.database)
            .env("DSSH_EDITOR_REMOTE_PROFILE", &self.profile_name)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .expect("Start SSH subsystem transport");
        let stream = tokio::io::join(child.stdout.take().unwrap(), child.stdin.take().unwrap());
        let result = tokio::time::timeout(Duration::from_secs(20), EditorSftpIo::new(stream)).await;
        let io = result
            .expect("SSH/SFTP initialization timed out")
            .expect("SSH authentication or SFTP initialization failed");
        (io, child)
    }
}

#[tokio::test]
#[ignore = "Requires explicit DSSH_EDITOR_REMOTE_DATA_DIR, PROFILE and ROOT authorization"]
async fn remote_saved_profile_editor_smoke() {
    let data = PathBuf::from(
        std::env::var("DSSH_EDITOR_REMOTE_DATA_DIR")
            .expect("Select existing application data directory"),
    );
    let profile_name =
        std::env::var("DSSH_EDITOR_REMOTE_PROFILE").expect("Select authorized saved connection");
    let root =
        std::env::var("DSSH_EDITOR_REMOTE_ROOT").expect("Select authorized test parent directory");
    assert!(root.starts_with('/') && !root.contains(['\0', '\n', '\r']));
    let database = data.join("dssh.sqlite3");
    let connection =
        Connection::open_with_flags(&database, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let locked: bool = connection
        .query_row(
            "SELECT enabled FROM app_lock_settings WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        !locked,
        "Use the unlocked application for verification when app lock is enabled"
    );
    let rows = connection.prepare("SELECT p.id,p.host,p.port,COALESCE(c.username,p.username),COALESCE(c.auth_type,p.auth_type),p.proxy_type FROM ssh_profiles p LEFT JOIN ssh_credentials c ON c.id=p.credential_id WHERE p.name=?1").unwrap()
        .query_map([&profile_name], |r| Ok((r.get::<_, String>(0)?,r.get::<_, String>(1)?,r.get::<_,u16>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,Option<String>>(5)?))).unwrap()
        .collect::<Result<Vec<_>,_>>().unwrap();
    assert_eq!(rows.len(), 1, "Choose one unambiguous saved connection");
    let (profile_id, host, port, username, auth_type, proxy) = rows.into_iter().next().unwrap();
    assert_eq!(
        auth_type, "password",
        "This opt-in transport supports saved password authentication only"
    );
    assert!(
        proxy.is_none(),
        "Use the application to verify proxied connections"
    );
    assert!(!host.starts_with('-') && !host.chars().any(char::is_whitespace));
    let trusted: HashMap<String, String> =
        serde_json::from_slice(&std::fs::read(data.join("known_hosts.json")).unwrap()).unwrap();
    let fingerprint = trusted
        .get(&format!("{host}:{port}"))
        .expect("Approve the host identity in the application first");
    let scan = tokio::time::timeout(
        Duration::from_secs(15),
        tokio::process::Command::new("ssh-keyscan")
            .args(["-T", "5", "-p", &port.to_string(), &host])
            .output(),
    )
    .await
    .unwrap()
    .unwrap();
    let scanned = String::from_utf8(scan.stdout).unwrap();
    let trusted_line = scanned
        .lines()
        .find(|line| {
            let parts: Vec<_> = line.split_whitespace().collect();
            parts.len() >= 3
                && PublicKey::from_openssh(&format!("{} {}", parts[1], parts[2]))
                    .is_ok_and(|key| key.fingerprint(HashAlg::Sha256).to_string() == *fingerprint)
        })
        .expect(
            "Presented SSH host key does not match the application's previously trusted identity",
        );
    let local = tempfile::tempdir().unwrap();
    let hosts = local.path().join("known_hosts");
    std::fs::write(&hosts, format!("{trusted_line}\n")).unwrap();
    let helper = local.path().join("askpass");
    std::fs::write(&helper, r#"#!/usr/bin/env python3
import os, sqlite3, sys
try:
    if len(sys.argv) < 2 or 'password' not in sys.argv[1].lower(): sys.exit(1)
    c = sqlite3.connect('file:' + os.environ['DSSH_EDITOR_REMOTE_DATABASE'] + '?mode=ro', uri=True)
    rows = c.execute('SELECT COALESCE(c.secret_ref,p.secret_ref) FROM ssh_profiles p LEFT JOIN ssh_credentials c ON c.id=p.credential_id WHERE p.name=?', (os.environ['DSSH_EDITOR_REMOTE_PROFILE'],)).fetchall()
    if len(rows) != 1 or not rows[0][0]: sys.exit(1)
    sys.stdout.write(rows[0][0])
except Exception:
    sys.exit(1)
"#).unwrap();
    std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o700)).unwrap();
    let remote = Remote {
        host,
        port,
        username,
        profile_id,
        profile_name,
        database,
        helper,
        hosts,
    };
    let (io, mut child) = remote.connect().await;
    let root = io.canonical_path(&root, false).await.unwrap();
    io.check_type(&root, true).await.unwrap();
    if std::env::var("DSSH_EDITOR_REMOTE_READ_ONLY").as_deref() == Ok("1") {
        let manager = EditorManager::default();
        let scope = manager
            .open(
                "remote-readonly-verification",
                FileSource::Sftp {
                    profile_id: remote.profile_id.clone(),
                },
                Some(root.clone()),
                None,
                Some("verification".into()),
            )
            .unwrap();
        let lease = manager
            .require("remote-readonly-verification", &scope.id)
            .unwrap();
        let (listing, _) = io.list_bounded(&root, 1, &lease).await.unwrap();
        assert!(listing.entries.len() <= 1);
        child.kill().await.unwrap();
        println!(
            "Read-only remote checks passed: saved authentication, pinned host identity, canonical directory, bounded SFTP listing; no remote writes dispatched"
        );
        return;
    }
    assert_eq!(
        std::env::var("DSSH_EDITOR_REMOTE_ALLOW_MUTATION").as_deref(),
        Ok("1"),
        "Explicit approval is required before creating, changing or deleting remote test files"
    );
    let owned = format!(
        "{}/.duo-ssh-editor-check-{:032x}",
        root.trim_end_matches('/'),
        rand::random::<u128>()
    );
    let mut attrs = FileAttributes::empty();
    attrs.permissions = Some(0o40700);
    io.raw
        .mkdir(&owned, attrs.clone())
        .await
        .expect("Create a fresh exclusive test directory");
    let manager = EditorManager::default();
    let scope = manager
        .open(
            "remote-verification",
            FileSource::Sftp {
                profile_id: remote.profile_id.clone(),
            },
            Some(owned.clone()),
            None,
            Some("verification".into()),
        )
        .unwrap();
    let lease = manager.require("remote-verification", &scope.id).unwrap();
    let mut created = Vec::new();
    let outcome = AssertUnwindSafe(async {
        for (i,encoding) in [TextEncoding::Utf8,TextEncoding::Utf8Bom,TextEncoding::Utf16Le,TextEncoding::Utf16Be,TextEncoding::Gb18030].into_iter().enumerate() {
            let path = format!("{owned}/encoding-{i}.txt");
            let metadata = TextMetadata{encoding,bom:matches!(encoding,TextEncoding::Utf8Bom|TextEncoding::Utf16Le|TextEncoding::Utf16Be),line_ending:LineEnding::Crlf};
            let bytes = text::encode("配置🚀\n末行",&metadata).unwrap();
            io.save(&remote.profile_id,&path,&bytes,None,false,&lease).await.unwrap(); created.push(path.clone());
            let read = io.read(&remote.profile_id,&path,false,&lease).await.unwrap();
            assert_eq!(read.data,bytes); assert_eq!(text::decode(&path,&read.data,Some(encoding)).unwrap().content,"配置🚀\r\n末行");
            assert_eq!(io.save(&remote.profile_id,&path,b"do not overwrite",None,false,&lease).await.unwrap_err().code,"editor_conflict");
        }
        let path=format!("{owned}/conflict.txt");
        let initial=io.save(&remote.profile_id,&path,b"first",None,false,&lease).await.unwrap(); created.push(path.clone());
        let (other,mut other_child)=remote.connect().await;
        let updated=other.save(&remote.profile_id,&path,b"other",Some(&initial),false,&lease).await.unwrap();
        assert_eq!(io.save(&remote.profile_id,&path,b"draft",Some(&initial),false,&lease).await.unwrap_err().code,"editor_conflict");
        assert_eq!(io.read(&remote.profile_id,&path,false,&lease).await.unwrap().data,b"other");
        let saved=io.save(&remote.profile_id,&path,b"saved",Some(&updated),false,&lease).await.unwrap();
        assert_ne!(saved,updated);
        let (listing,truncated)=io.list_bounded(&owned,2,&lease).await.unwrap(); assert_eq!(listing.entries.len(),2); assert!(truncated);
        let denied=format!("{owned}/readonly");
        io.raw.mkdir(&denied,attrs.clone()).await.unwrap();
        let mut readonly=FileAttributes::empty(); readonly.permissions=Some(0o40500); io.raw.setstat(&denied,readonly).await.unwrap();
        assert_eq!(io.save(&remote.profile_id,&format!("{denied}/attempt.txt"),b"denied",None,false,&lease).await.unwrap_err().code,"editor_permission");
        io.raw.setstat(&denied,attrs.clone()).await.unwrap(); io.raw.rmdir(&denied).await.unwrap();
        other_child.kill().await.unwrap();
        assert!(other.read(&remote.profile_id,&path,false,&lease).await.is_err());
        assert_eq!(io.read(&remote.profile_id,&path,false,&lease).await.unwrap().data,b"saved");
        println!("Remote editor checks passed: trusted host identity, saved authentication, 5 encodings, exclusive create, two-connection conflict, atomic save, listing bounds, permission failure, isolated transport loss");
    }).catch_unwind().await;
    // Only exact files created here and this new directory are eligible for cleanup.
    let denied = format!("{owned}/readonly");
    let _ = io.raw.setstat(&denied, attrs).await;
    let _ = io.raw.remove(format!("{denied}/attempt.txt")).await;
    let _ = io.raw.rmdir(&denied).await;
    for path in created {
        io.raw.remove(path).await.expect("Clean up known test file");
    }
    let remaining = io.list_bounded(&owned, 100, &lease).await.unwrap();
    assert!(
        remaining.0.entries.is_empty() && !remaining.1,
        "Test directory retained because unexpected files remain"
    );
    io.raw
        .rmdir(&owned)
        .await
        .expect("Remove empty test-owned directory");
    assert!(
        matches!(io.raw.lstat(&owned).await,Err(russh_sftp::client::error::Error::Status(status)) if status.status_code==StatusCode::NoSuchFile)
    );
    child.kill().await.unwrap();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
    println!("Remote test-owned directory removed; existing parent files were not modified");
}
