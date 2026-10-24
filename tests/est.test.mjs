// 压缩前预估 + 实际压缩对比；结果删除
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)(process.env.PW || "playwright");
const base = process.env.BASE || "http://localhost:8766/";
const b = await chromium.launch(); const page = await (await b.newContext(devices["iPhone 13"])).newPage();
page.on("pageerror", e => console.log("[pageerror]", e.message));
await page.goto(base + "#/compress");
const files = ["photo.jpg", "pic.heic", "big.png", "h264.mp4", "text.pdf", "utf8.zip"].map(n => "samples/" + n);
await page.setInputFiles(".pick input", files);
for (const mode of ["普通", "强力"]) {
  await page.click(`label:has-text('${mode}')`);
  await page.waitForFunction(() => document.querySelectorAll(".estimate").length >= 6 && ![...document.querySelectorAll(".estimate")].some(e => e.textContent.includes("正在估算")), null, { timeout: 120000 });
  console.log("== 预估（" + mode + "）\n" + (await page.$$eval(".estimate", es => es.map(e => e.closest("li").querySelector(".job-name").textContent + " | " + e.textContent))).join("\n"));
}
await page.screenshot({ path: "out/ui_estimate.png", fullPage: true });
await page.click("button:has-text('开始压缩')");
await page.waitForFunction(() => { const st = [...document.querySelectorAll("#app > ul.jobs .job-status")].map(e => e.textContent); return st.length === 6 && st.every(t => /^完成|^失败|^部分/.test(t)); }, null, { timeout: 300000 });
console.log("== 实际（强力）\n" + (await page.$$eval("#app > ul.jobs > li.job", ls => ls.map(l => l.querySelector(".job-name").textContent + " | " + l.querySelector(".stats").textContent))).join("\n"));
console.log("视频预览元素数：", await page.$$eval("#app > ul.jobs video", v => v.length));
await page.click("#app > ul.jobs > li.job >> nth=0 >> button.x");
console.log("删除一个后剩：", await page.$$eval("#app > ul.jobs > li.job", l => l.length));
await page.click("button:has-text('清空结果')");
console.log("清空后剩：", await page.$$eval("#app > ul.jobs > li.job", l => l.length));
await page.screenshot({ path: "out/ui_top.png", clip: { x: 0, y: 0, width: 390, height: 80 } });
await b.close();
