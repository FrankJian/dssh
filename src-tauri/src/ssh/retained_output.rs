use std::collections::VecDeque;

/// Same byte retention and UTF-8 boundary policy as the former String snapshot.
/// This is raw history, not a self-contained ANSI screen serialization.
pub(super) const RETAINED_OUTPUT_BYTES: usize = 200_000;
const SMALL_CHUNK_BYTES: usize = 4096;

struct Chunk {
    text: String,
    start: usize,
}

#[derive(Default)]
pub(super) struct RetainedOutput {
    chunks: VecDeque<Chunk>,
    retained: usize,
    revision: u64,
}

impl RetainedOutput {
    pub fn append(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }
        self.revision = self.revision.wrapping_add(1);
        if text.len() >= RETAINED_OUTPUT_BYTES {
            // Do not keep a huge backing allocation just to retain its tail.
            let mut start = text.len() - RETAINED_OUTPUT_BYTES;
            while !text.is_char_boundary(start) {
                start += 1;
            }
            self.chunks.clear();
            self.chunks.push_back(Chunk {
                text: text[start..].into(),
                start: 0,
            });
            self.retained = text.len() - start;
            return;
        }
        // Pack small messages into bounded pages. One retained object per
        // keystroke would otherwise dwarf the 200 KB text budget in metadata.
        if let Some(last) = self.chunks.back_mut()
            && last.text.len() + text.len() <= SMALL_CHUNK_BYTES
        {
            last.text.push_str(text);
        } else {
            self.chunks.push_back(Chunk {
                text: text.into(),
                start: 0,
            });
        }
        self.retained += text.len();
        while self.retained > RETAINED_OUTPUT_BYTES {
            let first = self
                .chunks
                .front_mut()
                .expect("retained bytes have a chunk");
            let excess = self.retained - RETAINED_OUTPUT_BYTES;
            let remaining = first.text.len() - first.start;
            if remaining <= excess {
                self.retained -= remaining;
                self.chunks.pop_front();
            } else {
                let mut start = first.start + excess;
                while !first.text.is_char_boundary(start) {
                    start += 1;
                }
                self.retained -= start - first.start;
                first.start = start;
            }
        }
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Materialize only for a reader (AI, cold attach or explicit inspection).
    pub fn snapshot(&self) -> String {
        let mut output = String::with_capacity(self.retained);
        for chunk in &self.chunks {
            output.push_str(&chunk.text[chunk.start..]);
        }
        output
    }

    /// Resume only from a checkpoint still covered by retained UTF-8 bytes.
    /// Never return a shortened suffix on a gap: ANSI parsers require every
    /// byte after the checkpoint, even when it falls inside a control sequence.
    pub fn snapshot_after(&self, end_offset: u64, after_offset: u64) -> Option<String> {
        let available = end_offset.checked_sub(after_offset)?;
        let available = usize::try_from(available).ok()?;
        if available > self.retained {
            return None;
        }
        let mut skip = self.retained - available;
        let mut result = String::with_capacity(available);
        for chunk in &self.chunks {
            let text = &chunk.text[chunk.start..];
            if skip >= text.len() {
                skip -= text.len();
                continue;
            }
            result.push_str(text.get(skip..)?);
            skip = 0;
        }
        Some(result)
    }

    /// Approval validation compares the retained text without allocating a copy.
    pub fn matches(&self, expected: &str) -> bool {
        if self.retained != expected.len() {
            return false;
        }
        let mut offset = 0;
        for chunk in &self.chunks {
            let bytes = &chunk.text.as_bytes()[chunk.start..];
            if bytes != &expected.as_bytes()[offset..offset + bytes.len()] {
                return false;
            }
            offset += bytes.len();
        }
        true
    }
}

