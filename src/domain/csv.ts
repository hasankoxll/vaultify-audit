export class CsvParseError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "CsvParseError";
    this.code = code;
  }
}

export interface CsvRecord {
  rowNumber: number;
  cells: string[];
}

export interface CsvTable {
  headers: string[];
  records: CsvRecord[];
}

export interface CsvLimits {
  maxColumns?: number;
  maxCellLength?: number;
  maxRows?: number;
}

export function parseCsv(text: string, limits: CsvLimits = {}): CsvTable {
  const maxColumns = limits.maxColumns ?? 50;
  const maxCellLength = limits.maxCellLength ?? 5_000;
  const maxRows = limits.maxRows ?? 100_000;
  let src = text;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  if (src.includes("\u0000")) throw new CsvParseError("nul_byte");

  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let recordCount = 0;

  const pushCell = () => {
    if (cell.length > maxCellLength) throw new CsvParseError("cell_too_long");
    row.push(cell);
    cell = "";
    if (row.length > maxColumns) throw new CsvParseError("too_many_columns");
  };

  const pushRow = () => {
    records.push(row);
    row = [];
    recordCount += 1;
    if (recordCount > maxRows + 1) throw new CsvParseError("too_many_rows");
  };

  for (let i = 0; i < src.length; i += 1) {
    const char = src[i] ?? "";
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          if (cell.length > maxCellLength) throw new CsvParseError("cell_too_long");
          i += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      cell += char;
      if (cell.length > maxCellLength) throw new CsvParseError("cell_too_long");
      continue;
    }
    if (char === '"') {
      if (cell.length !== 0) throw new CsvParseError("invalid_csv");
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      pushCell();
      continue;
    }
    if (char === "\n" || char === "\r") {
      pushCell();
      pushRow();
      if (char === "\r" && src[i + 1] === "\n") i += 1;
      continue;
    }
    cell += char;
    if (cell.length > maxCellLength) throw new CsvParseError("cell_too_long");
  }
  if (inQuotes) throw new CsvParseError("invalid_csv");
  if (cell.length > 0 || row.length > 0) {
    pushCell();
    pushRow();
  }
  if (records.length === 0) throw new CsvParseError("empty_csv");

  const headerCells = records[0] ?? [];
  const headers = headerCells.map((header) => header.trim());
  if (headers.length === 0 || headers.some((header) => header.length === 0)) throw new CsvParseError("empty_header");
  if (new Set(headers).size !== headers.length) throw new CsvParseError("duplicate_header");

  const data: CsvRecord[] = [];
  for (let index = 1; index < records.length; index += 1) {
    const cells = records[index] ?? [];
    if (cells.every((value) => value === "")) continue;
    data.push({ rowNumber: index + 1, cells });
  }
  return { headers, records: data };
}

const FORMULA_START = /^[\t\r\n=+@-]|^\s+[=+@-]/;

export function protectFormula(value: string): string {
  if (FORMULA_START.test(value)) return `'${value}`;
  return value;
}

export function encodeCsv(rows: string[][]): string {
  const lines = rows.map((row) => row.map(encodeCell).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function encodeCell(value: string): string {
  const safe = protectFormula(value);
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function recordsToObjects(headers: string[], cells: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = cells[index] ?? "";
  });
  return record;
}
