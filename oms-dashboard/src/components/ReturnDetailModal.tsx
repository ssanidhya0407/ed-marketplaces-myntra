'use client';

import { useEffect, useState } from 'react';
import { X, Undo2, Loader2, Package, User, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { formatINR, formatDate } from '@/lib/utils';
import { skuImage } from '@/lib/skuImage';
import StatusBadge from './StatusBadge';

const isRTO = (t: string | null | undefined) => String(t || '').toUpperCase() === 'COURIER_RETURN';

interface OrderInfo { sku: string | null; amount: number | null; status: string | null; customer: string | null; city: string | null; none?: boolean }

function Field({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</div>
      <div className={`text-[12px] text-zinc-800 font-medium break-words ${mono ? 'font-mono' : ''}`}>
        {value === null || value === undefined || value === '' ? '—' : String(value)}
      </div>
    </div>
  );
}

export default function ReturnDetailModal({ id, onClose, onViewOrder }: { id: string; onClose: () => void; onViewOrder?: (sellerOrderId: string) => void }) {
  const [ret, setRet] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [live, setLive] = useState<any>(null);
  const [order, setOrder] = useState<OrderInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      const res = await api.inboxReturnDetail(id);
      if (cancelled) return;
      if (!res.ok) { setError(res.error || 'Failed to load return'); setLoading(false); return; }
      const r = res.return; setRet(r); setLoading(false);

      // Live return record (Myntra keys returnRecon on the tracking number) — for the
      // authoritative confirmed/delivered timestamps.
      api.returnDetails(r.trackingNumber || id).then((lr) => { if (!cancelled) setLive(lr.ok ? lr.detail : null); }).catch(() => {});

      // Embed the parent order's key parts: find the returned line.
      if (r.sellerOrderId) {
        api.orderDetail(r.sellerOrderId, 'live').then((od) => {
          if (cancelled) return;
          const d = od.detail; const lines: any[] = d?.orderLineEntries || [];
          const line = lines.find((l) => String(l.orderLineId) === String(r.orderLineId)) || lines[0];
          if (line) setOrder({ sku: line.sku ?? null, amount: line.lineFinalAmount ?? line.mrp ?? null, status: line.status_code ?? null, customer: d.receiverName ?? null, city: d.city ?? null });
          else setOrder({ sku: null, amount: null, status: null, customer: d?.receiverName ?? null, city: d?.city ?? null, none: true });
        }).catch(() => setOrder({ sku: null, amount: null, status: null, customer: null, city: null, none: true }));
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [onClose]);

  const sku = order?.sku || ret?.items?.[0]?.sku || null;
  const img = skuImage(sku);
  const amount = order?.amount;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-modal-overlay"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div className="relative bg-white rounded-2xl w-full max-w-[620px] max-h-[90vh] overflow-y-auto shadow-2xl animate-modal-content"
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-black/[0.06] px-6 py-4 rounded-t-2xl flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center shrink-0">
              <Undo2 size={18} className="text-rose-500" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-bold text-zinc-900">Return details</h2>
                {ret?.type && (
                  <span className={'text-[10px] font-semibold px-2 py-0.5 rounded-md border ' + (isRTO(ret.type) ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200')}>
                    {isRTO(ret.type) ? 'RTO' : 'Customer'}
                  </span>
                )}
                {ret?.status && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border bg-zinc-100 text-zinc-600 border-zinc-200">{ret.status}</span>}
              </div>
              <span className="text-[11px] font-mono text-zinc-400 truncate block">{id}</span>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-zinc-50 hover:bg-zinc-100 flex items-center justify-center text-zinc-400 hover:text-zinc-700 transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {loading && <div className="px-6 py-16 text-center text-zinc-400"><Loader2 size={20} className="animate-spin inline mr-2" /> Loading return…</div>}
        {!loading && error && <div className="px-6 py-10 text-center text-rose-600 text-sm">{error}</div>}

        {!loading && ret && (
          <div className="px-6 py-5 space-y-5">
            {/* Returned item — embedded order essentials */}
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider"><Package size={13} className="text-zinc-400" /> Returned item</div>
              <div className="rounded-2xl border border-black/[0.06] p-3.5 flex items-center gap-3.5">
                {img
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={img} alt={sku || ''} className="w-16 h-16 rounded-xl object-cover border border-black/[0.06] shrink-0" />
                  : <div className="w-16 h-16 rounded-xl bg-indigo-50 text-indigo-600 font-bold flex items-center justify-center text-[16px] shrink-0">{(sku || '?').slice(0, 2).toUpperCase()}</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-zinc-900 text-[15px] truncate">{sku || '—'}</span>
                    {order?.status && <StatusBadge code={order.status} />}
                  </div>
                  <div className="text-[12px] text-zinc-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    {order?.customer && <span className="flex items-center gap-1"><User size={10} /> {order.customer}</span>}
                    {order?.city && <span>· {order.city}</span>}
                    <span className="font-mono text-zinc-400">· line {ret.orderLineId || '—'}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {amount != null && <div className="font-bold text-zinc-900 text-[16px] tabular-nums">{formatINR(amount)}</div>}
                  {onViewOrder && ret.sellerOrderId && (
                    <button onClick={() => onViewOrder(ret.sellerOrderId)} className="mt-1 inline-flex items-center gap-0.5 text-[12px] font-semibold text-indigo-600 hover:text-indigo-800">
                      Full order <ArrowRight size={11} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Return summary — important fields only */}
            <div>
              <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider"><Undo2 size={13} className="text-zinc-400" /> Return summary</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                <Field label="Type" value={isRTO(ret.type) ? 'RTO (Courier)' : 'Customer return'} />
                <Field label="Created on" value={ret.createdOn ? formatDate(ret.createdOn) : null} />
                <Field label="Confirmed" value={live?.confirmedTime ? formatDate(live.confirmedTime) : null} />
                <Field label="Delivered" value={live?.deliveredTime ? formatDate(live.deliveredTime) : null} />
                <Field label="Tracking" value={ret.trackingNumber} mono />
                <Field label="Return warehouse" value={ret.returnWarehouseCode} />
              </div>
              {ret.reason && (
                <div className="mt-3 rounded-lg bg-zinc-50 border border-black/[0.05] px-3 py-2">
                  <div className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider mb-0.5">Reason</div>
                  <div className="text-[12px] text-zinc-700">{ret.reason}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
