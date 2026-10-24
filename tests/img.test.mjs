import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)(process.env.PW || "playwright");
const page = await (await chromium.launch()).newPage();
page.on("console", m => console.log("[console]", m.text()));
page.on("pageerror", e => console.log("[pageerror]", e.message));
await page.goto((process.env.BASE || "http://localhost:8766/") + "tests/harness.html");
await page.waitForFunction(() => window.ready);
const r = await page.evaluate(async () => {
  const out = [];
  const t = async (label, fn) => { const t0 = performance.now(); try { const r = await fn(); out.push([label, "OK", Math.round(performance.now()-t0)+"ms", r]); } catch (e) { out.push([label, "FAIL", e.message]); } };
  for (const n of ["photo.jpg","rotated_gps.jpg","big.png","alpha.png","pic.webp","pic.tiff","pic.gif","pic.heic"]) {
    const f = await load(n); const fmt = await sniff(f);
    await t(n+" sniff", async () => fmt);
    for (const mode of ["normal","strong","lossless"]) await t(`${n} compress ${mode}`, async () => { const r = await runTool("image.compress", {file:f, fmt, mode}); return `${f.size} -> ${r.blob.size} ${r.outFmt}`; });
    for (const to of ["jpg","png","webp","avif","gif","tiff"]) if (to!==fmt) await t(`${n} -> ${to}`, async () => { const r = await runTool("image.convert", {file:f, from:fmt, to}); const bmp = to==="tiff"||to==="avif" ? null : await createImageBitmap(r.blob); return `${r.blob.size} ${r.width}x${r.height} ${bmp?bmp.width+"x"+bmp.height:""}`; });
  }
  await t("toPdf", async () => { const files = []; for (const n of ["photo.jpg","alpha.png","pic.heic"]) { const f = await load(n); files.push({file:f, fmt: await sniff(f)}); } const r = await runTool("image.toPdf", {files}); window.pdfOut = r.blob; return r.blob.size; });
  return out;
});
for (const row of r) console.log(row.join("  "));
process.exit(0);
