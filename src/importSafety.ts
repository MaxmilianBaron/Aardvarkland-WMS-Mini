export const IMPORT_LIMITS = { bytes: 5 * 1024 * 1024, rows: 20_000, columns: 32, cell: 8192, expandedBytes: 50 * 1024 * 1024 } as const;

export function validateRows(rows: unknown[][]): void {
  if (rows.length > IMPORT_LIMITS.rows + 1) throw new Error('IMPORT_TOO_MANY_ROWS');
  for (const row of rows) {
    if (row.length > IMPORT_LIMITS.columns) throw new Error('IMPORT_TOO_MANY_COLUMNS');
    for (const cell of row) {
      if (cell != null && typeof cell === 'object' && !(cell instanceof Date)) throw new Error('IMPORT_UNSUPPORTED_CELL');
      if (String(cell ?? '').length > IMPORT_LIMITS.cell) throw new Error('IMPORT_CELL_TOO_LONG');
    }
  }
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\ufeff/, '');
  const counts = new Map([[',', 0], [';', 0], ['\t', 0]]);
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted && (c === '\r' || c === '\n')) break;
    else if (!quoted && counts.has(c)) counts.set(c, counts.get(c)! + 1);
  }
  const delimiter = [...counts].sort((a,b) => b[1]-a[1])[0][0];
  const out: string[][] = [];
  let row: string[] = []; let cell = ''; let mode: 'plain' | 'quoted' | 'closed' = 'plain';
  const pushCell = () => { row.push(cell); cell = ''; mode = 'plain'; if (row.length > IMPORT_LIMITS.columns) throw new Error('IMPORT_TOO_MANY_COLUMNS'); };
  const pushRow = () => { pushCell(); out.push(row); row = []; if (out.length > IMPORT_LIMITS.rows + 1) throw new Error('IMPORT_TOO_MANY_ROWS'); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (mode === 'quoted') {
      if (c === '"') { if (text[i+1] === '"') { cell += '"'; i++; } else mode = 'closed'; }
      else cell += c;
    } else if (c === delimiter) pushCell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; pushRow(); }
    else if (c === '"' && !cell && mode === 'plain') mode = 'quoted';
    else if (mode === 'closed' || c === '"') throw new Error('MALFORMED_CSV');
    else cell += c;
    if (cell.length > IMPORT_LIMITS.cell) throw new Error('IMPORT_CELL_TOO_LONG');
  }
  if (mode === 'quoted') throw new Error('MALFORMED_CSV');
  if (cell || row.length || mode === 'closed') pushRow();
  return out;
}

// Reports are for viewing in spreadsheet programs, not lossless re-import.
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (typeof value !== 'number' && /^[\s\ufeff]*[=+\-@＝＋－＠]/u.test(text)) text = '\t' + text;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function validateXlsxArchive(buffer: ArrayBuffer): Promise<void> {
  const bytes = new Uint8Array(buffer); const view = new DataView(buffer);
  if (bytes.length > IMPORT_LIMITS.bytes || bytes.length < 22) throw new Error('INVALID_XLSX');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0 || view.getUint16(end+4,true) || view.getUint16(end+6,true)) throw new Error('INVALID_XLSX');
  const entries = view.getUint16(end+10,true); const centralSize = view.getUint32(end+12,true);
  let offset = view.getUint32(end+16,true); const centralStart = offset;
  if (entries > 500 || entries === 65535 || offset + centralSize !== end) throw new Error('INVALID_XLSX');
  let expanded = 0;
  for (let i=0;i<entries;i++) {
    if (offset + 46 > end || view.getUint32(offset,true) !== 0x02014b50) throw new Error('INVALID_XLSX');
    const flags=view.getUint16(offset+8,true), method=view.getUint16(offset+10,true);
    const compressed=view.getUint32(offset+20,true), uncompressed=view.getUint32(offset+24,true);
    const nameLength=view.getUint16(offset+28,true), extra=view.getUint16(offset+30,true), comment=view.getUint16(offset+32,true);
    const local=view.getUint32(offset+42,true);
    if ((flags & 1) || ![0,8].includes(method) || uncompressed > IMPORT_LIMITS.expandedBytes || local+30 > centralStart) throw new Error('INVALID_XLSX');
    if (view.getUint32(local,true) !== 0x04034b50 || view.getUint16(local+8,true)!==method) throw new Error('INVALID_XLSX');
    const dataStart=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
    if (dataStart+compressed > centralStart || offset+46+nameLength+extra+comment > end) throw new Error('INVALID_XLSX');
    expanded += uncompressed;
    if (expanded > IMPORT_LIMITS.expandedBytes) throw new Error('XLSX_EXPANSION_LIMIT');
    const payload=bytes.slice(dataStart,dataStart+compressed);
    let actual=0;
    if (method===0) actual=payload.length;
    else {
      if (typeof DecompressionStream === 'undefined') throw new Error('XLSX_DECOMPRESSION_UNAVAILABLE');
      const reader=new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      try {
        for (;;) { const part=await reader.read(); if (part.done) break; actual+=part.value.byteLength;
          if (actual > uncompressed || actual > IMPORT_LIMITS.expandedBytes) { await reader.cancel(); throw new Error('XLSX_EXPANSION_LIMIT'); }
        }
      } finally { reader.releaseLock(); }
    }
    if (actual!==uncompressed) throw new Error('INVALID_XLSX');
    offset+=46+nameLength+extra+comment;
  }
  if (offset!==end) throw new Error('INVALID_XLSX');
}
