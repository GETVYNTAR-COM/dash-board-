'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const [agencyName, setAgencyName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [plan, setPlan] = useState<'starter' | 'growth' | 'agency'>('growth');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Sign up with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            agency_name: agencyName,
            plan: plan,
          },
        },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      if (authData.user) {
        // Create agency record with 14-day trial
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 14);

        const { error: agencyError } = await supabase.from('agencies').insert({
          user_id: authData.user.id,
          name: agencyName,
          email: email,
          plan: plan,
          trial_ends_at: trialEndsAt.toISOString(),
        });

        if (agencyError) {
          console.error('Agency creation error:', agencyError);
        }
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 font-bold text-white text-sm">V</div>
            <span className="text-xl font-bold text-white">VYNTAR</span>
            <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-400">Local SEO</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-white">Start your free trial</h1>
          <p className="mt-2 text-sm text-gray-400">14 days free. No credit card required.</p>
        </div>

        <form onSubmit={handleSignup} className="card space-y-5">
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="agencyName" className="label">Agency name</label>
            <input
              id="agencyName"
              type="text"
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              placeholder="Your Agency Ltd"
              required
              className="input"
            />
          </div>

          <div>
            <label htmlFor="email" className="label">Email address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@agency.com"
              required
              className="input"
            />
          </div>

          <div>
            <label htmlFor="password" className="label">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
              required
              minLength={8}
              className="input"
            />
          </div>

          <div>
            <label className="label">Select your plan</label>
            <div className="grid grid-cols-3 gap-2">
              {(['starter', 'growth', 'agency'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlan(p)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium capitalize transition-all ${
                    plan === p
                      ? 'border-brand-500 bg-brand-500/10 text-brand-400'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              {plan === 'starter' && '£297/mo — Up to 10 clients'}
              {plan === 'growth' && '£497/mo — Up to 50 clients'}
              {plan === 'agency' && '£997/mo — Unlimited clients'}
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Start 14-Day Free Trial'}
          </button>

          <p className="text-center text-xs text-gray-500">
            By signing up, you agree to our Terms of Service and Privacy Policy.
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-gray-400">
          Already have an account?{' '}
          <Link href="/auth/login" className="text-brand-400 hover:text-brand-300">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
