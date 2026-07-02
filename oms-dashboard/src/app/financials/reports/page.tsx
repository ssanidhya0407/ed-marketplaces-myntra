'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, Download, FileSpreadsheet, Search, Table2, Hash } from 'lucide-react';
import { api, type PaymentReportResponse } from '@/lib/api';
import { formatINR, cx } from '@/lib/utils';

const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// [reportName, label, isMonthly]
const REPORTS: [string, string, boolean][] = [
  ['Sales_Revenue_Packed_B2C', 'Sales revenue', true], ['PG_Forward_Settled', 'Forward settlement', true],
  ['PG_Reverse_Settled', 'Reverse settlement (returns)', true], ['Non_Order_Deduction_Settled', 'Non-order deductions', true],
  ['Online_Goodwill_Recovery', 'Goodwill recovery', true], ['Failed_to_Supply_Charges', 'Failed-to-supply charges', true],
  ['COD_Goodwill_Recovery', 'COD goodwill recovery', true], ['SPF_Accepted', 'SPF accepted (one-time)', false],
];
const AMOUNT_RE = /amount|value|settle|commission|fee|tax|total|charge|pending|tcs|tds|revenue|discount|payable|mrp/i;
const inr = (n: number) => formatINR(n);
const humanize = (k: string) => k.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const isNum = (v: string) => v !== '' && v != null && Number.isFinite(Number(v));

