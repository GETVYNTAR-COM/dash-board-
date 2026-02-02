'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface CitationWithDetails {
  id: string;
  status: string;
  nap_consistent: boolean;
  submitted_at: string | null;
  live_at: string | null;
  client: { business_name: string } | null;
  directory: { name: string; url: string; tier: number } | null;
}

export default function CitationsPage() {
  const [citations, setCitations] = useState<CitationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'submitted' | 'live' | 'error'>('all');
  const supabase = createClient();

  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: agency } = await supabase
          .from('agencies')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (!agency) return;

        const { data: clients } = await supabase
          .from('clients')
          .select('id')
          .eq('agency_id', agency.id);

        const clientIds = clients?.map((c) => c.id) || [];
        if (clientIds.length === 0) {
          setLoading(false);
          return;
        }

        const { data } = await supabase
          .from('citations')
          .select(`
            id, status, nap_consistent, submitted_at, live_at,
            client:clients(business_name),
            directory:directories(name, url, tier)
          `)
          .in('client_id', clientIds)
          .order('created_at', { ascending: false });

        setCitations((data as unknown as CitationWithDetails[]) || []);
      } catch (err) {
        console.error('Failed to load citations:', err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [supabase]);

  const filtered = filter === 'all' ? citations : citations.filter((c) => c.status === filter);

  const statusColors: Record<string, string> = {
    pending: 'text-gray-400 bg-gray-400/10',
    submitted: 'text-blue-400 bg-blue-400/10',
    live: 'text-emerald-400 bg-emerald-400/10',
    error: 'text-red-400 bg-red-400/10',
  };

  const counts = {
    all: citations.length,
    pending: citations.filter((c) => c.status === 'pending').length,
    submitted: citations.filter((c) => c.status === 'submitted').length,
    live: citations.filter((c) => c.status === 'live').length,
    error: citations.filter((c) => c.status === 'error').length,
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
      <div>
        <h1 className="text-2xl font-bold text-white">Citations</h1>
        <p className="mt-1 text-sm text-gray-400">Track directory submissions across all clients</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'pending', 'submitted', 'live', 'error'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-4 py-2 text-sm font-medium capitalize transition-colors ${
              filter === f
                ? 'bg-brand-500/10 text-brand-400 border border-brand-500/30'
                : 'bg-gray-800/50 text-gray-400 border border-gray-800 hover:text-white'
            }`}
          >
            {f} ({counts[f]})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400">No citations found. Add clients and optimize their citations to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full">
            <thead className="bg-gray-900/80">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Directory</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Client</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">NAP</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filtered.map((citation) => (
                <tr key={citation.id} className="transition-colors hover:bg-gray-900/50">
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="font-medium text-white">{citation.directory?.name || 'Unknown'}</div>
                    <div className="text-xs text-gray-500">Tier {citation.directory?.tier || '-'}</div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-300">
                    {citation.client?.business_name || 'Unknown'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${statusColors[citation.status] || ''}`}>
                      {citation.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {citation.nap_consistent ? (
                      <span className="text-emerald-400 text-xs font-medium">Consistent</span>
                    ) : (
                      <span className="text-red-400 text-xs font-medium">Mismatch</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-400">
                    {citation.live_at
                      ? new Date(citation.live_at).toLocaleDateString('en-GB')
                      : citation.submitted_at
                        ? new Date(citation.submitted_at).toLocaleDateString('en-GB')
                        : '-'}
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