impl From<&str> for RetainedOutput {
    fn from(text: &str) -> Self {
        let mut output = Self::default();
        output.append(text);
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference_append(output: &mut String, text: &str) {
        output.push_str(text);
        if output.len() > RETAINED_OUTPUT_BYTES {
            let mut start = output.len() - RETAINED_OUTPUT_BYTES;
            while !output.is_char_boundary(start) {
                start += 1;
            }
            output.drain(..start);
        }
    }

    #[test]
    fn fragmented_utf8_and_ansi_history_matches_existing_byte_retention() {
        let mut output = RetainedOutput::default();
        let mut reference = String::new();
        let long_line = "长行".repeat(900);
        let pieces = [
            "登录😀",
            "\x1b[",
            "31m",
            "title\x1b]0;",
            "name\x07",
            "\r\n",
            "x",
            long_line.as_str(),
        ];
        for index in 0..1200 {
            let piece = pieces[index % pieces.len()];
            output.append(piece);
            reference_append(&mut reference, piece);
            assert_eq!(output.snapshot(), reference);
            assert!(output.matches(&reference));
            assert!(!output.matches(&(reference.clone() + "different")));
        }
    }

    #[test]
    fn oversized_chunks_do_not_retain_the_entire_backing_allocation() {
        let mut output = RetainedOutput::from("before");
        let huge = "😀中".repeat(RETAINED_OUTPUT_BYTES);
        let mut reference = String::from("before");
        reference_append(&mut reference, &huge);
        output.append(&huge);
        assert_eq!(output.snapshot(), reference);
        assert_eq!(output.chunks.len(), 1);
        assert!(output.chunks[0].text.len() <= RETAINED_OUTPUT_BYTES);
        output.append("");
        assert!(output.matches(&reference));
    }

    #[test]
    fn eviction_releases_old_chunks_and_comparisons_detect_same_length_changes() {
        let mut output = RetainedOutput::default();
        for _ in 0..RETAINED_OUTPUT_BYTES * 2 {
            output.append("x");
        }
        assert_eq!(output.retained, RETAINED_OUTPUT_BYTES);
        assert!(output.chunks.len() <= RETAINED_OUTPUT_BYTES / SMALL_CHUNK_BYTES + 2);
        assert!(
            output
                .chunks
                .iter()
                .map(|chunk| chunk.text.len())
                .sum::<usize>()
                <= RETAINED_OUTPUT_BYTES + SMALL_CHUNK_BYTES
        );
        assert!(output.matches(&"x".repeat(RETAINED_OUTPUT_BYTES)));
        output.append("y");
        assert!(!output.matches(&"x".repeat(RETAINED_OUTPUT_BYTES)));
        assert!(output.matches(&("x".repeat(RETAINED_OUTPUT_BYTES - 1) + "y")));
    }

    #[test]
    fn checkpoint_suffix_preserves_split_ansi_and_rejects_invalid_byte_boundaries() {
        let mut output = RetainedOutput::from("登录😀\x1b[");
        let checkpoint = output.snapshot().len() as u64;
        output.append("?25l\r\nready");
        let end = checkpoint + "?25l\r\nready".len() as u64;
        assert_eq!(
            output.snapshot_after(end, checkpoint).unwrap(),
            "?25l\r\nready"
        );
        assert_eq!(output.snapshot_after(end, end).unwrap(), "");
        assert!(output.snapshot_after(end, end + 1).is_none());
        assert!(output.snapshot_after(end, 1).is_none());
        assert_eq!(
            output.snapshot_after(end, 6).unwrap(),
            "😀\x1b[?25l\r\nready"
        );
    }

    #[test]
    fn checkpoint_suffix_requires_all_bytes_after_eviction_across_pages() {
        let mut output = RetainedOutput::default();
        let mut end = 0_u64;
        for _ in 0..100 {
            let page = "😀".repeat(1024);
            end += page.len() as u64;
            output.append(&page);
        }
        let first = end - output.snapshot().len() as u64;
        assert!(output.snapshot_after(end, first - 1).is_none());
        assert_eq!(
            output.snapshot_after(end, first).unwrap(),
            output.snapshot()
        );
        assert_eq!(
            output.snapshot_after(end, end - 4100).unwrap(),
            "😀".repeat(1025)
        );
        assert!(output.snapshot_after(end, end - 4099).is_none());
        let empty = RetainedOutput::default();
        assert_eq!(empty.snapshot_after(0, 0).unwrap(), "");
        assert!(empty.snapshot_after(0, 1).is_none());
    }
}
