// 文档互转：DOCX / Markdown / HTML / EPUB / TXT，用 pandoc（在后台线程运行）
import { UserError } from "../util.js";

const V = new URL("../../vendor/", import.meta.url).href;
let pandoc;

// 下载 pandoc 组件（约 16 MB），能拿到大小时报告进度
async function load(progress) {
  if (pandoc) return pandoc;
  const res = await fetch(V + "pandoc.wasm");
  if (!res.ok) throw new UserError("文档转换组件下载失败，请检查网络后重试。");
  const total = Number(res.headers.get("content-length")) || 0;
  const encoded = /gzip|br|deflate/.test(res.headers.get("content-encoding") || "");
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (total && !encoded) progress?.(Math.min(0.6, got / total * 0.6));
  }
  const buf = await new Blob(chunks).arrayBuffer();
  const { createPandocInstance } = await import(V + "pandoc.js");
  pandoc = await createPandocInstance(buf);
  return pandoc;
}

const READER = { docx: "docx", md: "markdown", html: "html", epub: "epub", txt: "markdown", odt: "odt" };
const WRITER = { docx: "docx", md: "gfm-raw_html", html: "html", epub: "epub3", txt: "plain" };
const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown;charset=utf-8", html: "text/html;charset=utf-8", epub: "application/epub+zip", txt: "text/plain;charset=utf-8",
};
const BINARY_IN = new Set(["docx", "epub", "odt"]);

async function readText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  for (const enc of ["utf-8", "gb18030"]) {
    try { return new TextDecoder(enc, { fatal: true }).decode(buf); } catch {}
  }
  return new TextDecoder().decode(buf);
}

export async function convert({ file, from, to, title }, progress) {
  const p = await load(progress);
  progress?.(0.7);
  const inName = "input." + (from === "txt" ? "md" : from);
  const outName = "output." + to;
  const input = BINARY_IN.has(from) ? file : await readText(file);
  const options = {
    from: READER[from], to: WRITER[to],
    "input-files": [inName], "output-file": outName,
    // Markdown / 纯文本不加文件头（标题等元数据）
    standalone: !(to === "md" || to === "txt"),
    metadata: { title: title || "文档", lang: "zh-CN" },
  };
  if (to === "html") options["embed-resources"] = true;
  if (to === "md" || to === "txt") options["extract-media"] = "media";
  let r;
  try { r = await p.convert(options, null, { [inName]: input }); }
  catch (e) { throw new UserError("文档转换失败：" + (e?.message || e)); }
  const out = r.files[outName];
  if (!out || !out.size) {
    const msg = (r.stderr || "").trim().split("\n").slice(-2).join(" ");
    throw new UserError("文档转换失败" + (msg ? "：" + msg : "，文件可能已损坏。"));
  }
  const notes = [];
  const media = Object.keys(r.mediaFiles || {}).length;
  if (media) notes.push(`原文档里有 ${media} 张图片，${to === "md" ? "Markdown 文件" : "纯文本文件"}里不包含图片本身。`);
  if (to === "txt") notes.push("纯文本只保留文字，标题、表格等格式会变成普通文字。");
  if (from === "txt") notes.push("纯文本按段落转换，没有标题、表格等格式。");
  progress?.(1);
  return { blob: new Blob([out], { type: MIME[to] }), notes };
}
