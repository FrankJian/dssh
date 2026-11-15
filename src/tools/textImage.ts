/// <reference lib="es2022.intl" />

export const IMAGE_PADDING = 24;
export const IMAGE_LINE_HEIGHT = 24;
const MAX_WIDTH = 1024;
export const MAX_IMAGE_HEIGHT = 4096;
const MAX_TEXT_LENGTH = 64 * 1024;
export const IMAGE_FONT = '16px ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace';
const segmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

function* graphemes(text: string) {
  if (segmenter) {
    for (const item of segmenter.segment(text)) yield item.segment;
  } else {
    yield* text;
  }
}

export function expandImageTabs(input: string): string {
  return input.replace(/\t/g, "    ");
}

export interface ImageRow {
  text: string;
  sourceIndex: number;
  offset: number;
}

export function layoutImageRows(input: string, measure: (text: string) => number, {
  gutter = 0,
  header = 0,
  minWidth = 0,
} = {}) {
  if (!input.trim()) throw new Error("请输入要转换的文本。");
  if (input.length > MAX_TEXT_LENGTH) throw new Error("文本过长，请缩短后再生成。");
  const rows: ImageRow[] = [];
  const availableWidth = MAX_WIDTH - 2 * IMAGE_PADDING - gutter;
  let width = 0;
  function addRow(row: ImageRow, lineWidth: number) {
    if (header + 2 * IMAGE_PADDING + (rows.length + 1) * IMAGE_LINE_HEIGHT > MAX_IMAGE_HEIGHT) {
      throw new Error("图片高度超出 4096 像素，请缩短文本。");
    }
    rows.push(row);
    width = Math.max(width, lineWidth);
  }
  expandImageTabs(input).split(/\r\n|\r|\n/).forEach((sourceLine, sourceIndex) => {
    let text = "";
    let lineWidth = 0;
    let offset = 0;
    for (const segment of graphemes(sourceLine)) {
      const next = text + segment;
      const measured = measure(next);
      if (measured <= availableWidth) {
        text = next;
        lineWidth = measured;
      } else {
        const segmentWidth = measure(segment);
        if (segmentWidth > availableWidth) throw new Error("图片宽度超限，请缩短文本。");
        addRow({ text, sourceIndex, offset }, lineWidth);
        offset += text.length;
        text = segment;
        lineWidth = segmentWidth;
      }
    }
    addRow({ text, sourceIndex, offset }, lineWidth);
  });
  return {
    rows,
    width: Math.max(minWidth, Math.ceil(width) + 2 * IMAGE_PADDING + gutter),
    height: header + rows.length * IMAGE_LINE_HEIGHT + 2 * IMAGE_PADDING,
  };
}

export function layoutTextImage(input: string, measure: (text: string) => number) {
  const { rows, width, height } = layoutImageRows(input, measure);
  return { lines: rows.map((row) => row.text), width, height };
}

export async function imageCanvas() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前窗口无法生成图片。");
  await document.fonts.ready;
  context.font = IMAGE_FONT;
  return { canvas, context };
}

export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("无法编码 PNG 图片。"));
    }, "image/png");
  });
}

export async function renderTextImage(input: string, background: string, foreground: string) {
  const { canvas, context } = await imageCanvas();
  const layout = layoutTextImage(input, (text) => context.measureText(text).width);
  canvas.width = layout.width;
  canvas.height = layout.height;
  context.fillStyle = background;
  context.fillRect(0, 0, layout.width, layout.height);
  context.fillStyle = foreground;
  context.font = IMAGE_FONT;
  context.textBaseline = "top";
  layout.lines.forEach((line, index) =>
    context.fillText(line, IMAGE_PADDING, IMAGE_PADDING + index * IMAGE_LINE_HEIGHT),
  );
  return { canvas, png: await canvasPng(canvas) };
}
