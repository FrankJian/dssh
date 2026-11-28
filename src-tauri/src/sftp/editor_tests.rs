use super::*;
use crate::editor::workspaces::{EditorManager, FileSource};
use russh_sftp::{
    protocol::{Attrs, Data, File as ProtocolFile, Handle, Name, SftpHandle, Status, Version},
    server::Handler,
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
struct Node {
    data: Vec<u8>,
    attributes: FileAttributes,
}
#[derive(Default)]
struct Files {
    directories: HashMap<String, Vec<ProtocolFile>>,
    directory_reads: std::collections::HashSet<SftpHandle>,
    nodes: HashMap<String, Node>,
    handles: HashMap<SftpHandle, String>,
    opens: Vec<(String, OpenFlags)>,
    fail_write: bool,
    fail_permissions: bool,
    fail_cleanup: bool,
    fail_rename: bool,
    change_target: bool,
    stall_write: bool,
    write_started: Arc<tokio::sync::Notify>,
}
struct Server {
    files: Arc<Mutex<Files>>,
    atomic: bool,
}
fn ok(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: String::new(),
        language_tag: String::new(),
    }
}

impl Handler for Server {
    type Error = StatusCode;
    fn unimplemented(&self) -> StatusCode {
        StatusCode::OpUnsupported
    }
    async fn init(&mut self, _: u32, _: HashMap<String, String>) -> Result<Version, StatusCode> {
        let mut version = Version::new();
        if self.atomic {
            version
                .extensions
                .insert("posix-rename@openssh.com".into(), "1".into());
        }
        Ok(version)
    }
    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, StatusCode> {
        Ok(Name {
            id,
            files: vec![ProtocolFile::dummy(if path == "." {
                "/".to_owned()
            } else {
                path
            })],
        })
    }
    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, StatusCode> {
        let files = self.files.lock().unwrap();
        if files.directories.contains_key(&path) {
            let mut attrs = FileAttributes::empty();
            attrs.permissions = Some(0o040755);
            return Ok(Attrs { id, attrs });
        }
        let node = files.nodes.get(&path).ok_or(StatusCode::NoSuchFile)?;
        let mut attrs = node.attributes.clone();
        attrs.size = Some(node.data.len() as u64);
        Ok(Attrs { id, attrs })
    }
    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, StatusCode> {
        self.lstat(id, path).await
    }
    async fn fstat(&mut self, id: u32, handle: SftpHandle) -> Result<Attrs, StatusCode> {
        let path = self
            .files
            .lock()
            .unwrap()
            .handles
            .get(&handle)
            .cloned()
            .ok_or(StatusCode::Failure)?;
        self.lstat(id, path).await
    }
    async fn open(
        &mut self,
        id: u32,
        path: String,
        flags: OpenFlags,
        attrs: FileAttributes,
    ) -> Result<Handle, StatusCode> {
        let mut files = self.files.lock().unwrap();
        files.opens.push((path.clone(), flags));
        if flags.contains(OpenFlags::CREATE) {
            if files.nodes.contains_key(&path) && flags.contains(OpenFlags::EXCLUDE) {
                return Err(StatusCode::Failure);
            }
            files.nodes.entry(path.clone()).or_insert(Node {
                data: Vec::new(),
                attributes: attrs,
            });
        }
        let node = files.nodes.get_mut(&path).ok_or(StatusCode::NoSuchFile)?;
        if flags.contains(OpenFlags::TRUNCATE) {
            node.data.clear();
        }
        let handle = SftpHandle::from(format!("h-{id}"));
        files.handles.insert(handle.clone(), path);
        Ok(Handle { id, handle })
    }
    async fn close(&mut self, id: u32, handle: SftpHandle) -> Result<Status, StatusCode> {
        let mut files = self.files.lock().unwrap();
        files.handles.remove(&handle);
        files.directory_reads.remove(&handle);
        Ok(ok(id))
    }
    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, StatusCode> {
        let mut files = self.files.lock().unwrap();
        if !files.directories.contains_key(&path) {
            return Err(StatusCode::PermissionDenied);
        }
        let handle = SftpHandle::from(format!("dir-{id}"));
        files.handles.insert(handle.clone(), path);
        Ok(Handle { id, handle })
    }
    async fn readdir(&mut self, id: u32, handle: SftpHandle) -> Result<Name, StatusCode> {
        let mut files = self.files.lock().unwrap();
        if !files.directory_reads.insert(handle.clone()) {
            return Err(StatusCode::Eof);
        }
        let path = files.handles.get(&handle).ok_or(StatusCode::Failure)?;
        Ok(Name {
            id,
            files: files
                .directories
                .get(path)
                .ok_or(StatusCode::Failure)?
                .clone(),
        })
    }
    async fn read(
        &mut self,
        id: u32,
        handle: SftpHandle,
        offset: u64,
        len: u32,
    ) -> Result<Data, StatusCode> {
        let files = self.files.lock().unwrap();
        let path = files.handles.get(&handle).ok_or(StatusCode::Failure)?;
        let node = files.nodes.get(path).ok_or(StatusCode::NoSuchFile)?;
        if offset as usize >= node.data.len() {
            return Err(StatusCode::Eof);
        }
        Ok(Data {
            id,
            data: node.data[offset as usize..(offset as usize + len as usize).min(node.data.len())]
                .to_vec(),
        })
    }
    async fn write(
        &mut self,
        id: u32,
        handle: SftpHandle,
        offset: u64,
        bytes: Vec<u8>,
    ) -> Result<Status, StatusCode> {
        let stall = {
            let files = self.files.lock().unwrap();
            files.stall_write.then(|| files.write_started.clone())
        };
        if let Some(signal) = stall {
            signal.notify_one();
            return std::future::pending().await;
        }
        let mut files = self.files.lock().unwrap();
        let path = files
            .handles
            .get(&handle)
            .cloned()
            .ok_or(StatusCode::Failure)?;
        let fail = files.fail_write;
        if files.change_target {
            files.nodes.get_mut("/file.txt").unwrap().data = b"evil".to_vec();
            files.change_target = false;
        }
        let node = files.nodes.get_mut(&path).ok_or(StatusCode::NoSuchFile)?;
        let count = if fail {
            bytes.len().min(2)
        } else {
            bytes.len()
        };
        node.data
            .resize(node.data.len().max(offset as usize + count), 0);
        node.data[offset as usize..offset as usize + count].copy_from_slice(&bytes[..count]);
        if fail {
            Err(StatusCode::Failure)
        } else {
            Ok(ok(id))
        }
    }
    async fn setstat(
        &mut self,
        id: u32,
        path: String,
        attrs: FileAttributes,
    ) -> Result<Status, StatusCode> {
        let mut files = self.files.lock().unwrap();
        if files.fail_permissions {
            return Err(StatusCode::PermissionDenied);
        }
        let node = files.nodes.get_mut(&path).ok_or(StatusCode::NoSuchFile)?;
        if attrs.permissions.is_some() {
            node.attributes.permissions = attrs.permissions;
        }
        if attrs.uid.is_some() {
            node.attributes.uid = attrs.uid;
            node.attributes.gid = attrs.gid;
        }
        Ok(ok(id))
    }
    async fn remove(&mut self, id: u32, path: String) -> Result<Status, StatusCode> {
        let mut files = self.files.lock().unwrap();
        if files.fail_cleanup {
            return Err(StatusCode::PermissionDenied);
        }
        files.nodes.remove(&path).ok_or(StatusCode::NoSuchFile)?;
        Ok(ok(id))
    }
    async fn rename(&mut self, id: u32, old: String, new: String) -> Result<Status, StatusCode> {
        let mut files = self.files.lock().unwrap();
        if files.nodes.contains_key(&new) {
            return Err(StatusCode::Failure);
        }
        let node = files.nodes.remove(&old).ok_or(StatusCode::NoSuchFile)?;
        files.nodes.insert(new, node);
        Ok(ok(id))
    }
    async fn extended(
        &mut self,
        id: u32,
        request: String,
        data: Vec<u8>,
    ) -> Result<Packet, StatusCode> {
        if !self.atomic || request != "posix-rename@openssh.com" {
            return Err(StatusCode::OpUnsupported);
        }
        fn take(data: &mut &[u8]) -> Result<String, StatusCode> {
            if data.len() < 4 {
                return Err(StatusCode::BadMessage);
            }
            let size = u32::from_be_bytes(data[..4].try_into().unwrap()) as usize;
            *data = &data[4..];
            if data.len() < size {
                return Err(StatusCode::BadMessage);
            }
            let value =
                String::from_utf8(data[..size].to_vec()).map_err(|_| StatusCode::BadMessage)?;
            *data = &data[size..];
            Ok(value)
        }
        let mut data = data.as_slice();
        let old = take(&mut data)?;
        let new = take(&mut data)?;
        if !data.is_empty() {
            return Err(StatusCode::BadMessage);
        }
        let mut files = self.files.lock().unwrap();
        if files.fail_rename {
            return Err(StatusCode::PermissionDenied);
        }
        let node = files.nodes.remove(&old).ok_or(StatusCode::NoSuchFile)?;
        files.nodes.insert(new, node);
        Ok(Packet::Status(ok(id)))
    }
}

