'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RotateCw, Search, Loader2, Package, Boxes, CheckCircle2, PackageX, Check, X, Pencil,
  Plus, Trash2, Upload, FileSpreadsheet, Download as DownloadIcon, AlertTriangle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, type CatalogStockItem } from '@/lib/api';
import { skuImage } from '@/lib/skuImage';
import HoverImage from '@/components/HoverImage';
import { useNotifications } from '@/components/NotificationProvider';
import { cx } from '@/lib/utils';

const PAGE_SIZE = 12;
const WAREHOUSE = '84502';
const DEFAULT_SLA = '5';
type StockFilter = 'all' | 'in' | 'out';
type Tab = 'live' | 'bulk';

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>('live');

  // Live-stock state lives here so it survives tab switches.
  const [items, setItems] = useState<CatalogStockItem[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [page, setPage] = useState(0);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((refresh = false) => {
    setError(null);
    if (refresh) setItems(null);
    const tick = async (first: boolean) => {
      const r = await api.catalogStock(first && refresh);
      if (r.status === 'error') { setError(r.error || 'Failed to load stock.'); setProgress(null); return; }
      if (r.status === 'running') {
        setProgress({ done: r.done || 0, total: r.total || 0 });
        pollRef.current = setTimeout(() => tick(false), 1500);
        return;
      }
      setItems((r.items || []).filter((i) => i.onMyntra));
      setProgress(null);
    };
    tick(true).catch((e) => setError(String(e?.message || e)));
  }, []);

  useEffect(() => {
    load(false);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [load]);

  const stats = useMemo(() => {
    const list = items || [];
    const inStock = list.filter((i) => (i.total || 0) > 0);
    return { total: list.length, inStock: inStock.length, out: list.length - inStock.length, units: inStock.reduce((a, i) => a + (i.total || 0), 0) };
  }, [items]);

  const filtered = useMemo(() => {
    let list = items || [];
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((i) => i.sku.toLowerCase().includes(needle));
    if (filter === 'in') list = list.filter((i) => (i.total || 0) > 0);
    if (filter === 'out') list = list.filter((i) => (i.total || 0) === 0);
    return [...list].sort((a, b) => (b.total || 0) - (a.total || 0));
  }, [items, q, filter]);

  useEffect(() => { setPage(0); }, [q, filter, items]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const applyLocal = useCallback((sku: string, qty: number) => {
    setItems((prev) => (prev || []).map((i) => (i.sku === sku ? { ...i, total: qty, active: qty } : i)));
  }, []);

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <h1 className="text-[22px] font-bold text-zinc-900 tracking-tight">Inventory</h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">Live Myntra stock — view, edit inline, or bulk-update · warehouse {WAREHOUSE}</p>
        </div>
        {tab === 'live' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU…"
                className="w-52 pl-8 pr-3 py-2 text-[12px] bg-white border border-black/[0.08] rounded-xl focus:border-indigo-400 outline-none" />
            </div>
            <button onClick={() => load(true)} disabled={!!progress}
              className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50">
              <RotateCw size={13} className={progress ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="inline-flex rounded-xl bg-zinc-100 p-0.5 mb-5">
        {([['live', 'Live stock'], ['bulk', 'Bulk update']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={cx('px-3.5 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all', tab === t ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'live' ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <StatCard icon={Boxes} label="SKUs on Myntra" value={stats.total} tone="indigo" loading={!items} onClick={() => setFilter('all')} active={filter === 'all'} />
            <StatCard icon={CheckCircle2} label="In stock" value={stats.inStock} tone="emerald" loading={!items} onClick={() => setFilter('in')} active={filter === 'in'} />
            <StatCard icon={PackageX} label="Out of stock" value={stats.out} tone="rose" loading={!items} onClick={() => setFilter('out')} active={filter === 'out'} />
            <StatCard icon={Package} label="Total units" value={stats.units} tone="violet" loading={!items} />
          </div>

          {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 mb-5">{error}</div>}

          {progress ? (
            <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-6">
              <div className="flex items-center gap-2.5 text-[14px] font-semibold text-zinc-800">
                <Loader2 size={16} className="animate-spin text-indigo-500" /> Checking Myntra inventory…
              </div>
              <p className="text-[12px] text-zinc-500 mt-1">{progress.total ? `${progress.done} of ${progress.total} SKUs` : 'Starting…'}</p>
              <div className="mt-3 h-2 rounded-full bg-zinc-100 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-600 to-violet-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
                <div className="overflow-x-auto">
                  <table className="w-full text-[15px]">
                    <thead className="bg-zinc-50/80 text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
                      <tr>
                        <th className="px-4 py-3 text-left">Item</th>
                        <th className="px-4 py-3 text-right w-52">Stock</th>
                        <th className="px-4 py-3 text-left w-40">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {pageItems.length === 0 && (
                        <tr><td colSpan={3} className="px-4 py-14 text-center text-sm text-zinc-400">No SKUs for this view.</td></tr>
                      )}
                      {pageItems.map((it) => <StockRow key={it.sku} item={it} onSaved={applyLocal} />)}
                    </tbody>
                  </table>
                </div>
              </div>

              {filtered.length > PAGE_SIZE && (
                <div className="flex items-center justify-center gap-3 mt-4">
                  <button disabled={page <= 0} onClick={() => setPage((p) => p - 1)}
                    className="px-3 py-1.5 text-[12px] bg-white border border-black/[0.08] rounded-lg disabled:opacity-40 hover:bg-zinc-50">← Prev</button>
                  <span className="text-[12px] text-zinc-500">Page {page + 1} of {totalPages} · {filtered.length} SKUs</span>
                  <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1.5 text-[12px] bg-white border border-black/[0.08] rounded-lg disabled:opacity-40 hover:bg-zinc-50">Next →</button>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <BulkUpdate />
      )}
    </>
  );
}

// ───────────────────────── Live-stock row (inline edit) ─────────────────────────
function Thumb({ image, size = 14 }: { image: string | null | undefined; size?: number }) {
  const cls = size === 14 ? 'w-14 h-14 rounded-xl' : 'w-12 h-12 rounded-lg';
  return (
    <HoverImage src={image}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className={cx(cls, 'object-cover border border-zinc-200 shrink-0 cursor-zoom-in')} />
      ) : (
        <div className={cx(cls, 'bg-gradient-to-br from-zinc-50 to-zinc-100 border border-zinc-200 flex items-center justify-center shrink-0')}>
          <Package size={size === 14 ? 22 : 18} className="text-zinc-300" />
        </div>
      )}
    </HoverImage>
  );
}

function StockRow({ item, onSaved }: { item: CatalogStockItem; onSaved: (sku: string, qty: number) => void }) {
  const { pushToast } = useNotifications();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(item.total ?? 0));
  const [busy, setBusy] = useState(false);
  const inStock = (item.total || 0) > 0;

  async function save() {
    const qty = Number(val);
    if (!Number.isFinite(qty) || qty < 0) { pushToast({ tone: 'err', title: 'Invalid quantity', message: 'Enter a non-negative number.' }); return; }
    if (qty === (item.total ?? 0)) { setEditing(false); return; }
    setBusy(true);
    try {
      const res = await api.updateInventory([{ sku: item.sku, quantity: qty, store_code: WAREHOUSE }]);
      if (res.ok && (res.succeeded ?? 0) > 0) {
        pushToast({ tone: 'ok', title: 'Stock updated', message: `${item.sku} → ${qty} units on Myntra` });
        onSaved(item.sku, qty);
        setEditing(false);
      } else {
        const msg = res.failed?.[0]?.remarks || res.chunkErrors?.[0]?.message || res.error || 'Myntra rejected the update.';
        pushToast({ tone: 'err', title: 'Update failed', message: msg });
      }
    } catch (e: any) {
      pushToast({ tone: 'err', title: 'Network error', message: e.message });
    } finally { setBusy(false); }
  }

  function cancel() { setEditing(false); setVal(String(item.total ?? 0)); }

  return (
    <tr className="group hover:bg-indigo-50/40 transition-colors">
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3.5">
          <Thumb image={skuImage(item.sku)} />
          <span className="font-semibold text-[15px] text-zinc-900">{item.sku}</span>
        </div>
      </td>
      <td className="px-4 py-3.5 text-right">
        {editing ? (
          <div className="flex items-center justify-end gap-1.5">
            <input autoFocus type="number" min={0} value={val} onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
              className="w-20 px-2 py-1.5 text-[14px] text-right bg-white border border-indigo-300 rounded-md outline-none focus:ring-2 focus:ring-indigo-100 tabular-nums" />
            <button onClick={save} disabled={busy} title="Save to Myntra"
              className="inline-flex items-center justify-center w-8 h-8 text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}
            </button>
            <button onClick={cancel} disabled={busy} title="Cancel"
              className="inline-flex items-center justify-center w-8 h-8 text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 rounded-md disabled:opacity-50">
              <X size={15} />
            </button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)}
            className="inline-flex items-center gap-2 px-2 py-1 rounded-md hover:bg-zinc-100 transition-colors">
            <span className={cx('text-[15px] font-semibold tabular-nums', inStock ? 'text-zinc-900' : 'text-rose-500')}>{item.total ?? 0}</span>
            <Pencil size={12} className="text-zinc-300 group-hover:text-indigo-400 transition-colors" />
          </button>
        )}
      </td>
      <td className="px-4 py-3.5">
        <span className={cx('px-2 py-0.5 rounded-full text-[11px] font-semibold', inStock ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600')}>
          {inStock ? 'In stock' : 'Out of stock'}
        </span>
      </td>
    </tr>
  );
}

// ───────────────────────── Bulk update (Excel / manual) ─────────────────────────
interface BulkRow { sku: string; quantity: string; processingSla: string; store_code: string }
const blankRow = (): BulkRow => ({ sku: '', quantity: '', processingSla: DEFAULT_SLA, store_code: WAREHOUSE });
interface Result { ok: boolean; submitted?: number; succeeded?: number; failed?: any[]; chunkErrors?: any[]; error?: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const FIELD_ALIASES: Record<keyof BulkRow, string[]> = {
  sku: ['sku', 'sellersku', 'skucode', 'barcode', 'ean', 'item'],
  quantity: ['quantity', 'qty', 'inventory', 'inventorycount', 'stock', 'count'],
  processingSla: ['sla', 'processingsla', 'leadtime', 'days'],
  store_code: ['storecode', 'store', 'storeid', 'warehouse', 'warehousecode'],
};

function BulkUpdate() {
  const [rows, setRows] = useState<BulkRow[]>([blankRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [fromExcel, setFromExcel] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { pushToast } = useNotifications();

  const update = (i: number, key: keyof BulkRow, val: string) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: val } : row)));
  const addRow = () => setRows((r) => [...r, blankRow()]);
  const removeRow = (i: number) => setRows((r) => (r.length === 1 ? [blankRow()] : r.filter((_, idx) => idx !== i)));

  async function onExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const objs: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        let parsed: BulkRow[] = [];
        if (objs.length) {
          const keys = Object.keys(objs[0]);
          const colFor = (field: keyof BulkRow) => keys.find((k) => FIELD_ALIASES[field].includes(norm(k)));
          const cSku = colFor('sku'), cQty = colFor('quantity'), cSla = colFor('processingSla'), cStore = colFor('store_code');
          if (cSku && cQty) {
            parsed = objs.map((o) => ({
              sku: String(o[cSku] ?? '').trim(),
              quantity: String(o[cQty] ?? '').trim(),
              processingSla: String(cSla ? o[cSla] : '').trim() || DEFAULT_SLA,
              store_code: String(cStore ? o[cStore] : '').trim() || WAREHOUSE,
            })).filter((r) => r.sku);
          }
        }
        if (!parsed.length) {
          const rowsArr: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          parsed = rowsArr
            .filter((r) => r[0] && !FIELD_ALIASES.sku.includes(norm(String(r[0]))))
            .map((r) => ({ sku: String(r[0]).trim(), quantity: String(r[1] ?? '').trim(), processingSla: String(r[2] ?? '').trim() || DEFAULT_SLA, store_code: String(r[3] ?? '').trim() || WAREHOUSE }))
            .filter((r) => r.sku);
        }
        if (!parsed.length) { pushToast({ tone: 'err', title: 'No rows found', message: 'Need columns for SKU and Quantity.' }); }
        else { setRows(parsed); setResult(null); setFromExcel(true); pushToast({ tone: 'ok', title: 'Excel loaded', message: `${parsed.length} row(s) ready to review.` }); }
      } catch (err: any) {
        pushToast({ tone: 'err', title: 'Could not read file', message: err.message });
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['SKU', 'Quantity', 'Processing SLA', 'Store Code'], ['Earrings632', 25, 5, WAREHOUSE]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
    XLSX.writeFile(wb, 'inventory_update_template.xlsx');
  }

  async function submit() {
    const items = rows.filter((r) => r.sku.trim()).map((r) => ({ sku: r.sku.trim(), quantity: r.quantity, processingSla: r.processingSla, store_code: r.store_code.trim() }));
    if (!items.length) { pushToast({ tone: 'err', title: 'No SKUs', message: 'Add at least one SKU row.' }); return; }
    setSubmitting(true); setResult(null);
    try {
      const res = await api.updateInventory(items);
      if (!res.ok) { pushToast({ tone: 'err', title: 'Update failed', message: res.error || `HTTP ${res.httpStatus}` }); setResult(res); return; }
      setResult(res);
      const failedN = (res.failed?.length || 0) + (res.chunkErrors?.flatMap((e: any) => e.skus)?.length || 0);
      pushToast({
        tone: failedN ? 'err' : 'ok',
        title: failedN ? `${res.succeeded}/${res.submitted} updated` : 'Inventory updated',
        message: failedN ? `${failedN} SKU(s) rejected — see below.` : `${res.succeeded} SKU(s) updated on Myntra.`,
      });
    } catch (e: any) {
      pushToast({ tone: 'err', title: 'Network error', message: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  const failedRows = [
    ...(result?.failed || []).map((f: any) => ({ sku: f.sku, remarks: f.remarks || 'Rejected', store: f.store_code })),
    ...(result?.chunkErrors || []).flatMap((e: any) => (e.skus || []).map((s: string) => ({ sku: s, remarks: e.message || 'Batch failed', store: '' }))),
  ];

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <p className="text-[12.5px] text-zinc-500">
          {fromExcel ? `Reviewing ${rows.filter((r) => r.sku.trim()).length} row(s) from your sheet — edit if needed, then push.` : 'Upload an Excel/CSV or add rows manually, then push the snapshot to Myntra. Sent in batches of 10.'}
        </p>
        <div className="flex items-center gap-2">
          <button onClick={downloadTemplate} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors">
            <DownloadIcon size={13} /> Template
          </button>
          <label className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer">
            <FileSpreadsheet size={13} /> Upload Excel
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onExcel} className="hidden" />
          </label>
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50/80 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Seller SKU</th>
                <th className="px-4 py-3 text-left w-32">Quantity</th>
                <th className="px-4 py-3 text-left w-36">SLA (days)</th>
                <th className="px-4 py-3 text-left w-32">Store</th>
                <th className="px-4 py-3 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Thumb image={skuImage(row.sku)} size={12} />
                      <input value={row.sku} onChange={(e) => update(i, 'sku', e.target.value)} placeholder="e.g. Earrings632"
                        className="w-full px-2.5 py-2.5 text-[13px] font-mono bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <input value={row.quantity} onChange={(e) => update(i, 'quantity', e.target.value)} type="number" min={0} placeholder="0"
                      className="w-full px-2.5 py-2.5 text-[13px] bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                  </td>
                  <td className="px-4 py-2">
                    <input value={row.processingSla} onChange={(e) => update(i, 'processingSla', e.target.value)} type="number" min={0}
                      className="w-full px-2.5 py-2.5 text-[13px] bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                  </td>
                  <td className="px-4 py-2">
                    <input value={row.store_code} onChange={(e) => update(i, 'store_code', e.target.value)} placeholder={WAREHOUSE}
                      className="w-full px-2.5 py-2.5 text-[13px] font-mono bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button onClick={() => removeRow(i)} className="text-zinc-300 hover:text-rose-500 transition-colors"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-black/[0.05]">
          <button onClick={addRow} className="flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 hover:text-indigo-800">
            <Plus size={14} /> Add SKU
          </button>
          <button onClick={submit} disabled={submitting}
            className="flex items-center gap-1.5 px-5 py-2 text-[12px] font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50">
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Update on Myntra
          </button>
        </div>
      </div>

      {result?.ok && (
        <div className="mt-4 rounded-2xl bg-white border border-black/[0.06] p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            {failedRows.length === 0 ? <CheckCircle2 size={16} className="text-emerald-500" /> : <AlertTriangle size={16} className="text-amber-500" />}
            <span className="text-[13px] font-semibold text-zinc-800">{result.succeeded}/{result.submitted} SKU(s) updated on Myntra</span>
          </div>
          {failedRows.length > 0 && (
            <div className="rounded-lg border border-rose-200/70 overflow-hidden">
              <table className="w-full text-[11px]">
                <thead className="bg-rose-50 text-[9px] uppercase text-rose-600">
                  <tr><th className="px-3 py-1.5 text-left">SKU</th><th className="px-3 py-1.5 text-left">Store</th><th className="px-3 py-1.5 text-left">Reason</th></tr>
                </thead>
                <tbody className="divide-y divide-rose-100">
                  {failedRows.map((f, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 font-mono text-zinc-700">{f.sku}</td>
                      <td className="px-3 py-1.5 font-mono text-zinc-500">{f.store || '—'}</td>
                      <td className="px-3 py-1.5 text-rose-600">{f.remarks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

const TONES: Record<string, string> = {
  indigo: 'bg-indigo-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  rose: 'bg-rose-50 text-rose-600',
  violet: 'bg-violet-50 text-violet-600',
};

function StatCard({ icon: Icon, label, value, tone, loading, onClick, active }: { icon: LucideIcon; label: string; value: number; tone: string; loading: boolean; onClick?: () => void; active?: boolean }) {
  return (
    <div onClick={onClick}
      className={cx(
        'bg-white border rounded-2xl p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all',
        onClick && 'cursor-pointer hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)] hover:border-black/[0.12]',
        active ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-black/[0.06]',
      )}>
      <div className="flex items-center gap-2 mb-2">
        <div className={cx('w-7 h-7 rounded-lg flex items-center justify-center', TONES[tone])}><Icon size={15} /></div>
        <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-[26px] font-bold text-zinc-900 tabular-nums leading-none">{loading ? '—' : value.toLocaleString('en-IN')}</p>
    </div>
  );
}
