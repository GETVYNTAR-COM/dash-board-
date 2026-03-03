'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Client } from '@/types/database';

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    business_name: '',
    address: '',
    city: '',
    postcode: '',
    phone: '',
    category: '',
    website: '',
  });

  // Scan state
  const [scanningClient, setScanningClient] = useState<string | null>(null);
  const [bulkScanning, setBulkScanning] = useState(false);
  const [bulkScanProgress, setBulkScanProgress] = useState({ current: 0, total: 0 });

  const supabase = createClient();

  useEffect(() => {
    loadClients();
  }, []);

  async function loadClients() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: agency } = await supabase
        .from('agencies')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!agency) return;

      const { data } = await supabase
        .from('clients')
        .select('*')
        .eq('agency_id', agency.id)
        .order('created_at', { ascending: false });

      setClients(data || []);
    } catch (err) {
      console.error('Failed to load clients:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: agency } = await supabase
        .from('agencies')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!agency) {
        setError('Agency not found');
        return;
      }

      const { error: insertError } = await supabase.from('clients').insert({
        agency_id: agency.id,
        business_name: form.business_name,
        address: form.address,
        city: form.city,
        postcode: form.postcode.toUpperCase(),
        phone: form.phone,
        category: form.category,
        website: form.website || null,
        citation_score: 0,
      });

      if (insertError) {
        setError(insertError.message);
        return;
      }

      setForm({ business_name: '', address: '', city: '', postcode: '', phone: '', category: '', website: '' });
      setShowForm(false);
      loadClients();
    } catch {
      setError('Failed to add client');
    } finally {
      setSaving(false);
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400 bg-emerald-400/10';
    if (score >= 50) return 'text-amber-400 bg-amber-400/10';
    return 'text-red-400 bg-red-400/10';
  };

  // Scan a single client
  const scanClient = useCallback(async (clientId: string): Promise<number | null> => {
    try {
      const response = await fetch('/api/citations/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });

      if (!response.ok) {
        throw new Error('Scan failed');
      }

      const data = await response.json();
      return data.client?.citation_score ?? null;
    } catch (err) {
      console.error('Scan error:', err);
      return null;
    }
  }, []);

  // Handle single client scan
  const handleScanClient = async (clientId: string) => {
    setScanningClient(clientId);
    const newScore = await scanClient(clientId);

    if (newScore !== null) {
      setClients(prev => prev.map(c =>
        c.id === clientId ? { ...c, citation_score: newScore } : c
      ));
    }

    setScanningClient(null);
  };

  // Handle bulk scan of all clients
  const handleScanAll = async () => {
    if (bulkScanning || clients.length === 0) return;

    setBulkScanning(true);
    setBulkScanProgress({ current: 0, total: clients.length });

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      setBulkScanProgress({ current: i + 1, total: clients.length });

      const newScore = await scanClient(client.id);

      if (newScore !== null) {
        setClients(prev => prev.map(c =>
          c.id === client.id ? { ...c, citation_score: newScore } : c
        ));
      }

      // Wait 2 seconds between scans to avoid rate limiting (except for last one)
      if (i < clients.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    setBulkScanning(false);
    setBulkScanProgress({ current: 0, total: 0 });
  };

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
          <h1 className="text-2xl font-bold text-white">Clients</h1>
          <p className="mt-1 text-sm text-gray-400">{clients.length} total clients</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleScanAll}
            disabled={bulkScanning || clients.length === 0}
            className="btn-secondary disabled:opacity-50"
          >
            {bulkScanning ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                {bulkScanProgress.current}/{bulkScanProgress.total} scanned
              </span>
            ) : (
              '🔍 Scan All'
            )}
          </button>
          <a href="/dashboard/clients/import" className="btn-secondary">
            📄 Import CSV
          </a>
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-primary"
          >
            {showForm ? 'Cancel' : '+ Add Client'}
          </button>
        </div>
      </div>

      {/* Add Client Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          <h3 className="text-lg font-semibold text-white">Add New Client</h3>

          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Business Name *</label>
              <input
                type="text"
                value={form.business_name}
                onChange={(e) => setForm({ ...form, business_name: e.target.value })}
                placeholder="Acme Plumbing Ltd"
                required
                className="input"
              />
            </div>
            <div>
              <label className="label">Category *</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="Plumber, Electrician, Restaurant..."
                required
                className="input"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Address *</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="123 High Street"
                required
                className="input"
              />
            </div>
            <div>
              <label className="label">City *</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                placeholder="London"
                required
                className="input"
              />
            </div>
            <div>
              <label className="label">Postcode *</label>
              <input
                type="text"
                value={form.postcode}
                onChange={(e) => setForm({ ...form, postcode: e.target.value })}
                placeholder="SW1A 1AA"
                required
                className="input"
              />
            </div>
            <div>
              <label className="label">Phone *</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="020 7946 0958"
                required
                className="input"
              />
            </div>
            <div>
              <label className="label">Website</label>
              <input
                type="url"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="https://www.example.co.uk"
                className="input"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? 'Adding...' : 'Add Client'}
            </button>
          </div>
        </form>
      )}

      {/* Clients List */}
      {clients.length === 0 ? (
        <div className="card text-center py-12">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
            <svg className="h-6 w-6 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white">No clients yet</h3>
          <p className="mt-1 text-sm text-gray-400">Add your first client to start building citations.</p>
          <button onClick={() => setShowForm(true)} className="btn-primary mt-4">
            + Add Your First Client
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full">
            <thead className="bg-gray-900/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Business</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Location</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Citation Score</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {clients.map((client) => (
                <tr key={client.id} className="transition-colors hover:bg-gray-900/50">
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="font-medium text-white">{client.business_name}</div>
                    {client.website && (
                      <div className="text-xs text-gray-500">{client.website}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-300">
                    {client.city}, {client.postcode}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className="rounded-full bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-300">
                      {client.category}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-300">
                    {client.phone}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${getScoreColor(client.citation_score)}`}>
                      {client.citation_score}%
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <button
                      onClick={() => handleScanClient(client.id)}
                      disabled={scanningClient === client.id || bulkScanning}
                      className="rounded-lg bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-400 hover:bg-brand-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {scanningClient === client.id ? (
                        <span className="flex items-center gap-1.5">
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
                          Scanning...
                        </span>
                      ) : (
                        '🔍 Scan'
                      )}
                    </button>
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
