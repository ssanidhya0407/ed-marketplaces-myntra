'use client';

import { useState } from 'react';
import { ChevronRight, Download, FileText, Loader2, Package, Truck, Ban } from 'lucide-react';
import { api, type OrderSummary } from '@/lib/api';
import type { RowDetail } from '@/lib/useRowDetails';
import { formatINR } from '@/lib/utils';
import StatusBadge from './StatusBadge';
import HoverImage from './HoverImage';
import { useNotifications } from './NotificationProvider';

function Thumb({ image }: { image: string | null | undefined }) {
  return (
    <HoverImage src={image}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="w-14 h-14 rounded-xl object-cover border border-zinc-200 shrink-0 cursor-zoom-in" />
      ) : (
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-zinc-50 to-zinc-100 border border-zinc-200 flex items-center justify-center shrink-0">
          <Package size={22} className="text-zinc-300" />
        </div>
      )}
    </HoverImage>
  );
}

function DocsCell({ d, source }: { d: RowDetail | undefined; source: 'live' | 'inbox' }) {
  if (d === undefined) return <Loader2 size={13} className="animate-spin text-zinc-300" />;
  if (!d.packetId) return <span className="text-[11px] text-zinc-300">—</span>;
  return (
    <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
      <div className="flex gap-1.5">
        <a href={api.labelUrl(d.packetId, source)} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors">
          <Download size={13} /> Label
        </a>
        <a href={api.invoiceUrl(d.packetId, source)} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-semibold text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-md transition-colors">
          <FileText size={13} /> Invoice
        </a>
      </div>
      {d.invoiceNumber && (
        <span className="text-[11px] text-zinc-400 font-mono truncate max-w-[160px]"
          title={`Invoice ${d.invoiceNumber}${d.invoiceDate ? ' · ' + d.invoiceDate : ''}`}>
          #{d.invoiceNumber}
        </span>
      )}
    </div>
  );
}

