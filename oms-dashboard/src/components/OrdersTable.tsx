'use client';

import { ChevronRight, Download, FileText, Loader2, Package } from 'lucide-react';
import { api, type OrderSummary } from '@/lib/api';
import type { RowDetail } from '@/lib/useRowDetails';
import { formatINR } from '@/lib/utils';
import StatusBadge from './StatusBadge';

function Thumb({ image }: { image: string | null | undefined }) {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" className="w-9 h-9 rounded-lg object-cover border border-zinc-200 shrink-0" />;
  }
  return (
    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-zinc-50 to-zinc-100 border border-zinc-200 flex items-center justify-center shrink-0">
      <Package size={15} className="text-zinc-300" />
    </div>
  );
}

function DocsCell({ d }: { d: RowDetail | undefined }) {
  if (d === undefined) return <Loader2 size={13} className="animate-spin text-zinc-300" />;
  if (!d.packetId) return <span className="text-[11px] text-zinc-300">—</span>;
  return (
    <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
      <a href={api.labelUrl(d.packetId)} target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors">
        <Download size={11} /> Label
      </a>
      <a href={api.invoiceUrl(d.packetId)} target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-md transition-colors">
        <FileText size={11} /> Invoice
      </a>
    </div>
  );
}

export default function OrdersTable({
  orders, onSelect, highlightIds, details,
}: {
  orders: OrderSummary[];
  onSelect: (sellerOrderId: string) => void;
  highlightIds?: Set<string>;
  details?: Record<string, RowDetail | undefined>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50/80 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
          <tr>
            <th className="px-4 py-3 text-left">Order · Item</th>
            <th className="px-4 py-3 text-left">Seller Order ID</th>
            <th className="px-4 py-3 text-right w-28">Amount</th>
            <th className="px-4 py-3 text-left w-40">Status</th>
            <th className="px-4 py-3 text-left w-48">Documents</th>
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
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Thumb image={d?.image} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-zinc-900 tabular-nums">{o.orderId}</span>
                        {isNew && <span className="text-[9px] font-bold bg-gradient-to-r from-rose-500 to-pink-500 text-white px-1.5 py-0.5 rounded">NEW</span>}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate max-w-[200px]">
                        {d === undefined ? <span className="text-zinc-300">loading…</span> : (d.sku || '—')}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">{sellerId || '—'}</td>
                <td className="px-4 py-3 text-right font-semibold text-zinc-900 tabular-nums">
                  {d === undefined ? <span className="text-zinc-300 font-normal">…</span> : (d.amount != null ? formatINR(d.amount) : '—')}
                </td>
                <td className="px-4 py-3"><StatusBadge code={line?.status} /></td>
                <td className="px-4 py-3"><DocsCell d={d} /></td>
                <td className="px-4 py-3 text-zinc-300 group-hover:text-indigo-400 transition-colors"><ChevronRight size={16} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
