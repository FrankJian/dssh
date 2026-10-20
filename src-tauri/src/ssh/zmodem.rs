use std::time::{Duration, Instant};
use zmodem2::{Action, FileInfo, Position, Receiver, Sender};

/// Standard ZMODEM abort: ten CAN bytes followed by ten backspaces. The peer
/// needs five CAN bytes to exit; the backspaces avoid leaving visible control
/// characters if it has already returned to a command interpreter.
pub(crate) const ZMODEM_ABORT_SEQUENCE: [u8; 20] = [
    0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08,
    0x08, 0x08, 0x08, 0x08,
];

/// zmodem2 reports SessionCompleted before exposing the queued final `OO`.
/// The caller must flush those bytes successfully before releasing the PTY
/// to terminal input or reporting completion to the UI.
pub(crate) async fn flush_sender_output<E, F: std::future::Future<Output = Result<(), E>>>(
    sender: &mut Sender,
    mut write: impl FnMut(Vec<u8>) -> F,
) -> Result<(), E> {
    while let Action::WriteWire(bytes) = sender.poll() {
        let len = bytes.len();
        write(bytes.to_vec()).await?;
        sender.wire_written(len);
    }
    Ok(())
}

const MAX_CANDIDATE_BYTES: usize = 32;
const MAX_MARKER_BYTES: usize = 6;
const FINISH_FRAME_GRACE: Duration = Duration::from_secs(2);
const ZFIN_HEX_MARKERS: [&[u8]; 2] = [b"**\x18B08", b"*\x18B08"];

pub(crate) struct ZmodemDetection {
    pub sender: Sender,
    pub trailing: Vec<u8>,
}

pub(crate) struct ProbeOutput {
    pub text: Vec<u8>,
    pub detection: Option<ZmodemDetection>,
}

pub(crate) struct ZmodemDownloadDetection {
    pub trailing: Vec<u8>,
}

pub(crate) struct DownloadProbeOutput {
    pub text: Vec<u8>,
    pub detection: Option<ZmodemDownloadDetection>,
}

/// Briefly filters a late copy of the receiver's final ZFIN frame after the
/// sender has completed. Some PTY implementations deliver that frame after
/// the sender has already reported completion, where the ordinary probe would
/// otherwise render its binary/control framing as terminal text.
#[derive(Default)]
pub(crate) struct ZmodemFinishFilter {
    pending: Vec<u8>,
    active_until: Option<Instant>,
    during_transfer: bool,
    trailer: HexTrailer,
}

#[derive(Default)]
enum HexTrailer {
    #[default]
    None,
    Start,
    AfterCr,
    AfterLf,
}

impl ZmodemFinishFilter {
    /// Filter ZMODEM control residue in terminal output streams for the whole
    /// transfer, including SSH extended data that is not consumed by Sender.
    pub fn begin_transfer(&mut self) {
        self.pending.clear();
        self.active_until = None;
        self.during_transfer = true;
        self.trailer = HexTrailer::None;
    }

    /// Keep filtering briefly after completion because PTYs may deliver a
    /// duplicate final frame after the protocol sender has already finished.
    pub fn finish_transfer(&mut self) {
        self.during_transfer = false;
        self.active_until = Some(Instant::now() + FINISH_FRAME_GRACE);
        // Sender consumes the final header only through its CRC. Its ZHEX
        // terminator is still in buffered_wire, possibly in the next packet.
        self.trailer = HexTrailer::Start;
    }