struct Fixture {
    io: EditorSftpIo,
    files: Arc<Mutex<Files>>,
    lease: WorkspaceLease,
    server: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}
async fn fixture(atomic: bool) -> Fixture {
    let mut attributes = FileAttributes::empty();
    attributes.permissions = Some(0o100640);
    attributes.uid = Some(1000);
    attributes.gid = Some(1000);
    attributes.mtime = Some(100);
    let files = Arc::new(Mutex::new(Files::default()));
    files.lock().unwrap().nodes.insert(
        "/file.txt".into(),
        Node {
            data: b"good".to_vec(),
            attributes,
        },
    );
    let (client, server) = tokio::io::duplex(128 * 1024);
    let handler = Server {
        files: files.clone(),
        atomic,
    };
    let server = tokio::spawn(async move {
        russh_sftp::server::run(server, handler).await;
    });
    let io = EditorSftpIo::new(client).await.unwrap();
    let manager = EditorManager::default();
    let scope = manager
        .open(
            "main",
            FileSource::Sftp {
                profile_id: "test".into(),
            },
            Some("/".into()),
            None,
            Some("v1".into()),
        )
        .unwrap();
    Fixture {
        io,
        files,
        lease: manager.require("main", &scope.id).unwrap(),
        server,
    }
}

#[tokio::test]
async fn protocol_atomic_save_preserves_mode_and_never_truncates_original() {
    let f = fixture(true).await;
    let original =
        f.io.read("test", "/file.txt", false, &f.lease)
            .await
            .unwrap();
    let version =
        f.io.save(
            "test",
            "/file.txt",
            b"new content",
            Some(&original.version),
            false,
            &f.lease,
        )
        .await
        .unwrap();
    assert_ne!(version, original.version);
    let state = f.files.lock().unwrap();
    assert_eq!(state.nodes["/file.txt"].data, b"new content");
    assert_eq!(
        state.nodes["/file.txt"].attributes.permissions,
        Some(0o100640)
    );
    assert!(
        state
            .opens
            .iter()
            .all(|(p, flags)| p != "/file.txt" || !flags.contains(OpenFlags::TRUNCATE))
    );
    assert_eq!(state.nodes.len(), 1);
    assert!(state.handles.is_empty());
}

