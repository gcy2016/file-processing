// 音视频：压缩、互转、提取声音、转 GIF、截图、音频配画面转 MP4
// 在页面主线程运行（调用浏览器自带的 WebCodecs 硬件编解码），基于 Mediabunny
import { UserError, fmtDur } from "./util.js";

const V = new URL("../vendor/", import.meta.url).href;
let MB;
async function mb() {
  if (MB) return MB;
  try { MB = await import(V + "mediabunny.js"); }
  catch { throw new UserError("音视频组件没加载出来，请检查网络后刷新页面。"); }
  return MB;
}

// 浏览器不能原生编码时，加载对应的软件编码器
const extLoaded = {};
async function ensureAudioEncoder(codec) {
  const M = await mb();
  if (await M.canEncodeAudio(codec)) return true;
  const ext = { mp3: ["mb-mp3.js", "registerMp3Encoder"], aac: ["mb-aac.js", "registerAacEncoder"], flac: ["mb-flac.js", "registerFlacEncoder"] }[codec];
  if (!ext) return false;
  if (!extLoaded[codec]) {
    const mod = await import(V + ext[0]);
    mod[ext[1]]();
    extLoaded[codec] = true;
  }
  return M.canEncodeAudio(codec);
}

const even = n => Math.max(2, Math.round(n / 2) * 2);

function outputFor(M, fmt) {
  switch (fmt) {
    case "mp4": case "m4a": return new M.Mp4OutputFormat({ fastStart: "in-memory" });
    case "mov": return new M.MovOutputFormat({ fastStart: "in-memory" });
    case "webm": return new M.WebMOutputFormat();
    case "mkv": return new M.MkvOutputFormat();
    case "mp3": return new M.Mp3OutputFormat();
    case "aac": return new M.AdtsOutputFormat();
    case "wav": return new M.WavOutputFormat();
    case "flac": return new M.FlacOutputFormat();
    case "ogg": return new M.OggOutputFormat();
  }
  throw new UserError("不支持输出为 " + fmt);
}
const MIME = {
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  m4a: "audio/mp4", mp3: "audio/mpeg", aac: "audio/aac", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg",
};
// 每种输出格式用的音频编码（第一个能用的）
const AUDIO_CODEC = { mp4: ["aac"], mov: ["aac"], m4a: ["aac"], webm: ["opus"], mkv: ["aac", "opus"], mp3: ["mp3"], aac: ["aac"], wav: ["pcm-s16"], flac: ["flac"], ogg: ["opus"] };
const VIDEO_CODEC = { mp4: ["avc"], mov: ["avc"], webm: ["vp9", "vp8"], mkv: ["avc", "vp9"] };

async function pickAudioCodec(fmt) {
  for (const c of AUDIO_CODEC[fmt] || []) if (c === "pcm-s16" || await ensureAudioEncoder(c)) return c;
  return null;
}

export async function probe(file) {
  const M = await mb();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  try {
    const [vt, at] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
    const dur = await input.computeDuration();
    const info = { dur, hasVideo: !!vt, hasAudio: !!at };
    if (vt) {
      const stats = await vt.computePacketStats(120);
      Object.assign(info, { w: vt.displayWidth, h: vt.displayHeight, fps: Math.round((stats.averagePacketRate || 30) * 100) / 100, vcodec: vt.codec });
    }
    if (at) Object.assign(info, { acodec: at.codec, channels: at.numberOfChannels, rate: at.sampleRate });
    return info;
  } catch (e) {
    if (e instanceof M.UnsupportedInputFormatError || /unsupported|format/i.test(e?.message)) throw new UserError("读不出这个音视频文件，格式可能不支持或文件已损坏。");
    throw e;
  } finally { input.dispose?.(); }
}

const describe = i => i.hasVideo ? `${i.w}×${i.h} · ${Math.round(i.fps)} 帧 · ${fmtDur(i.dur)}` : `音频 · ${fmtDur(i.dur)}`;
export { describe as describeMedia };

