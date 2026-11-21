use crate::{
    error::{AppError, AppResult},
    models::terminal::{
        TerminalOutputEvent, TerminalOutputPaused, TerminalStatusDelivery, TerminalStatusEvent,
        TerminalStreamEvent,
    },
};
use std::collections::{HashMap, VecDeque};
use tauri::ipc::Channel;

const PACKET_BYTES: usize = 16 * 1024;
const FLIGHT_BYTES: u64 = 128 * 1024;
const FLIGHT_EVENTS: usize = 16;
const QUEUE_BYTES: usize = 4 * 1024 * 1024;
const QUEUE_EVENTS: usize = 512;

enum Pending {
    Output { data: String, start: u64, end: u64 },
    Status(TerminalStatusEvent),
}

struct Subscriber {
    token: String,
    channel: Channel<TerminalStreamEvent>,
    acknowledged: u64,
    sent: u64,
    boundaries: VecDeque<u64>,
    pending: VecDeque<Pending>,
    queued_bytes: usize,
    paused: bool,
}

impl Subscriber {
    fn drain(&mut self, session_id: &str) {
        while let Some(front) = self.pending.front() {
            if let Pending::Output { end, .. } = front
                && (end - self.acknowledged > FLIGHT_BYTES
                    || self.boundaries.len() >= FLIGHT_EVENTS)
            {
                break;
            }
            let event = match self.pending.pop_front().expect("front exists") {
                Pending::Output { data, start, end } => {
                    self.queued_bytes -= data.len();
                    self.sent = end;
                    self.boundaries.push_back(end);
                    TerminalStreamEvent::Output(TerminalOutputEvent {
                        session_id: session_id.into(),
                        subscription_id: self.token.clone(),
                        data,
                        start_offset: start,
                        end_offset: end,
                    })
                }
                Pending::Status(status) => TerminalStreamEvent::Status(TerminalStatusDelivery {
                    subscription_id: self.token.clone(),
                    status,
                }),
            };
            if self.channel.send(event).is_err() {
                self.paused = true;
                self.pending.clear();
                self.queued_bytes = 0;
                break;
            }
        }
    }

    fn pause(&mut self, session_id: &str) {
        self.paused = true;
        self.pending.clear();
        self.queued_bytes = 0;
        // The screen remains an exact prefix, never a stream with an invisible
        // hole. Explicit resume starts a new subscription and resets the view.
        let _ = self
            .channel
            .send(TerminalStreamEvent::Paused(TerminalOutputPaused {
                session_id: session_id.into(),
                subscription_id: self.token.clone(),
            }));
    }
}

/// Bounded per-window delivery; PTY/SSH reads and input never wait for the UI.
/// ACK means xterm parsed the data (or a view-less consumer retained it).
#[derive(Default)]
pub(super) struct OutputDelivery {
    end_offset: u64,
    subscribers: HashMap<String, Subscriber>,
}

impl OutputDelivery {
    pub fn end_offset(&self) -> u64 {
        self.end_offset
    }

    pub fn subscribe(
        &mut self,
        window: &str,
        subscription: &str,
        channel: Channel<TerminalStreamEvent>,
    ) -> u64 {
        self.subscribers.insert(
            window.into(),
            Subscriber {
                token: subscription.into(),
                channel,
                acknowledged: self.end_offset,
                sent: self.end_offset,
                boundaries: VecDeque::new(),
                pending: VecDeque::new(),
                queued_bytes: 0,
                paused: false,
            },
        );
        self.end_offset
    }

    pub fn unsubscribe(&mut self, window: &str, subscription: &str) {
        if self
            .subscribers
            .get(window)
            .is_some_and(|s| s.token == subscription)
        {
            self.remove_window(window);
        }
    }

    pub fn remove_window(&mut self, window: &str) {
        self.subscribers.remove(window);
    }

