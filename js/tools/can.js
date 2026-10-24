// BLF（Vector 二进制 CAN 日志）→ ASC / CSV / TXT：在后台线程里用 Pyodide 运行 python-can
import { UserError } from "../util.js";

const V = new URL("../../vendor/pyodide/", import.meta.url).href;
const WHEELS = ["python_can-4.6.1-py3-none-any.whl", "packaging-26.3-py3-none-any.whl", "typing_extensions-4.16.0-py3-none-any.whl"];

// 转换脚本：ASC 用 python-can 的 ASCWriter；TXT 用 python-can 的 Printer；
// CSV 自己写（python-can 的 CSVWriter 把数据存成 base64，不方便看），数据用十六进制
const SCRIPT = `
import sys, types
# Pyodide 默认不带 sqlite3；python-can 导入时会加载它（只有写 .db 日志才用到），放一个占位模块
if "sqlite3" not in sys.modules:
    try:
        import sqlite3
    except ImportError:
        _stub = types.ModuleType("sqlite3")
        _stub.Connection = object
        def _unavailable(*a, **k):
            raise RuntimeError("sqlite3 is not available")
        _stub.connect = _unavailable
        sys.modules["sqlite3"] = _stub
import can, csv

def convert(src, dst, fmt, report):
    reader = can.BLFReader(src)
    total = reader.object_count or 0
    n = 0
    if fmt == "csv":
        f = open(dst, "w", newline="", encoding="utf-8-sig")
        w = csv.writer(f)
        w.writerow(["timestamp", "channel", "id", "extended", "direction", "remote", "error", "fd", "brs", "dlc", "data"])
        def write(m):
            w.writerow([f"{m.timestamp:.6f}", "" if m.channel is None else m.channel,
                        f"{m.arbitration_id:08X}" if m.is_extended_id else f"{m.arbitration_id:03X}",
                        int(m.is_extended_id), "Rx" if m.is_rx else "Tx", int(m.is_remote_frame), int(m.is_error_frame),
                        int(m.is_fd), int(m.bitrate_switch), m.dlc, m.data.hex(" ").upper()])
        close = f.close
    else:
        writer = can.ASCWriter(dst) if fmt == "asc" else can.Printer(dst)
        write = writer.on_message_received
        close = writer.stop
    try:
        for msg in reader:
            write(msg)
            n += 1
            if n % 20000 == 0:
                report(n, total)
    finally:
        close()
        reader.stop()
    return n
`;

let py = null, convertFn = null;
async function load(progress) {
  if (py) return;
  const { loadPyodide } = await import(V + "pyodide.mjs");
  py = await loadPyodide({ indexURL: V, stdout: () => {}, stderr: () => {} });
  progress?.(0.15);
  const site = py.runPython("import site; site.getsitepackages()[0]");
  for (const w of WHEELS) {
    const res = await fetch(V + "wheels/" + w);
    if (!res.ok) throw new UserError("BLF 转换组件下载失败，请检查网络后重试。");
    py.unpackArchive(await res.arrayBuffer(), "wheel", { extractDir: site });
  }
  py.runPython(SCRIPT);
  convertFn = py.globals.get("convert");
  progress?.(0.25);
}

const EXT = { asc: "asc", csv: "csv", txt: "txt" };

export async function convert({ file, to }, progress) {
  await load(progress);
  const src = "/tmp/in.blf", dst = "/tmp/out." + EXT[to];
  py.FS.writeFile(src, new Uint8Array(await file.arrayBuffer()));
  let n;
  try {
    n = convertFn(src, dst, to, (done, total) => { if (total) progress?.(0.25 + 0.7 * Math.min(1, done / total)); });
  } catch (e) {
    const msg = String(e?.message || e).trim().split("\n").pop();
    throw new UserError("BLF 文件读取失败，可能已损坏或版本不支持：" + msg);
  } finally {
    try { py.FS.unlink(src); } catch {}
  }
  const out = py.FS.readFile(dst);
  py.FS.unlink(dst);
  if (!n) throw new UserError("这个 BLF 文件里没有读到报文。");
  const notes = [`共 ${n.toLocaleString()} 条报文。`];
  if (to === "asc") notes.push("ASC 是 Vector 的标准文本格式，可以用 CANoe / CANalyzer 或文本编辑器打开。");
  if (to === "csv") notes.push("每行一条报文，ID 和数据为十六进制，可以用 Excel 打开。");
  if (to === "txt") notes.push("格式与 python-can 打印报文的格式一致。");
  return { blob: new Blob([out], { type: "text/plain;charset=utf-8" }), notes };
}
