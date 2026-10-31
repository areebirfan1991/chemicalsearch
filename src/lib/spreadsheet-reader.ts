import * as XLSX from "xlsx";

export type FileData = {
  name: string;
  sheets: Record<string, { headers: string[]; rows: Record<string, string>[] }>;
};

async function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("No file bytes were returned."));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function textEncoding(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return "utf-8";
}

// Excel exports can contain HTML despite the .xls extension. Never convert
// their entire byte buffer to a string: older SheetJS does that internally.
async function readHtml(file: File, encoding: string): Promise<FileData> {
  const sheets: FileData["sheets"] = {};
  const decoder = new TextDecoder(encoding);
  let pending = "";
  let table = 0;
  let inTable = false;
  let batch: string[] = [];
  let spanRemaining = 0;
  let headers: string[] | undefined;
  let rows: Record<string, string>[] = [];

  const flush = () => {
    if (!batch.length) return;
    const workbook = XLSX.read(`<table>${batch.join("")}</table>`, {
      type: "string", dense: true, cellDates: true,
    });
    const name = workbook.SheetNames[0];
    if (!name) return;
    const sheet = workbook.Sheets[name];
    if (!sheet) return;
    const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1, defval: "", raw: false, blankrows: false,
    });
    for (const cells of values) {
      if (!headers) {
        const used = new Set<string>();
        headers = cells.map((cell) => {
          const base = String(cell ?? "").trim() || "__EMPTY";
          let key = base;
          let suffix = 1;
          while (used.has(key)) key = `${base}_${suffix++}`;
          used.add(key);
          return key;
        });
        continue;
      }
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = String(cells[index] ?? "").trim();
      });
      rows.push(row);
    }
    batch = [];
  };
  const finishTable = () => {
    flush();
    if (headers && rows.length) sheets[`Sheet${table}`] = { headers, rows };
    headers = undefined;
    rows = [];
    spanRemaining = 0;
    inTable = false;
  };

  for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
    const bytes = await readBytes(file.slice(offset, offset + 1024 * 1024));
    pending += decoder.decode(bytes, { stream: true });
    if (offset + 1024 * 1024 >= file.size) pending += decoder.decode();
    while (pending) {
      const start = /<table\b[^>]*>|<\/table\s*>|<tr\b/i.exec(pending);
      if (!start) {
        // Preserve a tag split across two chunks, not surrounding export markup.
        pending = pending.slice(-32);
        break;
      }
      pending = pending.slice(start.index);
      if (/^<tr\b/i.test(pending)) {
        const end = /<\/tr\s*>/i.exec(pending);
        if (!end) break;
        const row = pending.slice(0, end.index + end[0].length);
        pending = pending.slice(end.index + end[0].length);
        if (!inTable) continue;
        batch.push(row);
        spanRemaining = Math.max(0, spanRemaining - 1);
        for (const match of row.matchAll(/\browspan\s*=\s*["']?(\d+)/gi)) {
          spanRemaining = Math.max(spanRemaining, Number(match[1]) - 1);
        }
        if (batch.length >= 128 && spanRemaining === 0) flush();
      } else {
        const closing = /^<\/table/i.test(pending);
        pending = pending.slice(start[0].length);
        if (closing) finishTable();
        else {
          if (inTable) finishTable();
          table += 1;
          inTable = true;
        }
      }
    }
    // Yield between chunks so Chrome remains responsive during large imports.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (inTable) finishTable();
  if (!Object.keys(sheets).length) throw new Error("No spreadsheet rows were found in the Excel export.");
  return { name: file.name, sheets };
}

export async function processSpreadsheet(file: File): Promise<FileData> {
  try {
    const prefix = new Uint8Array(await readBytes(file.slice(0, 65536)));
    const binary = (prefix[0] === 0xd0 && prefix[1] === 0xcf) ||
      (prefix[0] === 0x50 && prefix[1] === 0x4b) || prefix[0] === 0x09;
    const encoding = textEncoding(prefix);
    if (!binary && /<(?:html|table)\b/i.test(new TextDecoder(encoding).decode(prefix))) {
      return await readHtml(file, encoding);
    }
    const bytes = await readBytes(file);
    const csv = /\.csv$/i.test(file.name);
    const workbook = csv
      ? XLSX.read(new TextDecoder(encoding).decode(bytes), { type: "string", cellDates: true, dense: true })
      : XLSX.read(new Uint8Array(bytes), { type: "array", cellDates: true, dense: true });
    const sheets: FileData["sheets"] = {};
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      const values = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
      const first = values[0];
      if (!first) continue;
      const original = Object.keys(first);
      const headers = original.map((header) => header.trim());
      const rows = values.map((value) => Object.fromEntries(original.map((key, index) =>
        [headers[index], String(value[key] ?? "").trim()])));
      sheets[name] = { headers, rows };
    }
    return { name: file.name, sheets };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown file reading error";
    if (/memory|allocation|array length|string length|stack/i.test(detail)) {
      throw new Error(`Chrome ran out of memory while opening "${file.name}". Save it as CSV or split it into smaller files, then retry.`);
    }
    throw new Error(`Couldn't open "${file.name}": ${detail}. If it opens in Excel, save a new copy as .xlsx or .csv and retry.`);
  }
}