#[tokio::test]
async fn unsupported_server_requires_explicit_per_save_fallback() {
    let f = fixture(false).await;
    let original =
        f.io.read("test", "/file.txt", false, &f.lease)
            .await
            .unwrap();
    assert_eq!(
        f.io.save(
            "test",
            "/file.txt",
            b"new",
            Some(&original.version),
            false,
            &f.lease
        )
        .await
        .unwrap_err()
        .code,
        "editor_atomic_unavailable"
    );
    assert_eq!(f.files.lock().unwrap().nodes["/file.txt"].data, b"good");
    f.io.save(
        "test",
        "/file.txt",
        b"new",
        Some(&original.version),
        true,
        &f.lease,
    )
    .await
    .unwrap();
    assert_eq!(f.files.lock().unwrap().nodes["/file.txt"].data, b"new");
}

#[tokio::test]
async fn partial_write_permission_and_commit_failures_keep_original() {
    for fault in ["write", "permissions", "rename"] {
        let f = fixture(true).await;
        let original =
            f.io.read("test", "/file.txt", false, &f.lease)
                .await
                .unwrap();
        {
            let mut state = f.files.lock().unwrap();
            state.fail_write = fault == "write";
            state.fail_permissions = fault == "permissions";
            state.fail_rename = fault == "rename";
        }
        assert!(
            f.io.save(
                "test",
                "/file.txt",
                b"changed",
                Some(&original.version),
                false,
                &f.lease
            )
            .await
            .is_err()
        );
        let state = f.files.lock().unwrap();
        assert_eq!(state.nodes["/file.txt"].data, b"good");
        assert_eq!(state.nodes.len(), 1);
        assert!(state.handles.is_empty());
    }
}

