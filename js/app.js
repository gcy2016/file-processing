// 页面：首页 / 压缩 / 转换 / 隐私说明 / 使用条款 / 源代码与许可（# 路由，GitHub Pages 直接可用）
import { el, fmtSize, downloadBlob, savedPct } from "./util.js";
import { FORMATS, KIND_LABEL, sniff } from "./formats.js";
import { CAPABILITIES, COMPRESS, UNSUPPORTED_REASON, plan, targetsFor } from "./registry.js";
import { SIZE_LIMIT, isMobile } from "./env.js";
import { Queue, outputName } from "./queue.js";
import { compressFile, convertFile, imagesToPdf, estimateCompress } from "./jobs.js";
import { describeMedia, probe } from "./media.js";
import { SOURCE_URL, LIBRARIES } from "./about.js";

const app = document.getElementById("app");

const routes = { "": home, compress: compressPage, convert: convertPage, privacy, terms, source };
function route() {
  const key = location.hash.replace(/^#\/?/, "").split("?")[0];
  const page = routes[key] || home;
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("on", a.dataset.nav === key));
  app.replaceChildren(...[page()].flat());
  window.scrollTo(0, 0);
}
addEventListener("hashchange", route);
route();

// ---------- 首页 ----------
function home() {
  return [
    el("h1", "文件压缩与格式转换"),
    el("p.lead", "文件只在你自己的手机或电脑上处理，不上传、不保存。"),
    el("div.choices",
      el("a.choice", { href: "#/compress" }, el("strong", "文件压缩"), el("span", "图片、视频、PDF、压缩包变小，方便发送和上传")),
      el("a.choice", { href: "#/convert" }, el("strong", "格式转换"), el("span", "HEIC 转 JPG、视频转 MP4、提取声音、文档和表格互转等"))),
  ];
}

