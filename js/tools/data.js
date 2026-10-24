// 表格数据互转：CSV / JSON / XLSX，用 SheetJS（在后台线程运行）
import { UserError } from "../util.js";

let X;
const xlsx = async () => X ??= await import("../../vendor/xlsx.js");

async function readText(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  for (const enc of ["utf-8", "gb18030"]) {   // Excel 导出的中文 CSV 常是 GBK
    try { return new TextDecoder(enc, { fatal: true }).decode(buf); } catch {}
  }
  throw new UserError("这个文件的文字编码认不出来。");
}

// CSV 一律先按文本读，再把"像数字"的转成数字；以 0 开头的编号、超过 15 位的长数字（身份证、手机号等）保持文本
const NUM = /^-?(0|[1-9]\d{0,14})(\.\d+)?$/;
function typeCells(ws) {
  for (const addr of Object.keys(ws)) {
    if (addr[0] === "!") continue;
    const c = ws[addr];
    if (c.t === "s" && NUM.test(c.v.trim())) { c.v = Number(c.v); c.t = "n"; delete c.w; }
  }
}

async function readBook(file, from) {
  const XL = await xlsx();
  if (from === "xlsx") return XL.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const text = await readText(file);
  if (from === "csv") {
    const wb = XL.read(text.replace(/^﻿/, ""), { type: "string", raw: true });
    typeCells(wb.Sheets[wb.SheetNames[0]]);
    return wb;
  }
  // JSON：对象数组 / 二维数组 / { 工作表名: 数组 }
  let data;
  try { data = JSON.parse(text.replace(/^﻿/, "")); } catch { throw new UserError("JSON 格式有误，读不出来。"); }
  const wb = XL.utils.book_new();
  const toSheet = rows => {
    if (!Array.isArray(rows)) throw new UserError("JSON 需要是数组（每行一个对象或一个数组），才能转成表格。");
    const flat = rows.map(r => r && typeof r === "object" && !Array.isArray(r)
      ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && typeof v === "object" ? JSON.stringify(v) : v]))
      : r);
    return Array.isArray(flat[0]) ? XL.utils.aoa_to_sheet(flat) : XL.utils.json_to_sheet(flat);
  };
  if (Array.isArray(data)) XL.utils.book_append_sheet(wb, toSheet(data), "Sheet1");
  else if (data && typeof data === "object" && Object.values(data).every(Array.isArray)) {
    for (const [name, rows] of Object.entries(data)) XL.utils.book_append_sheet(wb, toSheet(rows), name.slice(0, 31) || "Sheet");
  } else throw new UserError("JSON 需要是数组（每行一个对象或一个数组），才能转成表格。");
  return wb;
}

export async function convert({ file, from, to }) {
  const XL = await xlsx();
  const wb = await readBook(file, from);
  if (!wb.SheetNames.length) throw new UserError("文件里没有数据。");
  const notes = [];
  let blob;
  if (to === "xlsx") {
    blob = new Blob([XL.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  } else if (to === "csv") {
    if (wb.SheetNames.length > 1) notes.push(`共有 ${wb.SheetNames.length} 个工作表，CSV 只能放一个，导出的是第一个“${wb.SheetNames[0]}”。`);
    const csv = XL.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { blankrows: false });
    blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });   // 带 BOM，Excel 打开中文不乱码
  } else if (to === "json") {
    const rows = n => XL.utils.sheet_to_json(wb.Sheets[n], { defval: "", raw: true });
    const data = wb.SheetNames.length > 1 ? Object.fromEntries(wb.SheetNames.map(n => [n, rows(n)])) : rows(wb.SheetNames[0]);
    if (wb.SheetNames.length > 1) notes.push("有多个工作表，JSON 按工作表名分组。");
    blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  } else throw new UserError("不支持输出为 " + to);
  if (from === "xlsx") notes.push("只转换数据，不保留单元格格式和图表；公式保留计算结果。");
  return { blob, notes };
}
