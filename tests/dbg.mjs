import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)(process.env.PW || "playwright");
const page = await (await chromium.launch()).newPage();
page.on("pageerror", e => console.log("[pageerror]", e.message));
page.on("console", m => console.log("[console]", m.text().slice(0,300)));
await page.goto("http://localhost:8765/tests/harness.html");
await page.waitForFunction(() => window.ready);
const code = process.argv[2];
console.log(await page.evaluate(new Function("return (async()=>{" + code + "})()")));
process.exit(0);
