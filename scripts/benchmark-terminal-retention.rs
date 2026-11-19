//! Run from the repo root:
//! rustc --edition=2024 -O scripts/benchmark-terminal-retention.rs -o /tmp/dssh-retention-bench
//! /tmp/dssh-retention-bench
//! Synthetic retention cost only; excludes SSH, IPC, xterm and reader snapshots.
#[path = "../src-tauri/src/ssh/retained_output.rs"]
mod retained_output;
use retained_output::{RETAINED_OUTPUT_BYTES, RetainedOutput};
use std::{hint::black_box, time::Instant};

fn main() {
    for size in [64, 16_384] {
        let chunk = "x".repeat(size);
        let mut reference = String::new();
        let started = Instant::now();
        for _ in 0..50_000_000 / size {
            reference.push_str(&chunk);
            if reference.len() > RETAINED_OUTPUT_BYTES {
                reference.drain(..reference.len() - RETAINED_OUTPUT_BYTES);
            }
        }
        println!(
            "String drain, chunk={size}, time_us={}",
            started.elapsed().as_micros()
        );
        let mut output = RetainedOutput::default();
        let started = Instant::now();
        for _ in 0..50_000_000 / size {
            output.append(&chunk);
        }
        println!(
            "chunk deque, chunk={size}, time_us={}",
            started.elapsed().as_micros()
        );
        std::hint::black_box(output.revision());
        assert!(output.matches(&reference));
        assert_eq!(output.snapshot(), reference);
        let started = Instant::now();
        for _ in 0..1000 {
            black_box(reference.clone());
        }
        println!(
            "String reader, chunk={size}, snapshots=1000, time_us={}",
            started.elapsed().as_micros()
        );
        let started = Instant::now();
        for _ in 0..1000 {
            black_box(output.snapshot());
        }
        println!(
            "deque reader, chunk={size}, snapshots=1000, time_us={}",
            started.elapsed().as_micros()
        );
        black_box(output);
    }
}