#[tokio::test]
async fn late_same_size_external_change_conflicts_before_replacement() {
    let f = fixture(true).await;
    let original =
        f.io.read("test", "/file.txt", false, &f.lease)
            .await
            .unwrap();
    f.files.lock().unwrap().change_target = true;
    assert_eq!(
        f.io.save(
            "test",
            "/file.txt",
            b"changed",
            Some(&original.version),
            false,
            &f.lease
        )
        .await
        .unwrap_err()
        .code,
        "editor_conflict"
    );
    let state = f.files.lock().unwrap();
    assert_eq!(state.nodes["/file.txt"].data, b"evil");
    assert_eq!(state.nodes.len(), 1);
}

#[tokio::test]
async fn cleanup_failure_reports_recoverable_temporary_path() {
    let f = fixture(true).await;
    let original =
        f.io.read("test", "/file.txt", false, &f.lease)
            .await
            .unwrap();
    {
        let mut state = f.files.lock().unwrap();
        state.fail_write = true;
        state.fail_cleanup = true;
    }
    let error =
        f.io.save(
            "test",
            "/file.txt",
            b"changed",
            Some(&original.version),
            false,
            &f.lease,
        )
        .await
        .unwrap_err();
    assert!(error.message.contains("清理"));
    assert!(
        error.details.unwrap()["cleanupPath"]
            .as_str()
            .unwrap()
            .contains(".duo-ssh-edit-")
    );
    assert_eq!(f.files.lock().unwrap().nodes["/file.txt"].data, b"good");
}

#[tokio::test]
async fn transport_loss_during_temporary_write_leaves_original_intact() {
    let f = fixture(true).await;
    f.io.raw.set_timeout(1);
    let original =
        f.io.read("test", "/file.txt", false, &f.lease)
            .await
            .unwrap();
    let started = {
        let mut state = f.files.lock().unwrap();
        state.stall_write = true;
        state.write_started.clone()
    };
    let saving = f.io.save(
        "test",
        "/file.txt",
        b"replacement",
        Some(&original.version),
        false,
        &f.lease,
    );
    tokio::pin!(saving);
    tokio::select! {
        _ = started.notified() => {},
        result = &mut saving => panic!("unexpected early save result: {:?}", result),
    }
    f.server.abort();
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), &mut saving)
        .await
        .unwrap();
    assert!(result.is_err());
    assert_eq!(f.files.lock().unwrap().nodes["/file.txt"].data, b"good");
}

#[tokio::test]
async fn new_files_are_exclusive_and_symlink_targets_are_rejected() {
    let f = fixture(true).await;
    f.io.save("test", "/new.txt", b"created", None, false, &f.lease)
        .await
        .unwrap();
    assert!(
        f.io.save("test", "/new.txt", b"overwrite", None, false, &f.lease)
            .await
            .is_err()
    );
    f.files
        .lock()
        .unwrap()
        .nodes
        .get_mut("/file.txt")
        .unwrap()
        .attributes
        .permissions = Some(0o120777);
    assert_eq!(
        f.io.read("test", "/file.txt", false, &f.lease)
            .await
            .err()
            .unwrap()
            .code,
        "editor_regular_file"
    );
}

#[tokio::test]
async fn bounded_directory_listing_closes_handles_and_rejects_malformed_server_names() {
    let f = fixture(true).await;
    let mut entries: Vec<_> = ["a", "b", "c"]
        .into_iter()
        .map(ProtocolFile::dummy)
        .collect();
    for item in &mut entries {
        item.attrs.permissions = Some(0o100600);
    }
    f.files
        .lock()
        .unwrap()
        .directories
        .insert("/".into(), entries);
    let (listing, truncated) = f.io.list_bounded("/", 2, &f.lease).await.unwrap();
    assert!(truncated);
    assert_eq!(listing.entries.len(), 2);
    assert!(f.files.lock().unwrap().handles.is_empty());
    f.files
        .lock()
        .unwrap()
        .directories
        .insert("/".into(), vec![ProtocolFile::dummy("../escape")]);
    assert!(f.io.list_bounded("/", 10, &f.lease).await.is_err());
    assert!(f.files.lock().unwrap().handles.is_empty());
}
