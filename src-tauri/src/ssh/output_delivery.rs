use crate::models::terminal::{TerminalStatusDelivery, TerminalStatusEvent, TerminalStreamEvent};
use std::collections::HashMap;
use tauri::ipc::Channel;

/// Subscriptions are separate from transport ownership. Each channel is bound
/// to the invoking WebView; unlike Tauri events it does not eval payloads in
/// unrelated windows, even if they registered a global event listener.
#[derive(Clone)]
pub(super) struct OutputSubscriber {
    pub subscription_id: String,
    pub channel: Channel<TerminalStreamEvent>,
}

#[derive(Default)]
pub(super) struct OutputDelivery {
    end_offset: u64,
    subscribers: HashMap<String, OutputSubscriber>,
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
            OutputSubscriber {
                subscription_id: subscription.into(),
                channel,
            },
        );
        self.end_offset
    }

    pub fn unsubscribe(&mut self, window: &str, subscription: &str) {
        if self
            .subscribers
            .get(window)
            .is_some_and(|entry| entry.subscription_id == subscription)
        {
            self.remove_window(window);
        }
    }

    pub fn remove_window(&mut self, window: &str) {
        self.subscribers.remove(window);
    }

    // Call under the delivery lock, also held while output is sent, so status
    // cannot overtake output between its offset being recorded and IPC send.
    pub fn send_status(&self, status: &TerminalStatusEvent) {
        for target in self.subscribers.values() {
            let _ = target
                .channel
                .send(TerminalStreamEvent::Status(TerminalStatusDelivery {
                    subscription_id: target.subscription_id.clone(),
                    status: status.clone(),
                }));
        }
    }

    pub fn record(&mut self, bytes: usize) -> (u64, u64, Vec<OutputSubscriber>) {
        let start = self.end_offset;
        self.end_offset += bytes as u64;
        (
            start,
            self.end_offset,
            self.subscribers.values().cloned().collect(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::terminal::TerminalOutputEvent;
    use std::sync::{Arc, Mutex};

    fn channel() -> Channel<TerminalStreamEvent> {
        Channel::new(|_| Ok(()))
    }
    fn ids(stream: &mut OutputDelivery) -> Vec<String> {
        let mut ids: Vec<_> = stream
            .record(1)
            .2
            .into_iter()
            .map(|entry| entry.subscription_id)
            .collect();
        ids.sort();
        ids
    }

    #[test]
    fn snapshot_checkpoint_and_live_ranges_share_one_offset() {
        let mut stream = OutputDelivery::default();
        let (start, end, targets) = stream.record("登录😀".len());
        assert_eq!((start, end), (0, 10));
        assert!(targets.is_empty());
        assert_eq!(stream.subscribe("main", "a", channel()), 10);
        let (start, end, targets) = stream.record(20);
        assert_eq!((start, end), (10, 30));
        assert_eq!(targets[0].subscription_id, "a");
        assert_eq!(stream.subscribe("detached-1", "b", channel()), 30);
        assert_eq!(ids(&mut stream), ["a", "b"]);
    }

    #[test]
    fn stale_unsubscribe_cannot_remove_a_newer_view_and_window_cleanup_is_complete() {
        let mut stream = OutputDelivery::default();
        stream.subscribe("main", "old", channel());
        stream.subscribe("main", "new", channel());
        stream.unsubscribe("main", "old");
        assert_eq!(ids(&mut stream), ["new"]);
        stream.unsubscribe("main", "new");
        assert!(ids(&mut stream).is_empty());
        stream.subscribe("detached-1", "new", channel());
        stream.remove_window("detached-1");
        assert!(ids(&mut stream).is_empty());
    }

    #[test]
    fn output_channels_deliver_only_to_registered_consumers() {
        let received = Arc::new(Mutex::new(Vec::new()));
        let capture = received.clone();
        let mut stream = OutputDelivery::default();
        stream.subscribe(
            "main",
            "main-stream",
            Channel::new(move |body| {
                capture.lock().unwrap().push(body);
                Ok(())
            }),
        );
        let (start_offset, end_offset, targets) = stream.record(4);
        assert_eq!(targets.len(), 1);
        for target in targets {
            target
                .channel
                .send(TerminalStreamEvent::Output(TerminalOutputEvent {
                    session_id: "terminal".into(),
                    subscription_id: target.subscription_id,
                    data: "text".into(),
                    start_offset,
                    end_offset,
                }))
                .unwrap();
        }
        let received = received.lock().unwrap();
        assert_eq!(received.len(), 1);
        let tauri::ipc::InvokeResponseBody::Json(json) = &received[0] else {
            panic!("expected JSON output");
        };
        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(value["subscriptionId"], "main-stream");
        assert_eq!(value["data"], "text");
        assert_eq!(value["startOffset"], 0);
        assert_eq!(value["endOffset"], 4);
    }
}