// Inline Ready-to-Dispatch / Cancel for actionable (WP) rows — same behaviour as the
// order-detail modal: RTD fires on a single browser confirm; Cancel takes a reason then
// confirms. Both hit the LIVE Myntra account via the same /action endpoint.
function RowActions({ order, source, onMutated }: { order: OrderSummary; source: 'live' | 'inbox'; onMutated?: () => void }) {
  const { pushToast } = useNotifications();
  const [busy, setBusy] = useState<null | 'rtd' | 'cancel'>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('Out of stock');
  const lines = order.orderLines || [];
  const sellerOrderId = lines[0]?.sellerOrderId || '';
  const orderLineIds = lines.map((l) => l.orderLineId).filter(Boolean);

  async function doRtd() {
    if (!sellerOrderId) return;
    if (!window.confirm(`Mark order ${sellerOrderId} READY TO DISPATCH on the LIVE Myntra account?\n\nThis packs the order and generates the packet, shipping label, and Myntra invoice. It cannot be cancelled afterwards.`)) return;
    setBusy('rtd');
    try {
      // The list summary carries no warehouse; pull it + the full line refs from detail
      // (exactly what the modal's RTD uses).
      const det = await api.orderDetail(sellerOrderId, source);
      if (!det.ok || !det.detail) {
        pushToast({ tone: 'err', title: 'Could not load order', message: det.error || (det as any).statusMessage || 'Failed to load order' });
        setBusy(null); return;
      }
      const dlines: any[] = det.detail.orderLineEntries || [];
      const warehouse = dlines[0]?.warehouse || det.detail.warehouse;
      const orderLineEntries = dlines.map((l) => ({ sellerOrderId, orderLineId: l.orderLineId }));
      const res = await api.action(sellerOrderId, { action: 'ready_to_dispatch', warehouse, orderLineEntries });
      if (res.ok) {
        const tn = res.raw?.trackingNumber || '';
        pushToast({ tone: 'ok', title: 'Ready to Dispatch done', message: `${res.message || 'Order packed'}${tn ? ` · tracking ${tn}` : ''} (code ${res.statusCode ?? res.httpStatus})` });
        onMutated?.();
      } else {
        pushToast({ tone: 'err', title: 'Myntra rejected RTD', message: `${res.message || res.error || 'Failed'} (HTTP ${res.httpStatus}${res.statusCode ? ', code ' + res.statusCode : ''})` });
      }
    } catch (e: any) {
      pushToast({ tone: 'err', title: 'Network error', message: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function submitCancel() {
    if (!reason.trim()) { pushToast({ tone: 'err', title: 'Reason required', message: 'Enter a cancellation reason.' }); return; }
    if (!window.confirm(`CANCEL order ${sellerOrderId} on the LIVE Myntra account?\n\nReason: ${reason.trim()}`)) return;
    setBusy('cancel');
    try {
      const res = await api.action(sellerOrderId, { action: 'cancel', orderLineIds, comment: reason.trim() });
      if (res.ok) {
        pushToast({ tone: 'ok', title: 'Cancelled', message: `${res.message || 'Items cancelled'} (code ${res.statusCode ?? res.httpStatus})` });
        setCancelOpen(false);
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

  if (cancelOpen) {
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason"
          className="w-28 px-2 py-1.5 text-[12px] bg-white border border-rose-200 rounded-md focus:border-rose-400 outline-none" />
        <button onClick={submitCancel} disabled={busy === 'cancel'}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-md disabled:opacity-50">
          {busy === 'cancel' && <Loader2 size={12} className="animate-spin" />} Confirm
        </button>
        <button onClick={() => setCancelOpen(false)} disabled={busy === 'cancel'}
          className="px-2 py-1.5 text-[12px] font-medium text-zinc-500 hover:text-zinc-800 disabled:opacity-50">Keep</button>
      </div>
    );
  }

  return (
    <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
      <button onClick={doRtd} disabled={!!busy} title="Ready to Dispatch"
        className="inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1.5 text-[12px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors disabled:opacity-50">
        {busy === 'rtd' ? <Loader2 size={13} className="animate-spin" /> : <Truck size={13} />} Dispatch
      </button>
      <button onClick={() => setCancelOpen(true)} disabled={!!busy}
        className="inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1.5 text-[12px] font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-md transition-colors disabled:opacity-50">
        <Ban size={13} /> Cancel
      </button>
    </div>
  );
}

export default function OrdersTable({
  orders, onSelect, highlightIds, details, source = 'live', onMutated,
}: {
  orders: OrderSummary[];
  onSelect: (sellerOrderId: string) => void;
  highlightIds?: Set<string>;
  details?: Record<string, RowDetail | undefined>;
  source?: 'live' | 'inbox';
  onMutated?: () => void;
}) {
  // When every visible row is actionable (WP), the last column is Actions, not Documents.
  const allActionable = orders.length > 0 && orders.every((o) => (o.orderLines?.[0]?.status || '').toUpperCase() === 'WP');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[15px]">
        <thead className="bg-zinc-50/80 text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
          <tr>
            <th className="px-4 py-3 text-left">Order · Item</th>
            <th className="px-4 py-3 text-left">Seller Order ID</th>
            <th className="px-4 py-3 text-right w-28">Amount</th>
            <th className="px-4 py-3 text-left w-40">Status</th>
            <th className="px-4 py-3 text-left w-48">{allActionable ? 'Actions' : 'Documents'}</th>
            <th className="px-4 py-3 w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {orders.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-14 text-center text-sm text-zinc-400">No orders for this view.</td></tr>
          )}
          {orders.map((o) => {
            const line = o.orderLines?.[0];
            const sellerId = line?.sellerOrderId || '';
            const d = sellerId ? details?.[sellerId] : undefined;
            const isNew = highlightIds?.has(String(o.orderId));
            return (
              <tr
                key={o.orderId}
                onClick={() => sellerId && onSelect(sellerId)}
                className="group hover:bg-indigo-50/40 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-3.5">
                    <Thumb image={d?.image} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[16px] text-zinc-900 tabular-nums">{o.orderId}</span>
                        {isNew && <span className="text-[10px] font-bold bg-gradient-to-r from-rose-500 to-pink-500 text-white px-1.5 py-0.5 rounded">NEW</span>}
                      </div>
                      <div className="text-[13px] text-zinc-500 truncate max-w-[240px]">
                        {d === undefined ? <span className="text-zinc-300">loading…</span> : (
                          <>{d.sku || '—'}{d.qty && d.qty > 1 ? <span className="text-zinc-400"> · {d.qty} items</span> : ''}</>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5 font-mono text-[12px] text-zinc-500">{sellerId || '—'}</td>
                <td className="px-4 py-3.5 text-right font-semibold text-[15px] text-zinc-900 tabular-nums"
                  title={d && d.tax != null ? `Order total ${formatINR(d.total ?? d.amount ?? 0)} · tax ${formatINR(d.tax)}` : undefined}>
                  {d === undefined ? <span className="text-zinc-300 font-normal">…</span> : (d.amount != null ? formatINR(d.amount) : '—')}
                  {d && d.tax != null && d.tax > 0 && (
                    <div className="text-[11px] font-normal text-zinc-400">incl. {formatINR(d.tax)} tax</div>
                  )}
                </td>
                <td className="px-4 py-3.5"><StatusBadge code={d?.status ?? line?.status} /></td>
                <td className="px-4 py-3.5">
                  {(d?.status ?? line?.status ?? '').toUpperCase() === 'WP'
                    ? <RowActions order={o} source={source} onMutated={onMutated} />
                    : <DocsCell d={d} source={source} />}
                </td>
                <td className="px-4 py-3.5 text-zinc-300 group-hover:text-indigo-400 transition-colors"><ChevronRight size={18} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
