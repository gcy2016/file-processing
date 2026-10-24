// 压缩包：用 7-Zip 解包 / 打包 / 列清单（在后台线程运行）
// 解包时做安全检查：加密、解压炸弹、文件数、符号链接；路径中的 ../ 和绝对路径由 7-Zip 去掉
import { emRun } from "./em.js";
import { UserError } from "../util.js";

// -bd：关掉进度显示，免得输出里混进退格符
const sevenZip = ([cmd, ...rest], opts) => emRun("sevenzip.js", "7zz.wasm", [cmd, "-bd", ...rest], opts);

const EXT = { zip: "zip", "7z": "7z", tar: "tar", tgz: "tar.gz", rar: "rar" };
const NO_PASS = "-p__no_password__";   // 防止 7-Zip 等待输入密码

function parseSlt(text) {
  const items = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^.*[\b\r]/, "");
    const m = line.match(/^([A-Za-z ]+) = (.*)$/);
    if (!m) { if (!line.trim() && cur) { items.push(cur); cur = null; } continue; }
    if (m[1] === "Path") { if (cur) items.push(cur); cur = { path: m[2] }; }
    else if (cur) cur[m[1]] = m[2];
  }
  if (cur) items.push(cur);
  return items.filter(i => i.path);
}

// 有非 ASCII 字符却没有一个汉字，多半是 GBK 文件名被按 437 代码页读成了乱码
const CJK = /[　-鿿＀-￯]/;
const looksGarbled = names => names.some(n => /[^\x00-\x7f]/.test(n)) && !names.some(n => CJK.test(n));
// 7-Zip 在没有 UTF-8 标记时按 437 代码页显示文件名；把它变回原始字节再按 GBK 解码
const CP437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";
function fixGbk(name) {
  const bytes = [];
  for (const ch of name) {
    const c = ch.charCodeAt(0);
    if (c < 128) { bytes.push(c); continue; }
    const i = CP437.indexOf(ch);
    if (i < 0) return name;
    bytes.push(128 + i);
  }
  try { return new TextDecoder("gbk", { fatal: true }).decode(new Uint8Array(bytes)); } catch { return name; }
}
const isDir = i => i.Folder === "+" || /^D/.test((i.Attributes || "").trim());

async function list(bytes, ext, extra = []) {
  const r = await sevenZip(["l", "-slt", "-ba", NO_PASS, ...extra, `/in.${ext}`], { inputs: { [`/in.${ext}`]: bytes } });
  const text = r.out + r.err;
  if (/Wrong password|encrypted/i.test(text) && r.code !== 0) throw new UserError("这个压缩包设置了密码，首版不支持处理加密压缩包。");
  if (r.code !== 0 && !r.out.trim()) throw new UserError("这个压缩包打不开，可能已损坏或格式不支持。");
  return parseSlt(r.out);
}

function walk(FS, dir, base, files, dirs, skipped) {
  for (const name of FS.readdir(dir)) {
    if (name === "." || name === "..") continue;
    const full = dir + "/" + name, rel = base ? base + "/" + name : name;
    const st = FS.lstat(full);
    if (FS.isLink(st.mode)) { skipped.push(rel + "（符号链接，已跳过）"); continue; }
    if (FS.isDir(st.mode)) { dirs.push(rel); walk(FS, full, rel, files, dirs, skipped); }
    else if (FS.isFile(st.mode)) files.push({ path: rel, data: FS.readFile(full) });
  }
}