    pub fn feed(&mut self, input: &[u8]) -> Vec<u8> {
        let mut visible = Vec::new();
        if !self.during_transfer
            && self
                .active_until
                .is_some_and(|deadline| Instant::now() >= deadline)
        {
            visible.append(&mut self.pending);
            self.active_until = None;
            self.trailer = HexTrailer::None;
        }
        if !self.during_transfer && self.active_until.is_none() {
            visible.extend_from_slice(input);
            return visible;
        }

        self.pending.extend_from_slice(input);
        while let Some(&first) = self.pending.first() {
            match self.trailer {
                HexTrailer::Start if first == b'\r' => {
                    self.pending.remove(0);
                    visible.push(b'\r');
                    self.trailer = HexTrailer::AfterCr;
                    continue;
                }
                HexTrailer::Start | HexTrailer::AfterCr if matches!(first, b'\n' | 0x8a) => {
                    // lrzsz writes CR + high-bit LF (0212), not UTF-8.
                    // Restore LF only at the known header boundary so the
                    // prompt starts on a new line without leaving "receive."
                    // underneath it. Never replace 0x8a in ordinary text.
                    self.pending.remove(0);
                    visible.push(b'\n');
                    self.trailer = HexTrailer::AfterLf;
                    continue;
                }
                HexTrailer::AfterLf if first == 0x11 => {
                    self.pending.remove(0);
                    self.trailer = HexTrailer::None;
                    continue;
                }
                _ => self.trailer = HexTrailer::None,
            }
            let Some(start) = find_zfin_marker(&self.pending) else {
                let safe_len = self
                    .pending
                    .len()
                    .saturating_sub(longest_zfin_marker_prefix(&self.pending));
                visible.extend(self.pending.drain(..safe_len));
                break;
            };
            if start > 0 {
                visible.extend(self.pending.drain(..start));
            }

            match validate_zfin_header(&self.pending) {
                ZfinCandidate::Complete(header_len) => {
                    self.pending.drain(..header_len);
                    self.trailer = HexTrailer::Start;
                }
                ZfinCandidate::Incomplete => break,
                ZfinCandidate::Invalid => visible.push(self.pending.remove(0)),
            }
        }
        visible
    }

    pub fn finish(&mut self) -> Vec<u8> {
        self.active_until = None;
        self.during_transfer = false;
        self.trailer = HexTrailer::None;
        std::mem::take(&mut self.pending)
    }
}

enum ZfinCandidate {
    Incomplete,
    Invalid,
    Complete(usize),
}

fn validate_zfin_header(bytes: &[u8]) -> ZfinCandidate {
    let marker_len = if bytes.starts_with(ZFIN_HEX_MARKERS[0]) {
        ZFIN_HEX_MARKERS[0].len()
    } else if bytes.starts_with(ZFIN_HEX_MARKERS[1]) {
        ZFIN_HEX_MARKERS[1].len()
    } else {
        return ZfinCandidate::Invalid;
    };

    // ZFIN is frame 08 with a zero position, followed by a four-digit CRC.
    let flags_end = marker_len + 8;
    if bytes.len() < flags_end {
        return ZfinCandidate::Incomplete;
    }
    if bytes[marker_len..flags_end]
        .iter()
        .any(|byte| *byte != b'0')
    {
        return ZfinCandidate::Invalid;
    }

    let crc_end = flags_end + 4;
    if bytes.len() < crc_end {
        return ZfinCandidate::Incomplete;
    }
    if !bytes[flags_end..crc_end].iter().all(u8::is_ascii_hexdigit) {
        return ZfinCandidate::Invalid;
    }
    let Some(actual_crc) = std::str::from_utf8(&bytes[flags_end..crc_end])
        .ok()
        .and_then(|hex| u16::from_str_radix(hex, 16).ok())
    else {
        return ZfinCandidate::Invalid;
    };
    if actual_crc != zfin_crc16() {
        return ZfinCandidate::Invalid;
    }
    ZfinCandidate::Complete(crc_end)
}

