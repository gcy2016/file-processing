// PDF 压缩：qpdf（无损重组）+ Ghostscript（重压内部图片），取更小且有效的结果
import { emRun } from "./em.js";
import { UserError } from "../util.js";

const qpdf = (args, opts) => emRun("qpdf.js", "qpdf.wasm", args, opts);
const gs = (args, opts) => emRun("gs.js", "gs.wasm", args, opts);

async function pageCount(bytes) {
  const r = await qpdf(["--show-npages", "/in.pdf"], { inputs: { "/in.pdf": bytes } });
  const n = parseInt(r.out, 10);
  return r.code === 0 || r.code === 3 ? (Number.isFinite(n) ? n : null) : null;
}

// mode：normal（图片最高 300 dpi，肉眼难以察觉）/ strong（150 dpi，画质下降）/ lossless（只做无损重组）
export async function compress({ file, mode }, progress) {
  const src = new Uint8Array(await file.arrayBuffer());
  progress?.(0.05);

  const enc = await qpdf(["--requires-password", "/in.pdf"], { inputs: { "/in.pdf": src } });
  if (enc.code === 0) throw new UserError("这个 PDF 设置了打开密码，首版不支持处理加密 PDF。");
  const pages = await pageCount(src);
  progress?.(0.1);

  const candidates = [];
  // 1. qpdf 无损：重新压缩数据流、合并对象流
  const q = await qpdf(["--object-streams=generate", "--compress-streams=y", "--recompress-flate",
    "--compression-level=9", "--decrypt", "/in.pdf", "/out.pdf"],
  { inputs: { "/in.pdf": src }, outputs: ["/out.pdf"] });
  if ((q.code === 0 || q.code === 3) && q.files["/out.pdf"]) candidates.push({ bytes: q.files["/out.pdf"], how: "lossless" });
  progress?.(0.25);

  // 2. Ghostscript：重压图片（无损模式不用）
  if (mode !== "lossless") {
    const dpi = mode === "strong" ? 150 : 300;
    const g = await gs(["-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5", "-dNOPAUSE", "-dBATCH", "-dQUIET", "-dSAFER",
      `-dPDFSETTINGS=${mode === "strong" ? "/ebook" : "/printer"}`,
      "-dDetectDuplicateImages=true", "-dCompressFonts=true", "-dSubsetFonts=true",
      "-dDownsampleColorImages=true", "-dDownsampleGrayImages=true", "-dDownsampleMonoImages=true",
      `-dColorImageResolution=${dpi}`, `-dGrayImageResolution=${dpi}`, `-dMonoImageResolution=${dpi * 2}`,
      "-dColorImageDownsampleThreshold=1.1", "-dGrayImageDownsampleThreshold=1.1",
      "-sOutputFile=/out.pdf", "/in.pdf"],
    { inputs: { "/in.pdf": src }, outputs: ["/out.pdf"] });
    if (g.code === 0 && g.files["/out.pdf"]?.length) candidates.push({ bytes: g.files["/out.pdf"], how: "gs" });
  }
  progress?.(0.85);

  // 校验：能打开、页数一致
  candidates.sort((a, b) => a.bytes.length - b.bytes.length);
  for (const c of candidates) {
    if (c.bytes.length >= src.length) break;
    const n = await pageCount(c.bytes);
    if (n == null || (pages != null && n !== pages)) continue;
    const notes = c.how === "gs"
      ? [mode === "strong" ? "图片分辨率降到 150 dpi，屏幕上看基本清楚，打印会变模糊。" : "图片最高保留 300 dpi，肉眼基本看不出差别。",
         "文字仍可搜索、复制，链接保留。"]
      : ["只做了无损优化，内容完全不变。"];
    if (pages != null) notes.push(`共 ${pages} 页，已核对页数一致。`);
    return { blob: new Blob([c.bytes], { type: "application/pdf" }), notes };
  }
  if (!candidates.length && pages == null) throw new UserError("这个 PDF 读不出来，文件可能已损坏。");
  return { blob: file, unchanged: true, notes: [] };
}
