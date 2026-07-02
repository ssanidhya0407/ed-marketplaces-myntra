// Myntra order-status map.
// Documented status values (myntradeveloper.md §Order Search): RFR, WP, IC, PK, SH, DL.
// Observed-but-undocumented: C (terminal/closed — old completed orders carry it).
type Tone = { label: string; cls: string };

export const STATUS_MAP: Record<string, Tone> = {
  RFR: { label: 'New', cls: 'bg-blue-50 text-blue-700 border-blue-200' },       // Ready For RTD
  WP:  { label: 'In Progress', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PK:  { label: 'Packed', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  SH:  { label: 'Shipped', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  S:   { label: 'Shipped', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }, // detail uses 'S'; list uses 'SH'
  DL:  { label: 'Delivered', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  D:   { label: 'Delivered', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  IC:  { label: 'Cancelled', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  C:   { label: 'Completed', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200' }, // undocumented, terminal
  // extra codes we may encounter
  RTD: { label: 'Ready to Dispatch', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  RTO: { label: 'Return to Origin', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
};

export function statusInfo(code: string | null | undefined): { code: string; label: string; cls: string } {
  // A blank summary status is NOT reliably "new" — the list omits status for closed
  // orders. Treat unknown/blank as "Unknown" unless the caller passes the detail code.
  if (code == null || code === '') return { code: '', label: 'Unknown', cls: 'bg-zinc-100 text-zinc-500 border-zinc-200' };
  const key = String(code).toUpperCase();
  if (STATUS_MAP[key]) return { code: key, ...STATUS_MAP[key] };
  return { code: key, label: key, cls: 'bg-zinc-100 text-zinc-700 border-zinc-200' };
}

// Genuinely-new = Myntra status RFR only.
export const isNewStatus = (code: string | null | undefined): boolean =>
  String(code ?? '').toUpperCase() === 'RFR';

// Seller fulfillment model. Accept/Reject is Omni-only (myntradeveloper.md §Accept/Reject
// + inbound reference: "Not applicable for PPMP model. Omni only."). This account
// (ALYA-V4-PPMP) is PPMP, so its new orders go straight to Ready to Dispatch.
export type PartnerModel = 'PPMP' | 'OMNI';
export const PARTNER_MODEL: PartnerModel = 'PPMP';

export type ActionKey = 'accept' | 'reject' | 'ready_to_dispatch' | 'cancel';

export const ACTION_META: Record<ActionKey, { label: string; variant: 'primary' | 'danger' | 'neutral' }> = {
  accept:            { label: 'Accept', variant: 'primary' },
  reject:            { label: 'Reject', variant: 'danger' },
  ready_to_dispatch: { label: 'Ready to Dispatch', variant: 'primary' },
  cancel:            { label: 'Cancel', variant: 'danger' },
};

// Which actions are valid for a status, per the seller model.
// PPMP flow (myntradeveloper.md §RTD workflow): New(RFR) -> RTD -> Packed -> RTS -> Shipped.
export function allowedActions(code: string | null | undefined, model: PartnerModel = PARTNER_MODEL): ActionKey[] {
  const s = String(code ?? '').toUpperCase();
  if (model === 'OMNI') {
    switch (s) {
      case 'RFR': return ['accept', 'reject'];
      case 'WP':  return ['ready_to_dispatch', 'cancel'];
      case 'PK':
      case 'RTD': return ['cancel'];
      default:    return [];
    }
  }
  // PPMP. Verified against the live API:
  //  - RFR is "received, awaiting release" — RFR->WP is a Myntra-side transition,
  //    NOT a seller action (Accept is rejected for PPMP). So no RTD on RFR.
  //  - RTD is valid only once Myntra moves the order to WP (Work in Progress).
  switch (s) {
    case 'RFR': return [];                              // awaiting Myntra release to WP
    case 'WP':  return ['ready_to_dispatch', 'cancel']; // now seller-actionable
    case 'PK':
    case 'RTD': return ['cancel'];
    case 'SH':
    case 'DL':
    case 'IC':
    case 'C':
    case 'RTO': return [];
    default:    return [];
  }
}

// RFR orders are received but not yet released by Myntra for fulfilment.
export const isAwaitingRelease = (code: string | null | undefined): boolean =>
  String(code ?? '').toUpperCase() === 'RFR';
