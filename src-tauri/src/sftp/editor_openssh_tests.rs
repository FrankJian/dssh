//! Opt-in integration with an installed OpenSSH subsystem and real temporary files.
//! This deliberately does not claim to validate SSH authentication or host-key prompts.
use std::{path::Path, process::Stdio, time::Duration};

use std::os::unix::fs::PermissionsExt;

use super::EditorSftpIo;
use crate::editor::workspaces::{EditorManager, FileSource};

async fn subsystem(root: &Path, denied: Option<&str>) -> (EditorSftpIo, tokio::process::Child) {
    let executable = ["/usr/libexec/sftp-server", "/usr/lib/openssh/sftp-server"]
        .into_iter()
        .find(|path| Path::new(path).is_file())
        .expect("Install OpenSSH sftp-server to run this opt-in test");
    let mut command = tokio::process::Command::new(executable);
    command
        .arg("-d")
        .arg(root)
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if let Some(request) = denied {
        command.args(["-P", request]);
    }
    let mut child = command.spawn().expect("Start installed OpenSSH subsystem");
    let stream = tokio::io::join(child.stdout.take().unwrap(), child.stdin.take().unwrap());
    let io = tokio::time::timeout(Duration::from_secs(5), EditorSftpIo::new(stream))
        .await
        .expect("OpenSSH initialization timed out")
        .expect("OpenSSH protocol initialization");
    (io, child)
}

#[tokio::test]
#[ignore = "Requires installed OpenSSH sftp-server; run with --ignored"]
async fn openssh_subsystem_safe_save_and_external_conflict() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    let path = root.join("编码文件.txt");
    // A real UTF-16LE file, including BOM and CRLF, passed through the byte provider intact.
    let original = [0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65, 0x0d, 0, 0x0a, 0];
    std::fs::write(&path, original).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
    let (io, mut child) = subsystem(&root, None).await;
    let manager = EditorManager::default();
    let workspace = manager
        .open(
            "openssh-test",
            FileSource::Sftp {
                profile_id: "synthetic".into(),
            },
            Some(root.to_string_lossy().into_owned()),
            None,
            Some("v1".into()),
        )
        .unwrap();
    let lease = manager.require("openssh-test", &workspace.id).unwrap();
    let name = path.to_str().unwrap();
    let before = io.read("synthetic", name, false, &lease).await.unwrap();
    assert_eq!(before.data, original);
    assert!(io.atomic_rename);
    let saved = io
        .save(
            "synthetic",
            name,
            b"saved\r\n",
            Some(&before.version),
            false,
            &lease,
        )
        .await
        .unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"saved\r\n");
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o640
    );
    std::fs::write(&path, b"other\r\n").unwrap();
    assert_eq!(
        io.save("synthetic", name, b"draft", Some(&saved), false, &lease)
            .await
            .unwrap_err()
            .code,
        "editor_conflict"
    );
    assert_eq!(std::fs::read(&path).unwrap(), b"other\r\n");
    let new_path = root.join("new.txt");
    io.save(
        "synthetic",
        new_path.to_str().unwrap(),
        b"new",
        None,
        false,
        &lease,
    )
    .await
    .unwrap();
    assert_eq!(
        io.save(
            "synthetic",
            new_path.to_str().unwrap(),
            b"overwrite",
            None,
            false,
            &lease
        )
        .await
        .unwrap_err()
        .code,
        "editor_conflict"
    );
    let link = root.join("link.txt");
    std::os::unix::fs::symlink(&path, &link).unwrap();
    assert_eq!(
        io.read("synthetic", link.to_str().unwrap(), false, &lease)
            .await
            .err()
            .unwrap()
            .code,
        "editor_regular_file"
    );
    let (listing, truncated) = io
        .list_bounded(root.to_str().unwrap(), 1, &lease)
        .await
        .unwrap();
    assert_eq!(listing.entries.len(), 1);
    assert!(truncated);
    assert!(!std::fs::read_dir(&root).unwrap().any(|entry| {
        entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".duo-ssh-edit-")
    }));
    child.kill().await.unwrap();
    assert!(io.read("synthetic", name, false, &lease).await.is_err());
}

#[tokio::test]
#[ignore = "Requires installed OpenSSH sftp-server; run with --ignored"]
async fn openssh_subsystem_capability_and_permission_failures_keep_original() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    let path = root.join("file.txt");
    std::fs::write(&path, b"original").unwrap();
    // OpenSSH removes the capability advertisement when this request is disabled.
    let (io, mut child) = subsystem(&root, Some("posix-rename")).await;
    let manager = EditorManager::default();
    let workspace = manager
        .open(
            "openssh-test",
            FileSource::Sftp {
                profile_id: "synthetic".into(),
            },
            Some(root.to_string_lossy().into_owned()),
            None,
            Some("v1".into()),
        )
        .unwrap();
    let lease = manager.require("openssh-test", &workspace.id).unwrap();
    let before = io
        .read("synthetic", path.to_str().unwrap(), false, &lease)
        .await
        .unwrap();
    let error = io
        .save(
            "synthetic",
            path.to_str().unwrap(),
            b"draft",
            Some(&before.version),
            false,
            &lease,
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, "editor_atomic_unavailable");
    assert_eq!(std::fs::read(&path).unwrap(), b"original");
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
    let saved = io
        .save(
            "synthetic",
            path.to_str().unwrap(),
            b"explicit fallback",
            Some(&before.version),
            true,
            &lease,
        )
        .await
        .unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"explicit fallback");
    assert_eq!(
        io.save(
            "synthetic",
            path.to_str().unwrap(),
            b"next save",
            Some(&saved),
            false,
            &lease
        )
        .await
        .unwrap_err()
        .code,
        "editor_atomic_unavailable"
    );
    child.kill().await.unwrap();

    // The atomic extension exists, but a real server policy rejects mode preservation.
    let (io, mut child) = subsystem(&root, Some("setstat")).await;
    assert!(io.atomic_rename);
    let before = io
        .read("synthetic", path.to_str().unwrap(), false, &lease)
        .await
        .unwrap();
    assert_eq!(
        io.save(
            "synthetic",
            path.to_str().unwrap(),
            b"draft",
            Some(&before.version),
            false,
            &lease
        )
        .await
        .unwrap_err()
        .code,
        "editor_metadata"
    );
    assert_eq!(std::fs::read(&path).unwrap(), b"explicit fallback");
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
    child.kill().await.unwrap();
}
