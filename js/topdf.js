// Word / Excel / PPT / Markdown / HTML / TXT / EPUB / ODT → PDF（图片式，不可编辑）
// 做法：在页面里把文档排好版（用手机自带的中文字体），再按页截图放进 PDF。
// 在主线程运行（需要页面 DOM）；文本类格式先用 pandoc 转成安全的 HTML（去掉脚本）。
import { UserError } from "./util.js";
import { runTool } from "./worker-client.js";
import { renderPptx } from "./pptx.js";
import { isMobile } from "./env.js";

const V = new URL("../vendor/", import.meta.url).href;
const A4 = { w: 794, h: 1123 };            // CSS 像素（96 dpi）
const MARGIN = 72;                          // 文本类文档的页边距
const SCALE = isMobile ? 1.5 : 2;           // 截图倍数：越大越清晰，越占内存

const NOTE = "生成的是图片式 PDF：文字不能选中、搜索或编辑；排版按网页效果生成，可能和原软件里略有差别。";

// stage：放在页面外、但仍参与排版的容器
function makeStage(width) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;z-index:-1;pointer-events:none";
  const stage = document.createElement("div");
  stage.className = "render-stage";
  stage.style.cssText = `position:absolute;left:0;top:0;width:${width}px;background:#fff;color:#000;` +
    "font-family:-apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif;font-size:14px;line-height:1.6";
  host.append(stage);
  document.body.append(host);
  return { stage, done: () => host.remove() };
}

const DOC_CSS = `
.render-stage .flow { padding:${MARGIN}px; box-sizing:border-box; width:${A4.w}px; }
.render-stage .flow img { max-width:100%; height:auto; }
.render-stage .flow table { border-collapse:collapse; max-width:100%; }
.render-stage .flow th, .render-stage .flow td { border:1px solid #999; padding:4px 6px; vertical-align:top; }
.render-stage .flow pre { white-space:pre-wrap; word-break:break-all; }
.render-stage .flow h1 { font-size:24px; } .render-stage .flow h2 { font-size:20px; } .render-stage .flow h3 { font-size:17px; }
.render-stage .sheet { padding:24px; display:inline-block; }
.render-stage .sheet table { border-collapse:collapse; font-size:12px; }
.render-stage .sheet td, .render-stage .sheet th { border:1px solid #bbb; padding:3px 6px; white-space:nowrap; }
.render-stage .sheet h2 { font-size:16px; margin:0 0 8px; }
`;

// ---------- 分页：在块元素边界处切，尽量不把一行字切成两半 ----------
function breakPoints(el, top) {
  const pts = new Set();
  for (const n of el.querySelectorAll("p,li,tr,h1,h2,h3,h4,h5,h6,img,pre,blockquote,table,section,article,div,hr,dt,dd,figure")) {
    const r = n.getBoundingClientRect();
    if (r.height > 0) pts.add(Math.round(r.bottom - top));
  }
  return [...pts].sort((a, b) => a - b);
}

// 把一个排好版的块（content 区域）切成若干页高度
function slices(el, contentTop, contentH, pageContentH) {
  const pts = breakPoints(el, contentTop);
  const out = [];
  let start = 0;
  while (start < contentH - 1) {
    let end = Math.min(contentH, start + pageContentH);
    if (end < contentH) {
      const ok = pts.filter(p => p > start + pageContentH * 0.5 && p <= start + pageContentH);
      if (ok.length) end = ok[ok.length - 1];
    }
    out.push([start, end]);
    start = end;
  }
  return out.length ? out : [[0, Math.max(1, contentH)]];
}

