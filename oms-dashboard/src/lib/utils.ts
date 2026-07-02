export function formatINR(value: number | string | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// Myntra dates come as "31-01-2026 10:07:53" (dd-MM-yyyy) or ISO. Render friendly.
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const dmy = /^(\d{2})-(\d{2})-(\d{4})/.exec(value);
  const d = dmy ? new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// Newest-first ordering. The list summary carries no order date, but Myntra allocates
// orderId sequentially, so a descending numeric orderId is a reliable recency proxy.
export function sortByNewest<T extends { orderId: number | string }>(orders: T[]): T[] {
  return [...orders].sort((a, b) => {
    const na = Number(a.orderId); const nb = Number(b.orderId);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return nb - na;
    return String(b.orderId).localeCompare(String(a.orderId));
  });
}
