'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  CANNOT_VERIFY_SECTION_LABEL,
  STATUS_LABEL,
  assessRelevance,
  countEvidence,
  formatMissingSummary,
  napLabel,
  normaliseStatus,
  type CitationStatus,
} from '@/lib/citations/evidence';

interface CitationWithDetails {
  id: string;
  status: CitationStatus;
  nap_consistent: boolean | null;
  verification_reason: string | null;
  submitted_at: string | null;
  live_at: string | null;
  verified_at: string | null;
  client: { business_name: string; category: string } | null;
  directory: { name: string; url: string; tier: number; domain: string; categories: string[] } | null;
}

type Filter = 'all' | 'live' | 'possible_match' | 'not_found';

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return (url || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
  }
}

export default function CitationsPage() {
  const [citations, setCitations] = useState<CitationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
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
          .select('id, business_name, category')
          .eq('agency_id', agency.id);

        const clientIds = clients?.map((c) => c.id) || [];
        if (clientIds.length === 0) {
          setLoading(false);
          return;
        }

        const { data, error: citationsError } = await supabase
          .from('citations')
          .select(`
            id, status, nap_consistent, verification_reason, submitted_at, live_at, verified_at, client_id, directory_id
          `)
          .in('client_id', clientIds)
          .order('created_at', { ascending: false });

        if (citationsError) {
          console.error('Citations query error:', citationsError);
          setLoading(false);
          return;
        }

        // Fetch client and directory details separately to avoid join issues
        const clientMap = new Map((clients || []).map((c) => [c.id, c]));

        const directoryIds = Array.from(new Set((data || []).map(c => c.directory_id).filter(Boolean)));
        const { data: directories } = directoryIds.length > 0
          ? await supabase.from('directories').select('id, name, url, tier, categories').in('id', directoryIds)
          : { data: [] };

        const directoryMap = new Map(
          (directories || []).map(d => [d.id, { ...d, domain: domainFromUrl(d.url) }])
        );

        const enrichedData = (data || []).map(citation => ({
          ...citation,
          status: normaliseStatus(citation.status),
          client: clientMap.get(citation.client_id) || null,
          directory: directoryMap.get(citation.directory_id) || null,
        }));

        // Directories that cannot apply to the client's category are dropped
        // entirely — they are not gaps and must not pad any count.
        const relevantOnly = enrichedData.filter((citation) => {
          if (!citation.directory) return true;
          return assessRelevance(
            { name: citation.directory.name, categories: citation.directory.categories },
            citation.client?.category
          ).relevant;
        });

        setCitations(relevantOnly as unknown as CitationWithDetails[]);
      } catch (err) {
        console.error('Failed to load citations:', err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [supabase]);

  // Checked rows and unverifiable rows are kept apart everywhere: a directory
  // that blocks automated access is not evidence that a listing is absent.
  const checked = useMemo(
    () => citations.filter((c) => c.status !== 'cannot_verify'),
    [citations]
  );
  const couldNotCheck = useMemo(
    () => citations.filter((c) => c.status === 'cannot_verify'),
    [citations]
  );
  const counts = useMemo(() => countEvidence(citations), [citations]);

  const filtered = filter === 'all' ? checked : checked.filter((c) => c.status === filter);

  const statusColors: Record<CitationStatus, string> = {
    live: 'text-emerald-400 bg-emerald-400/10',
    possible_match: 'text-blue-400 bg-blue-400/10',
    not_found: 'text-red-400 bg-red-400/10',
    cannot_verify: 'text-amber-400 bg-amber-400/10',
  };

  const filterCounts: Record<Filter, number> = {
    all: checked.length,
    live: counts.live,
    possible_match: counts.possibleMatch,
    not_found: counts.missing,
  };

  const filterLabels: Record<Filter, string> = {
    all: 'All checked',
    live: STATUS_LABEL.live,
    possible_match: STATUS_LABEL.possible_match,
    not_found: STATUS_LABEL.not_found,
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
        <p className="mt-1 text-sm text-gray-400">Directory coverage across all clients</p>
      </div>

      {citations.length > 0 && (
        <div className="card">
          <p className="text-sm text-white">{formatMissingSummary(counts)}</p>
          <p className="mt-1 text-xs text-gray-400">
            {counts.live} live · {counts.possibleMatch} possible · {counts.missing} missing ·{' '}
            {counts.cannotVerify} could not be checked
          </p>
        </div>
      )}

      {/* Filter tabs — checked directories only */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'live', 'possible_match', 'not_found'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-brand-500/10 text-brand-400 border border-brand-500/30'
                : 'bg-gray-800/50 text-gray-400 border border-gray-800 hover:text-white'
            }`}
          >
            {filterLabels[f]} ({filterCounts[f]})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400">No citations found. Add clients and scan their citations to get started.</p>
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
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusColors[citation.status]}`}>
                      {STATUS_LABEL[citation.status]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {citation.nap_consistent === true ? (
                      <span className="text-emerald-400 text-xs font-medium">Consistent</span>
                    ) : citation.nap_consistent === false ? (
                      <span className="text-red-400 text-xs font-medium">Mismatch</span>
                    ) : (
                      <span className="text-gray-500 text-xs font-medium" title="Not evaluated — no verified listing to compare against">
                        {napLabel(citation.nap_consistent)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-400">
                    {citation.live_at
                      ? new Date(citation.live_at).toLocaleDateString('en-GB')
                      : citation.verified_at
                        ? new Date(citation.verified_at).toLocaleDateString('en-GB')
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

      {/* Unverifiable directories — reported, never counted as gaps */}
      {couldNotCheck.length > 0 && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-amber-400">{CANNOT_VERIFY_SECTION_LABEL}</h2>
            <p className="mt-1 text-xs text-gray-500">
              {couldNotCheck.length} {couldNotCheck.length === 1 ? 'directory' : 'directories'} returned a
              block, captcha or login wall. No evidence either way — check these manually before reporting on them.
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-amber-500/20">
            <table className="w-full">
              <thead className="bg-gray-900/80">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Directory</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Client</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {couldNotCheck.map((citation) => (
                  <tr key={citation.id} className="transition-colors hover:bg-gray-900/50">
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="font-medium text-white">{citation.directory?.name || 'Unknown'}</div>
                      <div className="text-xs text-gray-500">Tier {citation.directory?.tier || '-'}</div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-300">
                      {citation.client?.business_name || 'Unknown'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400">
                      {citation.verification_reason || 'Directory blocks automated access'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