// ---------- 截图并组装 PDF ----------
// 截一页：把元素复制一份放进页面大小的"取景框"（贴在排版区左上角），只截这个框。
// 直接按坐标截取时，屏幕以外的页会是空白，所以不用坐标裁剪。
async function capture(h2c, el, rect) {
  const r = el.getBoundingClientRect();
  const frame = document.createElement("div");
  frame.style.cssText = `position:absolute;left:0;top:0;width:${rect.w}px;height:${rect.h}px;overflow:hidden;background:#fff`;
  const clone = el.cloneNode(true);
  clone.style.position = "relative";
  clone.style.margin = "0";
  clone.style.left = -(rect.x - (r.left + window.scrollX)) + "px";
  clone.style.top = -(rect.y - (r.top + window.scrollY)) + "px";
  frame.append(clone);
  el.closest(".render-stage").append(frame);
  try {
    await Promise.all([...frame.querySelectorAll("img")].map(i => i.complete ? null : new Promise(res => { i.onload = i.onerror = res; })));
    const canvas = await h2c(frame, { backgroundColor: "#ffffff", scale: SCALE, useCORS: true, logging: false });
    const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.88));
    canvas.width = canvas.height = 0;
    return new Uint8Array(await blob.arrayBuffer());
  } finally { frame.remove(); }
}

// pages：[{ el, rect:{x,y,w,h}（文档坐标）, page:{w,h}, at:{x,y}（在页面上的位置，CSS 像素） }]
async function assemble(pages, onProgress) {
  const [{ default: h2c }, { PDFDocument }] = await Promise.all([import(V + "html2canvas.js"), import(V + "pdflib.js")]);
  const doc = await PDFDocument.create();
  const pt = 0.75;   // CSS 像素 → PDF 点
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const jpg = await doc.embedJpg(await capture(h2c, p.el, p.rect));
    const page = doc.addPage([p.page.w * pt, p.page.h * pt]);
    const k = p.fit ? Math.min(1, (p.page.w - 2 * p.at.x) / p.rect.w) : 1;
    page.drawImage(jpg, { x: p.at.x * pt, y: (p.page.h - p.at.y - p.rect.h * k) * pt, width: p.rect.w * k * pt, height: p.rect.h * k * pt });
    onProgress?.(0.3 + 0.7 * (i + 1) / pages.length);
  }
  return new Blob([await doc.save()], { type: "application/pdf" });
}

// 流式内容（HTML 文档）：按 A4 分页
function flowPages(el) {
  const r = el.getBoundingClientRect();
  const top = r.top + window.scrollY, left = r.left + window.scrollX;
  const contentH = r.height - 2 * MARGIN;
  return slices(el, r.top + MARGIN, contentH, A4.h - 2 * MARGIN).map(([s, e]) => ({
    el, rect: { x: left + MARGIN, y: top + MARGIN + s, w: A4.w - 2 * MARGIN, h: e - s },
    page: A4, at: { x: MARGIN, y: MARGIN },
  }));
}

