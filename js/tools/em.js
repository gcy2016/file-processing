// 运行 Emscripten 编译的命令行工具（7-Zip、qpdf、Ghostscript）
// wasm 只编译一次；每次调用新建一个实例，用完即丢（这些工具运行一次后不能再次调用 main）
const V = new URL("../../vendor/", import.meta.url).href;
const compiled = {};

function compile(name) {
  return compiled[name] ??= (async () => {
    const res = await fetch(V + name);
    if (!res.ok) throw new Error(`组件 ${name} 下载失败（${res.status}）`);
    try { return await WebAssembly.compileStreaming(res.clone()); }
    catch { return WebAssembly.compile(await res.arrayBuffer()); }
  })().catch(e => { delete compiled[name]; throw e; });
}

const factories = {};
async function factory(js) {
  return factories[js] ??= (await import(V + js)).default;
}

// inputs：{ 路径: Uint8Array }；outputs：要读回的路径；返回 { code, out, err, files, fs }
export async function emRun(js, wasm, args, { inputs = {}, outputs = [], dirs = [], keep = false } = {}) {
  const [make, mod] = await Promise.all([factory(js), compile(wasm)]);
  let out = "", err = "";
  // 有的构建不理会 print 选项、在初始化时就绑定了 console.log，所以从创建实例起临时接管
  const saved = [console.log, console.warn, console.error];
  console.log = (...a) => { out += a.join(" ") + "\n"; };
  console.warn = console.error = (...a) => { err += a.join(" ") + "\n"; };
  try {
    const M = await make({
      noInitialRun: true,
      instantiateWasm(imports, done) {
        WebAssembly.instantiate(mod, imports).then(inst => done(inst, mod));
        return {};
      },
      locateFile: f => V + f,
      print: s => { out += s + "\n"; },
      printErr: s => { err += s + "\n"; },
    });
    for (const d of dirs) mkdirp(M.FS, d);
    for (const [p, data] of Object.entries(inputs)) {
      mkdirp(M.FS, p.slice(0, p.lastIndexOf("/")) || "/");
      M.FS.writeFile(p, data);
    }
    let code;
    try { code = M.callMain(args); }
    catch (e) {
      if (typeof e?.status === "number") code = e.status;
      else { code = -1; err += String(e?.message || e); }
    }
    const files = {};
    for (const p of outputs) { try { files[p] = M.FS.readFile(p); } catch {} }
    return { code: code ?? 0, out, err, files, fs: keep ? M.FS : null };
  } finally {
    [console.log, console.warn, console.error] = saved;
  }
}

export function mkdirp(FS, dir) {
  let cur = "";
  for (const part of dir.split("/").filter(Boolean)) {
    cur += "/" + part;
    try { FS.mkdir(cur); } catch {}
  }
}
