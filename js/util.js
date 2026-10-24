// 通用小工具：格式化、建 DOM、下载 / 分享
export const MB = 1024 * 1024;

export function fmtSize(b) {
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + " GB";
  if (b >= MB) return (b / MB).toFixed(b >= 100 * MB ? 0 : 1) + " MB";
  return Math.max(1, Math.round(b / 1024)) + " KB";
}

export function fmtDur(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
}

// 节省比例：1 − 输出 / 原始（PRD 3.2 规定的口径）
export const savedPct = (src, out) => Math.round((1 - out / src) * 100);

// el("div.cls", {attr}, ...children)
export function el(tag, attrs, ...kids) {
  const [name, ...cls] = tag.split(".");
  const n = document.createElement(name);
  if (cls.length) n.className = cls.join(" ");
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "html") n.innerHTML = v;
    else if (k in n && k !== "list" && k !== "form") n[k] = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
  return n;
}

export const baseName = name => name.replace(/\.[^./]+$/, "") || "file";

// 文件名只换扩展名；与真实输出格式一致
export const withExt = (name, ext) => `${baseName(name)}.${ext}`;

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// iPhone 上通过系统分享面板存入相册 / 文件
export function canShareFile(blob, name) {
  try { return !!navigator.canShare?.({ files: [new File([blob], name, { type: blob.type })] }); } catch { return false; }
}
export async function shareBlob(blob, name) {
  await navigator.share({ files: [new File([blob], name, { type: blob.type })] });
}

export function errMsg(e) {
  if (!e) return "未知错误";
  if (typeof e === "string") return e;
  return e.userMessage || e.message || String(e);
}

// 带给用户看的错误
export class UserError extends Error {
  constructor(msg) { super(msg); this.userMessage = msg; }
}
