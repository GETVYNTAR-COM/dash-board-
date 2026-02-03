import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { clientId, reportType } = await request.json();

    if (!clientId || !reportType) {
      return NextResponse.json({ error: 'clientId and reportType are required' }, { status: 400 });
    }

    // Debug logging
    console.log('=== Generate Report Debug ===');
    console.log('Received clientId:', clientId);
    console.log('clientId type:', typeof clientId);
    console.log('reportType:', reportType);

    const supabase = createServiceRoleClient();

    // Get client details
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    // Debug logging for query result
    console.log('Query result - client:', client);
    console.log('Query result - error:', clientError);

    if (clientError || !client) {
      console.error('Client lookup failed:', { clientId, clientError });
      return NextResponse.json({
        error: 'Client not found',
        debug: {
          receivedClientId: clientId,
          clientIdType: typeof clientId,
          queryError: clientError?.message,
          queryCode: clientError?.code
        }
      }, { status: 404 });
    }

    // Get citations with directory info
    const { data: citations } = await supabase
      .from('citations')
      .select('*, directory:directories(name, tier, domain_authority)')
      .eq('client_id', clientId);

    // Get competitors
    const { data: competitors } = await supabase
      .from('competitors')
      .select('*')
      .eq('client_id', clientId);

    const allCitations = citations || [];
    const allCompetitors = competitors || [];
    const liveCitations = allCitations.filter((c: any) => c.status === 'live');
    const pendingCitations = allCitations.filter((c: any) => c.status === 'pending' || c.status === 'submitted');
    const errorCitations = allCitations.filter((c: any) => c.status === 'error');

    const reportTypeLabels: Record<string, string> = {
      citation_audit: 'Citation Audit Report',
      competitor_analysis: 'Competitor Analysis Report',
      monthly_report: 'Monthly Performance Report',
    };

    // Build prompt based on report type
    let prompt = `You are a UK local SEO expert writing a professional ${reportTypeLabels[reportType]} for an agency client.

Business: ${client.business_name}
Category: ${client.category}
Location: ${client.city}, ${client.postcode}
Address: ${client.address}
Phone: ${client.phone}
Citation Score: ${client.citation_score}%

Citation Summary:
- Live citations: ${liveCitations.length}
- Pending/Submitted: ${pendingCitations.length}
- Errors: ${errorCitations.length}
- Total: ${allCitations.length}
`;

    if (reportType === 'citation_audit') {
      prompt += `
Live citations on:
${liveCitations.map((c: any) => `- ${c.directory?.name || 'Unknown'}`).join('\n') || '- None yet'}

Directories with errors:
${errorCitations.map((c: any) => `- ${c.directory?.name || 'Unknown'}`).join('\n') || '- None'}

Write a detailed citation audit covering:
1. Executive Summary
2. Current Citation Profile Assessment
3. NAP Consistency Analysis
4. Directory Coverage Gaps
5. Priority Actions (ranked by impact)
6. 90-Day Citation Building Strategy

Keep it professional and actionable. Use UK English.`;
    } else if (reportType === 'competitor_analysis') {
      prompt += `
Competitors:
${allCompetitors.map((c: any) => `- ${c.business_name}: ${c.citation_count} citations, ${c.citation_score}% score`).join('\n') || '- No competitors tracked yet'}

Write a competitor analysis covering:
1. Executive Summary
2. Citation Gap Analysis vs Competitors
3. Competitor Strengths and Weaknesses
4. Opportunities to Outperform
5. Recommended Strategy
6. Priority Action Items

Keep it professional and data-driven. Use UK English.`;
    } else {
      prompt += `
Write a monthly performance report covering:
1. Executive Summary
2. Citation Growth This Period
3. Directory Coverage Progress
4. NAP Consistency Score
5. Local Search Visibility Indicators
6. Recommendations for Next Month

Keep it professional, concise, and client-friendly. Use UK English.`;
    }

    // Call Claude
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const summary = message.content[0].type === 'text' ? message.content[0].text : '';

    // Save report to database
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .insert({
        client_id: clientId,
        report_type: reportType,
        summary,
        insights: {
          live_citations: liveCitations.length,
          total_citations: allCitations.length,
          citation_score: client.citation_score,
          competitors_tracked: allCompetitors.length,
        },
        recommendations: {
          generated_at: new Date().toISOString(),
          report_type: reportType,
        },
      })
      .select()
      .single();

    if (reportError) {
      console.error('Report save error:', reportError);
    }

    return NextResponse.json({
      id: report?.id,
      summary,
      report_type: reportType,
      client: client.business_name,
    });
  } catch (error) {
    console.error('Report generation error:', error);
    return NextResponse.json(
      { error: 'Failed to generate report. Check CLAUDE_API_KEY.' },
      { status: 500 }
    );
  }
}