fn zfin_crc16() -> u16 {
    let mut crc = 0_u16;
    for byte in [0x08_u8, 0, 0, 0, 0] {
        crc ^= u16::from(byte) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

fn find_zfin_marker(bytes: &[u8]) -> Option<usize> {
    (0..bytes.len()).find(|&start| {
        ZFIN_HEX_MARKERS
            .iter()
            .any(|marker| bytes[start..].starts_with(marker))
    })
}

fn longest_zfin_marker_prefix(bytes: &[u8]) -> usize {
    (1..=bytes.len().min(ZFIN_HEX_MARKERS[0].len()))
        .rev()
        .find(|&length| {
            let suffix = &bytes[bytes.len() - length..];
            ZFIN_HEX_MARKERS
                .iter()
                .any(|marker| marker.starts_with(suffix))
        })
        .unwrap_or(0)
}

/// Incrementally finds and validates a receiver's first ZRINIT header without
/// sending any bytes to the peer. Everything outside a valid header is
/// returned to the ordinary terminal stream in its original order.
#[derive(Default)]
pub(crate) struct ZmodemProbe {
    pending: Vec<u8>,
    suppressed: bool,
}

impl ZmodemProbe {
    pub fn feed(&mut self, input: &[u8]) -> ProbeOutput {
        if self.suppressed {
            return ProbeOutput {
                text: input.to_vec(),
                detection: None,
            };
        }
        self.pending.extend_from_slice(input);
        let mut visible = Vec::new();

        loop {
            let Some(start) = find_zrinit_marker(&self.pending) else {
                let safe_len = self
                    .pending
                    .len()
                    .saturating_sub(longest_marker_prefix(&self.pending));
                visible.extend(self.pending.drain(..safe_len));
                break;
            };
            if start > 0 {
                visible.extend(self.pending.drain(..start));
            }

            match validate_zrinit(&self.pending) {
                Ok(Some((sender, header_len))) => {
                    let trailing = self.pending.split_off(header_len);
                    self.pending.clear();
                    return ProbeOutput {
                        text: visible,
                        detection: Some(ZmodemDetection { sender, trailing }),
                    };
                }
                Ok(None) if self.pending.len() <= MAX_CANDIDATE_BYTES => break,
                Ok(None) | Err(()) => {
                    // This was ordinary output containing a ZMODEM-like
                    // prefix. Release one byte and resume scanning so a real
                    // frame immediately following it is still discoverable.
                    visible.push(self.pending.remove(0));
                }
            }
        }

        ProbeOutput {
            text: visible,
            detection: None,
        }
    }

    pub fn suppress_until_cancel(&mut self) {
        self.pending.clear();
        self.suppressed = true;
    }

    pub fn rearm(&mut self) {
        self.suppressed = false;
        self.pending.clear();
    }

    pub fn finish(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pending)
    }
}

/// Finds the sender's initial ZRQINIT frame used by `sz`. Detection never
/// writes a response: the caller waits for the user to choose a local
/// destination before constructing a live receiver.
#[derive(Default)]
pub(crate) struct ZmodemDownloadProbe {
    pending: Vec<u8>,
    suppressed: bool,
}

impl ZmodemDownloadProbe {
    pub fn feed(&mut self, input: &[u8]) -> DownloadProbeOutput {
        if self.suppressed {
            return DownloadProbeOutput {
                text: input.to_vec(),
                detection: None,
            };
        }
        self.pending.extend_from_slice(input);
        let mut visible = Vec::new();

        loop {
            let Some(start) = find_zrqinit_marker(&self.pending) else {
                let safe_len = self
                    .pending
                    .len()
                    .saturating_sub(longest_zrqinit_marker_prefix(&self.pending));
                visible.extend(self.pending.drain(..safe_len));
                break;
            };
            if start > 0 {
                visible.extend(self.pending.drain(..start));
            }

            match validate_zrqinit(&self.pending) {
                Ok(Some(header_len)) => {
                    let trailing = self.pending.split_off(header_len);
                    self.pending.clear();
                    return DownloadProbeOutput {
                        text: visible,
                        detection: Some(ZmodemDownloadDetection { trailing }),
                    };
                }
                Ok(None) if self.pending.len() <= MAX_CANDIDATE_BYTES => break,
                Ok(None) | Err(()) => visible.push(self.pending.remove(0)),
            }
        }

        DownloadProbeOutput {
            text: visible,
            detection: None,
        }
    }

    pub fn suppress_until_cancel(&mut self) {
        self.pending.clear();
        self.suppressed = true;
    }

    pub fn rearm(&mut self) {
        self.suppressed = false;
        self.pending.clear();
    }

    pub fn finish(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pending)
    }
}