// 通用转换（Mediabunny Conversion），返回 Blob
async function runConversion(file, fmt, { video, audio, onProgress, signal }) {
  const M = await mb();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  const output = new M.Output({ format: outputFor(M, fmt), target: new M.BufferTarget() });
  let conv;
  try {
    conv = await M.Conversion.init({ input, output, video, audio, showWarnings: false });
  } catch (e) { throw new UserError("没法开始处理：" + (e.message || e)); }
  if (!conv.isValid) {
    const why = conv.discardedTracks.map(d => d.reason).join("、");
    throw new UserError("这个文件的编码这台设备处理不了" + (why ? `（${why}）` : "") + "。可以换到电脑上的 Chrome 试试。");
  }
  const lost = conv.discardedTracks.filter(d => d.reason !== "discarded_by_user").map(d => d.track.type);
  if (lost.includes("video") && video && !video.discard) {
    throw new UserError("这台设备解码不了这个视频的画面（常见于 iPhone 的 HEVC 视频在部分电脑浏览器上）。请用 iPhone 的 Safari，或电脑上最新版的 Chrome / Edge 再试。");
  }
  const abort = () => conv.cancel();
  signal?.addEventListener("abort", abort);
  conv.onProgress = p => onProgress?.(p);
  try { await conv.execute(); }
  catch (e) {
    if (signal?.aborted || e instanceof M.ConversionCanceledError) throw new UserError("已取消。");
    throw new UserError("处理中途出错了：" + (e.message || e));
  } finally { signal?.removeEventListener("abort", abort); }
  const notes = [];
  if (lost.includes("audio")) notes.push("这台设备处理不了原文件的声音，输出文件没有声音。");
  return { blob: new Blob([output.target.buffer], { type: MIME[fmt] }), notes };
}

// ---------- 压缩 ----------
// normal：短边最多 1080，码率适中；strong：短边最多 720、最高 30 帧、码率更低
function videoPlan(info, mode) {
  const cfg = mode === "strong" ? { short: 720, bpp: 0.05, fps: 30, abr: 96000 } : { short: 1080, bpp: 0.085, fps: 60, abr: 128000 };
  const k = Math.min(1, cfg.short / Math.min(info.w, info.h));
  const w = even(info.w * k), h = even(info.h * k);
  const fps = Math.min(info.fps, cfg.fps);
  const bitrate = Math.max(300000, Math.round(cfg.bpp * w * h * fps));
  return { cfg, w, h, bitrate, bytes: (bitrate + (info.hasAudio ? cfg.abr : 0)) * info.dur / 8 };
}

// 压缩前预估输出大小（按目标码率计算）
export async function estimateVideo({ file, mode }) {
  const info = await probe(file);
  if (!info.hasVideo) throw new UserError("这个文件里没有视频画面。");
  const p = videoPlan(info, mode);
  return { bytes: Math.round(p.bytes), note: resNote(info, p) };
}
const resNote = (info, p) => p.w < info.w ? `分辨率 ${info.w}×${info.h} → ${p.w}×${p.h}` : "";

export async function compressVideo({ file, mode }, onProgress, signal) {
  const M = await mb();
  const info = await probe(file);
  if (!info.hasVideo) throw new UserError("这个文件里没有视频画面。");
  const { cfg, w, h, bitrate } = videoPlan(info, mode);
  const codec = await M.getFirstEncodableVideoCodec(["avc", "hevc", "vp9"], { width: w, height: h, bitrate });
  if (!codec) throw new UserError("这个浏览器不支持视频编码。请更新系统，或用电脑上最新版的 Chrome 打开。");
  const aac = await ensureAudioEncoder("aac");
  const { blob, notes } = await runConversion(file, "mp4", {
    video: { width: w, height: h, fit: "contain", codec, bitrate, forceTranscode: true, frameRate: info.fps > cfg.fps + 0.5 ? cfg.fps : undefined },
    audio: aac ? { codec: "aac", bitrate: cfg.abr } : {},
    onProgress, signal,
  });
  if (w < info.w) notes.unshift(`分辨率从 ${info.w}×${info.h} 降到 ${w}×${h}。`);
  if (mode === "strong") notes.push("强力模式画质会明显下降。");
  if (codec !== "avc") notes.push(`这台设备不支持 H.264 编码，改用了 ${codec.toUpperCase()}，个别老设备可能播放不了。`);
  return { blob, outFmt: "mp4", notes };
}

// ---------- 格式互转 / 提取声音 ----------
export async function convert({ file, from, to }, onProgress, signal) {
  const M = await mb();
  const info = await probe(file);
  const audioOnly = !VIDEO_CODEC[to];
  if (!audioOnly && !info.hasVideo) throw new UserError("这个文件里没有视频画面。");
  if (audioOnly && !info.hasAudio) throw new UserError("这个文件里没有声音。");
  let video;
  if (audioOnly) video = { discard: true };
  else {
    const codec = await M.getFirstEncodableVideoCodec(VIDEO_CODEC[to], { width: info.w, height: info.h });
    // 原编码已经符合目标就直接复制，不重新编码（快、无损）
    const keep = VIDEO_CODEC[to].includes(info.vcodec);
    if (!codec && !keep) throw new UserError("这台设备不支持生成这种格式的视频。");
    video = keep ? {} : { codec };
  }
  const acodec = info.hasAudio ? await pickAudioCodec(to) : null;
  const audioCopy = info.hasAudio && AUDIO_CODEC[to]?.includes(info.acodec);
  if (info.hasAudio && !acodec && !audioCopy) {
    if (audioOnly) throw new UserError(`这台设备不能生成 ${to.toUpperCase()} 音频。`);
  }
  const audio = !info.hasAudio ? undefined : audioCopy ? {} : acodec ? { codec: acodec, ...(acodec === "pcm-s16" ? {} : { bitrate: 192000 }) } : { discard: true };
  const r = await runConversion(file, to, { video, audio, onProgress, signal });
  if (!audioOnly && video.codec) r.notes.push("视频重新编码为 " + (video.codec === "avc" ? "H.264" : video.codec.toUpperCase()) + "，画质会有轻微损失。");
  if (!audioOnly && !video.codec) r.notes.push("视频编码没变，只换了格式，画质无损。");
  if (from === "mov" && to === "mp4" && info.vcodec === "hevc") r.notes.push("iPhone 的 HEVC 视频已转成兼容性更好的 H.264。");
  return { ...r, outFmt: to };
}

