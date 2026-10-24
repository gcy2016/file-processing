// 图片：解码 / 编码 / 压缩 / 转 PDF（在后台线程运行）
import { UserError } from "../util.js";

const V = "../../vendor/";
let sq, upng, utif, heif, gif;
const jsquash = async () => sq ??= await import(V + "jsquash.js");
const UPNG = async () => upng ??= (await import(V + "upng.js")).default;
const UTIF = async () => utif ??= (await import(V + "utif.js")).default;
const gifenc = async () => gif ??= await import(V + "gifenc.js");

// 强力模式下长边最大像素
const STRONG_MAX_SIDE = 2048;

// ---------- 解码：任何支持的输入 → ImageData（已按 EXIF 方向摆正） ----------
export async function decode(blob, fmt) {
  if (fmt === "tiff") return decodeTiff(blob);
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    return bitmapToImageData(bmp);
  } catch (e) {
    if (fmt === "heic") return decodeHeic(blob);
    const s = await jsquash();
    const buf = await blob.arrayBuffer();
    const dec = { jpg: s.decodeJpeg, png: s.decodePng, webp: s.decodeWebp, avif: s.decodeAvif }[fmt];
    if (dec) return dec(buf);
    throw new UserError("这张图片读不出来，文件可能已损坏。");
  }
}

function bitmapToImageData(bmp) {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return ctx.getImageData(0, 0, c.width, c.height);
}

async function decodeTiff(blob) {
  const U = await UTIF();
  const buf = await blob.arrayBuffer();
  const ifds = U.decode(buf);
  if (!ifds.length) throw new UserError("这个 TIFF 文件里没有图片。");
  U.decodeImage(buf, ifds[0]);
  const rgba = U.toRGBA8(ifds[0]);
  return new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), ifds[0].width, ifds[0].height);
}

async function decodeHeic(blob) {
  if (!heif) {
    const factory = (await import(V + "heif.js")).default;
    heif = await factory();
  }
  const decoder = new heif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(await blob.arrayBuffer()));
  if (!images?.length) throw new UserError("这张 HEIC 照片读不出来，文件可能已损坏。");
  const img = images[0];
  const w = img.get_width(), h = img.get_height();
  const out = new ImageData(w, h);
  await new Promise((resolve, reject) => img.display(out, r => r ? resolve() : reject(new UserError("HEIC 照片解码失败。"))));
  for (const i of images) i.free?.();
  return out;
}

// ---------- 工具函数 ----------
export function hasAlpha(img) {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true;
  return false;
}

function flatten(img, bg = 255) {
  const d = new Uint8ClampedArray(img.data);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a < 1) {
      d[i] = d[i] * a + bg * (1 - a);
      d[i + 1] = d[i + 1] * a + bg * (1 - a);
      d[i + 2] = d[i + 2] * a + bg * (1 - a);
      d[i + 3] = 255;
    }
  }
  return new ImageData(d, img.width, img.height);
}

export function fitInside(img, maxSide) {
  const long = Math.max(img.width, img.height);
  if (long <= maxSide) return img;
  const k = maxSide / long;
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const src = new OffscreenCanvas(img.width, img.height);
  src.getContext("2d").putImageData(img, 0, 0);
  const dst = new OffscreenCanvas(w, h);
  const ctx = dst.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// ---------- 编码 ----------
// quality：0–100；lossyPng：PNG 是否量化为 256 色
export async function encode(img, fmt, { quality = 82, lossyPng = false } = {}) {
  const s = ["jpg", "webp", "avif", "png"].includes(fmt) ? await jsquash() : null;
  switch (fmt) {
    case "jpg": return s.encodeJpeg(hasAlpha(img) ? flatten(img) : img, { quality });
    case "webp": return s.encodeWebp(img, { quality });
    case "avif": return s.encodeAvif(img, { quality: Math.max(30, quality - 22), speed: 8 });
    case "png": {
      if (!lossyPng) {
        // 无损：浏览器自带的 PNG 编码最快
        const c = new OffscreenCanvas(img.width, img.height);
        c.getContext("2d").putImageData(img, 0, 0);
        return (await c.convertToBlob({ type: "image/png" })).arrayBuffer();
      }
      const U = await UPNG();
      const raw = U.encode([img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.data.byteLength)], img.width, img.height, 256);
      return s.optimisePng(raw, { level: 2 });
    }
    case "gif": {
      const { GIFEncoder, quantize, applyPalette } = await gifenc();
      const palette = quantize(img.data, 256, { format: "rgba4444", oneBitAlpha: true });
      const index = applyPalette(img.data, palette, "rgba4444");
      const g = GIFEncoder();
      g.writeFrame(index, img.width, img.height, { palette, transparent: hasAlpha(img), transparentIndex: palette.findIndex(c => c[3] === 0) });
      g.finish();
      return g.bytes();
    }
    case "tiff": {
      const U = await UTIF();
      return U.encodeImage(img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.data.byteLength), img.width, img.height);
    }
  }
  throw new UserError("不支持输出为 " + fmt);
}

