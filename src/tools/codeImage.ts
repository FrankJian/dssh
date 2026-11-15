import {
  IMAGE_FONT, IMAGE_LINE_HEIGHT, IMAGE_PADDING, canvasPng, expandImageTabs, imageCanvas,
  layoutImageRows, type ImageRow,
} from "./textImage.ts";

const HEADER_HEIGHT = 42;
const MIN_WIDTH = 320;
const GUTTER_GAP = 18;
const HEADER_FONT = "600 13px system-ui, sans-serif";

type TokenColor = "keyword" | "string" | "number" | "comment" | "type" | "text";
type PaintColor = TokenColor | "surface" | "header" | "line-number" | "border";
export type CodeImageTheme = "dark" | "light";

interface CodeToken {
  offset: number;
  type: string;
}

function tokenColor(type: string): TokenColor {
  const category = type.split(".")[0];
  switch (category) {
    case "comment": return "comment";
    case "string": case "regexp": return "string";
    case "number": return "number";
    case "keyword": case "operator": return "keyword";
    case "type": case "tag": case "attribute": case "key": return "type";
    default: return "text";
  }
}

export function colorCodeRow(row: ImageRow, tokens: readonly CodeToken[], initialTokenIndex: number) {
  const start = row.offset;
  const end = start + row.text.length;
  let index = initialTokenIndex;
  while (index + 1 < tokens.length && tokens[index + 1].offset <= start) index++;

  const spans: Array<{ text: string; color: TokenColor }> = [];
  let offset = start;
  while (offset < end) {
    const token = tokens[index];
    const beforeToken = token && offset < token.offset;
    const next = Math.min(end, beforeToken ? token.offset : tokens[index + 1]?.offset ?? end);
    const text = row.text.slice(offset - start, next - start);
    const color = beforeToken || !token ? "text" : tokenColor(token.type);
    const previous = spans[spans.length - 1];
    if (previous?.color === color) previous.text += text;
    else spans.push({ text, color });
    offset = next;
    if (!beforeToken && tokens[index + 1]?.offset === offset) index++;
  }
  return { spans, nextTokenIndex: index };
}

export async function renderCodeImage(input: string, options: {
  theme: CodeImageTheme;
  lineNumbers: boolean;
  title: string;
  tokenize: (source: string) => Promise<readonly (readonly CodeToken[])[]>;
}) {
  const { canvas, context } = await imageCanvas();
  const digits = String(input.split(/\r\n|\r|\n/).length).length;
  const numberWidth = options.lineNumbers ? Math.ceil(context.measureText("0".repeat(digits)).width) : 0;
  const gutter = options.lineNumbers ? numberWidth + GUTTER_GAP : 0;
  const layout = layoutImageRows(input, (text) => context.measureText(text).width, {
    gutter, header: HEADER_HEIGHT, minWidth: MIN_WIDTH,
  });
  const tokens = await options.tokenize(expandImageTabs(input));
  const style = getComputedStyle(document.documentElement);
  const color = (name: PaintColor) => style.getPropertyValue(`--tool-code-${options.theme}-${name}`).trim();

  canvas.width = layout.width;
  canvas.height = layout.height;
  context.fillStyle = color("surface");
  context.fillRect(0, 0, layout.width, layout.height);
  context.fillStyle = color("header");
  context.fillRect(0, 0, layout.width, HEADER_HEIGHT);
  context.fillStyle = color("border");
  context.fillRect(0, HEADER_HEIGHT - 1, layout.width, 1);
  context.fillStyle = color("text");
  context.font = HEADER_FONT;
  context.textBaseline = "middle";
  context.fillText(options.title, IMAGE_PADDING, HEADER_HEIGHT / 2, layout.width - 2 * IMAGE_PADDING);

  context.font = IMAGE_FONT;
  context.textBaseline = "top";
  const codeX = IMAGE_PADDING + gutter;
  const colors = {
    text: color("text"), keyword: color("keyword"), number: color("number"),
    string: color("string"), comment: color("comment"), type: color("type"),
  };
  const lineNumberColor = color("line-number");
  let tokenIndex = 0;
  layout.rows.forEach((row, rowIndex) => {
    const y = HEADER_HEIGHT + IMAGE_PADDING + rowIndex * IMAGE_LINE_HEIGHT;
    if (row.offset === 0) {
      tokenIndex = 0;
      if (options.lineNumbers) {
        context.fillStyle = lineNumberColor;
        context.textAlign = "right";
        context.fillText(String(row.sourceIndex + 1), IMAGE_PADDING + numberWidth, y);
        context.textAlign = "left";
      }
    }
    const colored = colorCodeRow(row, tokens[row.sourceIndex] ?? [], tokenIndex);
    tokenIndex = colored.nextTokenIndex;
    let x = codeX;
    for (const span of colored.spans) {
      context.fillStyle = colors[span.color];
      context.fillText(span.text, x, y);
      x += context.measureText(span.text).width;
    }
  });
  return { canvas, png: await canvasPng(canvas) };
}