// ---------- 视频 → GIF ----------
export async function toGif({ file, opts = {} }, onProgress, signal) {
  const M = await mb();
  const { GIFEncoder, quantize, applyPalette } = await import(V + "gifenc.js");
  const info = await probe(file);
  if (!info.hasVideo) throw new UserError("这个文件里没有视频画面。");
  const start = Math.max(0, Math.min(Number(opts.start) || 0, info.dur));
  const len = Math.min(Number(opts.duration) || 10, 30, info.dur - start);
  const fps = Number(opts.fps) || 10;
  const width = Math.min(Number(opts.width) || 480, info.w);
  const height = even(info.h * width / info.w);
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  const sink = new M.CanvasSink(await input.getPrimaryVideoTrack(), { width: even(width), height, fit: "contain" });
  const times = [];
  for (let t = start; t < start + len; t += 1 / fps) times.push(t);
  const gif = GIFEncoder();
  let i = 0;
  for await (const wc of sink.canvasesAtTimestamps(times)) {
    if (signal?.aborted) throw new UserError("已取消。");
    if (!wc) continue;
    const ctx = wc.canvas.getContext("2d", { willReadFrequently: true });
    const { data } = ctx.getImageData(0, 0, wc.canvas.width, wc.canvas.height);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), wc.canvas.width, wc.canvas.height, { palette, delay: Math.round(1000 / fps) });
    onProgress?.(++i / times.length);
  }
  gif.finish();
  input.dispose?.();
  return {
    blob: new Blob([gif.bytes()], { type: "image/gif" }), outFmt: "gif",
    notes: [`截取 ${fmtDur(start)} 起 ${len.toFixed(1)} 秒，每秒 ${fps} 帧，宽 ${even(width)} 像素。`, "GIF 没有声音。"],
  };
}

// ---------- 视频 → 图片序列（ZIP） ----------
export async function toFrames({ file, opts = {} }, onProgress, signal) {
  const M = await mb();
  const { zipSync } = await import(V + "fflate.js");
  const info = await probe(file);
  if (!info.hasVideo) throw new UserError("这个文件里没有视频画面。");
  const every = Math.max(0.1, Number(opts.every) || 1);
  const times = [];
  for (let t = 0; t < info.dur && times.length < 600; t += every) times.push(t);
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  const sink = new M.CanvasSink(await input.getPrimaryVideoTrack());
  const files = {};
  let i = 0;
  for await (const wc of sink.canvasesAtTimestamps(times)) {
    if (signal?.aborted) throw new UserError("已取消。");
    if (!wc) continue;
    const blob = wc.canvas.convertToBlob
      ? await wc.canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 })
      : await new Promise(r => wc.canvas.toBlob(r, "image/jpeg", 0.9));
    files[`frame_${String(i + 1).padStart(4, "0")}_${fmtDur(times[i]).replace(/:/g, "-")}.jpg`] = new Uint8Array(await blob.arrayBuffer());
    onProgress?.(++i / times.length);
  }
  input.dispose?.();
  const zip = zipSync(files, { level: 0 });
  const notes = [`共 ${i} 张，每 ${every} 秒一张。`];
  if (times.length >= 600 && times.at(-1) + every < info.dur) notes.push("最多截 600 张，后面的部分没有截。");
  return { blob: new Blob([zip], { type: "application/zip" }), outFmt: "frames", notes };
}

