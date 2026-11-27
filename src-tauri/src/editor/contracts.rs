use super::{
    text::{TextEncoding, TextMetadata},
    workspaces::FileSource,
};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenEditorRequest {
    pub source: FileSource,
    pub path: Option<String>,
    #[serde(default)]
    pub directory: bool,
    pub root_path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadEditorRequest {
    pub workspace_id: String,
    pub path: String,
    pub encoding: Option<TextEncoding>,
    #[serde(default)]
    pub allow_large: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEditorRequest {
    pub workspace_id: String,
    pub path: String,
    pub content: String,
    #[serde(flatten)]
    pub metadata: TextMetadata,
    pub expected_version: Option<String>,
    #[serde(default)]
    pub allow_non_atomic: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorTextFile {
    pub source: FileSource,
    pub path: String,
    pub content: String,
    #[serde(flatten)]
    pub metadata: TextMetadata,
    pub version_token: String,
    pub read_only: bool,
    pub byte_length: u64,
    pub large_file: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSavedFile {
    pub source: FileSource,
    pub path: String,
    pub version_token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorFileVersion {
    pub source: FileSource,
    pub path: String,
    pub version_token: Option<String>,
    pub read_only: bool,
    pub byte_length: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn read_and_save_contracts_use_camel_case_and_explicit_source() {
        let opened: OpenEditorRequest = serde_json::from_value(serde_json::json!({
            "source": {"kind":"local"}, "path":"/root/nested/file.txt", "rootPath":"/root"
        }))
        .unwrap();
        assert_eq!(opened.root_path.as_deref(), Some("/root"));
        assert!(!opened.directory);
        let legacy: OpenEditorRequest = serde_json::from_value(serde_json::json!({
            "source": {"kind":"local"}, "path":"/file.txt"
        }))
        .unwrap();
        assert!(legacy.root_path.is_none());
        let request: SaveEditorRequest = serde_json::from_value(serde_json::json!({
            "workspaceId": "editor-1", "path": "/a.txt", "content": "test", "encoding": "utf-16le", "bom": true,
            "lineEnding": "crlf", "expectedVersion": "v1", "allowNonAtomic": false
        })).unwrap();
        assert_eq!(request.expected_version.as_deref(), Some("v1"));
        let source: FileSource =
            serde_json::from_value(serde_json::json!({"kind":"sftp","profileId":"p"})).unwrap();
        assert_eq!(
            serde_json::to_value(source).unwrap(),
            serde_json::json!({"kind":"sftp","profileId":"p"})
        );
        assert!(
            serde_json::from_value::<FileSource>(
                serde_json::json!({"kind":"sftp","profile_id":"p"})
            )
            .is_err()
        );
    }
}

/// Clean file references only. Text, credentials and unsaved drafts have no DTO fields.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorWorkspaceReference {
    pub source: FileSource,
    pub root_path: Option<String>,
    pub initial_file: Option<String>,
    pub title: String,
    pub state: EditorLayoutReference,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorLayoutReference {
    pub layout: EditorLayoutNode,
    pub focused: String,
    pub locations: std::collections::HashMap<String, EditorViewLocation>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EditorLayoutNode {
    Group {
        id: String,
        documents: Vec<String>,
        active: Option<String>,
        preview: Option<String>,
    },
    Split {
        id: String,
        direction: EditorSplitDirection,
        ratio: f64,
        children: [Box<EditorLayoutNode>; 2],
    },
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorSplitDirection {
    Horizontal,
    Vertical,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorViewLocation {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub scroll_top: f64,
    pub scroll_left: f64,
}
impl EditorWorkspaceReference {
    pub fn validate(&self) -> crate::error::AppResult<()> {
        fn path(value: &str) -> bool {
            !value.is_empty() && value.len() <= 32768 && !value.chars().any(char::is_control)
        }
        fn node(
            value: &EditorLayoutNode,
            depth: usize,
            ids: &mut std::collections::HashSet<String>,
            count: &mut usize,
        ) -> bool {
            if depth > 8 || ids.len() >= 15 {
                return false;
            }
            let id = match value {
                EditorLayoutNode::Group { id, .. } | EditorLayoutNode::Split { id, .. } => id,
            };
            if id.is_empty()
                || id.len() > 100
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                || !ids.insert(id.clone())
            {
                return false;
            }
            match value {
                EditorLayoutNode::Group {
                    documents,
                    active,
                    preview,
                    ..
                } => {
                    *count += documents.len();
                    *count <= 100
                        && documents.iter().all(|s| path(s))
                        && active.as_ref().is_none_or(|p| documents.contains(p))
                        && preview.as_ref().is_none_or(|p| documents.contains(p))
                }
                EditorLayoutNode::Split {
                    ratio, children, ..
                } => {
                    ratio.is_finite()
                        && (0.1..=0.9).contains(ratio)
                        && children.iter().all(|n| node(n, depth + 1, ids, count))
                }
            }
        }
        let mut ids = std::collections::HashSet::new();
        let mut count = 0;
        if self.title.len() > 800
            || self.root_path.as_ref().is_some_and(|p| !path(p))
            || self.initial_file.as_ref().is_some_and(|p| !path(p))
            || !node(&self.state.layout, 0, &mut ids, &mut count)
            || !ids.contains(&self.state.focused)
            || self.state.locations.len() > 8
            || self.state.locations.iter().any(|(id, p)| {
                !ids.contains(id)
                    || !path(&p.path)
                    || p.line == 0
                    || p.column == 0
                    || !p.scroll_top.is_finite()
                    || !p.scroll_left.is_finite()
                    || p.scroll_top < 0.0
                    || p.scroll_left < 0.0
            })
        {
            return Err(crate::error::AppError::new(
                "editor_reference",
                "编辑器文件引用或布局无效。",
            ));
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorDirectoryListing {
    #[serde(flatten)]
    pub listing: crate::sftp::SftpListing,
    pub truncated: bool,
}

#[cfg(test)]
mod reference_tests {
    use super::*;
    fn sample() -> EditorWorkspaceReference {
        serde_json::from_value(serde_json::json!({
            "source": {"kind":"local", "unexpected":"discard"}, "rootPath":"/root", "initialFile":null, "title":"editor",
            "content":"synthetic body must not survive", "state": {"focused":"main", "locations":{}, "layout": {"kind":"group", "id":"main", "documents":["/root/a"], "active":"/root/a", "preview":null, "content":"discard"}}
        })).unwrap()
    }
    #[test]
    fn clean_reference_contract_drops_bodies_and_rejects_invalid_layouts() {
        let reference = sample();
        reference.validate().unwrap();
        let encoded = serde_json::to_string(&reference).unwrap();
        assert!(!encoded.contains("content"));
        assert!(!encoded.contains("unexpected"));
        let mut invalid = reference.clone();
        invalid.state.focused = "missing".into();
        assert!(invalid.validate().is_err());
        invalid = reference.clone();
        invalid.state.locations.insert(
            "main".into(),
            EditorViewLocation {
                path: "/root/a".into(),
                line: 0,
                column: 1,
                scroll_top: 0.0,
                scroll_left: 0.0,
            },
        );
        assert!(invalid.validate().is_err());
        invalid = reference;
        if let EditorLayoutNode::Group { documents, .. } = &mut invalid.state.layout {
            *documents = (0..101).map(|n| format!("/root/{n}")).collect();
        }
        assert!(invalid.validate().is_err());
    }
}