fn validate_zrinit(bytes: &[u8]) -> Result<Option<(Sender, usize)>, ()> {
    for header_len in 1..=bytes.len().min(MAX_CANDIDATE_BYTES) {
        let mut candidate = primed_sender()?;
        candidate
            .submit_wire(&bytes[..header_len])
            .map_err(|_| ())?;
        candidate
            .start_file(FileInfo::new(b"probe", Some(Position::new(0))))
            .map_err(|_| ())?;
        if !matches!(candidate.poll(), Action::WriteWire(_)) {
            continue;
        }

        // Recreate the sender without the probe file, but with the verified
        // receiver header already consumed. `submit_wire`'s consumed count
        // also lets us preserve any bytes following this header in the same
        // SSH packet.
        let mut sender = primed_sender()?;
        let consumed = sender.submit_wire(&bytes[..header_len]).map_err(|_| ())?;
        if consumed != header_len {
            return Err(());
        }
        return Ok(Some((sender, header_len)));
    }
    Ok(None)
}

fn primed_sender() -> Result<Sender, ()> {
    let mut sender = Sender::new().map_err(|_| ())?;
    let initial_wire_len = match sender.poll() {
        Action::WriteWire(wire) => wire.len(),
        _ => return Err(()),
    };
    sender.wire_written(initial_wire_len);
    Ok(sender)
}

fn validate_zrqinit(bytes: &[u8]) -> Result<Option<usize>, ()> {
    for header_len in 1..=bytes.len().min(MAX_CANDIDATE_BYTES) {
        let mut receiver = primed_receiver()?;
        let consumed = receiver.submit_wire(&bytes[..header_len]).map_err(|_| ())?;
        if consumed != header_len {
            continue;
        }
        if matches!(receiver.poll(), Action::WriteWire(_)) {
            return Ok(Some(header_len));
        }
    }
    Ok(None)
}

fn primed_receiver() -> Result<Receiver, ()> {
    let mut receiver = Receiver::with_flow_control(0, true).map_err(|_| ())?;
    let initial_wire_len = match receiver.poll() {
        Action::WriteWire(wire) => wire.len(),
        _ => return Err(()),
    };
    receiver.wire_written(initial_wire_len);
    Ok(receiver)
}

fn find_zrinit_marker(bytes: &[u8]) -> Option<usize> {
    (0..bytes.len()).find(|&start| {
        let rest = &bytes[start..];
        marker_matches(rest, b"**\x18B01")
            || marker_matches(rest, b"*\x18B01")
            || marker_matches(rest, b"**\x18C\x01")
            || marker_matches(rest, b"*\x18C\x01")
            || marker_matches(rest, b"**\x18A\x01")
            || marker_matches(rest, b"*\x18A\x01")
    })
}

fn marker_matches(bytes: &[u8], marker: &[u8]) -> bool {
    bytes.starts_with(marker)
}

fn longest_marker_prefix(bytes: &[u8]) -> usize {
    (1..=bytes.len().min(MAX_MARKER_BYTES))
        .rev()
        .find(|&length| {
            let suffix = &bytes[bytes.len() - length..];
            [
                b"**\x18B01".as_slice(),
                b"*\x18B01",
                b"**\x18C\x01",
                b"*\x18C\x01",
                b"**\x18A\x01",
                b"*\x18A\x01",
            ]
            .iter()
            .any(|marker| marker.starts_with(suffix))
        })
        .unwrap_or(0)
}

