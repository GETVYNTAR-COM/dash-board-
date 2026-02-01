'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Client } from '@/types/database';

interface CompetitorItem {
  id: string;
  business_name: string;
  citation_count: number;
  citation_score: number;
  client: { business_name: string } | null;
}

export default function CompetitorsPage() {
  const [competitors, setCompetitors] = useState<CompetitorItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ client_id: '', business_name: '', citation_count: 0 });
  const supabase = createClient();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: agency } = await supabase.from('agencies').select('id').eq('user_id', user.id).single();
      if (!agency) return;

      const { data: clientData } = await supabase.from('clients').select('*').eq('agency_id', agency.id);
      setClients(clientData || []);

      const clientIds = clientData?.map((c) => c.id) || [];
      if (clientIds.length > 0) {
        const { data } = await supabase
          .from('competitors')
          .select('id, business_name, citation_count, citation_score, client:clients(business_name)')
          .in('client_id', clientIds)
          .order('citation_count', { ascending: false });

        setCompetitors((data as unknown as CompetitorItem[]) || []);
      }
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await supabase.from('competitors').insert({
        client_id: form.client_id,
        business_name: form.business_name,
        citation_count: form.citation_count,
      });
      setForm({ client_id: '', business_name: '', citation_count: 0 });
      setShowForm(false);
      load();
    } catch {
      alert('Failed to add competitor');
    } finally {
      setSaving(false);
    }
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Competitors</h1>
          <p className="mt-1 text-sm text-gray-400">Track competitor citation profiles</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          {showForm ? 'Cancel' : '+ Add Competitor'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="card space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label">For Client</label>
              <select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} className="input" required>
                <option value="">Select client...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.business_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Competitor Business Name</label>
              <input type="text" value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} className="input" required />
            </div>
            <div>
              <label className="label">Known Citation Count</label>
              <input type="number" value={form.citation_count} onChange={(e) => setForm({ ...form, citation_count: parseInt(e.target.value) || 0 })} className="input" />
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? 'Adding...' : 'Add Competitor'}
            </button>
          </div>
        </form>
      )}

      {competitors.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400">No competitors tracked yet. Add competitors to monitor their citation profiles.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full">
            <thead className="bg-gray-900/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Competitor</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">vs Client</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Citations</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {competitors.map((comp) => (
                <tr key={comp.id} className="transition-colors hover:bg-gray-900/50">
                  <td className="whitespace-nowrap px-6 py-4 font-medium text-white">{comp.business_name}</td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-300">{comp.client?.business_name || '-'}</td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-300">{comp.citation_count}</td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className="rounded-full bg-gray-800 px-2.5 py-1 text-xs font-bold text-gray-300">
                      {comp.citation_score}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