// ---------- 通用：选文件 ----------
function picker(onFiles, { accept = "", hint = "" } = {}) {
  const input = el("input", { type: "file", multiple: true, accept, hidden: true, onchange: () => { onFiles([...input.files]); input.value = ""; } });
  const box = el("label.pick", { tabIndex: 0 },
    el("strong", "选择文件"), el("span", hint || (isMobile ? "可以一次选多个" : "点这里选择，或把文件拖进来")), input);
  box.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  ["dragenter", "dragover"].forEach(t => box.addEventListener(t, e => { e.preventDefault(); box.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => box.addEventListener(t, e => { e.preventDefault(); box.classList.remove("over"); }));
  box.addEventListener("drop", e => onFiles([...e.dataTransfer.files]));
  return box;
}

async function identify(files) {
  return Promise.all(files.map(async file => ({ file, fmt: await sniff(file).catch(() => null) })));
}

const sizeWarn = f => f.size > SIZE_LIMIT
  ? el("p.note.warn", `${f.name} 有 ${fmtSize(f.size)}，超过这台设备建议的 ${fmtSize(SIZE_LIMIT)}，可能处理失败，可以试试。`) : null;

function seg(name, options, value, onChange) {
  return el("fieldset.seg", options.map(([v, label, small]) =>
    el("label", el("input", { type: "radio", name, value: v, checked: v === value, onchange: () => onChange(v) }),
      el("span", label, small ? el("small", small) : null))));
}

// ---------- 压缩 ----------
function compressPage() {
  let items = [];
  let mode = "normal";
  let archiveOut = "";
  const list = el("ul.jobs");
  const queue = new Queue(list, { onIdle: () => renderAll(), onChange: () => renderAll() });
  const pending = el("div.panel", { hidden: true });
  const allBox = el("div.row");

  const options = el("div.panel",
    el("div.panel-title", el("h2", "压缩强度")),
    seg("mode", [
      ["normal", "普通", "尽量不影响画质，肉眼基本看不出差别"],
      ["strong", "强力", "体积更小，但画质、清晰度会下降"],
    ], mode, v => { mode = v; renderPending(); estimateAll(); }),
  );
  const archiveOpt = el("details.panel", { hidden: true },
    el("summary", "修改压缩包格式（默认保持原格式）"),
    el("div.field", el("label", { for: "aout" }, "输出格式"),
      el("select", { id: "aout", onchange: e => { archiveOut = e.target.value; } },
        el("option", { value: "" }, "与原格式相同（RAR 输出为 ZIP）"),
        ["zip", "7z", "tar", "tgz"].map(f => el("option", { value: f }, FORMATS[f].label)))));

  async function addFiles(files) {
    const found = await identify(files);
    items.push(...found.map(i => ({ ...i, est: {} })));
    renderPending();
    estimateAll();
  }

  // 选好文件和强度后就预估压缩结果（逐个计算，算完一个刷新一次）
  let estimating = false;
  async function estimateAll() {
    if (estimating) return;
    estimating = true;
    try {
      for (;;) {
        const it = items.find(i => COMPRESS[i.fmt] && !i.est[mode]);
        if (!it) break;
        const m = mode;
        it.est[m] = { busy: true };
        try { it.est[m] = await estimateCompress({ file: it.file, fmt: it.fmt, mode: m }); }
        catch { it.est[m] = { failed: true }; }
        renderPending();
      }
    } finally { estimating = false; }
  }

  function estimateLine(it) {
    const e = it.est?.[mode];
    if (!COMPRESS[it.fmt] || !e) return null;
    if (e.busy) return el("p.estimate.hint", "正在估算压缩后的大小…");
    if (e.failed) return el("p.estimate.hint", "无法预估，压缩后显示实际结果。");
    if (e.text) return el("p.estimate", "预计：" + e.text);
    if (e.bytes >= it.file.size * 0.97) return el("p.estimate", "预计：已经比较小，可能无法再压缩（压缩后不变小会返回原文件）。");
    return el("p.estimate", "预计：", el("span.num", fmtSize(it.file.size)), " → 约 ", el("b.num", fmtSize(e.bytes)),
      `（节省约 ${savedPct(it.file.size, e.bytes)}%）`, e.note ? "，" + e.note : "");
  }

  function renderPending() {
    pending.hidden = !items.length;
    archiveOpt.hidden = !items.some(i => COMPRESS[i.fmt] === "archive");
    const ok = items.filter(i => COMPRESS[i.fmt]);
    pending.replaceChildren(
      el("div.panel-title", el("h2", `待压缩（${items.length}）`), el("button.btn.ghost", { type: "button", onclick: () => { items = []; renderPending(); } }, "清空")),
      el("ul.jobs", items.map((it, idx) => el("li.job",
        el("div.job-head", el("div.job-name", it.file.name), el("button.x", { type: "button", "aria-label": "移除", onclick: () => { items.splice(idx, 1); renderPending(); } }, "×")),
        el("div.job-meta", `${fmtSize(it.file.size)} · ${it.fmt ? FORMATS[it.fmt].label : "无法识别"}`),
        estimateLine(it),
        COMPRESS[it.fmt] ? null : el("p.note.bad", it.fmt ? `${FORMATS[it.fmt].label} 首版还不能压缩。支持：图片（JPG、PNG、WebP、HEIC）、视频（MP4、MOV 等）、PDF、压缩包（ZIP、7Z、TAR、TAR.GZ、RAR）。` : "认不出这个文件的格式。"),
        sizeWarn(it.file)))),
      el("button.btn", { type: "button", disabled: !ok.length, onclick: start }, `开始压缩${ok.length > 1 ? `（${ok.length} 个）` : ""}`),
    );
  }

  function start() {
    const ok = items.filter(i => COMPRESS[i.fmt]);
    items = items.filter(i => !COMPRESS[i.fmt]);
    renderPending();
    for (const { file, fmt } of ok) {
      const m = mode, aout = archiveOut;
      queue.add({
        title: file.name, size: file.size, kind: COMPRESS[fmt], compare: true, from: fmt,
        run: (p, s) => compressFile({ file, fmt, mode: m, archiveOut: aout }, p, s),
        outName: outFmt => outputName(file.name, outFmt, "_压缩"),
      });
    }
    renderAll();
  }

  function renderAll() { renderResultActions(queue, allBox); }

  return [
    el("h1", "文件压缩"),
    el("p.lead", "支持图片（JPG、PNG、WebP、HEIC）、视频（MP4、MOV 等）、PDF、压缩包（ZIP、7Z、TAR、TAR.GZ、RAR）。"),
    picker(addFiles),
    options, archiveOpt, pending, list, allBox,
  ];
}

// ---------- 转换 ----------
function convertPage() {
  let items = [];
  let target = null;
  let filter = "";
  const opts = { gif: { start: 0, duration: 10, width: 480 }, frames: { every: 1 }, audioVideo: { mode: "cover", color: "#1d2b25" }, mergePdf: true };
  const list = el("ul.jobs");
  const queue = new Queue(list, { onIdle: () => renderAll(), onChange: () => renderAll() });
  const panel = el("div.panel", { hidden: true });
  const allBox = el("div.row");

  async function addFiles(files) {
    items.push(...await identify(files));
    target = null;
    render();
    // 音视频补充时长等信息
    for (const it of items) {
      if (!it.info && ["video", "audio"].includes(FORMATS[it.fmt]?.kind)) {
        it.info = await probe(it.file).catch(() => null);
        render();
      }
    }
  }

  function render() {
    panel.hidden = !items.length;
    if (!items.length) { panel.replaceChildren(); return; }
    const fmts = [...new Set(items.map(i => i.fmt))];
    const kinds = new Set(fmts.map(f => kindGroup(f)));
    const bad = items.filter(i => !i.fmt || UNSUPPORTED_REASON[i.fmt] || !CAPABILITIES.some(c => c.from.includes(i.fmt)));
    const blocks = [
      el("div.panel-title", el("h2", `已选 ${items.length} 个文件`), el("button.btn.ghost", { type: "button", onclick: () => { items = []; target = null; render(); } }, "清空")),
      el("ul.jobs", items.map((it, idx) => el("li.job",
        el("div.job-head", el("div.job-name", it.file.name), el("button.x", { type: "button", "aria-label": "移除", onclick: () => { items.splice(idx, 1); render(); } }, "×")),
        el("div.job-meta", `${fmtSize(it.file.size)} · ${it.fmt ? FORMATS[it.fmt].label : "无法识别"}${it.info ? " · " + describeMedia(it.info) : ""}`),
        sizeWarn(it.file)))),
    ];
    if (bad.length) {
      blocks.push(el("p.note.bad", bad.map(b => `${b.file.name}：${!b.fmt ? "认不出这个文件的格式。" : UNSUPPORTED_REASON[b.fmt] || `${FORMATS[b.fmt].label} 首版还不支持转换。`}`).join(" ")));
      panel.replaceChildren(...blocks);
      return;
    }
    if (kinds.size > 1) {
      blocks.push(el("p.note.warn", "一次只能转换同一类文件（比如都是图片，或都是视频）。请移除其他类型的文件，分开转换。"));
      panel.replaceChildren(...blocks);
      return;
    }
    const targets = targetsFor(fmts);
    if (!targets.length) { blocks.push(el("p.note.bad", "这些文件没有共同可转换的目标格式。")); panel.replaceChildren(...blocks); return; }
    const shown = targets.filter(t => !filter || (FORMATS[t].label + FORMATS[t].ext).toLowerCase().includes(filter.toLowerCase()));
    const groups = {};
    for (const t of shown) (groups[FORMATS[t].kind] ||= []).push(t);
    blocks.push(el("h2", "转换成"));
    if (targets.length > 8) blocks.push(el("div.field", el("input", { type: "search", placeholder: "搜索格式，例如 jpg、mp3", value: filter, oninput: e => { filter = e.target.value; render(); queueMicrotask(() => panel.querySelector("input[type=search]")?.focus()); } })));
    blocks.push(el("div.targets", Object.entries(groups).map(([k, ts]) => [
      el("span.group-label", KIND_LABEL[k] || k),
      ts.map(t => el("button" + (t === target ? ".on" : ""), { type: "button", onclick: () => { target = t; render(); } },
        FORMATS[t].label, statusTag(fmts, t))),
    ])));
    if (target) blocks.push(...targetDetails(fmts, target));
    panel.replaceChildren(...blocks);
  }

  function statusTag(fmts, t) {
    const caps = fmts.filter(f => f !== t).map(f => plan(f, t)).flat().map(s => s.cap.status);
    if (caps.includes("experimental")) return el("span.tag", "实验性");
    return null;
  }

  function targetDetails(fmts, t) {
    const out = [];
    const paths = fmts.filter(f => f !== t).map(f => plan(f, t));
    const caps = [...new Set(paths.flat().map(s => s.cap))];
    const multi = paths.find(p => p.length > 1);
    if (multi) out.push(el("p.hint", "会分步完成：" + [multi[0].from, ...multi.map(s => s.to)].map(f => FORMATS[f].label).join(" → ")));
    for (const c of caps) if (c.loss) out.push(el("p.note.info", c.loss));
    const viaPandoc = caps.some(c => c.run === "doc.convert") || (caps.some(c => c.run === "pdf.fromDoc") && fmts.some(f => ["md", "html", "txt", "epub", "odt"].includes(f)));
    if (viaPandoc) out.push(el("p.hint", "文档转换组件约 16 MB，第一次使用需要下载，建议连着 Wi-Fi。"));
    if (caps.some(c => c.run === "pdf.toWord")) out.push(el("p.hint", "扫描版 PDF 需要先下载约 8 MB 的文字识别组件，识别每页要几秒到十几秒。"));
    if (caps.some(c => c.run === "can.convert")) out.push(el("p.hint", "第一次使用需要下载约 6 MB 的 Python 组件（python-can）。"));
    if (isMobile && caps.some(c => c.run.startsWith("media."))) out.push(el("p.hint", "处理期间请不要切到别的 App 或锁屏，否则可能中断。"));
    const need = caps.find(c => c.needs)?.needs;
    if (need === "gif") out.push(gifOptions());
    if (need === "frames") out.push(el("div.field", el("label", "每隔多久截一张"),
      el("select", { onchange: e => { opts.frames.every = Number(e.target.value); } },
        [[0.5, "0.5 秒"], [1, "1 秒"], [2, "2 秒"], [5, "5 秒"], [10, "10 秒"]].map(([v, l]) => el("option", { value: v, selected: v === opts.frames.every }, l)))));
    if (need === "audioVideo") out.push(audioVideoOptions());
    if (t === "pdf" && items.length > 1 && caps.every(c => c.run === "image.toPdf")) {
      out.push(el("label.check", el("input", { type: "checkbox", checked: opts.mergePdf, onchange: e => { opts.mergePdf = e.target.checked; } }), "合并成一个 PDF（按选择的顺序，每张一页）"));
    }
    out.push(el("button.btn", { type: "button", onclick: start }, `开始转换${items.length > 1 ? `（${items.length} 个）` : ""}`));
    return out;
  }

  function gifOptions() {
    const num = (label, key, min, max, step) => el("div.field", el("label", label),
      el("input", { type: "number", inputMode: "decimal", min, max, step, value: opts.gif[key], onchange: e => { opts.gif[key] = Number(e.target.value); } }));
    return el("div.panel", num("从第几秒开始", "start", 0, 36000, 1), num("截取多少秒（最多 30）", "duration", 1, 30, 1),
      el("div.field", el("label", "宽度"), el("select", { onchange: e => { opts.gif.width = Number(e.target.value); } },
        [320, 480, 640].map(w => el("option", { value: w, selected: w === opts.gif.width }, w + " 像素")))));
  }

  function audioVideoOptions() {
    const box = el("div.panel");
    const draw = () => {
      const m = opts.audioVideo.mode;
      box.replaceChildren(
        el("h2", "视频画面"),
        seg("avmode", [["cover", "封面图片", "用你选的图片；不选就用音频自带的封面"], ["color", "纯色背景"], ["wave", "声音波形", "画面随声音跳动"]], m, v => { opts.audioVideo.mode = v; draw(); }),
        m === "cover" ? el("div.field", el("label", "封面图片（可选）"),
          el("input", { type: "file", accept: "image/*", onchange: e => { opts.audioVideo.cover = e.target.files[0] || null; } })) : null,
        el("div.field", el("label", "背景颜色"),
          el("input", { type: "color", value: opts.audioVideo.color, oninput: e => { opts.audioVideo.color = e.target.value; } })),
      );
    };
    draw();
    return box;
  }

  function start() {
    const t = target;
    const o = structuredCloneSafe(opts);
    const batch = items;
    items = []; target = null; filter = "";
    render();
    const imgs = batch.every(i => FORMATS[i.fmt].kind === "image");
    if (t === "pdf" && imgs && batch.length > 1 && o.mergePdf) {
      const total = batch.reduce((s, i) => s + i.file.size, 0);
      queue.add({
        title: `${batch.length} 张图片合成 PDF`, size: total, kind: "image", from: batch[0].fmt,
        run: (p, s) => imagesToPdf(batch, p, s),
        outName: () => outputName(batch[0].file.name, "pdf", `_等${batch.length}张`),
      });
    } else {
      for (const { file, fmt } of batch) {
        queue.add({
          title: file.name, size: file.size, kind: FORMATS[fmt].kind, from: fmt,
          run: (p, s) => convertFile({ file, from: fmt, to: t, opts: o }, p, s),
          outName: outFmt => outputName(file.name, outFmt),
        });
      }
    }
    renderAll();
  }

  function renderAll() { renderResultActions(queue, allBox); }

  return [
    el("h1", "格式转换"),
    el("p.lead", "先选文件，再选要转成的格式。一次可以选多个同类文件。"),
    picker(addFiles),
    panel, list, allBox,
  ];
}

// 一批文件必须是同一大类（PRD 5）
const kindGroup = f => FORMATS[f]?.kind;

// File 对象不能 structuredClone 进普通对象时退回浅拷贝
function structuredCloneSafe(o) {
  return { gif: { ...o.gif }, frames: { ...o.frames }, audioVideo: { ...o.audioVideo }, mergePdf: o.mergePdf };
}

// 结果列表下方：全部打包下载、清空结果
function renderResultActions(queue, box) {
  const done = queue.doneJobs();
  const finished = queue.finishedJobs();
  box.replaceChildren(
    done.length > 1 ? el("button.btn.ghost", { type: "button", onclick: () => downloadAll(done) }, `全部打包下载（${done.length} 个，ZIP）`) : "",
    finished.length ? el("button.btn.ghost", { type: "button", onclick: () => queue.clearFinished() }, "清空结果") : "",
  );
}

async function downloadAll(jobs) {
  const { zipSync } = await import("../vendor/fflate.js");
  const files = {};
  for (const j of jobs) {
    let name = j.outName(j.result.outFmt), n = 1;
    while (files[name]) name = name.replace(/(\.[^.]+)?$/, `_${++n}$1`);
    files[name] = new Uint8Array(await j.result.blob.arrayBuffer());
  }
  const blob = new Blob([zipSync(files, { level: 0 })], { type: "application/zip" });
  downloadBlob(blob, "轻压_全部结果.zip");
}

// ---------- 说明页面 ----------
function privacy() {
  return el("article.doc",
    el("h1", "隐私说明"),
    el("p", "这个网站的所有处理都在你自己的浏览器里完成。"),
    el("ul",
      el("li", "你选择的文件只在你的手机或电脑上读取和处理，", el("b", "不会上传到任何服务器"), "。"),
      el("li", "网站不保存、也接触不到你的文件。关掉或刷新页面后，处理结果也随之清除。"),
      el("li", "网站本身是放在 GitHub Pages 上的静态网页。打开网页时，浏览器会从 GitHub Pages 下载网页和处理组件，GitHub 可能按其政策记录访问日志（如 IP 地址），与你的文件无关。"),
      el("li", "网站不使用 Cookie，不做用户追踪，不接入广告和统计。"),
      el("li", "处理照片时默认清除 GPS 位置等附加信息。")),
    el("p.hint", "如有疑问，可以查看网页的源代码核实，入口在页面底部。"));
}

function terms() {
  return el("article.doc",
    el("h1", "使用条款"),
    el("ul",
      el("li", "本网站免费提供，按“现状”提供，不保证所有文件都能处理成功，也不保证处理结果满足特定用途。"),
      el("li", "请保留好原始文件。网站不会修改或覆盖你的原文件，但处理结果（如压缩后的画质、转换后的排版）可能与原文件不同，请自行检查后再使用。"),
      el("li", "禁止使用本网站处理违法内容，或侵犯他人著作权、隐私等合法权益的内容。使用者对自己处理的文件内容负责。"),
      el("li", "因使用本网站造成的任何直接或间接损失，网站作者不承担责任。"),
      el("li", "网站代码按 GNU AGPL-3.0 许可公开，所用第三方工具各自的许可见“源代码与许可”页面。")));
}

function source() {
  return el("article.doc",
    el("h1", "源代码与许可"),
    el("p", "本网站的源代码公开，按 ", el("b", "GNU AGPL-3.0"), " 许可发布："),
    el("p", el("a", { href: SOURCE_URL, target: "_blank", rel: "noopener" }, SOURCE_URL)),
    el("p", "网页里使用了以下开源工具（它们的程序文件随网页一起下载到你的浏览器中运行，源代码可从下列项目获取）："),
    el("table",
      el("thead", el("tr", el("th", "工具"), el("th", "用途"), el("th", "许可"))),
      el("tbody", LIBRARIES.map(([name, url, use, license]) => el("tr",
        el("td", el("a", { href: url, target: "_blank", rel: "noopener" }, name)), el("td", use), el("td", license))))));
}
