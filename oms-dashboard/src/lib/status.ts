// Full Myntra order-status map → SmartCommerce-style badge classes.
// New orders arrive with no status (null) — treated as RFR / "New".
type Tone = { label: string; cls: string };

export const STATUS_MAP: Record<string, Tone> = {
  RFR: { label: 'New', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  WP:  { label: 'In Progress', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PK:  { label: 'Packed', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  RTD: { label: 'Ready to Dispatch', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  RTS: { label: 'Ready to Ship', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  SH:  { label: 'Shipped', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  OFD: { label: 'Out for Delivery', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  DL:  { label: 'Delivered', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  IC:  { label: 'Cancelled', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  RTO: { label: 'Return to Origin', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  RT:  { label: 'Returned', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  L:   { label: 'Lost', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export function statusInfo(code: string | null | undefined): { code: string; label: string; cls: string } {
  if (code == null || code === '') return { code: 'RFR', ...STATUS_MAP.RFR };
  const key = String(code).toUpperCase();
  if (STATUS_MAP[key]) return { code: key, ...STATUS_MAP[key] };
  return { code: key, label: key, cls: 'bg-zinc-100 text-zinc-700 border-zinc-200' };
}

export const isNewStatus = (code: string | null | undefined): boolean =>
  code == null || code === '' || String(code).toUpperCase() === 'RFR';

export type ActionKey = 'accept' | 'reject' | 'ready_to_dispatch' | 'ready_to_ship' | 'cancel';

export const ACTION_META: Record<ActionKey, { label: string; variant: 'primary' | 'danger' | 'neutral' }> = {
  accept:            { label: 'Accept', variant: 'primary' },
  reject:            { label: 'Reject', variant: 'danger' },
  ready_to_dispatch: { label: 'Ready to Dispatch', variant: 'primary' },
  ready_to_ship:     { label: 'Ready to Ship', variant: 'primary' },
  cancel:            { label: 'Cancel', variant: 'danger' },
};

// Which actions make sense for a given status (drives the modal footer).
export function allowedActions(code: string | null | undefined): ActionKey[] {
  const s = code == null ? 'RFR' : String(code).toUpperCase();
  switch (s) {
    case 'RFR': return ['accept', 'reject', 'cancel'];
    case 'WP':  return ['ready_to_dispatch', 'cancel'];
    case 'PK':
    case 'RTD': return ['ready_to_ship', 'cancel'];
    case 'SH':
    case 'DL':
    case 'IC':
    case 'RTO': return [];
    default:    return ['accept', 'reject', 'ready_to_dispatch', 'ready_to_ship', 'cancel'];
  }
}
