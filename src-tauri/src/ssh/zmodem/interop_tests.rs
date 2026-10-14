//! Optional real-peer test. Build/install lrzsz separately, then run:
//! DSSH_TEST_RZ=/absolute/path/to/lrz cargo test lrzsz_pty -- --ignored --nocapture
//! No SSH credentials or user files are used; uploads live in a temporary directory.

use super::{ZmodemFinishFilter, ZmodemProbe, flush_sender_output};
use portable_pty::{Child, CommandBuilder, PtySize, native_pty_system};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::mpsc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use zmodem2::{Action, Event, FileInfo, Position, Sender};

struct Peer {
    child: Box<dyn Child + Send + Sync>,
    directory: PathBuf,
}

impl Drop for Peer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = fs::remove_dir_all(&self.directory);
    }
}

#[tokio::test]
#[ignore = "requires DSSH_TEST_RZ pointing to a real lrzsz receiver"]
async fn lrzsz_pty_upload_returns_to_shell_without_enter() {
    let rz = std::env::var("DSSH_TEST_RZ").expect("set DSSH_TEST_RZ to the lrz/rz executable");
    for (read_size, file_size) in [(4096, 65536), (1, 1024), (1, 0)] {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("dssh-rz-test-{}-{unique}", std::process::id()));
        fs::create_dir(&directory).unwrap();
        let pty = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut command = CommandBuilder::new("/bin/sh");
        // Original lrzsz 0.12.20 leaves IEXTEN enabled in its raw mode.
        // BSD PTYs can then eat VLNEXT from binary payloads; establish an
        // eight-bit-clean test PTY before running this older receiver.
        command.args([
            "-c",
            "stty -iexten; \"$1\" -y; rc=$?; printf '\\r\\nDSSH_RZ_EXIT_%s\\r\\n' \"$rc\"",
            "rz-test",
            &rz,
        ]);
        command.cwd(&directory);
        let mut peer = Peer {
            child: pty.slave.spawn_command(command).unwrap(),
            directory,
        };
        drop(pty.slave);
        let mut reader = pty.master.try_clone_reader().unwrap();
        let mut writer = pty.master.take_writer().unwrap();
        let (tx, rx) = mpsc::channel();
        let reader_thread = std::thread::spawn(move || {
            let mut buffer = vec![0; read_size];
            while let Ok(len) = reader.read(&mut buffer) {
                if len == 0 || tx.send(buffer[..len].to_vec()).is_err() {
                    break;
                }
            }
        });

        let payload: Vec<_> = (0..file_size).map(|index| (index % 256) as u8).collect();
        let mut probe = ZmodemProbe::default();
        let mut filter = ZmodemFinishFilter::default();
        let mut sender: Option<Sender> = None;
        let mut queued = Vec::new();
        let mut terminal = Vec::new();
        let mut completed = false;
        let deadline = Instant::now() + Duration::from_secs(15);
        let ready = b"DSSH_RZ_EXIT_0";

        loop {
            assert!(Instant::now() < deadline, "rz did not return to the shell");
            if completed && terminal.windows(ready.len()).any(|part| part == ready) {
                break;
            }
            if !completed && let Some(sender) = sender.as_mut() {
                match sender.poll() {
                    Action::WriteWire(bytes) => {
                        let len = bytes.len();
                        writer.write_all(bytes).unwrap_or_else(|error| {
                            let remaining: Vec<u8> = rx.try_iter().flatten().collect();
                            panic!("PTY write: {error}; outgoing={:02x?}; visible={:?}; remaining={remaining:02x?}; child={:?}",
                                &bytes[..bytes.len().min(32)], String::from_utf8_lossy(&terminal), peer.child.try_wait());
                        });
                        sender.wire_written(len);
                        continue;
                    }
                    Action::ReadFile { offset, max_len } => {
                        let start = offset.get() as usize;
                        let end = (start + max_len).min(payload.len());
                        sender.submit_file(&payload[start..end]).unwrap();
                        continue;
                    }
                    Action::Event(Event::FileCompleted) => {
                        sender.finish().unwrap();
                        continue;
                    }
                    Action::Event(Event::SessionCompleted) => {
                        // Reproduce the old premature return: the file is
                        // complete but rz is still waiting for OO, not Enter.
                        let before_ack = Instant::now() + Duration::from_millis(150);
                        while let Ok(packet) =
                            rx.recv_timeout(before_ack.saturating_duration_since(Instant::now()))
                        {
                            queued.extend(packet);
                        }
                        assert!(peer.child.try_wait().unwrap().is_none());
                        assert_eq!(
                            fs::read(peer.directory.join("payload.bin")).unwrap(),
                            payload
                        );
                        assert!(
                            queued.starts_with(b"\r\x8a"),
                            "actual lrzsz trailer: {queued:02x?}"
                        );
                        let mut final_wire = Vec::new();
                        flush_sender_output(sender, |bytes| {
                            final_wire.extend_from_slice(&bytes);
                            std::future::ready(writer.write_all(&bytes))
                        })
                        .await
                        .unwrap();
                        assert_eq!(final_wire, b"OO");
                        filter.finish_transfer();
                        terminal.extend(filter.feed(&queued));
                        queued.clear();
                        completed = true;
                        continue;
                    }
                    Action::Idle => {
                        if !queued.is_empty() {
                            let consumed = sender.submit_wire(&queued).unwrap();
                            queued.drain(..consumed);
                            if consumed > 0 {
                                continue;
                            }
                        }
                    }
                    other => panic!("unexpected upload action: {other:?}"),
                }
            }

            let packet = rx
                .recv_timeout(Duration::from_secs(3))
                .expect("rz stopped responding");
            if completed {
                terminal.extend(filter.feed(&packet));
            } else if sender.is_some() {
                queued.extend(packet);
            } else {
                let output = probe.feed(&packet);
                terminal.extend(output.text);
                if let Some(mut detection) = output.detection {
                    detection
                        .sender
                        .start_file(FileInfo::new(
                            b"payload.bin",
                            Some(Position::new(payload.len() as u32)),
                        ))
                        .unwrap();
                    queued.extend(detection.trailing);
                    sender = Some(detection.sender);
                    filter.begin_transfer();
                }
            }
        }

        assert!(peer.child.wait().unwrap().success());
        let visible =
            std::str::from_utf8(&terminal).expect("protocol bytes leaked into terminal UTF-8");
        assert!(!visible.contains('\u{fffd}'));
        assert!(!visible.contains("**\u{18}B"));
        assert_eq!(
            fs::read(peer.directory.join("payload.bin")).unwrap(),
            payload
        );
        reader_thread.join().unwrap();
        eprintln!(
            "lrzsz PTY: {file_size} bytes, packets <= {read_size} bytes, OO sent, shell returned, file matched"
        );
    }
}
