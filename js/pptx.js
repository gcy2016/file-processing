// PPTX 简易渲染：把每张幻灯片画成网页元素（文字、图片、色块、简单表格），供转 PDF 截图
// 只覆盖常见内容；动画、图表、SmartArt、艺术字效果等不渲染
import { UserError } from "./util.js";

const V = new URL("../vendor/", import.meta.url).href;
const EMU = 9525;   // 1 CSS 像素 = 9525 EMU
const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
};

const kids = (n, ns, name) => n ? [...n.children].filter(c => c.namespaceURI === NS[ns] && c.localName === name) : [];
const kid = (n, ns, name) => kids(n, ns, name)[0] || null;
const path = (n, ...steps) => steps.reduce((cur, s) => { const [ns, name] = s.split(":"); return kid(cur, ns, name); }, n);
const xml = text => new DOMParser().parseFromString(text, "application/xml");

function resolve(base, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
  return parts.join("/");
}

export async function renderPptx(file, stage) {
  const { unzipSync, strFromU8 } = await import(V + "fflate.js");
  let zip;
  try { zip = unzipSync(new Uint8Array(await file.arrayBuffer())); }
  catch { throw new UserError("这个 PPT 文件打不开，可能已损坏。"); }
  const read = p => zip[p] ? strFromU8(zip[p]) : null;
  const rels = p => {
    const relPath = p.replace(/([^/]+)$/, "_rels/$1.rels");
    const map = {};
    const t = read(relPath);
    if (t) for (const r of xml(t).getElementsByTagName("Relationship")) map[r.getAttribute("Id")] = { target: resolve(p, r.getAttribute("Target")), type: r.getAttribute("Type") };
    return map;
  };
  const pres = xml(read("ppt/presentation.xml") || "");
  const sz = pres.getElementsByTagNameNS(NS.p, "sldSz")[0];
  const W = Math.round((Number(sz?.getAttribute("cx")) || 12192000) / EMU);
  const H = Math.round((Number(sz?.getAttribute("cy")) || 6858000) / EMU);
  const presRels = rels("ppt/presentation.xml");
  const slideIds = [...pres.getElementsByTagNameNS(NS.p, "sldId")].map(s => s.getAttributeNS(NS.r, "id"));
  const urls = [];
  const media = p => {
    if (!zip[p] || /\.(emf|wmf)$/i.test(p)) return null;
    const type = /\.png$/i.test(p) ? "image/png" : /\.gif$/i.test(p) ? "image/gif" : /\.svg$/i.test(p) ? "image/svg+xml" : "image/jpeg";
    const u = URL.createObjectURL(new Blob([zip[p]], { type }));
    urls.push(u);
    return u;
  };

  const pages = [];
  for (const rid of slideIds) {
    const slidePath = presRels[rid]?.target;
    if (!slidePath || !read(slidePath)) continue;
    const ctx = loadChain(slidePath, read, rels);
    const box = document.createElement("div");
    box.style.cssText = `position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#fff;margin-bottom:16px`;
    applyBackground(box, ctx, media);
    // 母版、版式上的非占位符元素（logo、装饰条等）先画
    for (const layer of [ctx.master, ctx.layout]) if (layer) drawTree(box, path(layer.doc.documentElement, "p:cSld", "p:spTree"), layer, ctx, media, true);
    drawTree(box, path(ctx.slide.doc.documentElement, "p:cSld", "p:spTree"), ctx.slide, ctx, media, false);
    stage.append(box);
    const r = box.getBoundingClientRect();
    pages.push({ el: box, rect: { x: r.left + window.scrollX, y: r.top + window.scrollY, w: W, h: H }, page: { w: W, h: H }, at: { x: 0, y: 0 } });
  }
  await Promise.all([...stage.querySelectorAll("img")].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
  if (!pages.length) throw new UserError("这个 PPT 里没有幻灯片。");
  setTimeout(() => urls.forEach(u => URL.revokeObjectURL(u)), 120000);
  return pages;
}

// 幻灯片 → 版式 → 母版 → 主题
function loadChain(slidePath, read, rels) {
  const part = p => ({ path: p, doc: xml(read(p)), rels: rels(p) });
  const slide = part(slidePath);
  const find = (pt, kind) => Object.values(pt.rels).find(r => r.type.endsWith("/" + kind))?.target;
  const layoutPath = find(slide, "slideLayout");
  const layout = layoutPath && read(layoutPath) ? part(layoutPath) : null;
  const masterPath = layout && find(layout, "slideMaster");
  const master = masterPath && read(masterPath) ? part(masterPath) : null;
  const themePath = master && find(master, "theme");
  const colors = {};
  if (themePath && read(themePath)) {
    const scheme = xml(read(themePath)).getElementsByTagNameNS(NS.a, "clrScheme")[0];
    for (const c of scheme?.children || []) {
      const v = c.firstElementChild;
      colors[c.localName] = v?.getAttribute("val") === "windowText" ? "000000" : v?.getAttribute("lastClr") || v?.getAttribute("val");
    }
  }
  return { slide, layout, master, colors };
}

// ---------- 颜色 ----------
function color(fillParent, ctx) {
  const solid = kid(fillParent, "a", "solidFill") || (fillParent?.localName === "solidFill" ? fillParent : null);
  if (!solid) return null;
  const c = solid.firstElementChild;
  if (!c) return null;
  let hex;
  if (c.localName === "srgbClr") hex = c.getAttribute("val");
  else if (c.localName === "schemeClr") {
    const alias = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
    const v = c.getAttribute("val");
    hex = ctx.colors[alias[v] || v];
  } else if (c.localName === "sysClr") hex = c.getAttribute("lastClr");
  else if (c.localName === "prstClr") return c.getAttribute("val");
  if (!hex) return null;
  let [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  const mod = name => { const m = kid(c, "a", name); return m ? Number(m.getAttribute("val")) / 100000 : null; };
  const lumMod = mod("lumMod"), lumOff = mod("lumOff"), alpha = mod("alpha");
  if (lumMod != null || lumOff != null) {
    let [h, s, l] = rgbToHsl(r, g, b);
    l = Math.min(1, Math.max(0, l * (lumMod ?? 1) + (lumOff ?? 0)));
    [r, g, b] = hslToRgb(h, s, l);
  }
  return `rgba(${r},${g},${b},${alpha ?? 1})`;
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb(h, s, l) {
  if (!s) return [l, l, l].map(v => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}

function applyBackground(box, ctx, media) {
  for (const layer of [ctx.slide, ctx.layout, ctx.master]) {
    const bgPr = layer && path(layer.doc.documentElement, "p:cSld", "p:bg", "p:bgPr");
    if (!bgPr) continue;
    const c = color(bgPr, ctx);
    if (c) { box.style.background = c; return; }
    const blip = path(bgPr, "a:blipFill", "a:blip");
    const u = blip && media(layer.rels[blip.getAttributeNS(NS.r, "embed")]?.target || "");
    if (u) { box.style.background = `#fff url("${u}") center/cover no-repeat`; return; }
  }
}

// ---------- 形状 ----------
function placeholderXfrm(sp, ctx) {
  const ph = path(sp, "p:nvSpPr", "p:nvPr", "p:ph");
  if (!ph) return null;
  const type = ph.getAttribute("type") || "body", idx = ph.getAttribute("idx");
  for (const layer of [ctx.layout, ctx.master]) {
    if (!layer) continue;
    for (const s of layer.doc.getElementsByTagNameNS(NS.p, "sp")) {
      const p2 = path(s, "p:nvSpPr", "p:nvPr", "p:ph");
      if (!p2) continue;
      const t2 = p2.getAttribute("type") || "body";
      if ((idx != null && p2.getAttribute("idx") === idx) || t2 === type || (type === "ctrTitle" && t2 === "title")) {
        const x = path(s, "p:spPr", "a:xfrm");
        if (x) return x;
      }
    }
  }
  return null;
}

function rect(xfrm, grp) {
  const off = kid(xfrm, "a", "off"), ext = kid(xfrm, "a", "ext");
  if (!off || !ext) return null;
  let x = +off.getAttribute("x"), y = +off.getAttribute("y"), w = +ext.getAttribute("cx"), h = +ext.getAttribute("cy");
  if (grp) {
    x = grp.x + (x - grp.chX) * grp.sx; y = grp.y + (y - grp.chY) * grp.sy;
    w *= grp.sx; h *= grp.sy;
  }
  return { x, y, w, h, rot: (+xfrm.getAttribute("rot") || 0) / 60000 };
}

function place(el, r) {
  el.style.position = "absolute";
  el.style.left = r.x / EMU + "px"; el.style.top = r.y / EMU + "px";
  el.style.width = r.w / EMU + "px"; el.style.height = r.h / EMU + "px";
  if (r.rot) el.style.transform = `rotate(${r.rot}deg)`;
}

function drawTree(box, tree, part, ctx, media, decorOnly, grp = null) {
  for (const n of tree?.children || []) {
    if (n.namespaceURI !== NS.p) continue;
    const isPh = !!path(n, n.localName === "sp" ? "p:nvSpPr" : "p:nvPicPr", "p:nvPr", "p:ph");
    if (decorOnly && isPh) continue;
    if (n.localName === "sp") drawShape(box, n, part, ctx, grp);
    else if (n.localName === "pic") drawPic(box, n, part, media, grp);
    else if (n.localName === "graphicFrame") drawTable(box, n, ctx, grp);
    else if (n.localName === "grpSp") {
      const x = path(n, "p:grpSpPr", "a:xfrm");
      const off = kid(x, "a", "off"), ext = kid(x, "a", "ext"), cho = kid(x, "a", "chOff"), che = kid(x, "a", "chExt");
      if (!off || !ext) continue;
      const outer = rect(x, grp);
      const g = {
        x: outer.x, y: outer.y, chX: +(cho?.getAttribute("x") || 0), chY: +(cho?.getAttribute("y") || 0),
        sx: outer.w / (+(che?.getAttribute("cx")) || outer.w || 1), sy: outer.h / (+(che?.getAttribute("cy")) || outer.h || 1),
      };
      drawTree(box, n, part, ctx, media, decorOnly, g);
    }
  }
}

function drawShape(box, sp, part, ctx, grp) {
  const spPr = kid(sp, "p", "spPr");
  const xfrm = kid(spPr, "a", "xfrm") || placeholderXfrm(sp, ctx);
  const r = xfrm && rect(xfrm, grp);
  if (!r) return;
  const el = document.createElement("div");
  place(el, r);
  const fill = color(spPr, ctx);
  if (fill) el.style.background = fill;
  const ln = kid(spPr, "a", "ln");
  const lnColor = ln && !kid(ln, "a", "noFill") && color(ln, ctx);
  if (lnColor) el.style.border = `${Math.max(1, (+ln.getAttribute("w") || 9525) / EMU)}px solid ${lnColor}`;
  const geom = kid(spPr, "a", "prstGeom")?.getAttribute("prst");
  if (geom === "ellipse") el.style.borderRadius = "50%";
  else if (geom === "roundRect") el.style.borderRadius = Math.min(r.w, r.h) / EMU * 0.12 + "px";
  el.style.boxSizing = "border-box";
  const body = kid(sp, "p", "txBody");
  // PowerPoint 默认：带底色的形状（非文本框）文字上下左右居中
  const isTextBox = path(sp, "p:nvSpPr", "p:cNvSpPr")?.getAttribute("txBox") === "1";
  if (body) drawText(el, body, sp, ctx, !isTextBox && !!(fill || geom) && !path(sp, "p:nvSpPr", "p:nvPr", "p:ph"));
  box.append(el);
}

function drawText(el, body, sp, ctx, centered) {
  const bodyPr = kid(body, "a", "bodyPr");
  const ins = k => (bodyPr?.getAttribute(k) != null ? +bodyPr.getAttribute(k) : (k[0] === "t" || k[0] === "b" ? 45720 : 91440)) / EMU;
  el.style.padding = `${ins("tIns")}px ${ins("rIns")}px ${ins("bIns")}px ${ins("lIns")}px`;
  el.style.display = "flex"; el.style.flexDirection = "column";
  const phType0 = path(sp, "p:nvSpPr", "p:nvPr", "p:ph")?.getAttribute("type");
  const anchor = bodyPr?.getAttribute("anchor") || (centered || phType0 === "ctrTitle" ? "ctr" : phType0 === "title" ? "ctr" : "t");
  el.style.justifyContent = { ctr: "center", b: "flex-end" }[anchor] || "flex-start";
  el.style.overflow = "visible"; el.style.wordBreak = "break-word";
  const phType = path(sp, "p:nvSpPr", "p:nvPr", "p:ph")?.getAttribute("type");
  const isTitle = phType === "title" || phType === "ctrTitle";
  const defaultPt = isTitle ? 36 : phType ? 20 : 18;
  for (const p of kids(body, "a", "p")) {
    const div = document.createElement("div");
    const pPr = kid(p, "a", "pPr");
    const defAlign = centered || phType === "ctrTitle" || phType === "subTitle" ? "ctr" : "l";
    div.style.textAlign = { ctr: "center", r: "right", just: "justify" }[pPr?.getAttribute("algn") || defAlign] || "left";
    div.style.lineHeight = "1.2";
    const lvl = +(pPr?.getAttribute("lvl") || 0);
    if (lvl) div.style.paddingLeft = lvl * 24 + "px";
    const bu = kid(pPr, "a", "buChar")?.getAttribute("char");
    const runs = [...p.children].filter(c => c.namespaceURI === NS.a && ["r", "br", "fld"].includes(c.localName));
    let firstSize = defaultPt;
    if (bu && runs.length) div.append(bu + " ");
    for (const run of runs) {
      if (run.localName === "br") { div.append(document.createElement("br")); continue; }
      const rPr = kid(run, "a", "rPr");
      const span = document.createElement("span");
      span.textContent = kid(run, "a", "t")?.textContent || "";
      const size = rPr?.getAttribute("sz") ? +rPr.getAttribute("sz") / 100 : defaultPt;
      firstSize = size;
      span.style.fontSize = size * 4 / 3 + "px";
      if (rPr?.getAttribute("b") === "1" || isTitle) span.style.fontWeight = "700";
      if (rPr?.getAttribute("i") === "1") span.style.fontStyle = "italic";
      if (rPr?.getAttribute("u") && rPr.getAttribute("u") !== "none") span.style.textDecoration = "underline";
      span.style.color = color(rPr, ctx) || (ctx.colors.dk1 ? "#" + ctx.colors.dk1 : "#000");
      div.append(span);
    }
    if (!runs.length) { div.style.fontSize = firstSize * 4 / 3 + "px"; div.innerHTML = "&nbsp;"; }
    el.append(div);
  }
}

function drawPic(box, pic, part, media, grp) {
  const xfrm = path(pic, "p:spPr", "a:xfrm");
  const r = xfrm && rect(xfrm, grp);
  const blip = path(pic, "p:blipFill", "a:blip");
  const u = blip && media(part.rels[blip.getAttributeNS(NS.r, "embed")]?.target || "");
  if (!r || !u) return;
  const img = document.createElement("img");
  img.src = u;
  place(img, r);
  img.style.objectFit = "fill";
  box.append(img);
}

function drawTable(box, frame, ctx, grp) {
  const tbl = frame.getElementsByTagNameNS(NS.a, "tbl")[0];
  const xfrm = kid(frame, "p", "xfrm");
  const r = tbl && xfrm && rect(xfrm, grp);
  if (!r) return;
  const t = document.createElement("table");
  t.style.cssText = "border-collapse:collapse;font-size:14px;table-layout:fixed";
  place(t, r);
  t.style.height = "auto";
  for (const tr of kids(tbl, "a", "tr")) {
    const row = t.insertRow();
    for (const tc of kids(tr, "a", "tc")) {
      if (tc.getAttribute("hMerge") === "1" || tc.getAttribute("vMerge") === "1") continue;
      const cell = row.insertCell();
      if (tc.getAttribute("gridSpan")) cell.colSpan = +tc.getAttribute("gridSpan");
      if (tc.getAttribute("rowSpan")) cell.rowSpan = +tc.getAttribute("rowSpan");
      cell.style.cssText = "border:1px solid #888;padding:4px 6px;vertical-align:top";
      const bg = color(kid(tc, "a", "tcPr"), ctx);
      if (bg) cell.style.background = bg;
      cell.textContent = [...tc.getElementsByTagNameNS(NS.a, "p")].map(p => [...p.getElementsByTagNameNS(NS.a, "t")].map(x => x.textContent).join("")).join("\n");
      cell.style.whiteSpace = "pre-wrap";
    }
  }
  box.append(t);
}
