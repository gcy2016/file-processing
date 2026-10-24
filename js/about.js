// 源代码地址与第三方工具许可（"源代码与许可"页面用）
// 公开源代码仓库（AGPL 要求）
export const SOURCE_URL = "https://github.com/gcy2016/file-processing";

// [名称, 项目地址, 用途, 许可]
export const LIBRARIES = [
  ["Mediabunny", "https://github.com/Vanilagy/mediabunny", "音视频读取、转换、压缩", "MPL-2.0"],
  ["@mediabunny/mp3-encoder（LAME）", "https://github.com/Vanilagy/mediabunny", "MP3 编码", "MPL-2.0；LAME 为 LGPL-2.0"],
  ["@mediabunny/aac-encoder（FFmpeg AAC）", "https://github.com/Vanilagy/mediabunny", "AAC 编码（浏览器不支持时）", "MPL-2.0；FFmpeg 为 LGPL-2.1"],
  ["@mediabunny/flac-encoder（libFLAC）", "https://github.com/Vanilagy/mediabunny", "FLAC 编码", "MPL-2.0；libFLAC 为 BSD-3-Clause"],
  ["Ghostscript 9.56（ghostscript-wasm）", "https://github.com/jsscheller/ghostscript-wasm", "PDF 压缩", "AGPL-3.0"],
  ["qpdf（qpdf-wasm）", "https://github.com/neslinesli93/qpdf-wasm", "PDF 无损优化、页数校验", "Apache-2.0 / ISC"],
  ["7-Zip（7z-wasm）", "https://github.com/use-strict/7z-wasm", "压缩包解包、打包", "LGPL-2.1；RAR 解压代码受 unRAR 许可限制"],
  ["jSquash（MozJPEG、libwebp、libavif、oxipng）", "https://github.com/jamsinclair/jSquash", "图片编码与优化", "Apache-2.0；各编解码器为 BSD / MIT 类许可"],
  ["libheif-js（libheif、libde265）", "https://github.com/catdad-experiments/libheif-js", "读取 iPhone 的 HEIC 照片", "LGPL-3.0"],
  ["UPNG.js（pako）", "https://github.com/photopea/UPNG.js", "PNG 减色", "MIT"],
  ["UTIF.js", "https://github.com/photopea/UTIF.js", "TIFF 读写", "MIT"],
  ["gifenc", "https://github.com/mattdesl/gifenc", "GIF 生成", "MIT"],
  ["pdf-lib", "https://github.com/Hopding/pdf-lib", "图片合成 PDF", "MIT"],
  ["fflate", "https://github.com/101arrowz/fflate", "打包下载 ZIP", "MIT"],
  ["pandoc（pandoc-wasm）", "https://github.com/jgm/pandoc", "文档互转", "GPL-2.0-or-later"],
  ["SheetJS Community Edition", "https://github.com/SheetJS/sheetjs", "表格数据互转、表格转 PDF", "Apache-2.0"],
  ["docx-preview", "https://github.com/VolodymyrBaydalka/docxjs", "Word 转 PDF 时渲染文档", "Apache-2.0"],
  ["html2canvas-pro", "https://github.com/yorickshan/html2canvas-pro", "文档转 PDF 时截取页面", "MIT"],
  ["PDF.js", "https://github.com/mozilla/pdf.js", "PDF 转 Word 时提取文字", "Apache-2.0"],
  ["Tesseract.js（Tesseract OCR）", "https://github.com/naptha/tesseract.js", "扫描版 PDF 文字识别", "Apache-2.0"],
  ["docx", "https://github.com/dolanmiu/docx", "生成 Word 文档", "MIT"],
  ["Pyodide", "https://github.com/pyodide/pyodide", "在浏览器里运行 Python", "MPL-2.0"],
  ["python-can（packaging、typing_extensions）", "https://github.com/hardbyte/python-can", "BLF 转 ASC / CSV / TXT", "LGPL-3.0（依赖为 Apache-2.0 / BSD、PSF）"],
];
