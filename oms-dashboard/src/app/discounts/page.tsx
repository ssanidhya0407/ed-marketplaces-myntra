'use client';

import { useRef, useState } from 'react';
import { Percent, Plus, Trash2, Upload, Loader2, FileSpreadsheet, Download as DownloadIcon, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { skuImage } from '@/lib/skuImage';
import { useNotifications } from '@/components/NotificationProvider';

interface Row { sku: string; discount: string }
const blankRow = (): Row => ({ sku: '', discount: '' });
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

interface Result { ok: boolean; submitted?: number; succeeded?: number; results?: any[]; chunkErrors?: any[]; error?: string }

// datetime-local "yyyy-MM-ddTHH:mm" -> Myntra "dd-MM-yyyy HH:mm:ss"
function toMyntra(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:00` : v;
}
function defaultLocal(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function DiscountsPage() {
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [discountType, setDiscountType] = useState('FlatPercent');
  const [start, setStart] = useState(defaultLocal(0));
  const [end, setEnd] = useState(defaultLocal(30));
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { pushToast } = useNotifications();

  const update = (i: number, key: keyof Row, val: string) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: val } : row)));
  const addRow = () => setRows((r) => [...r, blankRow()]);
  const removeRow = (i: number) => setRows((r) => (r.length === 1 ? [blankRow()] : r.filter((_, idx) => idx !== i)));

  async function onExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const objs: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        let parsed: Row[] = [];
        if (objs.length) {
          const keys = Object.keys(objs[0]);
          const cSku = keys.find((k) => ['sku', 'sellersku', 'skucode', 'barcode'].includes(norm(k)));
          const cDisc = keys.find((k) => ['discount', 'discountpercent', 'percent', 'value', 'off'].includes(norm(k)));
          if (cSku && cDisc) parsed = objs.map((o) => ({ sku: String(o[cSku] ?? '').trim(), discount: String(o[cDisc] ?? '').trim() })).filter((r) => r.sku);
        }
        if (!parsed.length) {
          const arr: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
          parsed = arr.filter((r) => r[0] && norm(String(r[0])) !== 'sku').map((r) => ({ sku: String(r[0]).trim(), discount: String(r[1] ?? '').trim() })).filter((r) => r.sku);
        }
        if (!parsed.length) pushToast({ tone: 'err', title: 'No rows found', message: 'Need columns for SKU and Discount.' });
        else { setRows(parsed); setResult(null); pushToast({ tone: 'ok', title: 'Excel loaded', message: `${parsed.length} row(s) ready.` }); }
      } catch (err: any) { pushToast({ tone: 'err', title: 'Could not read file', message: err.message }); }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['SKU', 'Discount'], ['8903880486532', 25]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Discounts');
    XLSX.writeFile(wb, 'discount_update_template.xlsx');
  }

  async function submit() {
    const items = rows.filter((r) => r.sku.trim()).map((r) => ({ sku: r.sku.trim(), discount: r.discount }));
    if (!items.length) { pushToast({ tone: 'err', title: 'No SKUs', message: 'Add at least one SKU row.' }); return; }
    if (!start || !end) { pushToast({ tone: 'err', title: 'Dates required', message: 'Pick a start and end date.' }); return; }
    setSubmitting(true); setResult(null);
    try {
      const res = await api.overrideDiscount({ startDate: toMyntra(start), endDate: toMyntra(end), discountType, items });
      if (!res.ok) { pushToast({ tone: 'err', title: 'Update failed', message: res.error || `HTTP ${res.httpStatus}` }); setResult(res); return; }
      setResult(res);
      const failedN = (res.submitted || 0) - (res.succeeded || 0);
      pushToast({
        tone: failedN ? 'err' : 'ok',
        title: failedN ? `${res.succeeded}/${res.submitted} applied` : 'Discounts applied',
        message: failedN ? `${failedN} SKU(s) rejected — see below.` : `${res.succeeded} SKU(s) updated on Myntra.`,
      });
    } catch (e: any) { pushToast({ tone: 'err', title: 'Network error', message: e.message }); }
    finally { setSubmitting(false); }
  }

  const failedRows = [
    ...(result?.results || []).filter((e: any) => e.status && /invalid|error|fail/i.test(String(e.status))).map((e: any) => ({ sku: e.sku, remarks: e.status })),
    ...(result?.chunkErrors || []).flatMap((e: any) => (e.skus || []).map((s: string) => ({ sku: s, remarks: e.message || 'Batch failed' }))),
  ];

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-base font-semibold text-zinc-900 flex items-center gap-2"><Percent size={17} className="text-indigo-500" /> Discounts</h2>
        <div className="flex items-center gap-2">
          <button onClick={downloadTemplate} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-zinc-600 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"><DownloadIcon size={13} /> Template</button>
          <label className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer">
            <FileSpreadsheet size={13} /> Upload Excel
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onExcel} className="hidden" />
          </label>
        </div>
      </div>
      <p className="text-xs text-zinc-500 mb-4">Set the discount per SKU for a date range (Seller API). Set discount to <span className="font-semibold">0</span> to remove it. Sent in batches of 100.</p>

      {/* Controls */}
      <div className="rounded-2xl bg-white border border-black/[0.06] p-4 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 shadow-sm">
        <div>
          <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Discount type</label>
          <select value={discountType} onChange={(e) => setDiscountType(e.target.value)} className="mt-1 w-full px-3 py-2 text-[12px] bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400">
            <option value="FlatPercent">Flat percent (%)</option>
            <option value="RupeeOff">Rupee off (₹)</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Effective from</label>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full px-3 py-2 text-[12px] bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Until</label>
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full px-3 py-2 text-[12px] bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50/80 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Seller SKU</th>
              <th className="px-4 py-3 text-left w-44">Discount {discountType === 'RupeeOff' ? '(₹)' : '(%)'}</th>
              <th className="px-4 py-3 w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    {skuImage(row.sku)
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={skuImage(row.sku) as string} alt="" className="w-12 h-12 rounded-lg object-cover border border-black/[0.06] shrink-0" />
                      : <div className="w-12 h-12 rounded-lg bg-zinc-100 shrink-0" />}
                    <input value={row.sku} onChange={(e) => update(i, 'sku', e.target.value)} placeholder="e.g. 8903880486532" className="w-full px-2.5 py-2.5 text-[13px] font-mono bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                  </div>
                </td>
                <td className="px-4 py-2">
                  <input value={row.discount} onChange={(e) => update(i, 'discount', e.target.value)} type="number" min={0} placeholder="0" className="w-full px-2.5 py-2.5 text-[13px] bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                </td>
                <td className="px-4 py-2 text-center">
                  <button onClick={() => removeRow(i)} className="text-zinc-300 hover:text-rose-500 transition-colors"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-black/[0.05]">
          <button onClick={addRow} className="flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 hover:text-indigo-800"><Plus size={14} /> Add SKU</button>
          <button onClick={submit} disabled={submitting} className="flex items-center gap-1.5 px-5 py-2 text-[12px] font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50">
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Apply on Myntra
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
                <thead className="bg-rose-50 text-[9px] uppercase text-rose-600"><tr><th className="px-3 py-1.5 text-left">SKU</th><th className="px-3 py-1.5 text-left">Reason</th></tr></thead>
                <tbody className="divide-y divide-rose-100">
                  {failedRows.map((f, i) => (<tr key={i}><td className="px-3 py-1.5 font-mono text-zinc-700">{f.sku}</td><td className="px-3 py-1.5 text-rose-600">{f.remarks}</td></tr>))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
