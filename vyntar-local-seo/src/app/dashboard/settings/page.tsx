'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Agency } from '@/types/database';

export default function SettingsPage() {
  const [agency, setAgency] = useState<Agency | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('agencies')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (data) {
        setAgency(data);
        setName(data.name);
      }
      setLoading(false);
    }
    load();
  }, [supabase]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!agency) return;
    setSaving(true);
    setSaved(false);

    const { error } = await supabase
      .from('agencies')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', agency.id);

    if (!error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-gray-400">Manage your agency settings</p>
      </div>

      <form onSubmit={handleSave} className="card space-y-4">
        <h3 className="text-lg font-semibold text-white">Agency Details</h3>

        <div>
          <label className="label">Agency Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input max-w-md"
          />
        </div>

        <div>
          <label className="label">Email</label>
          <input type="email" value={agency?.email || ''} disabled className="input max-w-md opacity-50" />
          <p className="mt-1 text-xs text-gray-500">Email cannot be changed</p>
        </div>

        <div>
          <label className="label">Plan</label>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-brand-500/10 px-3 py-1 text-sm font-medium capitalize text-brand-400">
              {agency?.plan || 'starter'}
            </span>
            {agency?.trial_ends_at && new Date(agency.trial_ends_at) > new Date() && (
              <span className="text-xs text-gray-500">
                Trial ends {new Date(agency.trial_ends_at).toLocaleDateString('en-GB')}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          {saved && <span className="text-sm text-brand-400">Saved successfully</span>}
        </div>
      </form>

      <div className="card space-y-4">
        <h3 className="text-lg font-semibold text-white">Subscription</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { name: 'Starter', price: '£297/mo', clients: '10 clients' },
            { name: 'Growth', price: '£497/mo', clients: '50 clients' },
            { name: 'Agency', price: '£997/mo', clients: 'Unlimited' },
          ].map((plan) => (
            <div
              key={plan.name}
              className={`rounded-lg border p-4 ${
                agency?.plan === plan.name.toLowerCase()
                  ? 'border-brand-500 bg-brand-500/5'
                  : 'border-gray-800 bg-gray-800/30'
              }`}
            >
              <h4 className="font-semibold text-white">{plan.name}</h4>
              <p className="text-xl font-bold text-white mt-1">{plan.price}</p>
              <p className="text-xs text-gray-400 mt-1">{plan.clients}</p>
              {agency?.plan === plan.name.toLowerCase() && (
                <span className="mt-2 inline-block rounded-full bg-brand-500/10 px-2 py-0.5 text-xs text-brand-400">Current plan</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
