'use client';

import { useEffect, useState } from 'react';
import {
  X, Package, MapPin, CreditCard, Calendar, Box, FileText, Download, Loader2, AlertTriangle, Truck,
  Clock, ShieldCheck, RotateCcw,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { formatINR, formatDate, cx } from '@/lib/utils';
import { allowedActions, ACTION_META, isAwaitingRelease, type ActionKey } from '@/lib/status';
import StatusBadge from './StatusBadge';
import { useNotifications } from './NotificationProvider';

export default function OrderDetailModal({
  sellerOrderId, onClose, onMutated, source = 'live',
}: { sellerOrderId: string; onClose: () => void; onMutated?: () => void; source?: 'live' | 'inbox' }) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ActionKey | null>(null);
  const { pushToast } = useNotifications();

  // Ready-to-Dispatch form (PPMP: RTD requires seller invoice + tax — collection schema).
  const [rtdOpen, setRtdOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(''); // datetime-local value
  const [rtdSubmitting, setRtdSubmitting] = useState(false);
  // Cancel form (in-modal reason input instead of a browser prompt).
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('Out of stock');

  async function fetchDetail() {
    setLoading(true);
    const res = await api.orderDetail(sellerOrderId, source);
    setDetail(res.ok ? res.detail : { _error: res.error || (res as any).statusMessage || 'Failed to load order' });
    setLoading(false);
  }

  useEffect(() => { fetchDetail(); /* eslint-disable-next-line */ }, [sellerOrderId]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [onClose]);

  const lines: any[] = detail?.orderLineEntries || [];
  const headStatus = lines[0]?.status_code;
  const actions = allowedActions(headStatus);
  // Myntra assigns the tracking number at RTD; it arrives at the order top level
  // (e.g. "trackingNumber": "MYEC1105151644"), with a line-level fallback.
  const trackingNo: string =
    detail?.trackingNumber || lines.find((l) => l.trackingNumber)?.trackingNumber || '';
  const addr = detail && [detail.address, detail.locality, detail.city, detail.stateName || detail.state, detail.zipcode, detail.country].filter(Boolean).join(', ');

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
      // RTD needs invoice + tax — handled by the dedicated form (openRtd/submitRtd).
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
    // default invoice date = now, as a datetime-local value
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    setInvoiceDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setInvoiceNumber('');
    setRtdOpen(true);
  }

  // datetime-local "yyyy-MM-ddTHH:mm" -> Myntra "dd-MM-yyyy HH:mm:ss"
  function toMyntraDate(v: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
    if (!m) return v;
    return `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:00`;
  }

  async function submitRtd() {
    if (!invoiceNumber.trim()) { pushToast({ tone: 'err', title: 'Invoice number required', message: 'Enter your seller invoice number.' }); return; }
    if (!invoiceDate) { pushToast({ tone: 'err', title: 'Invoice date required', message: 'Pick the invoice date.' }); return; }
    const warehouse = lines[0]?.warehouse || detail.warehouse;
    const orderLineEntries = lines.map((l) => ({
      sellerOrderId,
      orderLineId: l.orderLineId,
      invoiceNumber: invoiceNumber.trim(),
      invoiceDate: toMyntraDate(invoiceDate),
      unitTotalAmount: l.lineFinalAmount ?? l.mrp ?? undefined,
      // carry the tax breakup Myntra already attached to the order line
      taxEntries: Array.isArray(l.taxEntries)
        ? l.taxEntries.map((t: any) => ({
            taxType: t.taxType,
            taxRate: t.taxRate,
            unitTaxAmount: t.unitTaxAmount,
            unitTaxableAmount: t.unitTaxableAmount,
          }))
        : undefined,
    }));

    if (!window.confirm(`Mark order ${sellerOrderId} READY TO DISPATCH on the LIVE Myntra account?\n\nThis packs the order, files invoice ${invoiceNumber.trim()}, and generates the packet/label. It cannot be cancelled afterwards.`)) return;

    setRtdSubmitting(true);
    try {
      const res = await api.action(sellerOrderId, { action: 'ready_to_dispatch', warehouse, orderLineEntries });
      if (res.ok) {
        pushToast({ tone: 'ok', title: 'Ready to Dispatch done', message: `${res.message || 'Order packed'} (code ${res.statusCode ?? res.httpStatus})` });
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
        className="relative bg-white rounded-2xl w-full max-w-[820px] max-h-[90vh] overflow-y-auto shadow-2xl animate-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-black/[0.06] px-6 py-4 rounded-t-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
              <Package size={18} className="text-indigo-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-bold text-zinc-900">Order Details</h2>
                {headStatus !== undefined && <StatusBadge code={headStatus} />}
              </div>
              <span className="text-[11px] font-mono text-zinc-400">{sellerOrderId}</span>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-zinc-50 hover:bg-zinc-100 flex items-center justify-center text-zinc-400 hover:text-zinc-700 transition-colors">
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="px-6 py-16 text-center text-zinc-400">
            <Loader2 size={20} className="animate-spin inline mr-2" /> Loading from Myntra…
          </div>
        )}
        {!loading && detail?._error && (
          <div className="px-6 py-10 text-center text-rose-600 text-sm">{detail._error}</div>
        )}

        {!loading && detail && !detail._error && (
          <div className="px-6 py-5 space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <InfoCard icon={Calendar} label="Ship By" value={formatDate(lines[0]?.shipByTime)} />
              <InfoCard icon={CreditCard} label="Payment" value={(detail.paymentMethod || '—').toUpperCase()} highlight />
              <InfoCard icon={Box} label="Items" value={String(lines.length)} />
              <InfoCard icon={Truck} label="Warehouse" value={lines[0]?.warehouse || '—'} />
            </div>

            {/* Timeline */}
            <Section title="Order Timeline" icon={Clock}>
              <Timeline status={headStatus} placedDate={lines[0]?.shipByTime} />
            </Section>

            {/* Customer */}
            <Section title="Customer & shipping" icon={MapPin}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <DetailRow label="Customer" value={detail.receiverName} />
                <DetailRow label="Mobile" value={detail.mobile} />
                <DetailRow label="Email" value={detail.email} />
              </div>
              <div className="mt-3"><DetailRow label="Address" value={addr} /></div>
            </Section>

            {/* Items */}
            <Section title={`Items (${lines.length})`} icon={Box}>
              <div className="rounded-xl border border-black/[0.06] overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50/80 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-3 py-2 text-left">SKU</th>
                      <th className="px-3 py-2 text-left">Line ID</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Packet</th>
                      <th className="px-3 py-2 text-left">Documents</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {lines.map((l) => (
                      <tr key={l.orderLineId}>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-zinc-800">{l.sku || '—'}</div>
                          {l.cancellationReason && <div className="text-[10px] text-zinc-400 max-w-[180px] truncate" title={l.cancellationReason}>{l.cancellationReason}</div>}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-zinc-600">{l.orderLineId}</td>
                        <td className="px-3 py-2 text-right font-semibold text-zinc-900">{formatINR(l.lineFinalAmount ?? l.mrp)}</td>
                        <td className="px-3 py-2"><StatusBadge code={l.status_code} /></td>
                        <td className="px-3 py-2 font-mono text-[11px] text-zinc-600">{l.packetId || '—'}</td>
                        <td className="px-3 py-2">
                          {l.packetId ? (
                            <div className="flex gap-2">
                              <a href={api.labelUrl(l.packetId, source)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800">
                                <Download size={11} /> Label
                              </a>
                              <a href={api.invoiceUrl(l.packetId, source)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800">
                                <FileText size={11} /> Invoice
                              </a>
                            </div>
                          ) : <span className="text-[11px] text-zinc-400">no packet</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            {/* Cancel form */}
            {cancelOpen && (
              <div className="bg-rose-50/40 border border-rose-200/60 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[12px] font-semibold text-rose-700 flex items-center gap-1.5"><X size={13} /> Cancel order — reason required</h4>
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
              <div className="bg-indigo-50/40 border border-indigo-200/60 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[12px] font-semibold text-indigo-700 flex items-center gap-1.5"><Truck size={13} /> Ready to Dispatch — pack &amp; file invoice</h4>
                  <button onClick={() => setRtdOpen(false)} className="text-zinc-400 hover:text-zinc-700"><X size={14} /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Seller invoice number *</label>
                    <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="e.g. INV-2026-00123"
                      className="mt-1 w-full px-3 py-2 text-[12px] bg-white border border-black/[0.08] rounded-lg focus:border-indigo-400 outline-none font-mono" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Invoice date *</label>
                    <input type="datetime-local" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-[12px] bg-white border border-black/[0.08] rounded-lg focus:border-indigo-400 outline-none" />
                  </div>
                </div>
                <div className="rounded-lg border border-black/[0.06] overflow-hidden bg-white">
                  <table className="w-full text-[11px]">
                    <thead className="bg-zinc-50 text-[9px] uppercase text-zinc-500">
                      <tr><th className="px-2 py-1.5 text-left">SKU</th><th className="px-2 py-1.5 text-right">Unit total</th><th className="px-2 py-1.5 text-left">Tax</th></tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {lines.map((l) => (
                        <tr key={l.orderLineId}>
                          <td className="px-2 py-1.5 font-semibold">{l.sku}</td>
                          <td className="px-2 py-1.5 text-right">{formatINR(l.lineFinalAmount ?? l.mrp)}</td>
                          <td className="px-2 py-1.5 text-zinc-500">
                            {Array.isArray(l.taxEntries) && l.taxEntries.length
                              ? l.taxEntries.map((t: any, i: number) => <span key={i}>{t.taxType} {t.taxRate}%{i < l.taxEntries.length - 1 ? ', ' : ''}</span>)
                              : <span className="text-zinc-400">none on order</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-zinc-500">Amount &amp; tax are taken from the order as Myntra supplied it. RTD is irreversible — the order cannot be cancelled after this.</p>
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
          <div className="sticky bottom-0 bg-white/95 backdrop-blur-sm border-t border-black/[0.06] px-6 py-4 rounded-b-2xl flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[11px] text-zinc-400 flex items-center gap-1.5">
              <AlertTriangle size={12} /> Actions hit the live Myntra account and confirm first.
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {actions.length === 0 ? (
                <span className="text-[12px] text-zinc-400">
                  {isAwaitingRelease(headStatus)
                    ? 'Received — awaiting release to Work in Progress by Myntra. Ready to Dispatch unlocks then.'
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

function InfoCard({ icon: Icon, label, value, highlight }: { icon: LucideIcon; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-zinc-50/80 rounded-xl p-3 border border-black/[0.03]">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} className="text-zinc-400" />
        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</span>
      </div>
      <p className={cx('text-[14px] font-semibold', highlight ? 'text-indigo-600' : 'text-zinc-800')}>{value}</p>
    </div>
  );
}
function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Icon size={14} className="text-indigo-500" />
        <h3 className="text-[12px] font-semibold text-zinc-900 uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  );
}
function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">{label}</span>
      <p className="text-[13px] text-zinc-700 mt-0.5">{value || '—'}</p>
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
  const packed = ['PK', 'RTD', 'RTS', 'SH', 'OFD', 'DL'].includes(s);
  const shipped = ['SH', 'OFD', 'DL'].includes(s);
  const delivered = s === 'DL';
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
    <div className="flex items-center overflow-x-auto py-1">
      {steps.map((step, idx) => {
        const StepIcon = step.icon;
        const isLast = idx === steps.length - 1;
        return (
          <div key={step.key} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={cx(
                  'w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors',
                  step.cancelled
                    ? 'bg-rose-50 border-rose-300 text-rose-500'
                    : step.done
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-600'
                      : 'bg-zinc-50 border-zinc-200 text-zinc-300',
                )}
              >
                <StepIcon size={15} />
              </div>
              <span className={cx('text-[10px] font-medium mt-1.5 whitespace-nowrap', step.done ? 'text-zinc-700' : 'text-zinc-300')}>
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div className={cx('w-12 h-0.5 mx-1 mt-[-16px] rounded-full', steps[idx + 1].done ? 'bg-emerald-300' : 'bg-zinc-200')} />
            )}
          </div>
        );
      })}
    </div>
  );
}
