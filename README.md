# 轻压 · 文件压缩与格式转换

面向公众的免费网页工具（PRD：AI_Corp #27，版本 1.6）。**文件只在用户自己的浏览器里处理，不上传任何服务器。**
网站是纯静态网页，部署在 GitHub Pages；手机优先，以 iPhone Safari 为主要适配对象。

代码按 [GNU AGPL-3.0](LICENSE) 公开（因为 PDF 压缩用了 AGPL 许可的 Ghostscript）。

## 首版能力

状态：✅ 已实现并在桌面 Chromium 中自动测试通过；📱 需要在 iPhone 上实测；❌ 首版不提供。

### 文件压缩（普通 / 强力两档）

| 类型 | 普通 | 强力 | 说明 |
|---|---|---|---|
| JPG / WebP | MozJPEG q82 / WebP q80 | 质量更低，长边缩到 2048 | ✅ 清除 GPS 等附加信息，照片方向摆正 |
| PNG | oxipng 无损优化 | 减到 256 色 | ✅ |
| HEIC（iPhone 照片） | 输出 JPG | 输出 JPG，长边 2048 | ✅ 📱（浏览器无法生成 HEIC） |
| MP4 / MOV / WebM / MKV | H.264，短边 ≤1080 | 短边 ≤720、≤30 帧 | ✅ 📱 iPhone 的 HEVC 视频需在 Safari 实测 |
| PDF | qpdf 无损 + Ghostscript（图片 ≤300 dpi） | 图片 150 dpi | ✅ 核对页数；文字可搜索、链接保留；加密 PDF 报错 |
| ZIP / 7Z / TAR / TAR.GZ | 解包 → 包内文件无损优化 → 重新打包 | 包内图片 / PDF / 视频有损压缩 | ✅ 核对文件清单；嵌套最多 2 层 |
| RAR | 只读，默认输出 ZIP | 同左 | ✅ |

压缩后不比原文件小时，返回原文件并提示“已无法进一步压缩”。

### 格式转换

| 方向 | 状态 |
|---|---|
| 图片 JPG / PNG / WebP / GIF / TIFF / AVIF 互转，HEIC / BMP 读取 | ✅ |
| 图片 → PDF（可多张合成一个） | ✅ |
| 视频 MP4 / MOV / WebM / MKV / TS 互转（HEVC MOV → H.264 MP4） | ✅ 📱 |
| 视频 → 音频、→ GIF、→ 图片序列（ZIP） | ✅ |
| 音频 MP3 / M4A / AAC / WAV / FLAC / OGG 互转 | ✅ |
| MP3 等音频 → MP4（封面图 / 纯色 / 波形） | ✅ |
| DOCX / Markdown / HTML / EPUB / TXT 互转（pandoc，约 16 MB，用到时才下载） | ✅（部分：复杂排版会丢失） |
| CSV / JSON / XLSX 互转 | ✅ |
| 压缩包格式互转（ZIP / 7Z / TAR / TAR.GZ，RAR 只读） | ✅ |
| Office → PDF | ❌ 首版未上线：没有可以自行托管、在浏览器里稳定运行的 LibreOffice，评估后不上线（PRD 允许） |
| AVI 读取 | ❌ 所用音视频库不支持 AVI |
| PPTX 任何转换 | ❌ |

转换由能力注册表（`js/registry.js`）规划路径，最多 3 步（例如 HEIC → JPG → PDF）；每一步的输出按文件内容校验格式。

## 架构

```
index.html            页面骨架（首页 / 压缩 / 转换 / 隐私说明 / 使用条款 / 源代码与许可，# 路由）
css/app.css           样式（手机优先，跟随系统深色模式）
js/app.js             各页面
js/queue.js           任务队列与任务卡片（依次处理、"排队中，前面还有 N 个"、进度、下载 / 分享）
js/jobs.js            压缩、转换的分派；压缩包深度优化；输出校验
js/registry.js        能力注册表 + 路径规划
js/formats.js         格式表 + 按文件内容识别格式
js/media.js           音视频（主线程，Mediabunny + WebCodecs 硬件编解码）
js/worker.js          后台线程入口；每个任务新开一个，结束即关闭以释放内存
js/tools/*.js         后台线程里的工具：image / pdf / archive / doc / data
vendor/               第三方库打包结果（由 tools/vendor.mjs 生成，已提交，网页直接引用，不依赖外部 CDN）
tools/                第三方库的下载与打包脚本
tests/                测试样例生成脚本与自动化测试（Playwright）
```

设备上限（`js/env.js`，待实测后调整）：手机单文件 200 MB、电脑 500 MB，超过时提示但允许尝试；压缩包解压后手机 600 MB、电脑 2 GB，最多 1 万个文件，解压后超过原包 100 倍按解压炸弹拒绝。

## 部署到 GitHub Pages（Muse）

1. 代码需要放在**公开仓库**（AGPL 要求公开源代码；免费账号的私有仓库也不能开 Pages）。
2. 仓库 Settings → Pages → Source 选 “Deploy from a branch”，分支选 main，目录选 `/ (root)`，保存。
3. 几分钟后访问 `https://<用户名>.github.io/<仓库名>/`。
4. 换仓库时，把 `js/about.js` 里的 `SOURCE_URL` 改成新的公开仓库地址（页面底部“源代码与许可”会显示它）。当前是 `gcy2016/workspace-12`。

仓库里的 `pandoc.wasm` 约 56 MB，推送时 GitHub 会提示“超过 50 MB 建议值”，不影响使用（硬上限 100 MB）。

## 本地运行与测试

```bash
python3 -m http.server 8765          # 在仓库根目录；浏览器打开 http://localhost:8765
```

更新第三方库：`cd tools && npm install && npm run vendor`

自动化测试（需要 Playwright + Chromium、ffmpeg、pandoc）：

```bash
tests/make_samples.sh                # 生成测试样例到 tests/samples/
python3 -m http.server 8765 &        # 仓库根目录
cd tests
node img.test.mjs                    # 图片：压缩、互转、HEIC、转 PDF
node pdf.test.mjs photos.pdf text.pdf
node media.test.mjs '<用例 JSON>'    # 音视频，用法见文件内
node ui.test.mjs                     # 用 iPhone 13 尺寸走完整流程并截图到 tests/out/
```

## 已知限制

- 处理速度取决于设备；手机处理视频时切到后台或锁屏可能中断（页面会提示）。
- 部分电脑浏览器解码不了 iPhone 的 HEVC 视频，这时会明确报错，提示换 iPhone Safari 或新版 Chrome / Edge。
- 文档转换保留结构（标题、列表、表格、图片），字体、颜色、复杂排版可能丢失；转 Markdown / TXT 时不含图片本身。
- 包内文件保持原格式和文件名（例如包里的 HEIC 不会转成 JPG）。
- 文件修改时间、权限在重新打包后不保留。
