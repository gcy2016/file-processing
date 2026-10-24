// 后台线程：运行 WebAssembly 工具（图片、PDF、压缩包、文档、表格），避免页面卡住。
// 消息：{ id, op: "模块.函数", args } → { id, ok, result } / { id, progress } / { id, error }
self.onmessage = async ({ data }) => {
  const { id, op, args } = data;
  const [mod, fn] = op.split(".");
  try {
    const m = await import(`./tools/${mod}.js`);
    if (typeof m[fn] !== "function") throw new Error("未知操作：" + op);
    const result = await m[fn](args, p => self.postMessage({ id, progress: p }));
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, error: { message: e?.userMessage || e?.message || String(e), user: !!e?.userMessage } });
  }
};
