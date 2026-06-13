'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type OrderSummary } from './api';
import { skuImage } from './skuImage';

// The order LIST is sparse (id, sellerOrderId, status). To show SKU, amount and
// document buttons in the table we resolve each row's detail once and cache it.
export interface RowDetail {
  packetId: string | null;
  sku: string | null;
  amount: number | null;
  image: string | null;
  qty: number | null;
  status: string | null; // detail status_code (authoritative; the list summary omits it)
  invoiceNumber: string | null;
  invoiceDate: string | null;
  total: number | null; // sum of line final amounts
  tax: number | null;   // sum of unit tax across all lines
}

const EMPTY: RowDetail = {
  packetId: null, sku: null, amount: null, image: null, qty: null, status: null,
  invoiceNumber: null, invoiceDate: null, total: null, tax: null,
};

export function useRowDetails(orders: OrderSummary[], source: 'live' | 'inbox' = 'live'): Record<string, RowDetail | undefined> {
  const [map, setMap] = useState<Record<string, RowDetail>>({});
  const cache = useRef<Record<string, RowDetail>>({});

  // Stable dependency: the set of seller IDs in view, as a string. This avoids
  // re-running on every render just because `orders` is a fresh array reference.
  const idsKey = orders.map((o) => o.orderLines?.[0]?.sellerOrderId).filter(Boolean).join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey ? idsKey.split(',') : [];
    const todo = ids.filter((s) => !(s in cache.current));

    if (!todo.length) {
      // Sync state to cache only if a visible id is missing — return the same
      // reference otherwise so React bails out (no re-render, no loop).
      setMap((prev) => (ids.every((s) => s in prev) ? prev : { ...cache.current }));
      return;
    }

    Promise.all(
      todo.map(async (sid) => {
        try {
          const d = await api.orderDetail(sid, source);
          if (d.ok) {
            const lines: any[] = d.detail?.orderLineEntries || [];
            const first = lines[0] || {};
            const withPacket = lines.find((l) => l.packetId);
            const withInvoice = lines.find((l) => l.invoiceNumber);
            const total = lines.reduce((s, l) => s + (Number(l.lineFinalAmount ?? l.mrp) || 0), 0) || null;
            const tax = lines.reduce(
              (s, l) => s + (Array.isArray(l.taxEntries) ? l.taxEntries.reduce((t: number, e: any) => t + (Number(e.unitTaxAmount) || 0), 0) : 0),
              0,
            ) || null;
            cache.current[sid] = {
              packetId: withPacket?.packetId ?? null,
              sku: first.sku ?? null,
              amount: first.lineFinalAmount ?? first.mrp ?? null,
              image: first.imageUrl ?? first.image ?? skuImage(first.sku) ?? null,
              qty: lines.length || null,
              status: first.status_code ?? null,
              invoiceNumber: withInvoice?.invoiceNumber ?? null,
              invoiceDate: withInvoice?.invoiceDate ?? null,
              total,
              tax,
            };
          } else {
            cache.current[sid] = EMPTY;
          }
        } catch {
          cache.current[sid] = EMPTY;
        }
      }),
    ).then(() => { if (!cancelled) setMap({ ...cache.current }); });

    return () => { cancelled = true; };
  }, [idsKey]);

  return map;
}
