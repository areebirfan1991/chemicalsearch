// @ts-nocheck
import { useState, useCallback, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { logout } from "@/lib/gate.functions";
import * as XLSX from "xlsx";
import { processSpreadsheet, type FileData } from "@/lib/spreadsheet-reader";
import FileSaver from "file-saver";
const { saveAs } = FileSaver;
import {
  Search,
  Upload,
  Download,
  X,
  FileSpreadsheet,
  Loader2,
  ChevronDown,
  ChevronUp,
  LogOut,
} from "lucide-react";

// These are the fixed heading columns shown first when a row is expanded.
const HEADING_COLS = [
  "GD Number",
  "Item Description",
  "IMPORTAR",
  "origin",
  "VALUE",
  "Currency",
  "QUANTITY",
  "UOM",
  "IMPORTAR VALUE",
  "supplier",
];

// All file columns shown in the table (no cutoff).
const PRIMARY_COUNT = 9999;

type RowResult = {
  sheet: string;
  fileName: string;
  rowIndex: number;
  data: Record<string, string>;
  allFileHeaders: string[];
};

function HL({
  text,
  queries,
  caseSensitive,
}: {
  text: string;
  queries: string[];
  caseSensitive: boolean;
}) {
  const active = queries.filter((q) => q.trim());
  if (!active.length) return <>{text}</>;
  const pattern = active
    .map((q) => q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const parts = text.split(new RegExp(`(${pattern})`, caseSensitive ? "g" : "gi"));
  return (
    <>
      {parts.map((p, i) => {
        const hit = active.some((q) =>
          caseSensitive ? p === q.trim() : p.toLowerCase() === q.trim().toLowerCase()
        );
        return hit ? (
          <mark key={i} className="bg-primary/30 text-primary rounded-sm px-px">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </>
  );
}

export default function ChemSearch() {
  const router = useRouter();
  const doLogout = useServerFn(logout);
  const [files, setFiles] = useState<FileData[]>([]);
  const [query, setQuery] = useState("");
  const [aliasQuery, setAliasQuery] = useState("");
  const [results, setResults] = useState<RowResult[]>([]);
  const [primaryCols, setPrimaryCols] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [matchMode, setMatchMode] = useState<"contains" | "exact" | "starts">("contains");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processFile = processSpreadsheet;

  const handleFiles = async (incoming: FileList | File[] | null) => {
    if (!incoming || incoming.length === 0) return;
    setLoadingFiles(true);
    setUploadError(null);
    const loaded: FileData[] = [];
    const errors: string[] = [];
    for (const f of Array.from(incoming)) {
      try {
        loaded.push(await processFile(f));
      } catch (err) {
        console.error("Upload failed", f.name, err);
        errors.push(err instanceof Error ? err.message : `Couldn't open "${f.name}".`);
      }
    }
    if (errors.length) setUploadError(errors.join(" "));
    setFiles((prev) => {
      const next = [...prev, ...loaded];
      // Derive primary cols from the first sheet of the first file
      if (next.length > 0 && primaryCols.length === 0) {
        const firstSheets = Object.values(next[0].sheets);
        if (firstSheets.length > 0) {
          setPrimaryCols(firstSheets[0].headers.slice(0, PRIMARY_COUNT));
        }
      }
      return next;
    });
    setLoadingFiles(false);
  };

  const preloadStarted = useRef(false);
  const fetchPreload = useServerFn(getPreload);
  useEffect(() => {
    if (preloadStarted.current) return;
    preloadStarted.current = true;
    (async () => {
      const info = await fetchPreload().catch(() => null);
      if (!info) return;
      setLoadingFiles(true);
      try {
        const res = await fetch(info.url);
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        await handleFiles([new File([blob], info.name)]);
      } catch {
        setUploadError(`Couldn't load the preloaded file "${info.name}".`);
        setLoadingFiles(false);
      }
    })();
  }, []);

  const removeFile = (name: string) => {
    setFiles((prev) => {
      const next = prev.filter((f) => f.name !== name);
      if (next.length === 0) setPrimaryCols([]);
      return next;
    });
    setResults((prev) => prev.filter((r) => r.fileName !== name));
  };

  const matches = useCallback(
    (val: string, q: string) => {
      const v = caseSensitive ? val : val.toLowerCase();
      const qn = caseSensitive ? q.trim() : q.trim().toLowerCase();
      if (matchMode === "exact") return v === qn;
      if (matchMode === "starts") return v.startsWith(qn);
      return v.includes(qn);
    },
    [matchMode, caseSensitive]
  );

  const runSearch = useCallback(() => {
    if ((!query.trim() && !aliasQuery.trim()) || files.length === 0) return;
    setLoading(true);
    setSearched(true);
    setExpandedRows(new Set());

    setTimeout(() => {
      const found: RowResult[] = [];

      for (const file of files) {
        for (const [sheetName, { headers, rows }] of Object.entries(file.sheets)) {
          rows.forEach((row, ri) => {
            const vals = Object.values(row);
            const mainOk = query.trim() ? vals.some((v) => matches(v, query)) : true;
            const aliasOk = aliasQuery.trim() ? vals.some((v) => matches(v, aliasQuery)) : true;
            if (mainOk && aliasOk) {
              found.push({
                sheet: sheetName,
                fileName: file.name,
                rowIndex: ri + 2,
                data: row,
                allFileHeaders: headers,
              });
            }
          });
        }
      }

      setResults(found);
      setLoading(false);
    }, 0);
  }, [query, aliasQuery, files, matches]);

  const exportResults = () => {
    if (!results.length) return;
    const allHeaders: string[] = [];
    results.forEach((r) =>
      r.allFileHeaders.forEach((h) => {
        if (!allHeaders.includes(h)) allHeaders.push(h);
      })
    );
    const cols = ["Source File", "Sheet", "Original Row", ...allHeaders];
    const aoa = [
      cols,
      ...results.map((r) => [
        r.fileName,
        r.sheet,
        r.rowIndex,
        ...allHeaders.map((h) => r.data[h] ?? ""),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = cols.map((h, ci) => ({
      wch: Math.min(Math.max(h.length, ...aoa.slice(1).map((row) => String(row[ci] ?? "").length)) + 2, 50),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    saveAs(
      new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], {
        type: "application/octet-stream",
      }),
      `chem_search_${(query || aliasQuery).replace(/\s+/g, "_")}_results.xlsx`
    );
  };

  const toggleRow = (i: number) =>
    setExpandedRows((prev) => {
      const s = new Set(prev);
      s.has(i) ? s.delete(i) : s.add(i);
      return s;
    });

  const totalRows = files.reduce(
    (acc, f) => acc + Object.values(f.sheets).reduce((a, s) => a + s.rows.length, 0),
    0
  );

  const activeQueries = [query, aliasQuery].filter((q) => q.trim());

  return (
    <div
      className="min-h-screen bg-background text-foreground flex flex-col"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
            <FileSpreadsheet className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <div>
            <h1
              className="text-sm font-semibold tracking-tight leading-none"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              ChemSearch
            </h1>
            <p className="text-[11px] text-muted-foreground mt-0.5">Excel chemical compound finder</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {results.length > 0 && (
            <button
              onClick={exportResults}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded hover:bg-primary/90 transition-colors"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              <Download className="w-3.5 h-3.5" />
              Export {results.length} rows — single sheet
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              await doLogout();
              router.invalidate();
            }}
            className="flex items-center gap-2 px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 text-xs font-semibold rounded transition-colors"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            <LogOut className="w-3.5 h-3.5" />
            Log out
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col px-6 py-4 gap-4 min-h-0">
        {/* Controls */}
        <div className="flex-shrink-0 space-y-3">
          {/* Drop zone */}
          <label
            htmlFor="chem-file-input"
            className="block border border-dashed border-border rounded-lg p-5 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all"
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
            onDrop={(e) => { e.preventDefault(); handleFiles(Array.from(e.dataTransfer.files)); }}
          >
            <input
              id="chem-file-input"
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={(e) => {
                const input = e.currentTarget;
                const list = input.files ? Array.from(input.files) : [];
                handleFiles(list).finally(() => { input.value = ""; });
              }}
            />
            {loadingFiles ? (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-xs" style={{ fontFamily: "'DM Mono', monospace" }}>Parsing file…</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3">
                <Upload className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-xs">
                  Drop Excel files here or click to browse
                  <span className="text-muted-foreground ml-2">.xlsx · .xls · .csv — up to 300 MB</span>
                </span>
              </div>
            )}
          </label>
          {uploadError && (
            <p className="text-xs text-destructive" role="alert">{uploadError}</p>
          )}

          {/* File chips */}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[11px] text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>
                {totalRows.toLocaleString()} rows loaded
              </span>
              {files.map((f) => {
                const sc = Object.keys(f.sheets).length;
                const rc = Object.values(f.sheets).reduce((a, s) => a + s.rows.length, 0);
                return (
                  <div key={f.name} className="flex items-center gap-1.5 bg-secondary px-2.5 py-1 rounded text-[11px] border border-border">
                    <FileSpreadsheet className="w-3 h-3 text-primary flex-shrink-0" />
                    <span className="text-foreground max-w-[180px] truncate" style={{ fontFamily: "'DM Mono', monospace" }}>{f.name}</span>
                    <span className="text-muted-foreground">{sc}sh / {rc.toLocaleString()}r</span>
                    <button onClick={() => removeFile(f.name)} className="text-muted-foreground hover:text-destructive transition-colors">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Search row */}
          <div className="flex gap-2 items-center">
            {/* Main search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="Chemical name, CAS number, description…"
                className="w-full bg-input-background border border-border rounded-lg pl-10 pr-4 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-primary/50 transition-colors"
                style={{ fontFamily: "'DM Mono', monospace" }}
              />
            </div>

            {/* Alias search */}
            <div className="relative w-52">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={aliasQuery}
                onChange={(e) => setAliasQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="Other name / alias…"
                className="w-full bg-input-background border border-dashed border-border rounded-lg pl-8 pr-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-primary/50 transition-colors"
                style={{ fontFamily: "'DM Mono', monospace" }}
              />
            </div>

            {/* Match mode */}
            <div className="flex items-center gap-1 border border-border rounded-lg px-2 py-1 bg-input-background">
              {(["contains", "starts", "exact"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMatchMode(m)}
                  className={`text-[11px] px-2 py-0.5 rounded transition-colors ${matchMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  style={{ fontFamily: "'DM Mono', monospace" }}
                >
                  {m}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none" style={{ fontFamily: "'DM Mono', monospace" }}>
              <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} className="accent-primary" />
              Aa
            </label>

            <button
              onClick={runSearch}
              disabled={loading || files.length === 0 || (!query.trim() && !aliasQuery.trim())}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2 whitespace-nowrap"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search
            </button>
          </div>
        </div>

        {/* Results */}
        {searched && !loading && (
          <div className="flex-1 flex flex-col min-h-0">
            <div
              className="flex items-center justify-between text-[11px] text-muted-foreground mb-2 flex-shrink-0"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              <span>
                {results.length === 0
                  ? "No matches found"
                  : `${results.length.toLocaleString()} rows matched — click a row to expand all columns`}
              </span>
              {results.length > 0 && (
                <button onClick={exportResults} className="flex items-center gap-1.5 text-primary hover:underline">
                  <Download className="w-3 h-3" />
                  Export all to one sheet
                </button>
              )}
            </div>

            {results.length > 0 && primaryCols.length > 0 && (
              <div className="flex-1 min-h-0 border border-border rounded-lg overflow-hidden flex flex-col">
                <div className="overflow-auto flex-1">
                  <table className="text-xs border-collapse min-w-full">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-secondary border-b border-border">
                        {/* # col sticky */}
                        <th
                          className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap border-r border-border sticky left-0 bg-secondary z-20"
                          style={{ fontFamily: "'DM Mono', monospace", minWidth: 56 }}
                        >
                          #
                        </th>
                        {primaryCols.map((col) => (
                          <th
                            key={col}
                            className="text-left px-3 py-2 text-muted-foreground font-medium whitespace-nowrap border-r border-border last:border-r-0"
                            style={{ fontFamily: "'DM Mono', monospace", minWidth: 130 }}
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r, i) => {
                        const expanded = expandedRows.has(i);
                        return (
                          <>
                            {/* Collapsed row — primary cols only */}
                            <tr
                              key={`r${i}`}
                              onClick={() => toggleRow(i)}
                              className={`cursor-pointer border-b border-border transition-colors group ${expanded ? "bg-secondary/60" : "hover:bg-secondary/40"}`}
                            >
                              <td
                                className={`px-3 py-1.5 border-r border-border sticky left-0 z-10 transition-colors whitespace-nowrap ${expanded ? "bg-secondary/60" : "bg-background group-hover:bg-secondary/40"}`}
                                style={{ fontFamily: "'DM Mono', monospace" }}
                              >
                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                  {expanded
                                    ? <ChevronUp className="w-3 h-3 text-primary flex-shrink-0" />
                                    : <ChevronDown className="w-3 h-3 flex-shrink-0" />}
                                  <span>{i + 1}</span>
                                  <span className="opacity-40 text-[10px]">r{r.rowIndex}</span>
                                </div>
                              </td>
                              {primaryCols.map((col) => {
                                const val = r.data[col] ?? "";
                                return (
                                  <td
                                    key={col}
                                    className="px-3 py-1.5 border-r border-border last:border-r-0 max-w-[200px]"
                                    style={{ fontFamily: "'DM Mono', monospace" }}
                                  >
                                    <div className="truncate text-foreground">
                                      {val
                                        ? <HL text={val} queries={activeQueries} caseSensitive={caseSensitive} />
                                        : <span className="text-muted-foreground/30">—</span>}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>

                            {/* Expanded panel */}
                            {expanded && (() => {
                              // Map heading cols to their actual key in the file (case-insensitive, trimmed)
                              const resolvedHeadings = HEADING_COLS.map((hc) => ({
                                label: hc,
                                key: r.allFileHeaders.find(
                                  (fh) => fh.toLowerCase() === hc.toLowerCase()
                                ),
                              }));
                              // Extra cols = everything NOT matched by a heading col
                              const headingKeys = new Set(
                                resolvedHeadings.map((h) => h.key).filter(Boolean)
                              );
                              const extraCols = r.allFileHeaders.filter(
                                (fh) => !headingKeys.has(fh)
                              );

                              const renderCell = (val: string) =>
                                val
                                  ? <HL text={val} queries={activeQueries} caseSensitive={caseSensitive} />
                                  : <span className="text-muted-foreground/30">—</span>;

                              return (
                                <tr key={`e${i}`}>
                                  <td
                                    colSpan={1 + primaryCols.length}
                                    className="bg-muted/20 border-b border-border px-5 py-4"
                                  >
                                    {/* Row 1 — heading columns */}
                                    <p className="text-[10px] text-primary uppercase tracking-widest mb-2 font-medium" style={{ fontFamily: "'DM Mono', monospace" }}>
                                      Main fields
                                    </p>
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-3 mb-4">
                                      {resolvedHeadings.map(({ label, key }) => {
                                        const val = key ? (r.data[key] ?? "") : "";
                                        return (
                                          <div key={label}>
                                            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5" style={{ fontFamily: "'DM Mono', monospace" }}>{label}</div>
                                            <div className="text-xs text-foreground break-words" style={{ fontFamily: "'DM Mono', monospace" }}>{renderCell(val)}</div>
                                          </div>
                                        );
                                      })}
                                    </div>

                                    {/* Row 2 — all other columns */}
                                    {extraCols.length > 0 && (
                                      <>
                                        <div className="border-t border-border/40 mb-3" />
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2 font-medium" style={{ fontFamily: "'DM Mono', monospace" }}>
                                          Other fields
                                        </p>
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-3">
                                          {extraCols.map((col) => {
                                            const val = r.data[col] ?? "";
                                            return (
                                              <div key={col}>
                                                <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-0.5" style={{ fontFamily: "'DM Mono', monospace" }}>{col}</div>
                                                <div className="text-xs text-foreground break-words" style={{ fontFamily: "'DM Mono', monospace" }}>{renderCell(val)}</div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </>
                                    )}
                                  </td>
                                </tr>
                              );
                            })()}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footer */}
                <div
                  className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground flex items-center justify-between bg-secondary flex-shrink-0"
                  style={{ fontFamily: "'DM Mono', monospace" }}
                >
                  <span>{results.length.toLocaleString()} rows · {primaryCols.length} primary columns</span>
                  <button onClick={exportResults} className="flex items-center gap-1.5 text-primary hover:underline">
                    <Download className="w-3 h-3" />
                    Export .xlsx (1 sheet)
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {files.length === 0 && !loadingFiles && (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <FileSpreadsheet className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm">Upload one or more Excel files to begin searching</p>
            <p className="text-xs mt-1 opacity-60">Searches every column in every sheet</p>
          </div>
        )}
      </div>
    </div>
  );
}
