// PDF → Word / TXT：提取文字和段落（不保留排版、表格、图片）
// 有文字层的页面直接用 pdf.js 提取；没有文字的页面（扫描件）用 Tesseract 做 OCR（简体中文 + 英文）
// 在主线程运行（pdf.js、Tesseract 各自有后台线程）
import { UserError } from "./util.js";
import { isMobile } from "./env.js";

const V = new URL("../vendor/", import.meta.url).href;
const CJK = /[　-鿿＀-￯]/;

let pdfjsLib;
async function pdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import(V + "pdfjs/pdf.min.mjs");
  pdfjsLib.GlobalWorkerOptions.workerSrc = V + "pdfjs/pdf.worker.min.mjs";
  return pdfjsLib;
}

// 两段文字拼接：中文之间不加空格，英文单词之间加空格
const join = (a, b) => !a ? b : !b ? a : (CJK.test(a.at(-1)) || CJK.test(b[0]) || /[\s-]$/.test(a)) ? a + b : a + " " + b;

// pdf.js 文字块 → 行 → 段落
function paragraphsFromText(items) {
  const lines = [];
  for (const it of items) {
    if (!it.str) continue;
    const [, , , d, x, y] = it.transform;
    const size = Math.abs(d) || it.height || 10;
    let line = lines.find(l => Math.abs(l.y - y) < size * 0.5);
    if (!line) { line = { y, size, parts: [] }; lines.push(line); }
    line.size = Math.max(line.size, size);
    line.parts.push({ x, w: it.width, str: it.str });
  }
  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    let text = "", end = null;
    for (const p of l.parts) {
      const gap = end == null ? 0 : p.x - end;
      text = gap > l.size * 0.25 && !/\s$/.test(text) && !/^\s/.test(p.str) && !(CJK.test(text.at(-1) || "") && CJK.test(p.str[0])) ? text + " " + p.str : text + p.str;
      end = p.x + p.w;
    }
    l.text = text.replace(/\s+/g, " ").trim();
    l.x = l.parts[0].x;
    l.right = end;
  }
  const body = median(lines.filter(l => l.text).map(l => l.size)) || 10;
  const maxRight = Math.max(...lines.map(l => l.right || 0));
  const paras = [];
  let cur = null, prev = null;
  for (const l of lines) {
    if (!l.text) continue;
    const heading = l.size >= body * 1.3 ? (l.size >= body * 1.8 ? 1 : 2) : 0;
    const gap = prev ? prev.y - l.y : 0;
    const newPara = !cur || heading !== cur.heading || Math.abs(l.size - prev.size) > body * 0.15 ||
      gap > Math.max(prev.size, l.size) * 1.6 || (prev.right < maxRight * 0.8 && !heading);
    if (newPara) { cur = { heading, text: l.text }; paras.push(cur); }
    else cur.text = join(cur.text, l.text);
    prev = l;
  }
  return paras;
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}

// 页面文字太少（扫描件常见：只有页码、水印）→ 需要 OCR
const meaningful = items => items.reduce((n, it) => n + (it.str || "").replace(/\s/g, "").length, 0) >= 10;

let tess = null;
async function ocrWorker() {
  if (tess) return tess;
  const { default: Tesseract } = await import(V + "tess/tesseract.esm.min.js");
  tess = await Tesseract.createWorker(["chi_sim", "eng"], 1, {
    workerPath: V + "tess/worker.min.js", corePath: V + "tess/core", langPath: V + "tess/lang",
    gzip: true, workerBlobURL: false, cacheMethod: "none",
  });
  return tess;
}

async function ocrPage(page) {
  const vp = page.getViewport({ scale: isMobile ? 1.5 : 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  const w = await ocrWorker();
  const { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
  canvas.width = canvas.height = 0;
  // 按 Tesseract 识别出的段落分段；中文结果的字之间常带空格，去掉
  const paras = data.blocks?.flatMap(b => b.paragraphs.map(p => p.text)) ?? data.text.split(/\n\s*\n/);
  return paras.map(t => t.replace(/\n/g, " ").replace(/([　-鿿＀-￯])\s+(?=[　-鿿＀-￯])/g, "$1").replace(/\s+/g, " ").trim())
    .filter(Boolean).map(text => ({ heading: 0, text }));
}

export async function pdfToWord({ file, to }, onProgress, signal) {
  const lib = await pdfjs();
  let doc;
  const task = lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: V + "pdfjs/cmaps/", cMapPacked: true,
    standardFontDataUrl: V + "pdfjs/standard_fonts/", wasmUrl: V + "pdfjs/wasm/",
    isEvalSupported: false,
  });
  try {
    doc = await task.promise;
  } catch (e) {
    task.destroy();
    if (e?.name === "PasswordException") throw new UserError("这个 PDF 设置了打开密码，暂不支持。");
    throw new UserError("这个 PDF 打不开，文件可能已损坏。");
  }
  const pages = [];
  let ocrCount = 0;
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      if (signal?.aborted) throw new UserError("已取消。");
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      let paras;
      if (meaningful(tc.items)) paras = paragraphsFromText(tc.items);
      else { paras = await ocrPage(page); ocrCount++; }
      pages.push(paras);
      page.cleanup();
      onProgress?.(0.05 + 0.85 * i / doc.numPages);
    }
  } finally {
    await task.destroy();
    if (tess) { await tess.terminate().catch(() => {}); tess = null; }
  }
  if (!pages.some(p => p.length)) throw new UserError("没有从这个 PDF 里识别出文字。");

  const notes = [`共 ${pages.length} 页，只保留文字和段落；表格、图片、原排版不保留。`];
  if (ocrCount) notes.push(`其中 ${ocrCount} 页是扫描图片，用文字识别（OCR）提取，可能有错字，请核对。`);
  let blob;
  if (to === "txt") {
    blob = new Blob([pages.map(p => p.map(x => x.text).join("\n\n")).join("\n\n\f\n\n")], { type: "text/plain;charset=utf-8" });
  } else {
    const D = await import(V + "docx.js");
    const children = [];
    pages.forEach((paras, i) => {
      paras.forEach((p, j) => children.push(new D.Paragraph({
        heading: p.heading === 1 ? D.HeadingLevel.HEADING_1 : p.heading === 2 ? D.HeadingLevel.HEADING_2 : undefined,
        pageBreakBefore: i > 0 && j === 0,
        children: [new D.TextRun({ text: p.text, font: { eastAsia: "宋体" } })],
      })));
    });
    const docx = new D.Document({ sections: [{ children }] });
    blob = await D.Packer.toBlob(docx);
    notes.push("生成的 Word 文字可以编辑。");
  }
  onProgress?.(1);
  return { blob, outFmt: to, notes };
}
