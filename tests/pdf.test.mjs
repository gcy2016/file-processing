import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)(process.env.PW || "playwright");
const page = await (await chromium.launch()).newPage();
page.on("pageerror", e => console.log("[pageerror]", e.message));
await page.goto("http://localhost:8765/tests/harness.html");
await page.waitForFunction(() => window.ready);
const names = process.argv.length > 2 ? process.argv.slice(2) : ["photos.pdf", "text.pdf"];
const r = await page.evaluate(async (names) => {
  const out = [];
  for (const n of names) for (const mode of ["lossless","normal","strong"]) {
    const f = await load(n); const t0 = performance.now();
    try { const r = await runTool("pdf.compress", {file:f, mode}); out.push(`${n} ${mode}: ${f.size} -> ${r.blob.size} ${r.unchanged?"(unchanged)":""} ${Math.round(performance.now()-t0)}ms ${r.notes.join("|")}`); }
    catch (e) { out.push(`${n} ${mode}: FAIL ${e.message}`); }
  }
  return out;
}, names);
console.log(r.join("\n")); process.exit(0);
