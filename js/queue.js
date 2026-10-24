// 任务队列与任务卡片：同一页面的任务依次处理，显示"排队中，前面还有 N 个"、真实进度、结果和下载
import { el, fmtSize, savedPct, downloadBlob, canShareFile, shareBlob, errMsg, baseName } from "./util.js";
import { FORMATS } from "./formats.js";
import { isMobile } from "./env.js";

export class Queue {
  constructor(listEl, { onIdle } = {}) {
    this.listEl = listEl;
    this.jobs = [];
    this.running = false;
    this.onIdle = onIdle;
  }

  // job：{ title, size, kind, run(onProgress, signal) → { blob, outFmt, notes, unchanged, partial }, outName(outFmt), compare }
  add(job) {
    job.state = "queued";
    job.card = renderCard(job, this);
    this.jobs.push(job);
    this.listEl.append(job.card.root);
    this.refresh();
    this.pump();
    return job;
  }

  retry(job) {
    job.state = "queued";
    job.result = job.error = null;
    this.refresh();
    this.pump();
  }

  refresh() {
    let ahead = 0;
    for (const j of this.jobs) {
      if (j.state === "queued") { j.card.update({ ahead }); ahead++; }
      else if (j.state === "running") { j.card.update({}); ahead++; }
    }
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    let lock = null;
    try { lock = await navigator.wakeLock?.request("screen"); } catch {}
    for (;;) {
      const job = this.jobs.find(j => j.state === "queued");
      if (!job) break;
      job.state = "running";
      job.ctrl = new AbortController();
      job.started = performance.now();
      this.refresh();
      try {
        job.result = await job.run(p => job.card.progress(p), job.ctrl.signal);
        job.state = job.result.partial ? "partial" : "done";
      } catch (e) {
        job.state = "failed";
        job.error = job.ctrl.signal.aborted ? "已取消。" : errMsg(e);
        console.error(e);
      }
      job.card.update({});
      this.refresh();
    }
    lock?.release?.().catch(() => {});
    this.running = false;
    this.onIdle?.();
  }

  doneJobs() { return this.jobs.filter(j => j.state === "done" || j.state === "partial"); }
}

function renderCard(job, queue) {
  const name = el("div.job-name", job.title);
  const meta = el("div.job-meta.num", job.size != null ? fmtSize(job.size) : "");
  const status = el("div.job-status");
  const bar = el("div.bar", el("i"));
  const body = el("div");
  const actions = el("div.row");
  const root = el("li.job", el("div.job-head", name, meta), status, bar, body, actions);
  let lastPct = -1;

  const cancel = el("button.btn.ghost", { type: "button", onclick: () => job.ctrl?.abort() }, "取消");

  function update({ ahead }) {
    body.replaceChildren(); actions.replaceChildren();
    bar.hidden = true;
    status.className = "job-status";
    if (job.state === "queued") {
      status.textContent = ahead ? `排队中，前面还有 ${ahead} 个` : "排队中";
    } else if (job.state === "running") {
      status.textContent = "处理中…";
      bar.hidden = false;
      bar.classList.add("busy");
      lastPct = -1;
      if (job.kind === "video" && isMobile) body.append(el("p.hint", "处理期间请不要切到别的 App 或锁屏，否则可能中断。"));
      actions.append(cancel);
    } else if (job.state === "failed") {
      status.className = "job-status bad";
      status.textContent = "失败：" + job.error;
      actions.append(el("button.btn.ghost", { type: "button", onclick: () => queue.retry(job) }, "重试"));
    } else {
      showResult();
    }
  }

  function progress(p) {
    if (job.state !== "running" || p == null) return;
    const pct = Math.max(0, Math.min(100, Math.floor(p * 100)));
    if (pct === lastPct) return;
    lastPct = pct;
    bar.classList.remove("busy");
    bar.firstChild.style.width = pct + "%";
    const spent = (performance.now() - job.started) / 1000;
    const eta = p > 0.03 && spent > 3 ? `，大约还要 ${Math.max(1, Math.round(spent / p - spent))} 秒` : "";
    status.textContent = `处理中 ${pct}%${eta}`;
  }

  function showResult() {
    const r = job.result;
    const outName = job.outName(r.outFmt);
    status.className = "job-status " + (job.state === "partial" ? "part" : "ok");
    status.textContent = job.state === "partial" ? "部分成功（有文件没处理好，见下方说明）" : r.unchanged ? "完成（文件没有变化）" : "完成";
    const stats = el("div.stats");
    if (job.compare) {
      stats.append(el("span", "原始 ", el("b.num", fmtSize(job.size))), el("span", "输出 ", el("b.num", fmtSize(r.blob.size))));
      if (!r.unchanged) {
        const pct = savedPct(job.size, r.blob.size);
        stats.append(el("span", pct >= 0 ? "节省了 " : "变大了 ", el("b.num", Math.abs(pct) + "%")));
        if (pct > 0) stats.append(el("span", "节省空间 ", el("b.num", fmtSize(job.size - r.blob.size))));
      }
    } else {
      stats.append(el("span", `${FORMATS[job.from]?.label || ""} → ${FORMATS[r.outFmt]?.label || r.outFmt}`), el("span", "输出 ", el("b.num", fmtSize(r.blob.size))));
    }
    body.append(stats);
    if (r.notes?.length) body.append(el("ul.sub", r.notes.map(n => el("li", n))));
    const preview = makePreview(r.blob, r.outFmt);
    if (preview) body.append(preview);

    actions.append(el("button.btn.small", { type: "button", onclick: () => downloadBlob(r.blob, outName) }, "下载"));
    if (isMobile && canShareFile(r.blob, outName)) {
      const media = /^(image|video)\//.test(r.blob.type);
      actions.append(el("button.btn.ghost", { type: "button", onclick: () => shareBlob(r.blob, outName).catch(() => {}) }, media ? "存到相册 / 分享" : "分享 / 存到文件"));
    }
    actions.append(el("span.hint", outName));
  }

  return { root, update, progress };
}

function makePreview(blob, fmt) {
  const kind = FORMATS[fmt]?.kind;
  if (kind === "image" && blob.size < 30 * 1048576 && fmt !== "tiff") {
    const url = URL.createObjectURL(blob);
    return el("img.preview", { src: url, alt: "预览", loading: "lazy", onerror: e => e.target.remove() });
  }
  if (kind === "video") {
    const url = URL.createObjectURL(blob);
    return el("video", { src: url, controls: true, playsInline: true, preload: "metadata", onerror: e => e.target.remove() });
  }
  if (kind === "audio") {
    const url = URL.createObjectURL(blob);
    return el("audio", { src: url, controls: true, preload: "metadata", onerror: e => e.target.remove() });
  }
  return null;
}

// 结果文件名：原名 + 后缀，扩展名与真实格式一致
export function outputName(srcName, outFmt, suffix = "") {
  const ext = FORMATS[outFmt]?.ext || outFmt;
  return `${baseName(srcName.replace(/\.tar\.gz$/i, ".tgz"))}${suffix}.${ext}`;
}
