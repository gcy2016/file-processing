import { createRequire } from "node:module"; import { writeFileSync, mkdirSync } from "node:fs"; import { execSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)(process.env.PW || "playwright");
const page = await (await chromium.launch()).newPage();
page.on("pageerror", e => console.log("[pageerror]", e.message));
await page.goto((process.env.BASE || "http://localhost:8766/") + "tests/harness.html");
await page.waitForFunction(() => window.ready);
const cases = JSON.parse(process.argv[2]);
mkdirSync("out", { recursive: true });
for (const [name, fn, args] of cases) {
  const r = await page.evaluate(async ([name, fn, args]) => {
    const m = await import("../js/media.js");
    const f = await load(name); const from = await sniff(f);
    if (args.coverName) args.opts.cover = await load(args.coverName);
    const t0 = performance.now();
    try {
      const r = await m[fn]({ file: f, from, ...args }, () => {});
      const b = new Uint8Array(await r.blob.arrayBuffer());
      let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768));
      return { ok: true, ms: Math.round(performance.now() - t0), size: f.size, out: b.length, fmt: r.outFmt, notes: r.notes, b64: btoa(s) };
    } catch (e) { return { ok: false, err: e.message, stack: e.stack?.slice(0, 300) }; }
  }, [name, fn, args]);
  const label = `${name} ${fn} ${JSON.stringify(args)}`;
  if (!r.ok) { console.log("FAIL", label, r.err); continue; }
  const ext = r.fmt === "frames" ? "zip" : r.fmt;
  const p = `out/${name.replace(/\W/g, "_")}_${fn}_${args.to || args.mode || args.opts?.mode || ""}.${ext}`;
  writeFileSync(p, Buffer.from(r.b64, "base64"));
  let probe = "";
  try { probe = ext === "zip" ? execSync(`unzip -l ${p} | tail -1`).toString().trim() : execSync(`ffprobe -v error -show_entries stream=codec_name,width,height:format=duration -of compact ${p}`).toString().replace(/\n/g, " "); } catch (e) { probe = "PROBE FAIL"; }
  console.log("OK", label, `${r.size}->${r.out} ${r.ms}ms`, r.notes.join("|"), "::", probe);
}
process.exit(0);