    pub fn acknowledge(
        &mut self,
        session_id: &str,
        window: &str,
        token: &str,
        end: u64,
    ) -> AppResult<()> {
        let Some(subscriber) = self
            .subscribers
            .get_mut(window)
            .filter(|s| s.token == token)
        else {
            return Ok(()); // Late ACK from a disposed/replaced view.
        };
        if end <= subscriber.acknowledged {
            return Ok(());
        }
        if end > subscriber.sent || !subscriber.boundaries.contains(&end) {
            return Err(AppError::new(
                "terminal_output_ack",
                "终端输出确认位置无效。",
            ));
        }
        subscriber.acknowledged = end;
        while subscriber
            .boundaries
            .front()
            .is_some_and(|offset| *offset <= end)
        {
            subscriber.boundaries.pop_front();
        }
        if !subscriber.paused {
            subscriber.drain(session_id);
        }
        Ok(())
    }

    pub fn send_status(&mut self, status: &TerminalStatusEvent) {
        for subscriber in self.subscribers.values_mut() {
            // Lifecycle is still delivered while paused, but never releases
            // output credit. In normal delivery it cannot overtake queued data.
            if subscriber.paused {
                let _ =
                    subscriber
                        .channel
                        .send(TerminalStreamEvent::Status(TerminalStatusDelivery {
                            subscription_id: subscriber.token.clone(),
                            status: status.clone(),
                        }));
            } else if subscriber.pending.len() >= QUEUE_EVENTS {
                subscriber.pause(&status.session_id);
                let _ =
                    subscriber
                        .channel
                        .send(TerminalStreamEvent::Status(TerminalStatusDelivery {
                            subscription_id: subscriber.token.clone(),
                            status: status.clone(),
                        }));
            } else {
                subscriber
                    .pending
                    .push_back(Pending::Status(status.clone()));
                subscriber.drain(&status.session_id);
            }
        }
    }

    pub fn publish(&mut self, session_id: &str, text: &str) {
        let start = self.end_offset;
        self.end_offset += text.len() as u64;
        for subscriber in self.subscribers.values_mut().filter(|s| !s.paused) {
            let mut offset = 0;
            while offset < text.len() {
                let mut end = (offset + PACKET_BYTES).min(text.len());
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
                let data = &text[offset..end];
                if subscriber.queued_bytes + data.len() > QUEUE_BYTES
                    || subscriber.pending.len() >= QUEUE_EVENTS
                {
                    subscriber.pause(session_id);
                    break;
                }
                subscriber.pending.push_back(Pending::Output {
                    data: data.into(),
                    start: start + offset as u64,
                    end: start + end as u64,
                });
                subscriber.queued_bytes += data.len();
                subscriber.drain(session_id);
                if subscriber.paused {
                    break;
                }
                offset = end;
            }
        }
    }

    #[cfg(test)]
    pub fn record(&mut self, bytes: usize) {
        self.end_offset += bytes as u64;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn capture() -> (
        Channel<TerminalStreamEvent>,
        Arc<Mutex<Vec<serde_json::Value>>>,
    ) {
        let received = Arc::new(Mutex::new(Vec::new()));
        let target = received.clone();
        (
            Channel::new(move |body| {
                let tauri::ipc::InvokeResponseBody::Json(json) = body else {
                    panic!("expected JSON")
                };
                target
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(&json).unwrap());
                Ok(())
            }),
            received,
        )
    }

    #[test]
    fn stalled_renderer_has_bounded_flight_and_queue_and_overflows_once() {
        let mut stream = OutputDelivery::default();
        let (channel, events) = capture();
        stream.subscribe("main", "a", channel);
        for _ in 0..5000 {
            stream.publish("pty", &"x".repeat(PACKET_BYTES));
        }
        let subscriber = &stream.subscribers["main"];
        assert!(subscriber.paused);
        assert_eq!(subscriber.queued_bytes, 0);
        assert!(subscriber.pending.is_empty());
        assert!(subscriber.sent - subscriber.acknowledged <= FLIGHT_BYTES);
        assert!(subscriber.boundaries.len() <= FLIGHT_BYTES as usize / PACKET_BYTES);
        let events = events.lock().unwrap();
        assert_eq!(events.iter().filter(|e| e["type"] == "paused").count(), 1);
        assert_eq!(events.iter().filter(|e| e["type"] == "output").count(), 8);
    }

