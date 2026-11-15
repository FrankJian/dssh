import { escapeAttribute } from "entities";

export function maskText(input: string, mode: string): string {
  return input.split(/(\r\n|\r|\n)/).map((line, index) => {
    if (index % 2 === 1) return line;
    const symbols = typeof Intl.Segmenter === "function"
      ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(line), ({ segment }) => segment)
      : [...line];
    if (mode === "all" || symbols.length <= 4) return "•".repeat(symbols.length);
    return symbols.slice(0, 2).join("") + "•".repeat(symbols.length - 4) + symbols.slice(-2).join("");
  }).join("");
}

export function openGraphTags(title: string, description: string): string {
  const name = title.trim();
  const summary = description.trim();
  if (!name || name.length > 512 || summary.length > 2048) throw new Error("请填写标题，标题最多 512 字符，描述最多 2,048 字符。");
  return [
    `<title>${escapeAttribute(name).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</title>`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${htmlAttribute(name)}">`,
    ...(summary ? [`<meta name="description" content="${htmlAttribute(summary)}">`,
      `<meta property="og:description" content="${htmlAttribute(summary)}">`] : []),
  ].join("\n");
}

function htmlAttribute(value: string): string {
  return escapeAttribute(value).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const gitEntries = [
  ["git status --short", "简要查看工作区与暂存区状态。"],
  ["git diff", "查看尚未暂存的修改。"],
  ["git diff --cached", "查看已暂存、尚未提交的修改。"],
  ["git log --oneline --graph --all", "以提交图查看各分支历史。"],
  ["git show <commit>", "查看指定提交的详情和差异。"],
  ["git branch -a", "列出本地和远程跟踪分支。"],
  ["git switch -c <branch>", "创建并切换到新分支。"],
  ["git fetch --prune", "更新远程跟踪引用并清理已删除的引用。"],
  ["git stash push -u", "暂存改动和未跟踪文件。"],
  ["git stash list", "列出暂存记录。"],
  ["git restore --staged <file>", "将文件修改从暂存区移出。"],
  ["git commit --amend", "用新的提交替换当前分支的最后一条提交。"],
  ["git revert <commit>", "创建一个新提交撤销指定提交的改动。"],
  ["git reflog", "查看本地引用移动记录。"],
  ["git remote -v", "查看远程仓库名称及地址。"],
  ["git worktree list", "列出已关联的工作树。"],
] as const;

const regexEntries = [
  [String.raw`.`, "匹配任意字符，默认不含换行。"],
  [String.raw`^ / $`, "输入的开头和结尾。m 标志使其也匹配行边界。"],
  [String.raw`\d / \D`, "匹配 ASCII 数字或其反义。"],
  [String.raw`\w / \W`, "匹配字母、数字、下划线或其反义。"],
  [String.raw`\s / \S`, "匹配空白字符或其反义。"],
  [String.raw`\b`, "匹配词语边界。"],
  [String.raw`[abc] / [^abc]`, "匹配集合内或集合外的单个字符。"],
  [String.raw`a? / a* / a+`, "匹配 0 或 1 次、0 次或更多、1 次或更多。"],
  [String.raw`a{2,4}`, "匹配 2 到 4 次。"],
  [String.raw`a+?`, "非贪婪匹配，优先选择最短长度。"],
  [String.raw`(x) / (?:x) / (?<name>x)`, "捕获分组、非捕获分组和命名捕获分组。"],
  [String.raw`(?=x) / (?!x)`, "正向前瞻和负向前瞻。"],
  [String.raw`(?<=x) / (?<!x)`, "正向后顾和负向后顾。"],
  [String.raw`\p{L}`, "使用 u 或 v 标志时匹配 Unicode 字母。"],
  ["g / i / m / s / u", "全局、大小写不敏感、多行、点匹配换行、Unicode。"],
] as const;

export function searchMemo(input: string, memo: "git" | "regex"): string {
  const entries = memo === "git" ? gitEntries : regexEntries;
  const query = input.trim().toLowerCase();
  const matches = entries.filter(([name, description]) => `${name} ${description}`.toLowerCase().includes(query));
  return matches.length ? matches.map(([name, description]) => `${name}\n  ${description}`).join("\n\n") : "没有匹配项。";
}
