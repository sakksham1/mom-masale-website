// functions/api/_utils/export.js
// Shared CSV/JSON serialization for admin data exports. No external CSV
// library — Workers bundle size matters, and RFC 4180 escaping is simple
// enough to hand-roll. Every export endpoint under /api/admin/export/*
// reuses these three helpers so filename conventions and escaping stay
// identical across resources.
 
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
 
// columns: [{ key, header }]. Callers must pre-flatten rows (one row per
// CSV line) before calling this — no dotted-path/nested lookup here.
export function toCsv(rows, columns) {
  const headerLine = columns.map(c => csvEscape(c.header)).join(',');
  const lines = rows.map(row => columns.map(c => csvEscape(row[c.key])).join(','));
  // UTF-8 BOM so Excel renders ₹ and non-ASCII names correctly instead of
  // mangling them under its default codepage guess.
  return '\uFEFF' + [headerLine, ...lines].join('\r\n') + '\r\n';
}
 
export function csvResponse(content, filename) {
  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
 
export function jsonDownloadResponse(data, filename) {
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
 
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
 
export function exportFilename(resource, ext) {
  return `${resource}-${todayISO()}.${ext}`;
}