fn find_zrqinit_marker(bytes: &[u8]) -> Option<usize> {
    (0..bytes.len()).find(|&start| {
        let rest = &bytes[start..];
        marker_matches(rest, b"**\x18B00")
            || marker_matches(rest, b"*\x18B00")
            || marker_matches(rest, b"**\x18C\x00")
            || marker_matches(rest, b"*\x18C\x00")
            || marker_matches(rest, b"**\x18A\x00")
            || marker_matches(rest, b"*\x18A\x00")
    })
}

fn longest_zrqinit_marker_prefix(bytes: &[u8]) -> usize {
    (1..=bytes.len().min(MAX_MARKER_BYTES))
        .rev()
        .find(|&length| {
            let suffix = &bytes[bytes.len() - length..];
            [
                b"**\x18B00".as_slice(),
                b"*\x18B00",
                b"**\x18C\x00",
                b"*\x18C\x00",
                b"**\x18A\x00",
                b"*\x18A\x00",
            ]
            .iter()
            .any(|marker| marker.starts_with(suffix))
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{
        ZMODEM_ABORT_SEQUENCE, ZmodemDownloadProbe, ZmodemFinishFilter, flush_sender_output,
        primed_sender,
    };
    use zmodem2::{Action, Event, Receiver, Sender};

    #[test]
    fn pending_selection_abort_matches_the_protocol_engine() {
        let mut sender = Sender::new().expect("sender starts");
        sender.abort();
        match sender.poll() {
            Action::WriteWire(bytes) => assert_eq!(bytes, ZMODEM_ABORT_SEQUENCE),
            action => panic!("expected cancel bytes, got {action:?}"),
        }
    }

    const ZFIN: &[u8] = b"**\x18B0800000000022d\r\n";

    #[test]
    fn finish_filter_hides_late_zfin_and_preserves_shell_output() {
        let mut filter = ZmodemFinishFilter::default();
        filter.finish_transfer();

        // Unrelated bytes must survive; only verified protocol framing is
        // consumed. Guessing that arbitrary invalid UTF-8 is residue loses data.
        let mut bytes = b"\xff".to_vec();
        bytes.extend_from_slice(ZFIN);
        bytes.extend_from_slice(b"j3xie@holiday:~$ ");

        let visible = filter.feed(&bytes);
        assert_eq!(visible, b"\xff\r\nj3xie@holiday:~$ ");
    }

    #[test]
    fn finish_filter_handles_a_zfin_frame_split_across_packets() {
        let mut filter = ZmodemFinishFilter::default();
        filter.finish_transfer();

        let split = 9;
        let first = filter.feed(&ZFIN[..split]);
        assert!(first.is_empty());

        let second = filter.feed(&ZFIN[split..]);
        assert_eq!(second, b"\r\n");
    }

    #[test]
    fn finish_filter_hides_zfin_without_line_terminator_before_shell_output() {
        let mut filter = ZmodemFinishFilter::default();
        filter.finish_transfer();

        let header = &ZFIN[..ZFIN.len() - 2];
        let mut bytes = header.to_vec();
        bytes.extend_from_slice(b"dive.");

        assert_eq!(filter.feed(&bytes), b"dive.");
    }

    #[test]
    fn finish_filter_catches_split_zfin_residue_during_transfer() {
        let mut filter = ZmodemFinishFilter::default();
        filter.begin_transfer();

        let mut first_packet = Vec::new();
        first_packet.extend_from_slice(&ZFIN[..9]);
        assert!(filter.feed(&first_packet).is_empty());

        let mut second_packet = ZFIN[9..ZFIN.len() - 2].to_vec();
        second_packet.extend_from_slice(b"j3xie@holiday:~$ ");
        assert_eq!(filter.feed(&second_packet), b"j3xie@holiday:~$ ");

        filter.finish_transfer();
        assert_eq!(filter.feed(b"\r\n"), b"\r\n");
    }

    #[test]
    fn lrzsz_final_trailer_and_prompt_survive_every_packet_boundary() {
        // lrzsz zshhdr writes CR + 0212 (high-bit LF). Sender stops at the
        // CRC, so this suffix is the first terminal output after completion.
        let mut wire = b"\r\x8a".to_vec();
        wire.extend_from_slice(b"**\x18B0800000000022d\r\x8a\x11");
        wire.extend_from_slice("提示符：上$ ".as_bytes()); // 上 contains UTF-8 byte 0x8a
        for split in 0..=wire.len() {
            let mut filter = ZmodemFinishFilter::default();
            filter.finish_transfer();
            let mut visible = filter.feed(&wire[..split]);
            visible.extend(filter.feed(&wire[split..]));
            visible.extend(filter.finish());
            assert_eq!(visible, "\r\n\r\n提示符：上$ ".as_bytes(), "split {split}");
        }
        let mut filter = ZmodemFinishFilter::default();
        filter.finish_transfer();
        let visible: Vec<_> = wire.iter().flat_map(|byte| filter.feed(&[*byte])).collect();
        assert_eq!(visible, "\r\n\r\n提示符：上$ ".as_bytes());
    }

    #[tokio::test]
    async fn completion_event_requires_flushing_oo_and_propagates_write_failure() {
        let mut receiver = Receiver::new().unwrap();
        let init = match receiver.poll() {
            Action::WriteWire(bytes) => bytes.to_vec(),
            other => panic!("unexpected receiver action: {other:?}"),
        };
        let mut sender = primed_sender().unwrap();
        sender.submit_wire(&init).unwrap();
        sender.finish().unwrap();
        flush_sender_output(&mut sender, |_| std::future::ready(Ok::<_, ()>(())))
            .await
            .unwrap();

        // Production library returns SessionCompleted with the OO still queued.
        assert_eq!(sender.submit_wire(ZFIN).unwrap(), ZFIN.len() - 2);
        assert!(matches!(
            sender.poll(),
            Action::Event(Event::SessionCompleted)
        ));
        let error =
            flush_sender_output(&mut sender, |_| std::future::ready(Err("write failed"))).await;
        assert_eq!(error, Err("write failed"));

        let mut sent = Vec::new();
        flush_sender_output(&mut sender, |bytes| {
            sent.extend(bytes);
            std::future::ready(Ok::<_, ()>(()))
        })
        .await
        .unwrap();
        assert_eq!(sent, b"OO");
        assert!(matches!(sender.poll(), Action::Idle));
    }

    #[test]
    fn finish_filter_preserves_non_zfin_text() {
        let mut filter = ZmodemFinishFilter::default();
        filter.finish_transfer();

        assert_eq!(
            filter.feed(b"** this is ordinary output\r\n"),
            b"** this is ordinary output\r\n"
        );
    }

    #[test]
    fn finish_filter_preserves_a_zfin_like_frame_with_an_invalid_crc() {
        let mut filter = ZmodemFinishFilter::default();
        filter.finish_transfer();

        assert_eq!(
            filter.feed(b"**\x18B080000000000000\r\n"),
            b"**\x18B080000000000000\r\n"
        );
    }

    #[test]
    fn download_probe_detects_a_sender_handshake_across_packet_boundaries() {
        let mut sender = zmodem2::Sender::new().unwrap();
        let handshake = match sender.poll() {
            Action::WriteWire(bytes) => bytes.to_vec(),
            other => panic!("unexpected sender action: {other:?}"),
        };
        for split in 0..handshake.len() {
            let mut probe = ZmodemDownloadProbe::default();
            let first = probe.feed(&handshake[..split]);
            let second = probe.feed(&handshake[split..]);
            assert!(
                first.detection.is_some() || second.detection.is_some(),
                "sender handshake should be detected",
            );
        }
    }
}

#[cfg(all(test, unix))]
#[path = "zmodem/interop_tests.rs"]
mod interop_tests;
