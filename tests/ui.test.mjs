// 端到端：手机尺寸打开网页，走一遍压缩和转换流程，截图
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)(process.env.PW || "playwright");
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
const S = n => "samples/" + n;
const base = "http://localhost:8765/";
const wait = (sel, ms = 240000) => page.waitForFunction(s => {
  const st = [...document.querySelectorAll(".jobs .job-status")].map(e => e.textContent);
  return st.length && st.every(t => /^完成|^失败|^部分成功/.test(t));
}, sel, { timeout: ms });
const statuses = () => page.$$eval("#app > ul.jobs > li.job", lis => lis.map(li => li.querySelector(".job-name").textContent + " | " + li.querySelector(".job-status").textContent + " | " + (li.querySelector(".stats")?.textContent || "") + " | " + [...li.querySelectorAll(".sub li")].map(x => x.textContent).join(" / ")));

await page.goto(base);
await page.screenshot({ path: "out/ui_home.png", fullPage: true });

// 压缩
await page.click("a.choice:has-text('文件压缩')");
await page.setInputFiles(".pick input", [S("photo.jpg"), S("pic.heic"), S("big.png"), S("h264.mp4"), S("text.pdf"), S("utf8.zip"), S("rar4.rar"), S("doc.docx")]);
await page.waitForSelector("text=开始压缩");
await page.screenshot({ path: "out/ui_compress_pending.png", fullPage: true });
await page.click("button:has-text('开始压缩')");
await page.waitForTimeout(500);
await page.screenshot({ path: "out/ui_compress_running.png", fullPage: true });
await wait();
console.log("== 压缩（普通）\n" + (await statuses()).join("\n"));
await page.screenshot({ path: "out/ui_compress_done.png", fullPage: true });
const dl = page.waitForEvent("download");
await page.click("#app > ul.jobs > li.job >> nth=0 >> button:has-text('下载')");
console.log("download name:", (await dl).suggestedFilename());

// 强力
await page.goto(base + "#/compress");
await page.click("label:has-text('强力')");
await page.setInputFiles(".pick input", [S("photo.jpg"), S("h264.mp4"), S("t.7z")]);
await page.click("button:has-text('开始压缩')");
await wait();
console.log("== 压缩（强力）\n" + (await statuses()).join("\n"));

// 转换：HEIC → JPG（2 个）
await page.goto(base + "#/convert");
await page.setInputFiles(".pick input", [S("pic.heic"), S("rotated_gps.jpg")]);
await page.click(".targets button:has-text('JPG')").catch(async () => { await page.click(".targets button:has-text('PNG')"); });
await page.screenshot({ path: "out/ui_convert_targets.png", fullPage: true });
await page.click("button:has-text('开始转换')");
await wait();
console.log("== 转换 图片\n" + (await statuses()).join("\n"));

// 图片合成 PDF
await page.goto(base + "#/convert");
await page.setInputFiles(".pick input", [S("photo.jpg"), S("pic.heic"), S("alpha.png")]);
await page.click(".targets button:has-text('PDF')");
await page.click("button:has-text('开始转换')");
await wait();
console.log("== 合成 PDF\n" + (await statuses()).join("\n"));

// 视频 → MP3、MP3 → MP4（波形）、视频 → GIF、文档、表格、压缩包换格式、混合类型报错
for (const [files, label, extra] of [
  [["h264.mp4"], "MP3"], [["plain.mp3"], "MP4", "波形"], [["v.webm"], "GIF"], [["doc.docx"], "Markdown"],
  [["gbk.csv"], "Excel (XLSX)"], [["rar5.rar"], "7Z"], [["doc.md"], "Word (DOCX)"],
]) {
  await page.goto(base + "#/convert");
  await page.setInputFiles(".pick input", files.map(S));
  await page.click(`.targets button:text-is("${label}")`);
  if (extra) await page.click(`label:has-text("${extra}")`);
  await page.click("button:has-text('开始转换')");
  await wait();
  console.log(`== ${files} → ${label}\n` + (await statuses()).join("\n"));
}
await page.screenshot({ path: "out/ui_convert_done.png", fullPage: true });
await page.goto(base + "#/convert");
await page.setInputFiles(".pick input", [S("photo.jpg"), S("plain.mp3")]);
console.log("== 混合类型：", await page.textContent(".note.warn"));
for (const p of ["privacy", "terms", "source"]) { await page.goto(base + "#/" + p); await page.screenshot({ path: `out/ui_${p}.png`, fullPage: true }); }
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
console.log("横向溢出:", overflow, "\n页面错误:", errors.join("\n") || "无");
await browser.close();
