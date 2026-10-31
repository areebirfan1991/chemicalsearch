import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { processSpreadsheet } from "./spreadsheet-reader";

describe("spreadsheet reader", () => {
  it("reads HTML saved as .xls across chunk and batch boundaries", async () => {
    const content = '<html><table><tr><th>Item</th><th>Code</th></tr>' +
      Array.from({ length: 270 }, (_, index) => `<tr><td>Acetone ${index}</td><td>${index}</td></tr>${" ".repeat(8000)}`).join("") +
      '</table></html>';
    const result = await processSpreadsheet(new File([content], "all 2026.xls"));
    expect(result.sheets.Sheet1.rows).toHaveLength(270);
    expect(result.sheets.Sheet1.rows[269]).toEqual({ Item: "Acetone 269", Code: "269" });
  });

  it("reads binary XLS and XLSX without interpreting them as HTML", async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Item"], ["Acetone"]]), "Imports");
    for (const bookType of ["xls", "xlsx"] as const) {
      const bytes = XLSX.write(book, { type: "array", bookType });
      const result = await processSpreadsheet(new File([bytes], `imports.${bookType}`));
      expect(result.sheets.Imports.rows[0]).toEqual({ Item: "Acetone" });
    }
  });

  it("keeps separate tables and decodes UTF-16 Excel exports", async () => {
    const text = '<html><table><tr><th>Item</th></tr><tr><td>Café</td></tr></table><table><tr><th>Item</th></tr><tr><td>Zinc</td></tr></table></html>';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([255, 254]);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < text.length; index++) view.setUint16(2 + index * 2, text.charCodeAt(index), true);
    const result = await processSpreadsheet(new File([bytes], "export.xls"));
    expect(result.sheets.Sheet1.rows[0].Item).toBe("Café");
    expect(result.sheets.Sheet2.rows[0].Item).toBe("Zinc");
  });
});