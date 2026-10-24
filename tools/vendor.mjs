// 把网页用到的第三方库打包到 ../vendor/（网页直接引用，不依赖外部 CDN）
// 用法：cd tools && npm install && npm run vendor
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
console.log("vendor 完成：", out);
