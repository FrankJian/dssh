use encoding_rs::{GB18030, UTF_8, UTF_16BE, UTF_16LE};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const MAX_TEXT_BYTES: usize = 1_024 * 1_024 * 1_024;
pub const NORMAL_TEXT_BYTES: usize = 20 * 1_024 * 1_024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TextEncoding {
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-8-bom")]
    Utf8Bom,
    #[serde(rename = "utf-16le")]
    Utf16Le,
    #[serde(rename = "utf-16be")]
    Utf16Be,
    #[serde(rename = "gb18030")]
    Gb18030,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Mixed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMetadata {
    pub encoding: TextEncoding,
    pub bom: bool,
    pub line_ending: LineEnding,
}

#[derive(Debug)]
pub struct DecodedText {
    pub content: String,
    pub metadata: TextMetadata,
}

fn encoding_error() -> AppError {
    AppError::new(
        "editor_encoding",
        "无法使用所选编码无损读取此文件，请选择其他编码。",
    )
}

fn binary_error() -> AppError {
    AppError::new("editor_binary", "该文件为二进制或不支持的文本格式。")
}

pub fn check_size(size: u64, allow_large: bool) -> AppResult<()> {
    if size > MAX_TEXT_BYTES as u64 {
        return Err(AppError::new(
            "editor_too_large",
            "文件超过 1 GiB，无法编辑。",
        ));
    }
    if !allow_large && size > NORMAL_TEXT_BYTES as u64 {
        return Err(AppError::new(
            "editor_large_file",
            "文件超过 20 MiB，请选择受限模式或取消打开。",
        ));
    }
    Ok(())
}

pub fn line_ending(content: &str) -> LineEnding {
    let bytes = content.as_bytes();
    let mut crlf = false;
    let mut lf = false;
    let mut lone_cr = false;
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'\n' {
            if index > 0 && bytes[index - 1] == b'\r' {
                crlf = true;
            } else {
                lf = true;
            }
        } else if *byte == b'\r' && bytes.get(index + 1) != Some(&b'\n') {
            lone_cr = true;
        }
    }
    if lone_cr || (crlf && lf) {
        LineEnding::Mixed
    } else if crlf {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    }
}

pub fn decode(path: &str, bytes: &[u8], requested: Option<TextEncoding>) -> AppResult<DecodedText> {
    check_size(bytes.len() as u64, true)?;
    if crate::sftp::is_known_binary_path(path)
        || crate::sftp::has_binary_signature(bytes)
        || bytes.starts_with(&[0xff, 0xfe, 0, 0])
        || bytes.starts_with(&[0, 0, 0xfe, 0xff])
    {
        return Err(binary_error());
    }
    let detected = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        Some((TextEncoding::Utf8Bom, 3))
    } else if bytes.starts_with(&[0xff, 0xfe]) {
        Some((TextEncoding::Utf16Le, 2))
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        Some((TextEncoding::Utf16Be, 2))
    } else {
        None
    };
    let encoding = requested.unwrap_or_else(|| detected.map_or(TextEncoding::Utf8, |(e, _)| e));
    let strip = detected
        .filter(|(e, _)| {
            *e == encoding || (*e == TextEncoding::Utf8Bom && encoding == TextEncoding::Utf8)
        })
        .map_or(0, |(_, count)| count);
    let codec = match encoding {
        TextEncoding::Utf8 | TextEncoding::Utf8Bom => UTF_8,
        TextEncoding::Utf16Le => UTF_16LE,
        TextEncoding::Utf16Be => UTF_16BE,
        TextEncoding::Gb18030 => GB18030,
    };
    // Strict mode is essential: replacement characters must never silently reach a save.
    let content = codec
        .decode_without_bom_handling_and_without_replacement(&bytes[strip..])
        .ok_or_else(encoding_error)?
        .into_owned();
    if content.contains('\0') {
        return Err(binary_error());
    }
    Ok(DecodedText {
        metadata: TextMetadata {
            encoding: if encoding == TextEncoding::Utf8 && strip != 0 {
                TextEncoding::Utf8Bom
            } else {
                encoding
            },
            bom: strip != 0,
            line_ending: line_ending(&content),
        },
        content,
    })
}