// ---------- 各种输入 ----------
async function renderDocx(file, stage) {
  const { renderAsync } = await import(V + "docx-preview.js");
  const style = document.createElement("div");
  stage.append(style);
  const body = document.createElement("div");
  stage.append(body);
  await renderAsync(file, body, style, {
    inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false,
    renderHeaders: true, renderFooters: true, renderFootnotes: true, experimental: true, useBase64URL: true,
  });
  stage.style.width = "auto";
  await waitImages(stage);
  const pages = [];
  for (const sec of body.querySelectorAll("section.docx")) {
    const cs = getComputedStyle(sec);
    const pw = sec.offsetWidth, ph = parseFloat(cs.minHeight) || A4.h;
    const pad = { t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    const r = sec.getBoundingClientRect();
    const top = r.top + window.scrollY, left = r.left + window.scrollX;
    if (r.height <= ph + 2) { pages.push({ el: sec, rect: { x: left, y: top, w: pw, h: ph }, page: { w: pw, h: ph }, at: { x: 0, y: 0 } }); continue; }
    // 内容比一页长：在内容区里分页，每页保留原文档的上下边距
    const contentH = r.height - pad.t - pad.b, perPage = ph - pad.t - pad.b;
    for (const [s, e] of slices(sec, r.top + pad.t, contentH, perPage)) {
      pages.push({ el: sec, rect: { x: left, y: top + pad.t + s, w: pw, h: e - s }, page: { w: pw, h: ph }, at: { x: 0, y: pad.t } });
    }
  }
  if (!pages.length) throw new UserError("这个 Word 文档里没有可显示的内容。");
  return pages;
}

async function renderSheets(file, from, stage) {
  const XL = await import(V + "xlsx.js");
  let wb;
  if (from === "csv") {
    const buf = new Uint8Array(await file.arrayBuffer());
    let text;
    for (const enc of ["utf-8", "gb18030"]) { try { text = new TextDecoder(enc, { fatal: true }).decode(buf); break; } catch {} }
    wb = XL.read((text ?? "").replace(/^﻿/, ""), { type: "string", raw: true });
  } else wb = XL.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  stage.style.width = "auto";
  const pages = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws["!ref"]) continue;
    const box = document.createElement("div");
    box.className = "sheet";
    box.innerHTML = `<h2></h2>` + XL.utils.sheet_to_html(ws, { header: "", footer: "" });
    box.querySelector("h2").textContent = wb.SheetNames.length > 1 ? name : "";
    stage.append(box);
    const r = box.getBoundingClientRect();
    const top = r.top + window.scrollY, left = r.left + window.scrollX;
    // 表格较宽时整体缩小到 A4 横向宽度；按缩小后的页面高度分页
    const landscape = { w: A4.h, h: A4.w };
    const k = Math.min(1, (landscape.w - 48) / r.width);
    const perPage = (landscape.h - 48) / k;
    for (const [s, e] of slices(box, r.top, r.height, perPage)) {
      pages.push({ el: box, rect: { x: left, y: top + s, w: r.width, h: e - s }, page: landscape, at: { x: 24, y: 24 }, fit: true });
    }
  }
  if (!pages.length) throw new UserError("表格里没有数据。");
  return pages;
}

async function renderViaPandoc(file, from, stage, onProgress) {
  const r = await runTool("doc.convert", { file, from, to: "html", title: file.name.replace(/\.[^.]+$/, "") }, p => onProgress?.(p * 0.25));
  const html = await r.blob.text();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script,iframe,object,embed,link,meta,style,header#title-block-header").forEach(n => n.remove());
  const flow = document.createElement("div");
  flow.className = "flow";
  flow.append(...parsed.body.childNodes);
  stage.append(flow);
  await waitImages(flow);
  return flowPages(flow);
}

async function waitImages(root) {
  await Promise.all([...root.querySelectorAll("img")].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
  await document.fonts?.ready;
}

export async function docToPdf({ file, from }, onProgress, signal) {
  const { stage, done } = makeStage(A4.w);
  const css = document.createElement("style");
  css.textContent = DOC_CSS;
  stage.append(css);
  try {
    onProgress?.(0.02);
    let pages;
    if (from === "docx") pages = await renderDocx(file, stage);
    else if (from === "xlsx" || from === "csv") pages = await renderSheets(file, from, stage);
    else if (from === "pptx") pages = await renderPptx(file, stage);
    else pages = await renderViaPandoc(file, from, stage, onProgress);
    if (signal?.aborted) throw new UserError("已取消。");
    onProgress?.(0.3);
    if (pages.length > 300) throw new UserError(`文档有 ${pages.length} 页，超过了 300 页的上限。`);
    const blob = await assemble(pages, p => { if (signal?.aborted) throw new UserError("已取消。"); onProgress?.(p); });
    const notes = [NOTE, `共 ${pages.length} 页。`];
    if (from === "pptx") notes.push("PPT 按简易方式渲染：文字、图片、色块会保留，动画、图表、艺术字等可能缺失。");
    if (from === "xlsx" || from === "csv") notes.push("表格较宽时会整体缩小以放进横向 A4 页面。");
    return { blob, outFmt: "pdf", notes };
  } finally { done(); }
}
