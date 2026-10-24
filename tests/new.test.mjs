// 新增转换：文档 → PDF、PDF → Word / TXT、BLF → ASC / CSV / TXT
import { createRequire } from "node:module"; import { writeFileSync, mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)(process.env.PW || "playwright");
const base = process.env.BASE || "http://localhost:8766/";
const page = await (await chromium.launch()).newPage();
page.on("pageerror", e => console.log("[pageerror]", e.message));
await page.goto(base + "tests/harness.html");
await page.waitForFunction(() => window.ready);
mkdirSync("out", { recursive: true });
const cases = process.argv[2] ? JSON.parse(process.argv[2]) : [
  ["zh.docx", "pdf"], ["doc.docx", "pdf"], ["book.xlsx", "pdf"], ["gbk.csv", "pdf"], ["deck.pptx", "pdf"], ["doc.md", "pdf"], ["doc.html", "pdf"],
  ["zh_text.pdf", "docx"], ["zh_text.pdf", "txt"], ["text.pdf", "docx"], ["scan.pdf", "docx"],
  ["can.blf", "asc"], ["can.blf", "csv"], ["can.blf", "txt"],
];
for (const [name, to] of cases) {
  const r = await page.evaluate(async ([name, to]) => {
    const { convertFile } = await import("../js/jobs.js");
    const f = await load(name); const from = await sniff(f); const t0 = performance.now();
    try {
      const r = await convertFile({ file: f, from, to }, () => {});
      const b = new Uint8Array(await r.blob.arrayBuffer());
      let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768));
      return { ok: true, from, ms: Math.round(performance.now() - t0), size: b.length, notes: r.notes, b64: btoa(s) };
    } catch (e) { return { ok: false, from, err: e.message }; }
  }, [name, to]);
  if (!r.ok) { console.log("FAIL", name, "→", to, r.err); continue; }
  const out = `out/new_${name.replace(/\W/g, "_")}.${to}`;
  writeFileSync(out, Buffer.from(r.b64, "base64"));
  console.log("OK", name, `[${r.from}] →`, to, r.size, r.ms + "ms", "|", r.notes.join(" / "), "→", out);
}
process.exit(0);
