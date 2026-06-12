'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type OrderSummary } from './api';

// The order LIST is sparse (id, sellerOrderId, status). To show SKU, amount and
// document buttons in the table we resolve each row's detail once and cache it.
export interface RowDetail {
  packetId: string | null;
  sku: string | null;
  amount: number | null;
  image: string | null;
  qty: number | null;
  status: string | null; // detail status_code (authoritative; the list summary omits it)
}

const EMPTY: RowDetail = { packetId: null, sku: null, amount: null, image: null, qty: null, status: null };

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
            cache.current[sid] = {
              packetId: withPacket?.packetId ?? null,
              sku: first.sku ?? null,
              amount: first.lineFinalAmount ?? first.mrp ?? null,
              image: first.imageUrl ?? first.image ?? null,
              qty: lines.length || null,
              status: first.status_code ?? null,
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
