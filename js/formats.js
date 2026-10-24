// 格式表 + 按文件内容识别格式（不只看扩展名，PRD 5）

// kind：image / video / audio / pdf / archive / document / data
export const FORMATS = {
  jpg:  { label: "JPG",  ext: "jpg",  mime: "image/jpeg", kind: "image" },
  png:  { label: "PNG",  ext: "png",  mime: "image/png", kind: "image" },
  webp: { label: "WebP", ext: "webp", mime: "image/webp", kind: "image" },
  gif:  { label: "GIF",  ext: "gif",  mime: "image/gif", kind: "image" },
  tiff: { label: "TIFF", ext: "tiff", mime: "image/tiff", kind: "image" },
  avif: { label: "AVIF", ext: "avif", mime: "image/avif", kind: "image" },
  heic: { label: "HEIC", ext: "heic", mime: "image/heic", kind: "image" },
  bmp:  { label: "BMP",  ext: "bmp",  mime: "image/bmp", kind: "image" },

  mp4:  { label: "MP4",  ext: "mp4",  mime: "video/mp4", kind: "video" },
  mov:  { label: "MOV",  ext: "mov",  mime: "video/quicktime", kind: "video" },
  webm: { label: "WebM", ext: "webm", mime: "video/webm", kind: "video" },
  mkv:  { label: "MKV",  ext: "mkv",  mime: "video/x-matroska", kind: "video" },
  avi:  { label: "AVI",  ext: "avi",  mime: "video/x-msvideo", kind: "video" },
  ts:   { label: "TS",   ext: "ts",   mime: "video/mp2t", kind: "video" },

  mp3:  { label: "MP3",  ext: "mp3",  mime: "audio/mpeg", kind: "audio" },
  m4a:  { label: "M4A",  ext: "m4a",  mime: "audio/mp4", kind: "audio" },
  aac:  { label: "AAC",  ext: "aac",  mime: "audio/aac", kind: "audio" },
  wav:  { label: "WAV",  ext: "wav",  mime: "audio/wav", kind: "audio" },
  flac: { label: "FLAC", ext: "flac", mime: "audio/flac", kind: "audio" },
  ogg:  { label: "OGG",  ext: "ogg",  mime: "audio/ogg", kind: "audio" },

  pdf:  { label: "PDF",  ext: "pdf",  mime: "application/pdf", kind: "pdf" },

  zip:  { label: "ZIP",  ext: "zip",  mime: "application/zip", kind: "archive" },
  "7z": { label: "7Z",   ext: "7z",   mime: "application/x-7z-compressed", kind: "archive" },
  tar:  { label: "TAR",  ext: "tar",  mime: "application/x-tar", kind: "archive" },
  tgz:  { label: "TAR.GZ", ext: "tar.gz", mime: "application/gzip", kind: "archive" },
  rar:  { label: "RAR",  ext: "rar",  mime: "application/vnd.rar", kind: "archive" },

  docx: { label: "Word (DOCX)", ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document" },
  md:   { label: "Markdown", ext: "md", mime: "text/markdown", kind: "document" },
  html: { label: "HTML", ext: "html", mime: "text/html", kind: "document" },
  epub: { label: "EPUB", ext: "epub", mime: "application/epub+zip", kind: "document" },
  txt:  { label: "TXT",  ext: "txt",  mime: "text/plain", kind: "document" },
  pptx: { label: "PPT (PPTX)", ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "document" },
  odt:  { label: "ODT",  ext: "odt",  mime: "application/vnd.oasis.opendocument.text", kind: "document" },

  xlsx: { label: "Excel (XLSX)", ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "data" },
  csv:  { label: "CSV",  ext: "csv",  mime: "text/csv", kind: "data" },
  json: { label: "JSON", ext: "json", mime: "application/json", kind: "data" },

  blf:  { label: "BLF",  ext: "blf",  mime: "application/octet-stream", kind: "can" },
  asc:  { label: "ASC（Vector 文本）", ext: "asc", mime: "text/plain", kind: "can" },
};

export const KIND_LABEL = {
  image: "图片", video: "视频", audio: "音频", pdf: "PDF", archive: "压缩包", document: "文档", data: "表格数据", can: "CAN 总线日志",
};

const ascii = (b, start, len) => String.fromCharCode(...b.subarray(start, start + len));
const starts = (b, sig, at = 0) => sig.every((v, i) => v === null || b[at + i] === v);

// 返回格式 id（FORMATS 的键），认不出返回 null
export async function sniff(file) {
  const head = new Uint8Array(await file.slice(0, 4100).arrayBuffer());
  const name = (file.name || "").toLowerCase();
  const b = head;

  if (starts(b, [0xff, 0xd8, 0xff])) return "jpg";
  if (starts(b, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (ascii(b, 0, 4) === "GIF8") return "gif";
  if (ascii(b, 0, 4) === "RIFF") {
    const t = ascii(b, 8, 4);
    if (t === "WEBP") return "webp";
    if (t === "WAVE") return "wav";
    if (t === "AVI ") return "avi";
  }
  if (starts(b, [0x49, 0x49, 0x2a, 0x00]) || starts(b, [0x4d, 0x4d, 0x00, 0x2a])) return "tiff";
  if (ascii(b, 0, 2) === "BM" && b.length > 30) return "bmp";
  if (ascii(b, 4, 4) === "ftyp") return ftyp(b);
  if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return ascii(b, 0, 64).includes("webm") ? "webm" : "mkv";
  if (b[0] === 0x47 && b[188] === 0x47) return "ts";
  if (ascii(b, 0, 4) === "fLaC") return "flac";
  if (ascii(b, 0, 4) === "OggS") return "ogg";
  if (ascii(b, 0, 3) === "ID3") return "mp3";
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return "aac";       // ADTS
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return "mp3";       // MPEG 音频帧
  if (ascii(b, 0, 5) === "%PDF-") return "pdf";
  if (ascii(b, 0, 4) === "LOGG") return "blf";                       // Vector BLF 二进制日志
  if (starts(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (ascii(b, 0, 4) === "Rar!") return "rar";
  if (starts(b, [0x1f, 0x8b])) return "tgz";                        // gzip，按 tar.gz 处理
  if (ascii(b, 257, 5) === "ustar") return "tar";
  if (ascii(b, 0, 2) === "PK") return zipKind(file, b);

  // 文本类：先确认是可读文本，再按内容 / 扩展名区分
  const text = decodeText(b);
  if (text == null) return null;
  const t = text.trimStart();
  if (/^<!doctype html|^<html[\s>]/i.test(t)) return "html";
  if (/^[{[]/.test(t) && (name.endsWith(".json") || looksJson(t))) return "json";
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".asc")) return "asc";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "md";
  if (name.endsWith(".html") || name.endsWith(".htm")) return "html";
  if (name.endsWith(".txt") || name.endsWith(".text")) return "txt";
  if (name.endsWith(".json")) return "json";
  return "txt";
}

function ftyp(b) {
  const brands = [ascii(b, 8, 4)];
  const boxSize = (b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]) >>> 0;
  for (let i = 16; i + 4 <= Math.min(boxSize, 256); i += 4) brands.push(ascii(b, i, 4));
  const major = brands[0];
  if (["avif", "avis"].includes(major) || (major === "mif1" && brands.includes("avif"))) return "avif";
  if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(major)) return "heic";
  if (major === "qt  ") return "mov";
  if (["M4A ", "M4B ", "M4P "].includes(major)) return "m4a";
  return "mp4";
}

async function zipKind(file, b) {
  if (ascii(b, 30, 28) === "mimetypeapplication/epub+zip") return "epub";
  // 看中央目录里的文件名区分 Office 文档
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65536)).arrayBuffer());
  const s = new TextDecoder("latin1").decode(tail) + new TextDecoder("latin1").decode(b);
  if (s.includes("word/document.xml")) return "docx";
  if (s.includes("xl/workbook.xml")) return "xlsx";
  if (s.includes("ppt/presentation.xml")) return "pptx";
  if (s.includes("mimetypeapplication/epub+zip")) return "epub";
  if (s.includes("application/vnd.oasis.opendocument.text")) return "odt";
  return "zip";
}

function decodeText(b) {
  if (b.includes(0)) return null;
  // 截断处可能切开多字节字符，去掉最后几个字节再严格解码
  const body = b.length >= 4100 ? b.subarray(0, b.length - 4) : b;
  for (const enc of ["utf-8", "gb18030"]) {
    try { return new TextDecoder(enc, { fatal: true }).decode(body); } catch {}
  }
  return null;
}

function looksJson(t) {
  try { JSON.parse(t); return true; } catch { return /^[{[]\s*["{[\d-]/.test(t); }
}
