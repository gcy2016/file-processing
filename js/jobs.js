// 任务执行：按文件类型分派到各处理工具；转换按能力注册表规划的路径逐步执行
import { runTool } from "./worker-client.js";
import * as media from "./media.js";
import { plan, COMPRESS } from "./registry.js";
import { sniff, FORMATS } from "./formats.js";
import { UNPACK_LIMIT, UNPACK_MAX_FILES, BOMB_RATIO } from "./env.js";
import { UserError, baseName, errMsg } from "./util.js";

const LIMITS = { unpack: UNPACK_LIMIT, maxFiles: UNPACK_MAX_FILES, ratio: BOMB_RATIO };
const MAX_DEPTH = 2;   // 嵌套压缩包最多深入 2 层（PRD 3.3）

const NO_GAIN = "已无法进一步压缩，返回的是原文件。";

// ---------- 压缩 ----------
// mode：normal / strong / lossless；archiveOut：压缩包输出格式（默认同原格式，RAR → ZIP）
// 返回 { blob, outFmt, notes, unchanged, partial }
export async function compressFile({ file, fmt, mode, archiveOut }, onProgress, signal, depth = 0) {
  const kind = COMPRESS[fmt];
  if (!kind) throw new UserError("这种文件首版还不能压缩。");
  let r;
  if (kind === "image") r = await runTool("image.compress", { file, fmt, mode }, onProgress, signal);
  else if (kind === "pdf") r = await runTool("pdf.compress", { file, mode }, onProgress, signal);
  else if (kind === "video") {
    if (mode === "lossless") return { blob: file, outFmt: fmt, unchanged: true, notes: ["普通模式下视频保持原样。"] };
    r = await media.compressVideo({ file, mode }, onProgress, signal);
  } else r = await compressArchive({ file, fmt, mode, outFmt: archiveOut }, onProgress, signal, depth);
  r.outFmt ??= fmt;
  r.notes ??= [];
  // 结果不比原文件小：返回原文件（换格式输出的压缩包除外，那是用户要求的）
  const formatChanged = kind === "archive" && r.outFmt !== fmt;
  if (!r.unchanged && !formatChanged && r.blob.size >= file.size) {
    return { blob: file, outFmt: fmt, unchanged: true, noGain: true, notes: [NO_GAIN] };
  }
  if (r.unchanged && !r.notes.length) r.notes.push(NO_GAIN);
  return r;
}

// 压缩包深度优化：解包 → 逐个优化里面的图片 / PDF / 视频 / 压缩包 → 重新打包 → 核对清单
async function compressArchive({ file, fmt, mode, outFmt }, onProgress, signal, depth) {
  outFmt ||= fmt === "rar" ? "zip" : fmt;
  const ex = await runTool("archive.extract", { file, fmt, limits: LIMITS }, null, signal);
  if (ex.singleGzip) return { blob: file, outFmt: fmt, unchanged: true, notes: ["这是单个文件的 .gz 压缩，已经是压缩格式，保持原样。"] };
  onProgress?.(0.1);
  const innerMode = mode === "normal" ? "lossless" : "strong";
  const notes = [...(ex.warn || [])];
  let improved = 0, failed = 0, saved = 0;
  const deep = [];
  for (let i = 0; i < ex.files.length; i++) {
    if (signal?.aborted) throw new UserError("已取消。");
    const entry = ex.files[i];
    const name = entry.path.split("/").pop();
    const sub = new File([entry.data], name);
    const f = await sniff(sub);
    const k = COMPRESS[f];
    if (k && !(k === "video" && innerMode === "lossless")) {
      if (k === "archive" && depth + 1 >= MAX_DEPTH) { deep.push(entry.path); }
      else {
        try {
          // 包内文件保持原格式和文件名（例如 HEIC 不转 JPG、内层 RAR 不改 ZIP）
          if (k !== "archive" || f !== "rar") {
            const r = await compressFile({ file: sub, fmt: f, mode: innerMode, archiveOut: f }, null, signal, depth + 1);
            if (!r.unchanged && r.outFmt === f && r.blob.size < entry.data.length) {
              saved += entry.data.length - r.blob.size;
              entry.data = new Uint8Array(await r.blob.arrayBuffer());
              improved++;
            }
          }
        } catch (e) {
          if (signal?.aborted) throw e;
          failed++;
          notes.push(`“${entry.path}”处理失败，已原样保留（${errMsg(e)}）。`);
        }
      }
    }
    onProgress?.(0.1 + 0.75 * (i + 1) / ex.files.length);
  }
  const packed = await runTool("archive.pack", { files: ex.files, dirs: ex.dirs, fmt: outFmt }, null, signal);
  onProgress?.(0.92);
  // 核对文件清单：重新打包后一个文件都不能少
  const list = await runTool("archive.listFiles", { file: packed.blob, fmt: outFmt }, null, signal);
  const want = new Set(ex.files.map(f => f.path));
  const got = new Set(list.map(f => f.path));
  const missing = [...want].filter(p => !got.has(p));
  if (missing.length) throw new UserError(`重新打包后少了 ${missing.length} 个文件（如“${missing[0]}”），已停止，原文件不受影响。`);
  onProgress?.(1);

  notes.unshift(`共 ${ex.files.length} 个文件，优化了 ${improved} 个，其余原样保留；已核对文件清单一致。`);
  if (mode === "normal") notes.push("普通模式下，包里的文件只做无损优化。");
  if (deep.length) notes.push(`以下压缩包嵌套超过 ${MAX_DEPTH} 层，原样保留：${deep.join("、")}`);
  if (ex.skipped?.length) notes.push("未处理：" + ex.skipped.join("、"));
  if (fmt === "rar" && outFmt === "zip") notes.push("首版不能生成 RAR，输出为 ZIP。");
  return { blob: packed.blob, outFmt, notes, partial: failed > 0 };
}

