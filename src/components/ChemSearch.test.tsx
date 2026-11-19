import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileData } from "@/lib/spreadsheet-reader";

const { parse, getPreload } = vi.hoisted(() => ({ parse: vi.fn(), getPreload: vi.fn(async () => null) }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ invalidate: vi.fn() }) }));
vi.mock("@/lib/gate.functions", () => ({ logout: vi.fn(), getPreload }));
vi.mock("@/lib/spreadsheet-reader", () => ({ processSpreadsheet: parse }));
import ChemSearch from "./ChemSearch";

function parsed(name: string): FileData {
  return { name, sheets: { Imports: { headers: ["Item"], rows: [{ Item: "Acetone" }] } } };
}

afterEach(() => { cleanup(); parse.mockReset(); });

describe("multiple customer files", () => {
  it("keeps all four files selected together", async () => {
    parse.mockImplementation(async (file: File) => parsed(file.name));
    render(<ChemSearch />);
    fireEvent.change(screen.getByLabelText("Add Excel files"), {
      target: { files: [1, 2, 3, 4].map((n) => new File(["data"], `part${n}.xlsx`)) },
    });
    await waitFor(() => expect(screen.getByText("4 files · 4 rows loaded")).toBeInTheDocument());
    expect(parse).toHaveBeenCalledTimes(4);
  });

  it("keeps a second selection made while the first file is parsing", async () => {
    let complete: ((data: FileData) => void) | undefined;
    parse.mockImplementationOnce(() => new Promise<FileData>((resolve) => { complete = resolve; }));
    parse.mockImplementation(async (file: File) => parsed(file.name));
    render(<ChemSearch />);
    const input = screen.getByLabelText("Add Excel files");
    fireEvent.change(input, { target: { files: [new File(["data"], "first.xlsx")] } });
    fireEvent.change(input, { target: { files: [new File(["data"], "second.xlsx")] } });
    expect(parse).toHaveBeenCalledTimes(1);
    await act(async () => { complete?.(parsed("first.xlsx")); });
    await waitFor(() => expect(screen.getByText("2 files · 2 rows loaded")).toBeInTheDocument());
    expect(screen.getByText("first.xlsx")).toBeInTheDocument();
    expect(screen.getByText("second.xlsx")).toBeInTheDocument();
  });
});

describe("search text", () => {
  it("clears the typed text when the clear button is pressed", async () => {
    parse.mockImplementation(async (file: File) => parsed(file.name));
    render(<ChemSearch />);
    fireEvent.change(screen.getByLabelText("Add Excel files"), {
      target: { files: [new File(["data"], "part1.xlsx")] },
    });
    await waitFor(() => expect(screen.getByText("1 files · 1 rows loaded")).toBeInTheDocument());
    const box = screen.getByLabelText("Search chemicals") as HTMLInputElement;
    const alias = screen.getByLabelText("Search by other name or alias") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "Acetone" } });
    fireEvent.change(alias, { target: { value: "Propanone" } });
    expect(box.value).toBe("Acetone");
    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(box.value).toBe("");
    expect(alias.value).toBe("");
  });

  it("clears both search boxes with the Clear button beside Search", async () => {
    parse.mockImplementation(async (file: File) => parsed(file.name));
    render(<ChemSearch />);
    fireEvent.change(screen.getByLabelText("Add Excel files"), {
      target: { files: [new File(["data"], "part1.xlsx")] },
    });
    await waitFor(() => expect(screen.getByText("1 files · 1 rows loaded")).toBeInTheDocument());
    const box = screen.getByLabelText("Search chemicals") as HTMLInputElement;
    const alias = screen.getByLabelText("Search by other name or alias") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "Acetone" } });
    fireEvent.change(alias, { target: { value: "Propanone" } });
    const clear = screen.getByLabelText("Clear all search text");
    expect(clear).toBeEnabled();
    fireEvent.click(clear);
    expect(box.value).toBe("");
    expect(alias.value).toBe("");
  });
});