// ---------- 音频 → MP4（配封面 / 纯色 / 波形） ----------
// opts：{ mode: "cover" | "color" | "wave", cover: File, color: "#123456" }
export async function audioToVideo({ file, opts = {} }, onProgress, signal) {
  const M = await mb();
  const input = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS });
  const at = await input.getPrimaryAudioTrack();
  if (!at) throw new UserError("这个文件里没有声音。");
  const dur = await input.computeDuration();
  const W = 1280, H = 720;
  const mode = opts.mode || "cover";
  const color = opts.color || "#1d2b25";

  // 封面：用户选的图片 > 音频里自带的封面 > 纯色
  let coverBmp = null, notes = [];
  if (mode === "cover") {
    let src = opts.cover;
    if (!src) {
      const tags = await input.getMetadataTags().catch(() => ({}));
      const img = tags.images?.find(i => i.kind === "coverFront") || tags.images?.[0];
      if (img) { src = new Blob([img.data], { type: img.mimeType }); notes.push("使用了音频文件自带的封面。"); }
    }
    if (src) coverBmp = await createImageBitmap(src, { imageOrientation: "from-image" }).catch(() => null);
    if (!coverBmp) notes.push("没有可用的封面图片，改用纯色背景。");
  }

  // 波形：先解码一遍，算出每一帧的音量
  const fps = mode === "wave" ? 15 : 1;
  const frames = Math.max(1, Math.ceil(dur * fps));
  let env = null;
  if (mode === "wave") {
    env = new Float32Array(frames);
    for await (const s of new M.AudioSampleSink(at).samples()) {
      if (signal?.aborted) throw new UserError("已取消。");
      const n = s.numberOfFrames, buf = new Float32Array(n);
      s.copyTo(buf, { planeIndex: 0, format: "f32-planar" });
      const step = Math.max(1, Math.floor(s.sampleRate / fps / 4));
      for (let j = 0; j < n; j += step) {
        const f = Math.min(frames - 1, Math.floor((s.timestamp + j / s.sampleRate) * fps));
        env[f] = Math.max(env[f], Math.abs(buf[j]));
      }
      s.close();
      onProgress?.(0.3 * Math.min(1, s.timestamp / dur));
    }
    const peak = env.reduce((a, b) => Math.max(a, b), 0.01);
    for (let j = 0; j < frames; j++) env[j] /= peak;
  }

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const draw = f => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, W, H);
    if (coverBmp) {
      const k = Math.min(W / coverBmp.width, H / coverBmp.height);
      const w = coverBmp.width * k, h = coverBmp.height * k;
      ctx.drawImage(coverBmp, (W - w) / 2, (H - h) / 2, w, h);
    }
    if (env) {
      const bars = 64, bw = W / bars;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (let b = 0; b < bars; b++) {
        const idx = Math.min(frames - 1, Math.max(0, f - bars / 2 + b));
        const amp = env[idx] * (b === bars / 2 ? 1 : 0.85);
        const bh = Math.max(4, amp * H * 0.7);
        ctx.fillRect(b * bw + 2, (H - bh) / 2, bw - 4, bh);
      }
    }
  };

  const vcodec = await M.getFirstEncodableVideoCodec(["avc", "hevc", "vp9"], { width: W, height: H });
  if (!vcodec) throw new UserError("这个浏览器不支持视频编码。");
  const aac = await ensureAudioEncoder("aac");
  const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: "in-memory" }), target: new M.BufferTarget() });
  const vsrc = new M.CanvasSource(canvas, { codec: vcodec, bitrate: mode === "wave" ? 1_500_000 : 600_000, keyFrameInterval: 2 });
  output.addVideoTrack(vsrc, { frameRate: fps });
  let asrc, copy = false;
  if (["aac", "mp3"].includes(at.codec) && !aac || at.codec === "aac") {
    copy = true;   // MP4 能直接装 AAC / MP3，原样复制，不损失音质
    asrc = new M.EncodedAudioPacketSource(at.codec);
  } else if (aac) asrc = new M.AudioSampleSource({ codec: "aac", bitrate: 192000 });
  else throw new UserError("这台设备不能生成 AAC 音频。");
  output.addAudioTrack(asrc);
  await output.start();

  // 先写声音
  if (copy) {
    const sink = new M.EncodedPacketSink(at);
    const cfg = await at.getDecoderConfig();
    let first = true;
    for await (const pkt of sink.packets()) {
      await asrc.add(pkt, first ? { decoderConfig: cfg } : undefined);
      first = false;
    }
  } else {
    for await (const s of new M.AudioSampleSink(at).samples()) {
      if (signal?.aborted) throw new UserError("已取消。");
      await asrc.add(s); s.close();
      onProgress?.(0.3 + 0.3 * Math.min(1, s.timestamp / dur));
    }
  }
  asrc.close();
  // 再写画面
  for (let f = 0; f < frames; f++) {
    if (signal?.aborted) throw new UserError("已取消。");
    draw(f);
    await vsrc.add(f / fps, Math.min(1 / fps, dur - f / fps));
    if (f % 15 === 0) onProgress?.(0.6 + 0.4 * f / frames);
  }
  vsrc.close();
  await output.finalize();
  input.dispose?.();
  coverBmp?.close();
  if (copy) notes.push("声音原样保留，没有重新编码。");
  return { blob: new Blob([output.target.buffer], { type: "video/mp4" }), outFmt: "mp4", notes };
}
