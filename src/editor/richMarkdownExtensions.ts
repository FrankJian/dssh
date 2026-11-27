import { Extension, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
const blockTypes = ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "taskList", "table", "codeBlock", "horizontalRule", "image", "rawMarkdown"];
const SourceIdentity = Extension.create({ name: "sourceIdentity", addGlobalAttributes: () => [{ types: blockTypes, attributes: { sourceKey: { default: null, rendered: false } } }] });
const RawMarkdown = Node.create({
  name: "rawMarkdown", group: "block", atom: true, selectable: true,
  addAttributes: () => ({ raw: { default: "", rendered: false } }),
  parseHTML: () => [], renderHTML: ({ node }) => ["pre", { class: "editor-rich-raw", title: "原文区块：可切换源码编辑" }, ["code", String(node.attrs.raw)]],
});
const SafeImage = Image.extend({
  renderHTML: ({ node }) => ["span", { class: "editor-rich-image", title: String(node.attrs.src ?? ""), "data-image-reference": "true" }, `[图片：${node.attrs.alt || "未命名"}]`],
}).configure({ inline: false, allowBase64: false });

export function richMarkdownExtensions() {
  return [StarterKit.configure({ undoRedo: false, underline: false, trailingNode: false, link: { openOnClick: false, autolink: false, protocols: ["http", "https", "mailto"] } }), Markdown.configure({ markedOptions: { gfm: true } }), TableKit, TaskList, TaskItem.configure({ nested: true }), SafeImage, RawMarkdown, SourceIdentity];
}
