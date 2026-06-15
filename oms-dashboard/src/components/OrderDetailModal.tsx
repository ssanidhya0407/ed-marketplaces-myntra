'use client';

import { useEffect, useRef, useState } from 'react';
import {
  X, Package, MapPin, CreditCard, Calendar, Box, FileText, Download, Loader2, AlertTriangle, Truck,
  Clock, ShieldCheck, RotateCcw, Receipt, User, Phone, Mail, Ban, CheckCircle2, Gift, Zap, PauseCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { formatINR, formatDate, cx } from '@/lib/utils';
import { allowedActions, ACTION_META, isAwaitingRelease, type ActionKey } from '@/lib/status';
import StatusBadge from './StatusBadge';
import InvoiceDetails from './InvoiceDetails';
import { skuImage } from '@/lib/skuImage';
import { useNotifications } from './NotificationProvider';

export default function OrderDetailModal({
  sellerOrderId, onClose, onMutated, source = 'live',
}: { sellerOrderId: string; onClose: () => void; onMutated?: () => void; source?: 'live' | 'inbox' }) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ActionKey | null>(null);
  const { pushToast } = useNotifications();

  // Ready-to-Dispatch (Myntra-generated invoice: minimal body, no seller invoice fields).
  const [rtdOpen, setRtdOpen] = useState(false);
  const [rtdSubmitting, setRtdSubmitting] = useState(false);
  // Myntra returns the tracking number in the RTD response; keep it so Ready to Ship
  // unlocks immediately even before the order re-fetch reflects it.
  const [rtdTracking, setRtdTracking] = useState('');
  // Cancel form (in-modal reason input instead of a browser prompt).
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('Out of stock');
  // Invoice details per packet — auto-loaded from live Myntra for dispatched packets.
  type InvState = { loading: boolean; ok: boolean; message: string; data: any };
  const [invByPacket, setInvByPacket] = useState<Record<string, InvState>>({});
  const invStarted = useRef<Set<string>>(new Set());

  async function fetchDetail() {
    setLoading(true);
    const res = await api.orderDetail(sellerOrderId, source);
    setDetail(res.ok ? res.detail : { _error: res.error || (res as any).statusMessage || 'Failed to load order' });
    setLoading(false);
  }

  useEffect(() => {
    invStarted.current = new Set();
    setInvByPacket({});
    fetchDetail();
    /* eslint-disable-next-line */
  }, [sellerOrderId]);

  // Auto-load invoice details for any packet on this order (live only). A packet only
  // exists once the order was RTD'd, so it always has a label + invoice — including
  // shipped, delivered, completed and cancelled-after-pack orders (which show the docs).
  useEffect(() => {
    if (source !== 'live' || !detail || detail._error) return;
    const packets: string[] = Array.from(
      new Set(
        (detail.orderLineEntries || [])
          .filter((l: any) => l.packetId)
          .map((l: any) => String(l.packetId)),
      ),
    );
    packets.forEach((pid) => {
      if (invStarted.current.has(pid)) return;
      invStarted.current.add(pid);
      setInvByPacket((m) => ({ ...m, [pid]: { loading: true, ok: false, message: '', data: null } }));
      api.invoiceDetails(pid)
        .then((res) => setInvByPacket((m) => ({
          ...m,
          [pid]: {
            loading: false,
            ok: res.ok,
            message: res.message || res.error || (res.ok ? '' : `HTTP ${res.httpStatus}${res.statusCode ? ', code ' + res.statusCode : ''}`),
            data: res.details,
          },
        })))
        .catch((e: any) => setInvByPacket((m) => ({ ...m, [pid]: { loading: false, ok: false, message: e.message, data: null } })));
    });
    /* eslint-disable-next-line */
  }, [detail, source]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [onClose]);

  const lines: any[] = detail?.orderLineEntries || [];
  const headStatus = lines[0]?.status_code;
  const actions = allowedActions(headStatus);
  const orderTotal = lines.reduce((s, l) => s + (Number(l.lineFinalAmount ?? l.mrp) || 0), 0);
  // Myntra assigns the tracking number at RTD; it arrives at the order top level
  // (e.g. "trackingNumber": "MYEC1105151644"), with a line-level fallback.
  const trackingNo: string =
    detail?.trackingNumber || lines.find((l) => l.trackingNumber)?.trackingNumber || rtdTracking || '';
  const addr = detail && [detail.address, detail.locality, detail.city, detail.stateName || detail.state, detail.zipcode, detail.country].filter(Boolean).join(', ');

  // ---- Stage- and type-aware context ----
  const su = String(headStatus || '').toUpperCase();
  const stage = STAGES[su] || { tone: 'zinc', icon: Box, title: su || 'Order', desc: '' };
  const courier = detail?.courierCode || lines.find((l) => l.courierCode)?.courierCode || '';
  const eta = lines.find((l) => l.expectedDeliveryTime)?.expectedDeliveryTime || detail?.expectedDeliveryTime;
  const packedOn = lines.find((l) => l.packedOn)?.packedOn;
  const packetId = lines.find((l) => l.packetId)?.packetId;
  const lineCancelReason = lines.find((l) => l.cancellationReason)?.cancellationReason;
  const lineCancelledOn = lines.find((l) => l.cancelledOn)?.cancelledOn;
  const isPrepaid = ['on', 'prepaid'].includes(String(detail?.paymentMethod || '').toLowerCase());
  const flags = { gift: lines.some((l) => l.gift), priority: lines.some((l) => l.priority), onHold: lines.some((l) => l.onHold) };
  const dispatched = ['PK', 'RTD', 'SH', 'S', 'OFD', 'DL', 'D'].includes(su);

  const stageDesc =
    (su === 'SH' || su === 'S' || su === 'OFD') ? `In transit${courier ? ' · ' + courier : ''}${trackingNo ? ' · ' + trackingNo : ''}`
      : su === 'IC' ? (lineCancelReason || stage.desc)
        : stage.desc;

  // Quick-fact pills, chosen by stage.
  const pills: Array<{ icon: LucideIcon; label: string; value: string }> = [{ icon: CreditCard, label: 'Payment', value: isPrepaid ? 'Prepaid' : 'COD' }];
  if (su === 'RFR' || su === 'WP') {
    pills.push({ icon: Calendar, label: 'Ship by', value: formatDate(lines[0]?.shipByTime) || '—' });
    pills.push({ icon: Box, label: 'Warehouse', value: lines[0]?.warehouse || '—' });
  } else if (dispatched) {
    if (courier) pills.push({ icon: Truck, label: 'Courier', value: courier });
    if (trackingNo) pills.push({ icon: Truck, label: 'Tracking', value: trackingNo });
    if (su === 'DL' || su === 'D') pills.push({ icon: ShieldCheck, label: 'Delivered', value: 'Yes' });
    else if (eta) pills.push({ icon: Calendar, label: 'Est. delivery', value: formatDate(eta) || '—' });
  } else if (su === 'IC' && lineCancelledOn) {
    pills.push({ icon: Calendar, label: 'Cancelled on', value: formatDate(lineCancelledOn) || '—' });
  }
  pills.push({ icon: Box, label: 'Items', value: String(lines.length) });

  async function runAction(action: ActionKey) {
    const orderLineIds = lines.map((l) => l.orderLineId).filter(Boolean);
    const warehouse = lines[0]?.warehouse || detail.warehouse;
    const body: Record<string, unknown> = { action, orderLineIds, warehouse };

    if (action === 'cancel') {
      // Reason captured via the in-modal form (submitCancel), not a browser prompt.
      setCancelOpen(true);
      return;
    }
    if (action === 'ready_to_ship') {
      // RTS is keyed on the Myntra-assigned tracking number from RTD — no typing.
      if (!trackingNo) {
        pushToast({ tone: 'err', title: 'No tracking number yet', message: 'This order has not been Ready-to-Dispatched — Myntra assigns the tracking number at RTD.' });
        return;
      }
      body.trackingNo = trackingNo;
    }
    if (action === 'ready_to_dispatch') {
      // RTD is confirmed via a short review panel (openRtd/submitRtd).
      openRtd();
      return;
    }
    const label = ACTION_META[action].label;
    const extra = action === 'ready_to_ship' ? `\n\nTracking number: ${trackingNo}` : '';
    if (!window.confirm(`This will ${label.toUpperCase()} on the LIVE Myntra account for order ${sellerOrderId}.${extra}\n\nProceed?`)) return;

    setBusy(action);
    try {
      const res = await api.action(sellerOrderId, body);
      if (res.ok) {
        pushToast({ tone: 'ok', title: 'Success', message: `${label} · ${res.message || 'done'} (code ${res.statusCode ?? res.httpStatus})` });
        await fetchDetail();
        onMutated?.();
      } else {
        pushToast({ tone: 'err', title: 'Myntra rejected it', message: res.message || res.error || `HTTP ${res.httpStatus}` });
      }
    } catch (e: any) {
      pushToast({ tone: 'err', title: 'Network error', message: e.message });
    } finally {
      setBusy(null);
    }
  }

  function openRtd() {
    setRtdOpen(true);
  }

  async function submitRtd() {
    const warehouse = lines[0]?.warehouse || detail.warehouse;
    // Myntra-generated invoice model: the RTD body only needs the order line refs —
    // Myntra produces the invoice and assigns packet/courier/tracking on its side.
    const orderLineEntries = lines.map((l) => ({ sellerOrderId, orderLineId: l.orderLineId }));

    if (!window.confirm(`Mark order ${sellerOrderId} READY TO DISPATCH on the LIVE Myntra account?\n\nThis packs the order and generates the packet, shipping label, and Myntra invoice. It cannot be cancelled afterwards.`)) return;

    setRtdSubmitting(true);
    try {
      const res = await api.action(sellerOrderId, { action: 'ready_to_dispatch', warehouse, orderLineEntries });
      if (res.ok) {
        // RTD returns packetId + courierCode + trackingNumber — keep the tracking
        // number so Ready to Ship unlocks immediately, before the re-fetch lands.
        const tn = res.raw?.trackingNumber || '';
        if (tn) setRtdTracking(tn);
        pushToast({ tone: 'ok', title: 'Ready to Dispatch done', message: `${res.message || 'Order packed'}${tn ? ` · tracking ${tn}` : ''} (code ${res.statusCode ?? res.httpStatus})` });
        setRtdOpen(false);
        await fetchDetail();
        onMutated?.();
      } else {
        pushToast({ tone: 'err', title: 'Myntra rejected RTD', message: `${res.message || res.error || 'Failed'} (HTTP ${res.httpStatus}${res.statusCode ? ', code ' + res.statusCode : ''})` });
      }
    } catch (e: any) {
      pushToast({ tone: 'err', title: 'Network error', message: e.message });
    } finally {
      setRtdSubmitting(false);
    }
  }

  async function refreshInvoice(packetId: string) {
    setInvByPacket((m) => ({ ...m, [packetId]: { loading: true, ok: false, message: '', data: null } }));
    try {
      const res = await api.invoiceDetails(packetId);
      setInvByPacket((m) => ({
        ...m,
        [packetId]: {
          loading: false,
          ok: res.ok,
          message: res.message || res.error || (res.ok ? '' : `HTTP ${res.httpStatus}${res.statusCode ? ', code ' + res.statusCode : ''}`),
          data: res.details,
        },
      }));
    } catch (e: any) {
      setInvByPacket((m) => ({ ...m, [packetId]: { loading: false, ok: false, message: e.message, data: null } }));
    }
  }

  async function submitCancel() {
    if (!cancelReason.trim()) { pushToast({ tone: 'err', title: 'Reason required', message: 'Enter a cancellation reason.' }); return; }
    if (!window.confirm(`CANCEL order ${sellerOrderId} on the LIVE Myntra account?\n\nReason: ${cancelReason.trim()}`)) return;
    setBusy('cancel');
    try {
      const orderLineIds = lines.map((l) => l.orderLineId).filter(Boolean);
      const res = await api.action(sellerOrderId, { action: 'cancel', orderLineIds, comment: cancelReason.trim() });
      if (res.ok) {
        pushToast({ tone: 'ok', title: 'Cancelled', message: `${res.message || 'Items cancelled'} (code ${res.statusCode ?? res.httpStatus})` });
        setCancelOpen(false);
        await fetchDetail();
        onMutated?.();
      } else {
        pushToast({ tone: 'err', title: 'Myntra rejected it', message: `${res.message || res.error || 'Failed'} (HTTP ${res.httpStatus}${res.statusCode ? ', code ' + res.statusCode : ''})` });
      }
    } catch (e: any) {
      pushToast({ tone: 'err', title: 'Network error', message: e.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-modal-overlay"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl w-full max-w-[840px] max-h-[92vh] overflow-y-auto shadow-2xl animate-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-black/[0.06] px-6 py-3.5 rounded-t-2xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm shrink-0">
              <Package size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[15px] font-bold text-zinc-900">Order details</h2>
                {headStatus !== undefined && <StatusBadge code={headStatus} />}
                {source === 'inbox' && <span className="text-[9px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5">INBOX</span>}
                {flags.priority && <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"><Zap size={9} /> PRIORITY</span>}
                {flags.gift && <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-pink-700 bg-pink-50 border border-pink-200 rounded px-1.5 py-0.5"><Gift size={9} /> GIFT</span>}
                {flags.onHold && <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-zinc-600 bg-zinc-100 border border-zinc-200 rounded px-1.5 py-0.5"><PauseCircle size={9} /> ON HOLD</span>}
              </div>
              <span className="text-[11px] font-mono text-zinc-400 truncate block">{sellerOrderId}</span>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-zinc-50 hover:bg-zinc-100 flex items-center justify-center text-zinc-400 hover:text-zinc-700 transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="px-6 py-20 text-center text-zinc-400">
            <Loader2 size={22} className="animate-spin inline mr-2" /> Loading from Myntra…
          </div>
        )}
        {!loading && detail?._error && (
          <div className="px-6 py-12 text-center text-rose-600 text-sm">{detail._error}</div>
        )}

        {!loading && detail && !detail._error && (
          <div className="px-6 py-5 space-y-6">
            {/* Stage banner: what's the state + what to do next */}
            <div className={cx('rounded-2xl border p-4 flex items-center justify-between gap-4 flex-wrap', BANNER_TONE[stage.tone])}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center shrink-0"><stage.icon size={18} /></div>
                <div className="min-w-0">
                  <div className="text-[14px] font-bold leading-tight">{stage.title}</div>
                  <div className="text-[12px] opacity-80 break-words">{stageDesc}</div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Order total</div>
                <div className="text-[22px] font-bold text-zinc-900 tabular-nums leading-none">{formatINR(orderTotal)}</div>
              </div>
            </div>

            {/* Quick facts — vary by stage */}
            <div className="flex flex-wrap gap-2">
              {pills.map((p) => <Stat key={p.label} icon={p.icon} label={p.label} value={p.value} />)}
            </div>

            {/* Timeline */}
            <Section title="Order timeline" icon={Clock}>
              <div className="rounded-2xl border border-black/[0.06] px-4 py-4">
                <Timeline status={headStatus} placedDate={lines[0]?.shipByTime} />
              </div>
            </Section>

            {/* Customer & shipping */}
            <Section title="Customer & shipping" icon={MapPin}>
              <div className="rounded-2xl border border-black/[0.06] p-4 space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field icon={User} label="Customer" value={detail.receiverName} />
                  <Field icon={Phone} label="Mobile" value={detail.mobile} />
                  <Field icon={Mail} label="Email" value={detail.email} />
                </div>
                <div className="pt-3.5 border-t border-black/[0.05]">
                  <div className="flex items-center gap-1 text-[9px] font-semibold text-zinc-400 uppercase tracking-wider"><MapPin size={10} /> Shipping address</div>
                  <p className="text-[13px] text-zinc-700 mt-1 leading-relaxed">{addr || '—'}</p>
                </div>
              </div>
            </Section>

            {/* Items */}
            <Section title={`Items (${lines.length})`} icon={Box}>
              <div className="space-y-2">
                {lines.map((l) => <ItemRow key={l.orderLineId} l={l} source={source} />)}
              </div>
            </Section>

            {/* Shipment — shown whenever a packet/tracking exists (packed → delivered,
                completed, or cancelled-after-pack) */}
            {(trackingNo || courier || packetId) && (
              <Section title="Shipment" icon={Truck}>
                <div className="rounded-2xl border border-black/[0.06] p-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <Field icon={Truck} label="Courier" value={courier || undefined} />
                  <Field icon={Truck} label="Tracking" value={trackingNo || undefined} />
                  <Field icon={Box} label="Packet" value={packetId || undefined} />
                  <Field icon={Calendar} label="Packed on" value={packedOn ? formatDate(packedOn) : undefined} />
                  <Field icon={su === 'DL' ? ShieldCheck : Calendar} label={su === 'DL' ? 'Delivered' : 'Est. delivery'} value={eta ? formatDate(eta) : undefined} />
                </div>
              </Section>
            )}

            {/* Invoice details — auto-loaded from Myntra for dispatched packets */}
            {source === 'live' && Object.keys(invByPacket).length > 0 && (
              <Section title="Invoice details" icon={Receipt}>
                <div className="space-y-3">
                  {Object.entries(invByPacket).map(([pid, st]) => (
                    <div key={pid} className="rounded-2xl border border-black/[0.06] bg-zinc-50/40 p-3">
                      <div className="flex items-center justify-between mb-2.5">
                        <div className="text-[11px] text-zinc-500">Packet <span className="font-mono text-zinc-700">{pid}</span></div>
                        <button onClick={() => refreshInvoice(pid)} disabled={st.loading}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-800 disabled:opacity-50">
                          <RotateCcw size={11} className={st.loading ? 'animate-spin' : ''} /> Refresh
                        </button>
                      </div>
                      {st.loading ? (
                        <div className="flex items-center gap-2 text-[12px] text-zinc-500"><Loader2 size={13} className="animate-spin" /> Fetching from Myntra…</div>
                      ) : !st.ok ? (
                        <p className="text-[12px] text-amber-700">{st.message || 'Invoice details not available yet.'}</p>
                      ) : (
                        <InvoiceDetails data={st.data} customer={detail.receiverName} address={addr} />
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Cancel form */}
            {cancelOpen && (
              <div className="bg-rose-50/50 border border-rose-200/70 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[12px] font-semibold text-rose-700 flex items-center gap-1.5"><AlertTriangle size={13} /> Cancel order — reason required</h4>
                  <button onClick={() => setCancelOpen(false)} className="text-zinc-400 hover:text-zinc-700"><X size={14} /></button>
                </div>
                <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Out of stock"
                  className="w-full px-3 py-2 text-[12px] bg-white border border-black/[0.08] rounded-lg focus:border-rose-400 outline-none" />
                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => setCancelOpen(false)} disabled={busy === 'cancel'} className="px-3 py-1.5 text-[11px] font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-50">Keep order</button>
                  <button onClick={submitCancel} disabled={busy === 'cancel'}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold rounded-lg shadow-sm bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50">
                    {busy === 'cancel' && <Loader2 size={11} className="animate-spin" />} Confirm cancellation
                  </button>
                </div>
              </div>
            )}

            {/* Ready-to-Dispatch form (PPMP) */}
            {rtdOpen && (
              <div className="bg-indigo-50/50 border border-indigo-200/70 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[12px] font-semibold text-indigo-700 flex items-center gap-1.5"><Truck size={13} /> Ready to Dispatch — pack &amp; generate label</h4>
                  <button onClick={() => setRtdOpen(false)} className="text-zinc-400 hover:text-zinc-700"><X size={14} /></button>
                </div>
                <div className="rounded-lg border border-black/[0.06] overflow-hidden bg-white">
                  <table className="w-full text-[11px]">
                    <thead className="bg-zinc-50 text-[9px] uppercase text-zinc-500">
                      <tr><th className="px-2.5 py-1.5 text-left">SKU</th><th className="px-2.5 py-1.5 text-right">Unit total</th><th className="px-2.5 py-1.5 text-left">Tax</th></tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {lines.map((l) => (
                        <tr key={l.orderLineId}>
                          <td className="px-2.5 py-1.5 font-semibold">{l.sku}</td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums">{formatINR(l.lineFinalAmount ?? l.mrp)}</td>
                          <td className="px-2.5 py-1.5 text-zinc-500">
                            {Array.isArray(l.taxEntries) && l.taxEntries.length
                              ? l.taxEntries.map((t: any, i: number) => <span key={i}>{t.taxType} {t.taxRate}%{i < l.taxEntries.length - 1 ? ', ' : ''}</span>)
                              : <span className="text-zinc-400">none on order</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-zinc-500">Myntra generates the invoice for this account — no invoice number needed. Amount &amp; tax shown are as Myntra supplied them. RTD is irreversible — the order cannot be cancelled after this.</p>
                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => setRtdOpen(false)} disabled={rtdSubmitting} className="px-3 py-1.5 text-[11px] font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-50">Cancel</button>
                  <button onClick={submitRtd} disabled={rtdSubmitting}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold rounded-lg shadow-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                    {rtdSubmitting && <Loader2 size={11} className="animate-spin" />} Confirm Ready to Dispatch
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        {!loading && detail && !detail._error && (
          <div className="sticky bottom-0 bg-white/90 backdrop-blur-md border-t border-black/[0.06] px-6 py-3.5 rounded-b-2xl flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[11px] text-zinc-400 flex items-center gap-1.5">
              <AlertTriangle size={12} /> Actions hit the live Myntra account and confirm first.
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {actions.length === 0 ? (
                <span className="text-[12px] text-zinc-400">
                  {isAwaitingRelease(headStatus)
                    ? 'Received — awaiting release to Work in Progress by Myntra.'
                    : 'No further seller action for this status.'}
                </span>
              ) : actions.map((a) => {
                const meta = ACTION_META[a];
                const rtsBlocked = a === 'ready_to_ship' && !trackingNo;
                return (
                  <button
                    key={a}
                    onClick={() => runAction(a)}
                    disabled={!!busy || rtsBlocked}
                    title={rtsBlocked ? 'Needs Ready to Dispatch first — Myntra assigns the tracking number at RTD.' : a === 'ready_to_ship' ? `Tracking: ${trackingNo}` : undefined}
                    className={cx(
                      'flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold rounded-xl transition-colors shadow-sm disabled:opacity-50',
                      meta.variant === 'primary' && 'bg-indigo-600 text-white hover:bg-indigo-700',
                      meta.variant === 'danger' && 'bg-white border border-rose-200 text-rose-600 hover:bg-rose-50',
                      meta.variant === 'neutral' && 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200',
                    )}
                  >
                    {busy === a && <Loader2 size={12} className="animate-spin" />}
                    {meta.label}
                  </button>
                );
              })}
              <button onClick={onClose} className="px-4 py-2 text-[12px] font-medium bg-zinc-100 text-zinc-600 rounded-xl hover:bg-zinc-200 transition-colors">Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Per-stage banner: title, helper text (next step), icon, colour.
const STAGES: Record<string, { tone: string; icon: LucideIcon; title: string; desc: string }> = {
  RFR: { tone: 'blue', icon: Clock, title: 'New — awaiting release', desc: 'Myntra will release this to Work in Progress. No seller action yet.' },
  WP: { tone: 'amber', icon: Package, title: 'Ready to process', desc: 'Pack the item, then mark it Ready to Dispatch.' },
  PK: { tone: 'violet', icon: Box, title: 'Packed', desc: 'Print the label & invoice, then mark Ready to Ship.' },
  RTD: { tone: 'violet', icon: Box, title: 'Ready to dispatch', desc: 'Print the label & invoice, then mark Ready to Ship.' },
  SH: { tone: 'emerald', icon: Truck, title: 'Shipped', desc: 'In transit to the customer.' },
  S: { tone: 'emerald', icon: Truck, title: 'Shipped', desc: 'In transit to the customer.' },
  OFD: { tone: 'emerald', icon: Truck, title: 'Out for delivery', desc: 'With the courier for delivery.' },
  DL: { tone: 'green', icon: ShieldCheck, title: 'Delivered', desc: 'Delivered to the customer.' },
  D: { tone: 'green', icon: ShieldCheck, title: 'Delivered', desc: 'Delivered to the customer.' },
  IC: { tone: 'rose', icon: Ban, title: 'Cancelled', desc: 'This order was cancelled.' },
  C: { tone: 'zinc', icon: CheckCircle2, title: 'Completed', desc: 'Order closed.' },
  RTO: { tone: 'rose', icon: RotateCcw, title: 'Returned to origin', desc: 'The shipment came back.' },
};
const BANNER_TONE: Record<string, string> = {
  blue: 'bg-blue-50 border-blue-200 text-blue-800',
  amber: 'bg-amber-50 border-amber-200 text-amber-800',
  violet: 'bg-violet-50 border-violet-200 text-violet-800',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  green: 'bg-green-50 border-green-200 text-green-800',
  rose: 'bg-rose-50 border-rose-200 text-rose-800',
  zinc: 'bg-zinc-50 border-zinc-200 text-zinc-700',
};

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="bg-white border border-black/[0.06] rounded-xl px-3 py-2 min-w-[104px]">
      <div className="flex items-center gap-1 text-[9px] font-semibold text-zinc-400 uppercase tracking-wider"><Icon size={10} /> {label}</div>
      <div className="text-[12px] font-semibold text-zinc-800 mt-0.5 truncate max-w-[160px]">{value}</div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <Icon size={14} className="text-indigo-500" />
        <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[9px] font-semibold text-zinc-400 uppercase tracking-wider"><Icon size={10} /> {label}</div>
      <p className="text-[13px] text-zinc-800 font-medium mt-0.5 truncate">{value || '—'}</p>
    </div>
  );
}

function ItemRow({ l, source }: { l: any; source: 'live' | 'inbox' }) {
  // Truly cancelled only if the line is IC or Myntra stamped cancelledOn. A bare
  // cancellationReason with no cancelledOn is a *request* that was never actioned.
  const cancelled = String(l.status_code || '').toUpperCase() === 'IC' || !!l.cancelledOn;
  const discounted = l.mrp && l.lineFinalAmount && Number(l.mrp) !== Number(l.lineFinalAmount);
  const img = l.imageUrl || l.image || skuImage(l.sku);
  return (
    <div className={cx(
      'rounded-2xl border p-3.5 flex items-start gap-3.5 transition-colors',
      cancelled ? 'border-rose-200/70 bg-rose-50/30' : 'border-black/[0.06] hover:border-black/[0.1]',
    )}>
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt={l.sku || ''} className={cx('w-16 h-16 rounded-xl object-cover border border-black/[0.06] shrink-0', cancelled && 'opacity-60 grayscale')} />
      ) : (
        <div className={cx(
          'w-16 h-16 rounded-xl flex items-center justify-center text-[16px] font-bold shrink-0',
          cancelled ? 'bg-rose-100 text-rose-500' : 'bg-indigo-50 text-indigo-600',
        )}>
          {(l.sku || '?').slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cx('font-semibold text-[15px] truncate', cancelled ? 'text-zinc-500 line-through' : 'text-zinc-900')}>{l.sku || '—'}</span>
          <StatusBadge code={l.status_code} />
        </div>
        <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
          Line {l.orderLineId}{l.packetId ? <> · Packet {l.packetId}</> : ''}
        </div>
        {l.cancellationReason && (
          <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-rose-50 border border-rose-200/70 px-2.5 py-1.5">
            <Ban size={13} className="text-rose-500 mt-px shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] font-bold text-rose-700 uppercase tracking-wide">{cancelled ? 'Cancelled' : 'Cancellation requested'}</div>
              <p className="text-[12px] text-rose-600 leading-snug">{l.cancellationReason}</p>
            </div>
          </div>
        )}
        {l.packetId ? (
          <div className="flex gap-3 mt-2">
            <a href={api.labelUrl(l.packetId, source)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-800">
              <Download size={13} /> Label
            </a>
            <a href={api.invoiceUrl(l.packetId, source)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold text-violet-600 hover:text-violet-800">
              <FileText size={13} /> Invoice
            </a>
          </div>
        ) : null}
      </div>
      <div className="text-right shrink-0">
        <div className={cx('font-bold text-[16px] tabular-nums', cancelled ? 'text-zinc-400 line-through' : 'text-zinc-900')}>{formatINR(l.lineFinalAmount ?? l.mrp)}</div>
        {discounted && <div className="text-[11px] text-zinc-400 line-through tabular-nums">{formatINR(l.mrp)}</div>}
      </div>
    </div>
  );
}

interface Step { key: string; label: string; icon: LucideIcon; done: boolean; cancelled?: boolean }

function buildTimeline(code: string | null | undefined): Step[] {
  const s = (code == null ? '' : String(code).toUpperCase());
  if (s === 'IC') {
    return [
      { key: 'placed', label: 'Placed', icon: Box, done: true },
      { key: 'cancelled', label: 'Cancelled', icon: X, done: true, cancelled: true },
    ];
  }
  if (s === 'RTO' || s === 'RT') {
    return [
      { key: 'placed', label: 'Placed', icon: Box, done: true },
      { key: 'packed', label: 'Packed', icon: Package, done: true },
      { key: 'shipped', label: 'Shipped', icon: Truck, done: true },
      { key: 'rto', label: 'Returned', icon: RotateCcw, done: true, cancelled: true },
    ];
  }
  if (s === 'C') {
    // Completed = the order ran the full course and is now closed.
    return [
      { key: 'placed', label: 'New', icon: Box, done: true },
      { key: 'packed', label: 'Packed', icon: Package, done: true },
      { key: 'shipped', label: 'Shipped', icon: Truck, done: true },
      { key: 'delivered', label: 'Delivered', icon: ShieldCheck, done: true },
      { key: 'completed', label: 'Completed', icon: CheckCircle2, done: true },
    ];
  }
  const packed = ['PK', 'RTD', 'RTS', 'SH', 'S', 'OFD', 'DL', 'D'].includes(s);
  const shipped = ['SH', 'S', 'OFD', 'DL', 'D'].includes(s);
  const delivered = s === 'DL' || s === 'D';
  return [
    { key: 'placed', label: 'New', icon: Box, done: true },
    { key: 'packed', label: 'Packed', icon: Package, done: packed },
    { key: 'shipped', label: 'Shipped', icon: Truck, done: shipped },
    { key: 'delivered', label: 'Delivered', icon: ShieldCheck, done: delivered },
  ];
}

function Timeline({ status, placedDate }: { status: string | null | undefined; placedDate?: string }) {
  const steps = buildTimeline(status);
  return (
    <div className="flex items-start justify-between">
      {steps.map((step, idx) => {
        const StepIcon = step.icon;
        const isLast = idx === steps.length - 1;
        return (
          <div key={step.key} className="flex items-start flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={cx(
                  'w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors',
                  step.cancelled
                    ? 'bg-rose-50 border-rose-300 text-rose-500'
                    : step.done
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-600'
                      : 'bg-zinc-50 border-zinc-200 text-zinc-300',
                )}
              >
                <StepIcon size={16} />
              </div>
              <span className={cx('text-[10px] font-medium mt-1.5 whitespace-nowrap', step.done ? 'text-zinc-700' : 'text-zinc-300')}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div className={cx('flex-1 h-0.5 mt-5 mx-1 rounded-full', steps[idx + 1].done ? 'bg-emerald-300' : 'bg-zinc-200')} />
            )}
          </div>
        );
      })}
    </div>
  );
}
