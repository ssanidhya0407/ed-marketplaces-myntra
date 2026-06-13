'use client';

import { useState } from 'react';
import { Boxes, Plus, Trash2, Upload, Loader2, RotateCw, Search, Download as DownloadIcon, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useNotifications } from '@/components/NotificationProvider';

interface Row { sku: string; store_code: string; current: number | null; newQty: string; sla: string; notFound?: boolean; blocked?: boolean }

const DEFAULT_STORE = '84502';
const DEFAULT_SLA = '5';

export default function InventoryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [bulk, setBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [loadingSkus, setLoadingSkus] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { pushToast } = useNotifications();

  const update = (i: number, key: keyof Row, val: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: val } : row)));
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  // Fetch current stock (and real store codes) for the given SKUs, preserving any
  // quantities already typed. One row per (sku, store) Myntra reports.
  async function checkCurrent(skuList: string[]) {
    const skus = [...new Set(skuList.map((s) => s.trim()).filter(Boolean))];
    if (!skus.length) { pushToast({ tone: 'err', title: 'No SKUs', message: 'Add SKUs first.' }); return; }
    setLoadingCurrent(true);
    try {
      const res = await api.searchInventory(skus);
      if (!res.ok) { pushToast({ tone: 'err', title: 'Lookup failed', message: res.error || `HTTP ${res.httpStatus}` }); return; }
      const inv = res.inventory || {};
      const failed = res.failed || [];
      const blocked = res.blocked || [];
      const typed: Record<string, string> = {};
      rows.forEach((r) => { if (r.newQty) typed[r.sku] = r.newQty; });
      const next: Row[] = [];
      for (const sku of skus) {
        const stores = inv[sku];
        if (stores && stores.length) {
          for (const s of stores) next.push({ sku, store_code: s.store_code || DEFAULT_STORE, current: s.count ?? null, newQty: typed[sku] || '', sla: DEFAULT_SLA });
        } else {
          next.push({ sku, store_code: DEFAULT_STORE, current: null, newQty: typed[sku] || '', sla: DEFAULT_SLA, notFound: failed.includes(sku), blocked: blocked.includes(sku) });
        }
      }
      setRows(next);
      if (failed.length) pushToast({ tone: 'err', title: `${failed.length} SKU(s) not in inventory`, message: failed.join(', ').slice(0, 120) });
    } catch (e: any) {
      pushToast({ tone: 'err', title: 'Network error', message: e.message });
    } finally {
      setLoadingCurrent(false);
    }
  }

  async function loadFromOrders() {
    setLoadingSkus(true);
    try {
      const res = await api.listSkus();
      if (!res.ok || !res.skus?.length) { pushToast({ tone: 'err', title: 'No SKUs found', message: res.error || 'No SKUs on recent orders.' }); return; }
      await checkCurrent(res.skus);
    } catch (e: any) {
      pushToast({ tone: 'err', title: 'Network error', message: e.message });
    } finally {
      setLoadingSkus(false);
    }
  }

  function applyBulk() {
    const skus = bulk.split(/\r?\n/).map((l) => l.trim().split(/[,\t]/)[0].trim()).filter(Boolean);
    if (!skus.length) { pushToast({ tone: 'err', title: 'Nothing to parse', message: 'One SKU per line.' }); return; }
    setShowBulk(false); setBulk('');
    checkCurrent(skus);
  }

  async function submit() {
    const items = rows.filter((r) => r.sku.trim() && r.newQty !== '').map((r) => ({ sku: r.sku.trim(), quantity: r.newQty, processingSla: r.sla, store_code: r.store_code.trim() }));
    if (!items.length) { pushToast({ tone: 'err', title: 'Nothing to update', message: 'Enter a new quantity on at least one row.' }); return; }
    setSubmitting(true);
    try {
      const res = await api.updateInventory(items);
      if (!res.ok) { pushToast({ tone: 'err', title: 'Update failed', message: res.error || `HTTP ${res.httpStatus}` }); return; }
      const failedN = (res.failed?.length || 0) + (res.chunkErrors?.flatMap((e: any) => e.skus)?.length || 0);
      pushToast({
        tone: failedN ? 'err' : 'ok',
        title: failedN ? `${res.succeeded}/${res.submitted} updated` : 'Inventory updated',
        message: failedN ? `${failedN} SKU(s) rejected.` : `${res.succeeded} SKU(s) updated on Myntra.`,
      });
      // Refresh current stock for the SKUs we just pushed, then clear the inputs.
      await checkCurrent([...new Set(items.map((i) => i.sku))]);
      setRows((r) => r.map((row) => ({ ...row, newQty: '' })));
    } catch (e: any) {
      pushToast({ tone: 'err', title: 'Network error', message: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  const dirtyCount = rows.filter((r) => r.newQty !== '').length;

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-base font-semibold text-zinc-900 flex items-center gap-2">
          <Boxes size={17} className="text-indigo-500" /> Inventory
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={loadFromOrders} disabled={loadingSkus || loadingCurrent}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors disabled:opacity-50">
            {loadingSkus ? <Loader2 size={13} className="animate-spin" /> : <DownloadIcon size={13} />} Load from orders
          </button>
          <button onClick={() => setShowBulk((s) => !s)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors">
            <Upload size={13} /> Paste SKUs
          </button>
        </div>
      </div>
      <p className="text-xs text-zinc-500 mb-4">Live stock from Myntra shown beside the new value. Edit, then push the snapshot back (Seller API — works while the M-Direct panel is closed).</p>

      {showBulk && (
        <div className="rounded-2xl bg-white border border-black/[0.06] p-4 mb-4 shadow-sm">
          <div className="text-[11px] font-semibold text-zinc-500 mb-1.5">One SKU per line — we’ll fetch current stock for each.</div>
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={5} placeholder={`Earrings632\nBracelet088\nNecklace214`}
            className="w-full px-3 py-2 text-[12px] font-mono bg-zinc-50 border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setShowBulk(false); setBulk(''); }} className="px-3 py-1.5 text-[11px] font-medium text-zinc-600 hover:text-zinc-900">Cancel</button>
            <button onClick={applyBulk} className="px-3.5 py-1.5 text-[11px] font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Look up</button>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
        {rows.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-zinc-500">
            {loadingCurrent || loadingSkus
              ? <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Fetching current stock from Myntra…</span>
              : <>Load your SKUs to see current stock. Use <span className="font-semibold text-zinc-700">Load from orders</span> or <span className="font-semibold text-zinc-700">Paste SKUs</span>.</>}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50/80 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Seller SKU</th>
                <th className="px-4 py-3 text-left w-28">Store</th>
                <th className="px-4 py-3 text-right w-32">Current stock</th>
                <th className="px-4 py-3 text-left w-40">New quantity</th>
                <th className="px-4 py-3 text-left w-28">SLA (days)</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row, i) => (
                <tr key={`${row.sku}-${row.store_code}-${i}`} className={row.notFound ? 'bg-rose-50/30' : ''}>
                  <td className="px-4 py-2 font-mono text-[12px] text-zinc-800">
                    {row.sku}
                    {row.notFound && <span className="ml-2 text-[10px] text-rose-500 font-sans">not in inventory</span>}
                    {row.blocked && <span className="ml-2 text-[10px] text-amber-600 font-sans">lookup blocked — retry</span>}
                  </td>
                  <td className="px-4 py-2">
                    <input value={row.store_code} onChange={(e) => update(i, 'store_code', e.target.value)}
                      className="w-20 px-2 py-1.5 text-[12px] font-mono bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className={`text-[14px] font-bold tabular-nums ${row.current == null ? 'text-zinc-300' : 'text-zinc-900'}`}>
                      {row.current == null ? '—' : row.current}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <ArrowRight size={12} className="text-zinc-300 shrink-0" />
                      <input value={row.newQty} onChange={(e) => update(i, 'newQty', e.target.value)} type="number" min={0} placeholder={row.current == null ? '0' : String(row.current)}
                        className="w-24 px-2.5 py-1.5 text-[12px] bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <input value={row.sla} onChange={(e) => update(i, 'sla', e.target.value)} type="number" min={0}
                      className="w-16 px-2 py-1.5 text-[12px] bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button onClick={() => removeRow(i)} className="text-zinc-300 hover:text-rose-500 transition-colors"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {rows.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-black/[0.05]">
            <button onClick={() => checkCurrent(rows.map((r) => r.sku))} disabled={loadingCurrent}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-600 hover:text-zinc-900 disabled:opacity-50">
              <RotateCw size={13} className={loadingCurrent ? 'animate-spin' : ''} /> Refresh current
            </button>
            <button onClick={submit} disabled={submitting || dirtyCount === 0}
              className="flex items-center gap-1.5 px-5 py-2 text-[12px] font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50">
              {submitting ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Update {dirtyCount > 0 ? `${dirtyCount} SKU${dirtyCount > 1 ? 's' : ''}` : ''} on Myntra
            </button>
          </div>
        )}
      </div>
    </>
  );
}
