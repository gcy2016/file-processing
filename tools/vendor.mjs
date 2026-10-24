// 把网页用到的第三方库打包到 ../vendor/（网页直接引用，不依赖外部 CDN）
// 用法：cd tools && npm install && npm run vendor
import { build } from "esbuild";
import { copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const nm = join(here, "node_modules");
const out = join(here, "..", "vendor");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "entries"), { recursive: true });

// 每个入口：名字 → 源码（esbuild 打成单个 ESM 文件）
const entries = {
  mediabunny: `export * from "mediabunny";`,
  // 编码扩展：浏览器自己不能编码 MP3 / AAC / FLAC 时才加载（各约 0.3–1 MB）
  "mb-mp3": `export { registerMp3Encoder } from "@mediabunny/mp3-encoder";`,
  "mb-aac": `export { registerAacEncoder } from "@mediabunny/aac-encoder";`,
  "mb-flac": `export { registerFlacEncoder } from "@mediabunny/flac-encoder";`,
  jsquash: `
    export { default as encodeJpeg } from "@jsquash/jpeg/encode.js";
    export { default as decodeJpeg } from "@jsquash/jpeg/decode.js";
    export { default as encodeWebp } from "@jsquash/webp/encode.js";
    export { default as decodeWebp } from "@jsquash/webp/decode.js";
    export { default as encodeAvif } from "@jsquash/avif/encode.js";
    export { default as decodeAvif } from "@jsquash/avif/decode.js";
    export { default as decodePng } from "@jsquash/png/decode.js";
    export { default as optimisePng } from "@jsquash/oxipng/optimise.js";
    export { default as resize } from "@jsquash/resize";`,
  heif: `export { default } from "libheif-js/libheif-wasm/libheif-bundle.mjs";`,
  upng: `import UPNG from "upng-js"; export default UPNG;`,
  utif: `import UTIF from "utif2"; export default UTIF;`,
  pdflib: `export * from "pdf-lib";`,
  fflate: `export * from "fflate";`,
  gifenc: `export * from "gifenc/dist/gifenc.esm.js";`,
  sevenzip: `export { default } from "7z-wasm/7zz.es6.js";`,
  qpdf: `import m from "@neslinesli93/qpdf-wasm/dist/qpdf.js"; export default m;`,
  gs: `import m from "@jspawn/ghostscript-wasm/gs.js"; export default m;`,
  pandoc: `export { createPandocInstance } from "${join(nm, "pandoc-wasm/src/core.js").replaceAll("\\", "/")}";`,
  xlsx: `export * from "xlsx/xlsx.mjs";`,
  // 文档转 PDF：渲染 Word、截图成页面
  "docx-preview": `export { renderAsync } from "docx-preview";`,
  html2canvas: `export { default } from "html2canvas-pro";`,
  // PDF 转 Word：生成 DOCX
  docx: `export { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, AlignmentType } from "docx";`,
};

for (const [name, code] of Object.entries(entries)) {
  const entry = join(out, "entries", name + ".js");
  writeFileSync(entry, code);
  await build({
    entryPoints: [entry], outfile: join(out, name + ".js"),
    bundle: true, format: "esm", minify: true, target: "es2020",
    platform: "browser", nodePaths: [nm], logLevel: "warning",
    // 库里有给 Node 用的分支，浏览器用不到
    external: ["fs", "path", "module", "url", "crypto", "worker_threads", "child_process", "os", "perf_hooks"],
    define: { "process.env.NODE_ENV": '"production"' },
    // 编码扩展要注册到同一份 mediabunny 上，不能各自再打包一份
    plugins: name === "mediabunny" ? [] : [{
      name: "share-mediabunny",
      setup(b) { b.onResolve({ filter: /^mediabunny$/ }, () => ({ path: "./mediabunny.js", external: true })); },
    }],
  });
}
rmSync(join(out, "entries"), { recursive: true });

// wasm 文件：与打包后的 js 放在同一目录，运行时用 locateFile / import.meta.url 找到
const wasm = {
  "mozjpeg_enc.wasm": "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm",
  "mozjpeg_dec.wasm": "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm",
  "webp_enc.wasm": "@jsquash/webp/codec/enc/webp_enc.wasm",
  "webp_enc_simd.wasm": "@jsquash/webp/codec/enc/webp_enc_simd.wasm",
  "webp_dec.wasm": "@jsquash/webp/codec/dec/webp_dec.wasm",
  "avif_enc.wasm": "@jsquash/avif/codec/enc/avif_enc.wasm",
  "avif_dec.wasm": "@jsquash/avif/codec/dec/avif_dec.wasm",
  "squoosh_png_bg.wasm": "@jsquash/png/codec/pkg/squoosh_png_bg.wasm",
  "squoosh_oxipng_bg.wasm": "@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm",
  "squoosh_resize_bg.wasm": "@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm",
  "7zz.wasm": "7z-wasm/7zz.wasm",
  "qpdf.wasm": "@neslinesli93/qpdf-wasm/dist/qpdf.wasm",
  "gs.wasm": "@jspawn/ghostscript-wasm/gs.wasm",
  "pandoc.wasm": "pandoc-wasm/src/pandoc.wasm",
};
for (const [to, from] of Object.entries(wasm)) copyFileSync(join(nm, from), join(out, to));

// 整目录复制的组件（带自己的加载器，不打包）
const dirs = {
  // pdf.js：用 legacy 版本兼容旧一些的 Safari；cmaps 用于中文 PDF 的文字提取
  "pdfjs/pdf.min.mjs": "pdfjs-dist/legacy/build/pdf.min.mjs",
  "pdfjs/pdf.worker.min.mjs": "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  "pdfjs/cmaps": "pdfjs-dist/cmaps",
  "pdfjs/standard_fonts": "pdfjs-dist/standard_fonts",
  "pdfjs/wasm": "pdfjs-dist/wasm",
  // Tesseract OCR：扫描件识别文字（简体中文 + 英文，best_int 模型）
  "tess/tesseract.esm.min.js": "tesseract.js/dist/tesseract.esm.min.js",
  "tess/worker.min.js": "tesseract.js/dist/worker.min.js",
  "tess/core/tesseract-core-lstm.wasm.js": "tesseract.js-core/tesseract-core-lstm.wasm.js",
  "tess/core/tesseract-core-simd-lstm.wasm.js": "tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "tess/core/tesseract-core-relaxedsimd-lstm.wasm.js": "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "tess/lang/chi_sim.traineddata.gz": "@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz",
  "tess/lang/eng.traineddata.gz": "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  // Pyodide（浏览器里的 Python）：运行 python-can 把 BLF 转成文本
  "pyodide/pyodide.mjs": "pyodide/pyodide.mjs",
  "pyodide/pyodide.asm.js": "pyodide/pyodide.asm.js",
  "pyodide/pyodide.asm.wasm": "pyodide/pyodide.asm.wasm",
  "pyodide/python_stdlib.zip": "pyodide/python_stdlib.zip",
  "pyodide/pyodide-lock.json": "pyodide/pyodide-lock.json",
};
for (const [to, from] of Object.entries(dirs)) {
  mkdirSync(dirname(join(out, to)), { recursive: true });
  cpSync(join(nm, from), join(out, to), { recursive: true });
}
// python-can 及其依赖的 wheel（由 tools/fetch-wheels.sh 下载到 tools/wheels/）
cpSync(join(here, "wheels"), join(out, "pyodide/wheels"), { recursive: true });
console.log("vendor 完成：", out);