// limits：{ unpack, maxFiles, ratio }
export async function extract({ file, fmt, limits }) {
  let bytes = new Uint8Array(await file.arrayBuffer());
  let ext = EXT[fmt] || fmt;

  // tar.gz：先解 gzip，再看里面是不是 tar
  if (fmt === "tgz") {
    const r = await sevenZip(["x", "-y", "-o/mid", "/in.gz"], { inputs: { "/in.gz": bytes }, keep: true });
    if (r.code !== 0) throw new UserError("这个 .gz 文件解不开，可能已损坏。");
    const names = r.fs.readdir("/mid").filter(n => n !== "." && n !== "..");
    const inner = r.fs.readFile("/mid/" + names[0]);
    const isTar = String.fromCharCode(...inner.subarray(257, 262)) === "ustar";
    if (!isTar) {
      const name = (file.name || "file.gz").replace(/\.t?gz$/i, "") || "file";
      return { files: [{ path: name, data: inner }], dirs: [], skipped: [], singleGzip: true };
    }
    bytes = inner; ext = "tar";
  }

  const items = await list(bytes, ext);
  if (items.some(i => i.Encrypted === "+")) throw new UserError("这个压缩包设置了密码，首版不支持处理加密压缩包。");
  const fileItems = items.filter(i => !isDir(i));
  const total = fileItems.reduce((s, i) => s + (Number(i.Size) || 0), 0);
  if (fileItems.length > limits.maxFiles) throw new UserError(`压缩包里有 ${fileItems.length} 个文件，超过了 ${limits.maxFiles} 个的上限。`);
  if (total > limits.unpack) throw new UserError(`解压后有 ${(total / 1048576).toFixed(0)} MB，超过了这台设备的处理上限。`);
  if (file.size > 0 && total / file.size > limits.ratio && total > 50 * 1048576) {
    throw new UserError("解压后体积是压缩包的上百倍，疑似“解压炸弹”，已拒绝处理。");
  }

  const r = await sevenZip(["x", "-y", NO_PASS, "-o/out", `/in.${ext}`], { inputs: { [`/in.${ext}`]: bytes }, dirs: ["/out"], keep: true });
  if (r.code !== 0 && r.code !== 1) {
    if (/Wrong password/i.test(r.err + r.out)) throw new UserError("这个压缩包设置了密码，首版不支持处理加密压缩包。");
    throw new UserError("解压失败，压缩包可能已损坏。");
  }
  const files = [], dirs = [], skipped = [];
  walk(r.fs, "/out", "", files, dirs, skipped);
  if (ext === "zip" && looksGarbled(files.map(f => f.path).concat(dirs))) {
    // 没标 UTF-8 的中文 zip（Windows 自带压缩常见）：文件名按 GBK 还原
    const fixed = files.map(f => fixGbk(f.path));
    if (fixed.some(n => CJK.test(n))) {
      files.forEach((f, i) => { f.path = fixed[i]; });
      dirs.forEach((d, i) => { dirs[i] = fixGbk(d); });
    }
  }
  const warn = r.code === 1 ? ["解压时有警告，部分文件可能不完整。"] : [];
  return { files, dirs, skipped, warn };
}

// files：[{ path, data(Uint8Array|Blob) }]；dirs：空目录也保留
export async function pack({ files, dirs = [], fmt }) {
  const inputs = {};
  for (const f of files) inputs["/src/" + f.path] = f.data instanceof Uint8Array ? f.data : new Uint8Array(await f.data.arrayBuffer());
  const dirList = ["/src", ...dirs.map(d => "/src/" + d)];
  let out;
  if (fmt === "tgz") {
    const t = await sevenZip(["a", "-ttar", "/mid.tar", "/src/*"], { inputs, dirs: dirList, keep: true });
    if (t.code !== 0) throw new UserError("打包失败：" + t.err.trim().split("\n").pop());
    const tar = t.fs.readFile("/mid.tar");
    const g = await sevenZip(["a", "-tgzip", "-mx=9", "/out.tar.gz", "/mid.tar"], { inputs: { "/mid.tar": tar }, outputs: ["/out.tar.gz"] });
    out = g.files["/out.tar.gz"];
  } else {
    const type = { zip: ["-tzip", "-mx=9", "-mcu=on"], "7z": ["-t7z", "-mx=9"], tar: ["-ttar"] }[fmt];
    if (!type) throw new UserError("不支持打包成 " + fmt);
    const name = "/out." + EXT[fmt];
    const r = await sevenZip(["a", ...type, name, "/src/*"], { inputs, dirs: dirList, outputs: [name] });
    if (r.code !== 0) throw new UserError("打包失败：" + r.err.trim().split("\n").pop());
    out = r.files[name];
  }
  if (!out) throw new UserError("打包失败。");
  return { blob: new Blob([out], { type: fmt === "zip" ? "application/zip" : "application/octet-stream" }) };
}

// 文件清单（只含文件），用于打包后校验
export async function listFiles({ file, fmt }) {
  let bytes = new Uint8Array(await file.arrayBuffer());
  let ext = EXT[fmt];
  if (fmt === "tgz") {
    const r = await sevenZip(["x", "-y", "-o/mid", "/in.gz"], { inputs: { "/in.gz": bytes }, keep: true });
    const n = r.fs.readdir("/mid").find(x => x !== "." && x !== "..");
    bytes = r.fs.readFile("/mid/" + n); ext = "tar";
  }
  const items = await list(bytes, ext);
  return items.filter(i => !isDir(i)).map(i => ({ path: i.path, size: Number(i.Size) || 0 }));
}
