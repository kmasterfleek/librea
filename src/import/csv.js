// A dependency-free RFC-4180 CSV reader.
// Handles: quoted fields, embedded commas/newlines, doubled quotes ("" -> "),
// UTF-8 BOM, CRLF/CR/LF line endings, ragged rows, and tab/semicolon/pipe
// delimited files (auto-detected). Everything a district's SIS export throws
// at us should land here and come out as plain objects.

const DELIMITERS = [',', '\t', ';', '|'];
const MAX_CELL = 100_000;

export function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Count a character in the first logical line, ignoring quoted regions. */
function countOutsideQuotes(s, ch, limit = 8192) {
  let n = 0;
  let inQ = false;
  for (let i = 0; i < s.length && i < limit; i++) {
    const c = s[i];
    if (c === '"') {
      if (inQ && s[i + 1] === '"') { i++; continue; }
      inQ = !inQ;
      continue;
    }
    if (inQ) continue;
    if (c === '\n' || c === '\r') break;
    if (c === ch) n++;
  }
  return n;
}

/** Pick the delimiter that appears most often in the header line. */
export function detectDelimiter(text) {
  let best = ',';
  let bestN = 0;
  for (const d of DELIMITERS) {
    const n = countOutsideQuotes(text, d);
    if (n > bestN) { bestN = n; best = d; }
  }
  return best;
}

/** Full-text -> array of arrays of raw strings. */
export function parseTable(text, delimiter = ',') {
  const s = stripBom(String(text ?? ''));
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;   // this field opened with a quote
  let inQ = false;
  let i = 0;
  const endField = () => { row.push(field.slice(0, MAX_CELL)); field = ''; quoted = false; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"' && field === '' && !quoted) { inQ = true; quoted = true; i += 1; continue; }
    if (c === delimiter) { endField(); i += 1; continue; }
    if (c === '\r') { if (s[i + 1] === '\n') i += 1; endRow(); i += 1; continue; }
    if (c === '\n') { endRow(); i += 1; continue; }
    field += c; i += 1;
  }
  if (field !== '' || quoted || row.length) endRow();
  return rows;
}

const isBlankRow = (r) => r.every((c) => String(c).trim() === '');

/** Make headers safe, non-empty and unique. */
export function normalizeHeaders(raw) {
  const seen = new Map();
  return raw.map((h, i) => {
    let name = String(h ?? '').trim().replace(/^"+|"+$/g, '');
    if (!name) name = `column_${i + 1}`;
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    return n ? `${name}_${n + 1}` : name;
  });
}

/**
 * Parse CSV text into { headers, rows, delimiter, duplicateHeaders }.
 * `rows` are plain objects keyed by header; short rows are padded with ''.
 */
export function parseCsv(text, { delimiter } = {}) {
  const src = stripBom(String(text ?? ''));
  const d = delimiter || detectDelimiter(src);
  const table = parseTable(src, d).filter((r) => !isBlankRow(r));
  if (!table.length) return { headers: [], rows: [], delimiter: d, duplicateHeaders: [] };
  const rawHeaders = table[0];
  const headers = normalizeHeaders(rawHeaders);
  const duplicateHeaders = headers.filter((h, i) => h !== String(rawHeaders[i] ?? '').trim());
  const rows = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = String(cells[c] ?? '').trim();
    obj.__line = r + 1;
    rows.push(obj);
  }
  return { headers, rows, delimiter: d, duplicateHeaders };
}