function ReportsInner() {
  const params = useSearchParams();
  const now = new Date();
  const [reportName, setReportName] = useState(params.get('report') || 'PG_Forward_Settled');
  const [year, setYear] = useState(params.get('year') || String(now.getFullYear()));
  const [month, setMonth] = useState(params.get('month') || String(now.getMonth() + 1).padStart(2, '0'));
  const [data, setData] = useState<PaymentReportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const meta = REPORTS.find((r) => r[0] === reportName);
  const isMonthly = meta ? meta[2] : true;
  const label = meta ? meta[1] : reportName.replace(/_/g, ' ');
  const years = Array.from({ length: 3 }, (_, i) => String(now.getFullYear() - i));

  const load = useCallback(async () => {
    setBusy(true); setData(null);
    try {
      const r = await api.paymentReport({ reportType: isMonthly ? 'MONTHLY_REPORTS' : 'ONE_TIME_REPORTS', year, month: isMonthly ? month : undefined, reportName });
      setData(r);
    } catch (e: any) {
      setData({ ok: false, httpStatus: 0, error: e.message } as PaymentReportResponse);
    }
    setBusy(false);
  }, [reportName, year, month, isMonthly]);

  // Auto-load on first mount with whatever the URL / defaults specify.
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const columns = data?.columns || [];
  const rows = data?.rows || [];

  // Which columns are numeric (sampled) and money-like → become summed KPIs.
  const kpis = useMemo(() => {
    if (!rows.length) return [];
    const sample = rows.slice(0, 60);
    return columns
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => AMOUNT_RE.test(c) && sample.filter((r) => isNum(r[i])).length > sample.length * 0.5)
      .slice(0, 5)
      .map(({ c, i }) => ({ label: humanize(c), value: rows.reduce((s, r) => s + (Number(r[i]) || 0), 0) }));
  }, [columns, rows]);

  const numericCol = useMemo(() => {
    const sample = rows.slice(0, 60);
    return columns.map((_, i) => sample.length > 0 && sample.filter((r) => isNum(r[i])).length > sample.length * 0.5);
  }, [columns, rows]);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) => r.some((cell) => String(cell).toLowerCase().includes(needle)));
  }, [rows, q]);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Link href="/financials" className="w-9 h-9 rounded-xl bg-white border border-black/[0.08] flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:border-black/20 shadow-sm transition-all shrink-0" title="Back to Financials">
            <ArrowLeft size={17} />
          </Link>
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-sm"><FileSpreadsheet size={20} className="text-white" /></div>
          <div>
            <h1 className="text-[22px] font-bold text-zinc-900 tracking-tight leading-none">{label}</h1>
            <p className="text-[13px] text-zinc-500 mt-1.5">Myntra settlement report{isMonthly ? ` · ${MONTH_NAMES[Number(month)]} ${year}` : ' · one-time'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-white border border-black/[0.08] rounded-xl h-9 overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            <select value={reportName} onChange={(e) => setReportName(e.target.value)} className="px-3 h-full text-[12px] font-medium text-zinc-700 bg-transparent outline-none cursor-pointer max-w-[190px] truncate">{REPORTS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}</select>
          </div>
          {isMonthly && (
            <div className="flex items-center bg-white border border-black/[0.08] rounded-xl h-9 overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <select value={month} onChange={(e) => setMonth(e.target.value)} className="px-3 h-full text-[12px] font-medium text-zinc-700 bg-transparent outline-none cursor-pointer">{MONTHS.map((m) => <option key={m} value={m}>{MONTH_NAMES[Number(m)]}</option>)}</select>
              <span className="w-px h-4 bg-black/[0.08]" />
              <select value={year} onChange={(e) => setYear(e.target.value)} className="px-3 h-full text-[12px] font-medium text-zinc-700 bg-transparent outline-none cursor-pointer">{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            </div>
          )}
          <button onClick={load} disabled={busy} className="flex items-center gap-1.5 px-4 h-9 text-[12px] font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl hover:opacity-90 shadow-sm disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <Table2 size={13} />} Load</button>
          {data?.found && data.reportPath && <button onClick={() => window.open(data.reportPath, '_blank')} className="flex items-center gap-1.5 px-3 h-9 text-[12px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl"><Download size={13} /> CSV</button>}
        </div>
      </div>

      {busy ? (
        <div className="rounded-2xl bg-white border border-black/[0.06] px-4 py-24 text-center text-sm text-zinc-400 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin text-indigo-400" /> Fetching {label} from Myntra…</div>
      ) : !data ? null : !data.ok ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{data.error || 'Could not load the report.'}</div>
      ) : !data.found ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[13px] text-amber-800"><span className="font-semibold">No {label} report</span> for {isMonthly ? `${MONTH_NAMES[Number(month)]} ${year}` : 'this selection'}. Myntra publishes a month a few weeks after it ends — try an earlier month.</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            <div className="rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
              <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2.5"><Hash size={16} /></div>
              <p className="text-[10.5px] font-semibold text-zinc-400 uppercase tracking-wider">Records</p>
              <p className="text-[22px] font-bold text-zinc-900 tabular-nums leading-none mt-1">{(data.rowCount || 0).toLocaleString('en-IN')}{data.truncated && <span className="text-[11px] font-medium text-amber-500">+</span>}</p>
            </div>
            {kpis.map((k) => (
              <div key={k.label} className="rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2.5 text-[13px] font-bold">₹</div>
                <p className="text-[10.5px] font-semibold text-zinc-400 uppercase tracking-wider truncate" title={k.label}>{k.label}</p>
                <p className="text-[19px] font-bold text-zinc-900 tabular-nums leading-none mt-1">{inr(k.value)}</p>
              </div>
            ))}
          </div>

          {/* Table */}
          <div className="rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-black/[0.06] flex-wrap">
              <p className="text-[12.5px] font-bold text-zinc-800">{filtered.length.toLocaleString('en-IN')} of {(data.rowCount || 0).toLocaleString('en-IN')} rows{data.truncated && ' (first 1,000)'}</p>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter rows…" className="pl-8 pr-3 h-8 w-56 text-[12px] bg-zinc-50 border border-black/[0.06] rounded-lg outline-none focus:border-indigo-300" />
              </div>
            </div>
            <div className="overflow-auto max-h-[65vh]">
              <table className="w-full text-[12px] whitespace-nowrap">
                <thead className="bg-zinc-50/90 backdrop-blur sticky top-0 z-10 text-[10.5px] font-semibold text-zinc-500 uppercase tracking-wide">
                  <tr>{columns.map((c, i) => <th key={i} className={cx('px-3 py-2.5 border-b border-black/[0.06]', numericCol[i] ? 'text-right' : 'text-left')}>{humanize(c)}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filtered.slice(0, 400).map((r, ri) => (
                    <tr key={ri} className="hover:bg-indigo-50/40 transition-colors">
                      {r.map((cell, ci) => (
                        <td key={ci} className={cx('px-3 py-2 text-zinc-700', numericCol[ci] ? 'text-right tabular-nums' : 'text-left', ci === 0 && 'font-medium text-zinc-900')}>
                          {numericCol[ci] && isNum(cell) && AMOUNT_RE.test(columns[ci] || '') ? inr(Number(cell)) : (cell === '' ? '—' : cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > 400 && <div className="px-4 py-2.5 text-[11px] text-zinc-400 border-t border-black/[0.06] text-center">Showing first 400 rows of {filtered.length.toLocaleString('en-IN')} — refine the filter or download the CSV for the full set.</div>}
          </div>
        </>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="px-4 py-24 text-center text-sm text-zinc-400 flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin text-indigo-400" /> Loading…</div>}>
      <ReportsInner />
    </Suspense>
  );
}