// 压缩前预估：返回 { bytes, note } 或只有文字说明 { text }
export async function estimateCompress({ file, fmt, mode }) {
  const kind = COMPRESS[fmt];
  if (kind === "image") return runTool("image.estimate", { file, fmt, mode });
  if (kind === "video") return media.estimateVideo({ file, mode });
  if (kind === "pdf") return { text: mode === "strong" ? "取决于 PDF 里的图片多少，图片多的通常能节省 50%–90%" : "取决于 PDF 里的图片多少，图片多的通常能节省 20%–60%，纯文字的变化不大" };
  if (kind === "archive") return { text: "取决于包里的图片、PDF、视频多少" + (mode === "normal" ? "；普通模式只做无损优化，变化通常不大" : "") };
  return { text: "" };
}

// ---------- 转换 ----------
// opts：{ gif, frames, audioVideo, title }
export async function convertFile({ file, from, to, opts = {} }, onProgress, signal) {
  if (from === to) return { blob: file, outFmt: to, unchanged: true, notes: [`本来就是 ${FORMATS[to].label} 格式，原样保留。`] };
  const steps = plan(from, to);
  if (!steps) throw new UserError(`没有从 ${FORMATS[from]?.label || from} 转到 ${FORMATS[to]?.label || to} 的方法。`);
  let cur = file, notes = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const prog = p => onProgress?.((i + (p || 0)) / steps.length);
    const r = await runStep(s, cur, opts, prog, signal);
    notes.push(...(r.notes || []));
    cur = new File([r.blob], `${baseName(file.name)}.${FORMATS[s.to].ext}`, { type: FORMATS[s.to].mime });
  }
  await verify(cur, to);
  if (steps.length > 1) notes.unshift("分 " + steps.length + " 步完成：" + [steps[0].from, ...steps.map(s => s.to)].map(f => FORMATS[f].label).join(" → "));
  return { blob: cur, outFmt: to, notes };
}

async function runStep({ cap, from, to }, file, opts, onProgress, signal) {
  switch (cap.run) {
    case "image.convert": return runTool("image.convert", { file, from, to }, onProgress, signal);
    case "image.toPdf": return runTool("image.toPdf", { files: [{ file, fmt: from }] }, onProgress, signal);
    case "media.convert": return media.convert({ file, from, to }, onProgress, signal);
    case "media.toGif": return media.toGif({ file, opts: opts.gif }, onProgress, signal);
    case "media.toFrames": return media.toFrames({ file, opts: opts.frames }, onProgress, signal);
    case "media.audioToVideo": return media.audioToVideo({ file, opts: opts.audioVideo }, onProgress, signal);
    case "doc.convert": return runTool("doc.convert", { file, from, to, title: opts.title || baseName(file.name) }, onProgress, signal);
    case "data.convert": return runTool("data.convert", { file, from, to }, onProgress, signal);
    case "pdf.fromDoc": return (await import("./topdf.js")).docToPdf({ file, from }, onProgress, signal);
    case "pdf.toWord": return (await import("./pdf2word.js")).pdfToWord({ file, to }, onProgress, signal);
    case "can.convert": return runTool("can.convert", { file, to }, onProgress, signal);
    case "archive.convert": {
      const ex = await runTool("archive.extract", { file, fmt: from, limits: LIMITS }, null, signal);
      onProgress?.(0.4);
      if (ex.singleGzip) throw new UserError("这是单个文件的 .gz 压缩，不是 TAR.GZ 压缩包，没法换成别的压缩包格式。");
      const p = await runTool("archive.pack", { files: ex.files, dirs: ex.dirs, fmt: to }, null, signal);
      const list = await runTool("archive.listFiles", { file: p.blob, fmt: to }, null, signal);
      if (list.length !== ex.files.length) throw new UserError("重新打包后文件数量不一致，已停止。");
      return { blob: p.blob, notes: [`共 ${ex.files.length} 个文件，已核对文件清单一致。`, ...(ex.skipped?.length ? ["未处理：" + ex.skipped.join("、")] : [])] };
    }
  }
  throw new Error("未知处理：" + cap.run);
}

// 多张图片合成一个 PDF
export async function imagesToPdf(items, onProgress, signal) {
  const r = await runTool("image.toPdf", { files: items.map(i => ({ file: i.file, fmt: i.fmt })) }, onProgress, signal);
  return { ...r, outFmt: "pdf" };
}

// 输出校验：按内容识别出来的格式要和目标一致（文本类格式无法从内容区分，跳过）
const SAME = { m4a: ["m4a", "mp4"], mov: ["mov", "mp4"], frames: ["zip"], aac: ["aac", "mp3"] };
const TEXTY = new Set(["md", "txt", "html", "csv", "json", "asc"]);
async function verify(blob, to) {
  if (TEXTY.has(to)) { if (!blob.size) throw new UserError("输出文件是空的，转换失败。"); return; }
  const got = await sniff(blob);
  if (!(SAME[to] || [to]).includes(got)) throw new UserError(`输出文件校验没通过（应为 ${FORMATS[to].label}，实际识别为 ${got || "未知"}），已停止。`);
}
