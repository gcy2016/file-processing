// 页面这一侧调用后台线程。每个任务用一个独立线程，任务结束就关掉，释放内存（手机上很重要）。
import { UserError } from "./util.js";

export class ToolWorker {
  constructor() {
    this.w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    this.seq = 0;
    this.pending = new Map();
    this.w.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      if ("progress" in data) { p.onProgress?.(data.progress); return; }
      this.pending.delete(data.id);
      if (data.ok) p.resolve(data.result);
      else p.reject(data.error.user ? new UserError(data.error.message) : new Error(data.error.message));
    };
    this.w.onerror = e => {
      e.preventDefault?.();
      const err = new UserError("处理组件出错或内存不足，已停止。文件太大时可以换到电脑上试试。");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }
  call(op, args, onProgress) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.w.postMessage({ id, op, args });
    });
  }
  close() {
    this.w.terminate();
    const err = new UserError("已取消。");
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

// 一次性调用
export async function runTool(op, args, onProgress, signal) {
  const w = new ToolWorker();
  const abort = () => w.close();
  signal?.addEventListener("abort", abort);
  try { return await w.call(op, args, onProgress); }
  finally { signal?.removeEventListener("abort", abort); w.close(); }
}