    #[test]
    fn unicode_ansi_and_status_are_lossless_and_ordered_as_credit_returns() {
        let mut stream = OutputDelivery::default();
        let (channel, events) = capture();
        stream.subscribe("main", "a", channel);
        let text = "中😀\x1b[31mlog\x1b[0m\r\n".repeat(20_000);
        stream.publish("pty", &text);
        stream.send_status(&TerminalStatusEvent {
            session_id: "pty".into(),
            status: crate::models::terminal::SessionStatus::Disconnected,
            message: None,
        });
        assert!(!events.lock().unwrap().iter().any(|e| e["type"] == "status"));
        while stream.subscribers["main"].acknowledged < text.len() as u64 {
            let sent = stream.subscribers["main"].sent;
            stream.acknowledge("pty", "main", "a", sent).unwrap();
        }
        let events = events.lock().unwrap();
        let joined: String = events.iter().filter_map(|e| e["data"].as_str()).collect();
        assert_eq!(joined, text);
        assert_eq!(events.last().unwrap()["type"], "status");
    }

    #[test]
    fn stale_or_forged_ack_cannot_release_credit_and_other_windows_keep_running() {
        let mut stream = OutputDelivery::default();
        let (channel, _) = capture();
        stream.subscribe("main", "old", channel);
        let (channel, events) = capture();
        stream.subscribe("main", "new", channel);
        stream.publish("pty", &"x".repeat(FLIGHT_BYTES as usize * 2));
        stream
            .acknowledge("pty", "main", "old", FLIGHT_BYTES)
            .unwrap();
        assert_eq!(stream.subscribers["main"].acknowledged, 0);
        assert!(stream.acknowledge("pty", "main", "new", 1).is_err());
        assert!(
            stream
                .acknowledge("pty", "main", "new", FLIGHT_BYTES * 2)
                .is_err()
        );
        stream.unsubscribe("main", "old");
        assert_eq!(stream.subscribers.len(), 1);
        let (channel, second) = capture();
        let checkpoint = stream.subscribe("detached-1", "other", channel);
        stream.publish("pty", "new window");
        assert_eq!(second.lock().unwrap()[0]["startOffset"], checkpoint);
        assert_eq!(events.lock().unwrap().len(), 8);
        stream.remove_window("main");
        assert_eq!(stream.subscribers.len(), 1);
    }

    #[test]
    fn sustained_acknowledged_output_does_not_accumulate_with_total_volume() {
        let mut stream = OutputDelivery::default();
        let received = Arc::new(Mutex::new(0_usize));
        let counter = received.clone();
        stream.subscribe(
            "main",
            "a",
            Channel::new(move |body| {
                let tauri::ipc::InvokeResponseBody::Json(json) = body else {
                    panic!("expected JSON")
                };
                let value: serde_json::Value = serde_json::from_str(&json).unwrap();
                assert_eq!(value["type"], "output");
                *counter.lock().unwrap() += value["data"].as_str().unwrap().len();
                Ok(())
            }),
        );
        let data = "x".repeat(PACKET_BYTES);
        for _ in 0..4096 {
            stream.publish("pty", &data);
            stream
                .acknowledge("pty", "main", "a", stream.end_offset())
                .unwrap();
            let subscriber = &stream.subscribers["main"];
            assert!(subscriber.pending.is_empty());
            assert!(subscriber.boundaries.is_empty());
            assert!(!subscriber.paused);
        }
        assert_eq!(*received.lock().unwrap(), PACKET_BYTES * 4096);
    }
}
