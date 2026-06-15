'use client';

import { useRef, useState } from 'react';
import { Boxes, Plus, Trash2, Upload, Loader2, FileSpreadsheet, Download as DownloadIcon, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { skuImage } from '@/lib/skuImage';
import HoverImage from '@/components/HoverImage';
import { useNotifications } from '@/components/NotificationProvider';

interface Row { sku: string; quantity: string; processingSla: string; store_code: string }

const DEFAULT_STORE = '84502';
const DEFAULT_SLA = '5';
const blankRow = (): Row => ({ sku: '', quantity: '', processingSla: DEFAULT_SLA, store_code: DEFAULT_STORE });

interface Result { ok: boolean; submitted?: number; succeeded?: number; failed?: any[]; chunkErrors?: any[]; error?: string }

// Map a header label to one of our fields (lowercased, non-letters stripped).
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const FIELD_ALIASES: Record<keyof Row, string[]> = {
  sku: ['sku', 'sellersku', 'skucode', 'barcode', 'ean', 'item'],
  quantity: ['quantity', 'qty', 'inventory', 'inventorycount', 'stock', 'count'],
  processingSla: ['sla', 'processingsla', 'leadtime', 'days'],
  store_code: ['storecode', 'store', 'storeid', 'warehouse', 'warehousecode'],
};

export default function InventoryPage() {
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { pushToast } = useNotifications();

  const update = (i: number, key: keyof Row, val: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: val } : row)));
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
        let parsed: Row[] = [];
        if (objs.length) {
          // Header-based: match columns by alias.
          const keys = Object.keys(objs[0]);
          const colFor = (field: keyof Row) => keys.find((k) => FIELD_ALIASES[field].includes(norm(k)));
          const cSku = colFor('sku'), cQty = colFor('quantity'), cSla = colFor('processingSla'), cStore = colFor('store_code');
          if (cSku && cQty) {
            parsed = objs.map((o) => ({
              sku: String(o[cSku] ?? '').trim(),
              quantity: String(o[cQty] ?? '').trim(),
              processingSla: String(cSla ? o[cSla] : '').trim() || DEFAULT_SLA,
              store_code: String(cStore ? o[cStore] : '').trim() || DEFAULT_STORE,
            })).filter((r) => r.sku);
          }
        }
        if (!parsed.length) {
          // Fallback: positional columns A=sku, B=qty, C=sla, D=store (skip a header row).
          const rowsArr: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          parsed = rowsArr
            .filter((r) => r[0] && !FIELD_ALIASES.sku.includes(norm(String(r[0]))))
            .map((r) => ({ sku: String(r[0]).trim(), quantity: String(r[1] ?? '').trim(), processingSla: String(r[2] ?? '').trim() || DEFAULT_SLA, store_code: String(r[3] ?? '').trim() || DEFAULT_STORE }))
            .filter((r) => r.sku);
        }
        if (!parsed.length) { pushToast({ tone: 'err', title: 'No rows found', message: 'Need columns for SKU and Quantity.' }); }
        else { setRows(parsed); setResult(null); pushToast({ tone: 'ok', title: 'Excel loaded', message: `${parsed.length} row(s) ready to review.` }); }
      } catch (err: any) {
        pushToast({ tone: 'err', title: 'Could not read file', message: err.message });
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['SKU', 'Quantity', 'Processing SLA', 'Store Code'], ['8903880486532', 25, 5, '84502']]);
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
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-base font-semibold text-zinc-900 flex items-center gap-2">
          <Boxes size={17} className="text-indigo-500" /> Update inventory
        </h2>
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
      <p className="text-xs text-zinc-500 mb-4">Push the latest stock snapshot to Myntra (Seller API). Enter rows manually or upload an Excel sheet — columns: <code className="font-mono text-zinc-600">SKU, Quantity, Processing SLA, Store Code</code>. Sent in batches of 10 automatically.</p>

      <div className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50/80 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Seller SKU</th>
              <th className="px-4 py-3 text-left w-32">Quantity</th>
              <th className="px-4 py-3 text-left w-36">Processing SLA (days)</th>
              <th className="px-4 py-3 text-left w-36">Store code</th>
              <th className="px-4 py-3 w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <HoverImage src={skuImage(row.sku)}>
                      {skuImage(row.sku)
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={skuImage(row.sku) as string} alt="" className="w-12 h-12 rounded-lg object-cover border border-black/[0.06] shrink-0 cursor-zoom-in" />
                        : <div className="w-12 h-12 rounded-lg bg-zinc-100 shrink-0" />}
                    </HoverImage>
                    <input value={row.sku} onChange={(e) => update(i, 'sku', e.target.value)} placeholder="e.g. 8903880486532"
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
                  <input value={row.store_code} onChange={(e) => update(i, 'store_code', e.target.value)} placeholder="84502"
                    className="w-full px-2.5 py-2.5 text-[13px] font-mono bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                </td>
                <td className="px-4 py-2 text-center">
                  <button onClick={() => removeRow(i)} className="text-zinc-300 hover:text-rose-500 transition-colors"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
