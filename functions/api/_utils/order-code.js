// functions/api/_utils/order-code.js
// Public-facing order code derived from the order's DB id + creation date —
// no new column needed, fully reconstructible from data already on the row.
// Format: MM-YYYYMMDD-0001
export function formatOrderCode(orderId, createdAt) {
  const iso = String(createdAt).includes('T') ? String(createdAt) : String(createdAt).replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `MM-${y}${m}${day}-${String(orderId).padStart(4, '0')}`;
}