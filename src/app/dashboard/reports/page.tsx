'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Client } from '@/types/database';

interface ReportItem {
  id: string;
  report_type: string;
  summary: string;
  created_at: string;
  client: { business_name: string } | null;
}

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [reportType, setReportType] = useState<'citation_audit' | 'competitor_analysis' | 'monthly_report'>('citation_audit');
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generatedReport, setGeneratedReport] = useState<string | null>(null);
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

        const { data: clientData } = await supabase
          .from('clients')
          .select('*')
          .eq('agency_id', agency.id);

        setClients(clientData || []);

        const clientIds = clientData?.map((c) => c.id) || [];
        if (clientIds.length > 0) {
          const { data: reportData } = await supabase
            .from('reports')
            .select('id, report_type, summary, created_at, client:clients(business_name)')
            .in('client_id', clientIds)
            .order('created_at', { ascending: false });

          setReports((reportData as unknown as ReportItem[]) || []);
        }
      } catch (err) {
        console.error('Failed to load reports:', err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [supabase]);

  async function handleGenerate() {
    if (!selectedClient) return;
    setGenerating(true);
    setGeneratedReport(null);

    try {
      const res = await fetch('/api/ai/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedClient, reportType }),
      });

      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        setGeneratedReport(data.summary);
        // Reload reports
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: agency } = await supabase.from('agencies').select('id').eq('user_id', user.id).single();
          if (agency) {
            const { data: clientData } = await supabase.from('clients').select('id').eq('agency_id', agency.id);
            const clientIds = clientData?.map((c) => c.id) || [];
            if (clientIds.length > 0) {
              const { data: reportData } = await supabase
                .from('reports')
                .select('id, report_type, summary, created_at, client:clients(business_name)')
                .in('client_id', clientIds)
                .order('created_at', { ascending: false });
              setReports((reportData as unknown as ReportItem[]) || []);
            }
          }
        }
      }
    } catch {
      alert('Failed to generate report');
    } finally {
      setGenerating(false);
    }
  }

  const typeLabels: Record<string, string> = {
    citation_audit: 'Citation Audit',
    competitor_analysis: 'Competitor Analysis',
    monthly_report: 'Monthly Report',
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
        <h1 className="text-2xl font-bold text-white">Reports</h1>
        <p className="mt-1 text-sm text-gray-400">Generate AI-powered reports for your clients</p>
      </div>

      {/* Generate Report */}
      <div className="card space-y-4">
        <h3 className="text-lg font-semibold text-white">Generate New Report</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Client</label>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="input"
            >
              <option value="">Select client...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.business_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Report Type</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as typeof reportType)}
              className="input"
            >
              <option value="citation_audit">Citation Audit</option>
              <option value="competitor_analysis">Competitor Analysis</option>
              <option value="monthly_report">Monthly Report</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={handleGenerate}
              disabled={!selectedClient || generating}
              className="btn-primary w-full disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate with AI'}
            </button>
          </div>
        </div>

        {generatedReport && (
          <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-4">
            <h4 className="text-sm font-medium text-brand-400 mb-2">Generated Report</h4>
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{generatedReport}</p>
          </div>
        )}
      </div>

      {/* Previous Reports */}
      <div className="card">
        <h3 className="mb-4 text-lg font-semibold text-white">Previous Reports</h3>
        {reports.length === 0 ? (
          <p className="text-sm text-gray-500">No reports generated yet.</p>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <div key={report.id} className="rounded-lg bg-gray-800/50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-white">{report.client?.business_name}</span>
                    <span className="mx-2 text-gray-600">-</span>
                    <span className="text-sm text-gray-400">{typeLabels[report.report_type] || report.report_type}</span>
                  </div>
                  <span className="text-xs text-gray-500">
                    {new Date(report.created_at).toLocaleDateString('en-GB')}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-400 line-clamp-2">{report.summary}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