pub fn encode(content: &str, metadata: &TextMetadata) -> AppResult<Vec<u8>> {
    if content.contains('\0') {
        return Err(binary_error());
    }
    if metadata.line_ending == LineEnding::Mixed {
        return Err(AppError::new(
            "editor_mixed_line_endings",
            "文件包含混合行尾，请选择 LF 或 CRLF 后再保存。",
        ));
    }
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let normalized = match metadata.line_ending {
        LineEnding::Crlf => normalized.replace('\n', "\r\n"),
        _ => normalized,
    };
    let bytes = match metadata.encoding {
        TextEncoding::Utf8 | TextEncoding::Utf8Bom => {
            let mut bytes = Vec::new();
            if metadata.encoding == TextEncoding::Utf8Bom || metadata.bom {
                bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
            }
            bytes.extend_from_slice(normalized.as_bytes());
            bytes
        }
        TextEncoding::Utf16Le | TextEncoding::Utf16Be => {
            let little = metadata.encoding == TextEncoding::Utf16Le;
            let mut bytes = Vec::new();
            if metadata.bom {
                bytes.extend_from_slice(if little { &[0xff, 0xfe] } else { &[0xfe, 0xff] });
            }
            for unit in normalized.encode_utf16() {
                bytes.extend_from_slice(&if little {
                    unit.to_le_bytes()
                } else {
                    unit.to_be_bytes()
                });
            }
            bytes
        }
        TextEncoding::Gb18030 => {
            let (bytes, _, errors) = GB18030.encode(&normalized);
            if errors
                || GB18030
                    .decode_without_bom_handling_and_without_replacement(&bytes)
                    .as_deref()
                    != Some(normalized.as_str())
            {
                return Err(AppError::new(
                    "editor_encoding_loss",
                    "所选编码无法无损保存这些字符。",
                ));
            }
            bytes.into_owned()
        }
    };
    check_size(bytes.len() as u64, true)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_encodings_round_trip_without_inventing_newlines() {
        for encoding in [
            TextEncoding::Utf8,
            TextEncoding::Utf8Bom,
            TextEncoding::Utf16Le,
            TextEncoding::Utf16Be,
            TextEncoding::Gb18030,
        ] {
            for bom in [false, true] {
                if encoding == TextEncoding::Gb18030 && bom {
                    continue;
                }
                for ending in [LineEnding::Lf, LineEnding::Crlf] {
                    let metadata = TextMetadata {
                        encoding,
                        bom,
                        line_ending: ending,
                    };
                    let bytes = encode("配置🚀\n末行", &metadata).unwrap();
                    let decoded = decode("file.txt", &bytes, Some(encoding)).unwrap();
                    assert_eq!(
                        decoded.content,
                        if ending == LineEnding::Lf {
                            "配置🚀\n末行"
                        } else {
                            "配置🚀\r\n末行"
                        }
                    );
                    assert_eq!(encode(&decoded.content, &decoded.metadata).unwrap(), bytes);
                }
            }
        }
    }

    #[test]
    fn bom_sniffing_is_strict_and_utf16_zero_bytes_are_not_binary() {
        assert_eq!(
            decode("a", &[0xff, 0xfe, b'A', 0], None).unwrap().content,
            "A"
        );
        assert_eq!(
            decode("a", &[0xfe, 0xff, 0, b'A'], None).unwrap().content,
            "A"
        );
        assert!(decode("a", &[0xff, 0xfe, 0x00], None).is_err());
        assert!(decode("a", &[0xff, 0xfe, 0x00, 0xd8], None).is_err());
        assert!(decode("a", &[0xff, 0xfe, 0, 0], None).is_err());
        assert!(decode("a", &[0xff], None).is_err());
        assert!(decode("a", &[0xef, 0xbb, 0xbf, 0xff], None).is_err());
    }

    #[test]
    fn gb18030_requires_selection_and_rejects_malformed_data() {
        let bytes = [0xc5, 0xe4, 0xd6, 0xc3];
        assert!(decode("a", &bytes, None).is_err());
        assert_eq!(
            decode("a", &bytes, Some(TextEncoding::Gb18030))
                .unwrap()
                .content,
            "配置"
        );
        assert!(decode("a", &[0x81], Some(TextEncoding::Gb18030)).is_err());
    }

    #[test]
    fn gb18030_unmappable_characters_are_not_saved_as_html_references() {
        let metadata = TextMetadata {
            encoding: TextEncoding::Gb18030,
            bom: false,
            line_ending: LineEnding::Lf,
        };
        assert_eq!(
            encode("\u{e5e5}", &metadata).unwrap_err().code,
            "editor_encoding_loss"
        );
    }

    #[test]
    fn binary_signatures_extensions_and_decoded_nul_are_rejected() {
        assert!(decode("a.zip", b"plain", None).is_err());
        assert!(decode("a", b"PK\x03\x04ascii", None).is_err());
        assert!(decode("a", b"hello\0world", None).is_err());
        assert!(
            encode(
                "\0",
                &TextMetadata {
                    encoding: TextEncoding::Utf8,
                    bom: false,
                    line_ending: LineEnding::Lf
                }
            )
            .is_err()
        );
    }

    #[test]
    fn mixed_and_lone_cr_require_explicit_normalization() {
        assert_eq!(line_ending("a\r\nb\nc"), LineEnding::Mixed);
        assert_eq!(line_ending("a\rb"), LineEnding::Mixed);
        let mut metadata = TextMetadata {
            encoding: TextEncoding::Utf8,
            bom: false,
            line_ending: LineEnding::Mixed,
        };
        assert!(encode("a\r\nb\n", &metadata).is_err());
        metadata.line_ending = LineEnding::Lf;
        assert_eq!(encode("a\r\nb\n", &metadata).unwrap(), b"a\nb\n");
    }

    #[test]
    fn size_limits_distinguish_user_choice_from_hard_rejection() {
        assert!(check_size(NORMAL_TEXT_BYTES as u64, false).is_ok());
        assert_eq!(
            check_size(NORMAL_TEXT_BYTES as u64 + 1, false)
                .unwrap_err()
                .code,
            "editor_large_file"
        );
        assert!(check_size(MAX_TEXT_BYTES as u64, true).is_ok());
        assert_eq!(
            check_size(MAX_TEXT_BYTES as u64 + 1, true)
                .unwrap_err()
                .code,
            "editor_too_large"
        );
    }
}
