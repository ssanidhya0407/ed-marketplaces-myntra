import { statusInfo } from '@/lib/status';

export default function StatusBadge({ code }: { code: string | null | undefined }) {
  const s = statusInfo(code);
  return (
    <span
      title={`Status code: ${s.code}`}
      className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-md border ${s.cls}`}
    >
      {s.label}
    </span>
  );
}
