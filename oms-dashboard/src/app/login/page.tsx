'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

function safeNext(raw: string | null): string {
  // Only allow internal, non-protocol-relative paths to avoid open redirects.
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/orders/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        // Full reload so the new cookie is picked up by middleware on the next route.
        window.location.href = next;
        return;
      }
      setError(data.error || 'Sign in failed. Check your email and password.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF9F6] px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-6 justify-center">
          <div className="w-10 h-10 rounded-xl bg-white border border-black/[0.06] flex items-center justify-center shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/myntra-logo.svg" alt="Myntra" className="w-7 h-7 object-contain" />
          </div>
          <div className="text-[18px] font-extrabold tracking-tight text-zinc-900">
            Myntra <span className="bg-gradient-to-r from-rose-500 to-pink-600 bg-clip-text text-transparent">OMS</span>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-white border border-black/[0.07] rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_6px_20px_rgba(0,0,0,0.05)] p-6"
        >
          <h1 className="text-[15px] font-bold text-zinc-900">Sign in</h1>
          <p className="text-[12px] text-zinc-500 mt-0.5 mb-5">Enter your credentials to access the dashboard.</p>

          <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Email</label>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-3 py-2.5 mb-4 rounded-xl border border-black/[0.1] text-[14px] outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition"
            placeholder="you@experiences.digital"
          />

          <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Password</label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full px-3 py-2.5 rounded-xl border border-black/[0.1] text-[14px] outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 transition"
            placeholder="••••••••"
          />

          {error && (
            <p className="mt-4 text-[12.5px] text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 text-white text-[14px] font-semibold shadow-sm hover:opacity-95 disabled:opacity-60 transition"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-[11px] text-zinc-400 mt-4">EXPERIENCES.DIGITAL · Myntra OMS</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
