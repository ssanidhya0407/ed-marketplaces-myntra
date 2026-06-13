'use client';

import type { LucideIcon } from 'lucide-react';
import { cx } from '@/lib/utils';

export interface Stat {
  label: string;
  value: number | string;
  tone?: keyof typeof TONES;
  icon?: LucideIcon;
  hint?: string;
}

const TONES = {
  zinc: 'text-zinc-700 bg-zinc-100',
  blue: 'text-blue-700 bg-blue-100',
  amber: 'text-amber-700 bg-amber-100',
  violet: 'text-violet-700 bg-violet-100',
  emerald: 'text-emerald-700 bg-emerald-100',
  green: 'text-green-700 bg-green-100',
  rose: 'text-rose-700 bg-rose-100',
  pink: 'text-pink-700 bg-pink-100',
  indigo: 'text-indigo-700 bg-indigo-100',
};

export default function StatStrip({ stats, cols = 6 }: { stats: Stat[]; cols?: number }) {
  return (
    <div className={cx('grid gap-2.5 mb-4', cols === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6')}>
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div key={s.label} className="rounded-xl bg-white border border-black/[0.06] px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider truncate">{s.label}</span>
              {Icon && <span className={cx('w-6 h-6 rounded-md flex items-center justify-center shrink-0', TONES[s.tone || 'zinc'])}><Icon size={12} /></span>}
            </div>
            <div className="text-[22px] font-bold text-zinc-900 tabular-nums leading-none">{s.value}</div>
            {s.hint && <div className="text-[10px] text-zinc-400 mt-1">{s.hint}</div>}
          </div>
        );
      })}
    </div>
  );
}
