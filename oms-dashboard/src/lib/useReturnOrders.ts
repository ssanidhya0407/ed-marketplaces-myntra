'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { skuImage } from './skuImage';

// Resolve each return to the product that was returned, by looking up its parent order
// (live getOrderById) and finding the order line. Cached per return id.
export interface ReturnProduct { sku: string | null; image: string | null; amount: number | null }

export function useReturnOrders(
  returns: Array<{ id: string; sellerOrderId: string | null; orderLineId: string | number | null }>,
): Record<string, ReturnProduct | undefined> {
  const [map, setMap] = useState<Record<string, ReturnProduct>>({});
  const cache = useRef<Record<string, ReturnProduct>>({});
  const key = returns.map((r) => r.id).join(',');

  useEffect(() => {
    let cancelled = false;
    const todo = returns.filter((r) => !(r.id in cache.current)).slice(0, 40);
    if (!todo.length) {
      setMap((m) => (returns.every((r) => r.id in m) ? m : { ...cache.current }));
      return;
    }
    (async () => {
      for (const r of todo) {
        try {
          if (!r.sellerOrderId) { cache.current[r.id] = { sku: null, image: null, amount: null }; continue; }
          const od = await api.orderDetail(r.sellerOrderId, 'live');
          const lines: any[] = od.detail?.orderLineEntries || [];
          const line = lines.find((l) => String(l.orderLineId) === String(r.orderLineId)) || lines[0];
          const sku = line?.sku ?? null;
          cache.current[r.id] = { sku, image: skuImage(sku), amount: line?.lineFinalAmount ?? line?.mrp ?? null };
        } catch { cache.current[r.id] = { sku: null, image: null, amount: null }; }
      }
      if (!cancelled) setMap({ ...cache.current });
    })();
    return () => { cancelled = true; };
  }, [key]);

  return map;
}
