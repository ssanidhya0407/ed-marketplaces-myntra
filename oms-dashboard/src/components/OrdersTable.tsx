'use client';

import { ChevronRight, Download, FileText, Loader2, Package } from 'lucide-react';
import { api, type OrderSummary } from '@/lib/api';
import type { RowDetail } from '@/lib/useRowDetails';
import { formatINR } from '@/lib/utils';
import StatusBadge from './StatusBadge';
import HoverImage from './HoverImage';

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

export default function OrdersTable({
  orders, onSelect, highlightIds, details, source = 'live',
}: {
  orders: OrderSummary[];
  onSelect: (sellerOrderId: string) => void;
  highlightIds?: Set<string>;
  details?: Record<string, RowDetail | undefined>;
  source?: 'live' | 'inbox';
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[15px]">
        <thead className="bg-zinc-50/80 text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
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
                <td className="px-4 py-3.5"><DocsCell d={d} source={source} /></td>
                <td className="px-4 py-3.5 text-zinc-300 group-hover:text-indigo-400 transition-colors"><ChevronRight size={18} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