const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif", gif: "image/gif", tiff: "image/tiff" };
const toBlob = (buf, fmt) => new Blob([buf], { type: MIME[fmt] });

// ---------- 对外操作 ----------
export async function convert({ file, from, to }) {
  const img = await decode(file, from);
  const notes = [];
  if (from === "gif" || from === "webp") notes.push("如果原图是动图，只保留了第一帧。");
  if (to === "jpg" && hasAlpha(img)) notes.push("JPG 不支持透明，透明部分已填成白色。");
  const out = await encode(img, to, { quality: to === "jpg" ? 90 : 88 });
  return { blob: toBlob(out, to), notes, width: img.width, height: img.height };
}

// mode：normal（肉眼难以察觉）/ strong（有损，可能缩小尺寸）/ lossless（只做无损优化，压缩包普通模式用）
export async function compress({ file, fmt, mode }) {
  const notes = [];
  let out, outFmt = fmt === "heic" ? "jpg" : fmt;

  if (mode === "lossless") {
    if (fmt !== "png") return { blob: file, outFmt: fmt, unchanged: true, notes: ["普通模式下只做无损优化，这类图片保持原样。"] };
    const s = await jsquash();
    out = await s.optimisePng(await file.arrayBuffer(), { level: 2 });
  } else if (fmt === "png" && mode === "normal") {
    const s = await jsquash();
    out = await s.optimisePng(await file.arrayBuffer(), { level: 2 });
    notes.push("PNG 做了无损优化，画面完全不变。");
  } else {
    let img = await decode(file, fmt);
    if (mode === "strong") {
      const before = Math.max(img.width, img.height);
      img = fitInside(img, STRONG_MAX_SIDE);
      if (Math.max(img.width, img.height) < before) notes.push(`长边从 ${before} 像素缩小到 ${STRONG_MAX_SIDE} 像素。`);
    }
    const q = mode === "strong" ? { jpg: 65, webp: 62 } : { jpg: 82, webp: 80 };
    if (outFmt === "png") out = await encode(img, "png", { lossyPng: true });
    else out = await encode(img, outFmt, { quality: q[outFmt] });
    if (mode === "strong") notes.push("强力模式会降低一些画质。");
    if (fmt === "heic") notes.push("浏览器无法生成 HEIC，输出为 JPG。");
    notes.push("已清除照片里的 GPS 位置等附加信息，照片方向已摆正。");
  }
  return { blob: toBlob(out, outFmt), outFmt, notes };
}

// 多张图片 → 一个 PDF（每张一页，页面尺寸与图片一致）
export async function toPdf({ files }, progress) {
  const { PDFDocument } = await import(V + "pdflib.js");
  const doc = await PDFDocument.create();
  let i = 0;
  for (const { file, fmt } of files) {
    const img = await decode(file, fmt);
    const alpha = hasAlpha(img);
    const bytes = alpha ? await encode(img, "png") : await encode(img, "jpg", { quality: 90 });
    const emb = alpha ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    // 按 150 dpi 换算页面尺寸，打印时大小合理
    const w = img.width * 72 / 150, h = img.height * 72 / 150;
    doc.addPage([w, h]).drawImage(emb, { x: 0, y: 0, width: w, height: h });
    progress?.(++i / files.length);
  }
  const out = await doc.save();
  return { blob: new Blob([out], { type: "application/pdf" }), notes: [`共 ${files.length} 页。`] };
}
