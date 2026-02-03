'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface DashboardStats {
  totalClients: number;
  liveCitations: number;
  totalCitations: number;
  avgCitationScore: number;
}

interface ActivityItem {
  id: string;
  type: 'citation_live' | 'client_added' | 'report_generated' | 'citation_submitted';
  message: string;
  timestamp: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalClients: 0,
    liveCitations: 0,
    totalCitations: 0,
    avgCitationScore: 0,
  });
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    async function loadDashboard() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Get agency
        const { data: agency } = await supabase
          .from('agencies')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (!agency) return;

        // Get clients
        const { data: clients } = await supabase
          .from('clients')
          .select('id, citation_score, created_at, business_name')
          .eq('agency_id', agency.id);

        const clientIds = clients?.map((c) => c.id) || [];

        // Get citations
        let citations: { id: string; status: string; client_id: string; submitted_at: string | null; live_at: string | null }[] = [];
        if (clientIds.length > 0) {
          const { data, error: citationsError } = await supabase
            .from('citations')
            .select('id, status, client_id, submitted_at, live_at')
            .in('client_id', clientIds);

          if (citationsError) {
            console.error('Citations query error:', citationsError);
          }
          citations = data || [];
        }

        const liveCitations = citations.filter((c) => c.status === 'live').length;
        const avgScore = clients && clients.length > 0
          ? Math.round(clients.reduce((acc, c) => acc + (c.citation_score || 0), 0) / clients.length)
          : 0;

        setStats({
          totalClients: clients?.length || 0,
          liveCitations,
          totalCitations: citations.length,
          avgCitationScore: avgScore,
        });

        // Build activity feed from recent data
        const activityItems: ActivityItem[] = [];

        clients?.slice(-5).reverse().forEach((c) => {
          activityItems.push({
            id: `client-${c.id}`,
            type: 'client_added',
            message: `New client added: ${c.business_name}`,
            timestamp: c.created_at,
          });
        });

        citations.filter((c) => c.status === 'live').slice(-5).reverse().forEach((c) => {
          activityItems.push({
            id: `citation-${c.id}`,
            type: 'citation_live',
            message: `Citation went live`,
            timestamp: c.live_at || c.submitted_at || '',
          });
        });

        activityItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setActivity(activityItems.slice(0, 10));
      } catch (err) {
        console.error('Dashboard load error:', err);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, [supabase]);

  const statCards = [
    { label: 'Total Clients', value: stats.totalClients, color: 'text-brand-400' },
    { label: 'Live Citations', value: stats.liveCitations, color: 'text-emerald-400' },
    { label: 'Total Citations', value: stats.totalCitations, color: 'text-blue-400' },
    { label: 'Avg Citation Score', value: `${stats.avgCitationScore}%`, color: 'text-amber-400' },
  ];

  const getActivityIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'citation_live':
        return <div className="h-2 w-2 rounded-full bg-emerald-400" />;
      case 'client_added':
        return <div className="h-2 w-2 rounded-full bg-blue-400" />;
      case 'report_generated':
        return <div className="h-2 w-2 rounded-full bg-purple-400" />;
      case 'citation_submitted':
        return <div className="h-2 w-2 rounded-full bg-amber-400" />;
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-400">Overview of your local SEO performance</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <div key={stat.label} className="card">
            <p className="text-sm text-gray-400">{stat.label}</p>
            <p className={`mt-2 text-3xl font-bold ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Activity */}
        <div className="card">
          <h3 className="mb-4 text-lg font-semibold text-white">Recent Activity</h3>
          {activity.length === 0 ? (
            <p className="text-sm text-gray-500">No activity yet. Add your first client to get started.</p>
          ) : (
            <div className="space-y-3">
              {activity.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-lg bg-gray-800/50 px-4 py-3">
                  {getActivityIcon(item.type)}
                  <div className="flex-1">
                    <p className="text-sm text-gray-200">{item.message}</p>
                    <p className="text-xs text-gray-500">
                      {item.timestamp ? new Date(item.timestamp).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      }) : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h3 className="mb-4 text-lg font-semibold text-white">Quick Actions</h3>
          <div className="space-y-3">
            <a
              href="/dashboard/clients"
              className="flex items-center gap-3 rounded-lg bg-gray-800/50 px-4 py-3 transition-colors hover:bg-gray-800"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white">Add New Client</p>
                <p className="text-xs text-gray-500">Start building citations for a new business</p>
              </div>
            </a>
            <a
              href="/dashboard/reports"
              className="flex items-center gap-3 rounded-lg bg-gray-800/50 px-4 py-3 transition-colors hover:bg-gray-800"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white">Generate Report</p>
                <p className="text-xs text-gray-500">Create an AI-powered citation audit</p>
              </div>
            </a>
            <a
              href="/dashboard/citations"
              className="flex items-center gap-3 rounded-lg bg-gray-800/50 px-4 py-3 transition-colors hover:bg-gray-800"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white">Audit Citations</p>
                <p className="text-xs text-gray-500">Check NAP consistency across directories</p>
              </div>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
