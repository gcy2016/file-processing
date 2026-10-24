// 能力注册表 + 转换路径规划（PRD 4.3）
// 每条能力是一条"边"：from 里的任一格式 → to 里的任一格式，由 run 指定的处理函数完成。
// 新增能力只需在这里加一条，不必给每对格式单独写代码。
import { FORMATS } from "./formats.js";

const IMG_IN = ["jpg", "png", "webp", "gif", "tiff", "avif", "heic", "bmp"];
const IMG_OUT = ["jpg", "png", "webp", "gif", "tiff", "avif"];
const VID_IN = ["mp4", "mov", "webm", "mkv", "ts"];
const VID_OUT = ["mp4", "mov", "webm", "mkv"];
const AUD_IN = ["mp3", "m4a", "aac", "wav", "flac", "ogg"];
const AUD_OUT = ["mp3", "m4a", "aac", "wav", "flac", "ogg"];
const DOC_IN = ["docx", "md", "html", "epub", "txt"];
const DOC_OUT = ["docx", "md", "html", "epub", "txt"];
const DATA = ["csv", "json", "xlsx"];
const ARC_IN = ["zip", "7z", "tar", "tgz", "rar"];
const ARC_OUT = ["zip", "7z", "tar", "tgz"];

// status：full 完整 / partial 部分 / experimental 实验性
// tool / license：用到的工具及许可（也用于"源代码与许可"页面）
export const CAPABILITIES = [
  { id: "image", from: IMG_IN, to: IMG_OUT, run: "image.convert", status: "full",
    tool: "浏览器内置解码、MozJPEG、libwebp、libavif、UPNG、UTIF、gifenc、libheif",
    loss: "转成 JPG / WebP / AVIF / GIF 会有轻微画质损失；动图只保留第一帧；JPG 不支持透明，透明处填白色。" },
  { id: "image-pdf", from: IMG_IN, to: ["pdf"], run: "image.toPdf", status: "full", tool: "pdf-lib",
    loss: "每张图片一页，页面大小按图片尺寸换算（150 dpi）。" },
  { id: "video", from: VID_IN, to: VID_OUT, run: "media.convert", status: "full", tool: "Mediabunny + 浏览器 WebCodecs",
    loss: "需要重新编码时画质会有轻微损失。转 MP4 / MOV 统一输出 H.264 视频，兼容性最好。" },
  { id: "video-audio", from: VID_IN, to: AUD_OUT, run: "media.convert", status: "full", tool: "Mediabunny",
    loss: "只保留声音。" },
  { id: "video-gif", from: VID_IN, to: ["gif"], run: "media.toGif", status: "full", tool: "Mediabunny + gifenc",
    loss: "GIF 只有 256 色、没有声音；默认截取前 10 秒，每秒 10 帧。", needs: "gif" },
  { id: "video-frames", from: VID_IN, to: ["frames"], run: "media.toFrames", status: "full", tool: "Mediabunny + MozJPEG + fflate",
    loss: "按固定间隔截图，打包成 ZIP。", needs: "frames" },
  { id: "audio", from: AUD_IN, to: AUD_OUT, run: "media.convert", status: "full", tool: "Mediabunny（MP3 编码：LAME）",
    loss: "转成 MP3 / M4A / AAC / OGG 是有损格式；WAV / FLAC 无损。" },
  { id: "audio-video", from: AUD_IN, to: ["mp4"], run: "media.audioToVideo", status: "full", tool: "Mediabunny",
    loss: "音频本身没有画面，需要选一种画面：封面图、纯色或波形。", needs: "audioVideo" },
  { id: "doc", from: DOC_IN, to: DOC_OUT, run: "doc.convert", status: "partial", tool: "pandoc",
    loss: "保留文字、标题、列表、表格、图片等结构；字体、颜色、复杂排版可能丢失。首次使用需下载约 16 MB 的组件。" },
  { id: "data", from: DATA, to: DATA, run: "data.convert", status: "full", tool: "SheetJS",
    loss: "只转换数据，不保留单元格格式、公式（保留计算结果）和图表。多个工作表转 CSV 时只导出第一个。" },
  { id: "archive", from: ARC_IN, to: ARC_OUT, run: "archive.convert", status: "full", tool: "7-Zip",
    loss: "真实解包后重新打包，目录结构和文件名保留；文件修改时间和权限不保留。" },
];

// 虚拟目标格式：视频截图打包
FORMATS.frames = { label: "图片序列（ZIP）", ext: "zip", mime: "application/zip", kind: "archive", virtual: true };

const edgesFrom = fmt => CAPABILITIES.filter(c => c.from.includes(fmt));

// 找 from → to 的最短路径（最多 3 步）；需要用户补充输入的能力只能作为最后一步
export function plan(from, to, maxSteps = 3) {
  if (from === to) return null;
  const queue = [[from, []]];
  const seen = new Set([from]);
  while (queue.length) {
    const [fmt, path] = queue.shift();
    if (path.length >= maxSteps) continue;
    for (const cap of edgesFrom(fmt)) {
      if (cap.to.includes(to)) return [...path, { cap, from: fmt, to }];
      if (cap.needs) continue;
      for (const next of cap.to) {
        if (seen.has(next) || FORMATS[next]?.virtual) continue;
        seen.add(next);
        queue.push([next, [...path, { cap, from: fmt, to: next }]]);
      }
    }
  }
  return null;
}

// 一批文件共同可转换到的目标；本来就是目标格式的文件原样保留（例如 HEIC 和 JPG 一起转 JPG）
export function targetsFor(fmts) {
  const all = Object.keys(FORMATS);
  return all.filter(t => fmts.some(f => f !== t) && fmts.every(f => f === t || plan(f, t)));
}

// 压缩能力（PRD 3.1）：格式 → 压缩方式
export const COMPRESS = {
  jpg: "image", png: "image", webp: "image", heic: "image",
  mp4: "video", mov: "video", webm: "video", mkv: "video",
  pdf: "pdf",
  zip: "archive", "7z": "archive", tar: "archive", tgz: "archive", rar: "archive",
};

// 首版不支持但用户可能会选的格式，给出具体原因
export const UNSUPPORTED_REASON = {
  avi: "首版暂不支持读取 AVI 视频。可以先用其他工具转成 MP4。",
  pptx: "PPT 转换（包括转 PDF）首版暂不支持。",
  bmp: null,
};
