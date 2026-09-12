import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  CANNOT_VERIFY_SECTION_LABEL,
  countEvidence,
  formatMissingSummary,
  napLabel,
  normaliseStatus,
  partitionByRelevance,
} from '@/lib/citations/evidence';

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
    console.log('SUPABASE_SERVICE_ROLE_KEY set:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
    console.log('NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);

    const supabase = createServiceRoleClient();

    // First, list all clients to verify database connection and bypass RLS
    const { data: allClients, error: listError } = await supabase
      .from('clients')
      .select('id, business_name')
      .limit(10);

    console.log('All clients (first 10):', allClients);
    console.log('List error:', listError);

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
          queryCode: clientError?.code,
          hint: clientError?.hint,
          details: clientError?.details,
          allClientsCount: allClients?.length || 0,
          allClientIds: allClients?.map(c => c.id) || [],
          serviceRoleKeySet: !!process.env.SUPABASE_SERVICE_ROLE_KEY
        }
      }, { status: 404 });
    }

    // Get citations with directory info
    const { data: citations, error: citationsError } = await supabase
      .from('citations')
      .select('*, directory:directories(name, tier, domain_authority)')
      .eq('client_id', clientId);

    if (citationsError) {
      console.error('Citations query failed:', citationsError);
      return NextResponse.json(
        {
          error: `Database error loading citations: ${citationsError.message}`,
          code: citationsError.code,
          hint: citationsError.hint,
        },
        { status: 500 }
      );
    }

    // Get competitors
    const { data: competitors, error: competitorsError } = await supabase
      .from('competitors')
      .select('*')
      .eq('client_id', clientId);

    if (competitorsError) {
      console.error('Competitors query failed:', competitorsError);
      return NextResponse.json(
        {
          error: `Database error loading competitors: ${competitorsError.message}`,
          code: competitorsError.code,
          hint: competitorsError.hint,
        },
        { status: 500 }
      );
    }

    // ========================================================================
    // EVIDENCE SPLIT
    // ========================================================================
    // Three streams, and only one of them is a gap:
    //   live / possible_match — listing found
    //   not_found             — checked, not listed. The gap count.
    //   cannot_verify         — never checked. Reported separately.
    // Directories irrelevant to the client's category are dropped entirely.
    // ========================================================================
    const allCompetitors = competitors || [];

    const normalisedCitations = (citations || []).map((c: any) => ({
      ...c,
      status: normaliseStatus(c.status),
      name: c.directory?.name || 'Unknown directory',
      domain: c.directory?.url ? String(c.directory.url).replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : '',
    }));

    const { relevant: allCitations } = partitionByRelevance(normalisedCitations, client.category);

    const counts = countEvidence(allCitations);
    const liveCitations = allCitations.filter((c: any) => c.status === 'live');
    const possibleMatchCitations = allCitations.filter((c: any) => c.status === 'possible_match');
    const missingCitations = allCitations.filter((c: any) => c.status === 'not_found');
    const cannotVerifyCitations = allCitations.filter((c: any) => c.status === 'cannot_verify');

    const reportTypeLabels: Record<string, string> = {
      citation_audit: 'Citation Audit Report',
      competitor_analysis: 'Competitor Analysis Report',
      monthly_report: 'Monthly Performance Report',
    };

    // Format today's date
    const today = new Date();
    const reportDate = today.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    // NAP verdict across the rows where it was actually evaluated. Rows with
    // no listing hold null and are not evidence of a mismatch.
    const evaluatedNap = allCitations.filter((c: any) => c.nap_consistent !== null && c.nap_consistent !== undefined);
    const napVerdict: boolean | null = evaluatedNap.length === 0
      ? null
      : evaluatedNap.every((c: any) => c.nap_consistent === true);
    const napBasis = evaluatedNap.length === 0
      ? ' (not evaluated — no verified listing to compare against)'
      : ` (evaluated on ${evaluatedNap.length} verified listing${evaluatedNap.length === 1 ? '' : 's'})`;

    // Build prompt based on report type
    let prompt = `You are a UK local SEO expert writing a professional ${reportTypeLabels[reportType]} for an agency client.

REPORT HEADER:
Prepared by: VYNTAR Local SEO
Report Date: ${reportDate}
Report Type: ${reportTypeLabels[reportType]}

CLIENT DETAILS:
Business Name: ${client.business_name}
Website: ${client.website || 'Not provided'}
Category: ${client.category || 'Local Business'}
City: ${client.city || 'Not specified'}
Full Address: ${client.address || 'Not provided'}, ${client.city || ''}, ${client.postcode || ''}
Phone: ${client.phone || 'Not provided'}
Current Citation Score: ${client.citation_score || 0}%

Citation Evidence Summary (directories relevant to this category only):
- Live listings verified: ${counts.live}
- Possible listings (found, not fully corroborated): ${counts.possibleMatch}
- Missing (checked, no listing found): ${counts.missing}
- Could not be checked (directory blocks automated access): ${counts.cannotVerify}
- Directories checkable: ${counts.verifiableTotal}
- Gap headline: ${formatMissingSummary(counts)}

NAP consistency: ${napLabel(napVerdict)}${napBasis}

EVIDENCE RULES — these are not stylistic preferences, they are accuracy requirements:
1. The ONLY gap figure is ${counts.missing}. Never state or imply the business is missing from ${counts.missing + counts.cannotVerify} directories.
2. The ${counts.cannotVerify} directories under "${CANNOT_VERIFY_SECTION_LABEL}" were NOT checked. Never describe them as missing, absent, or a gap. Report them in their own clearly labelled section using that exact heading, and say a manual check is needed.
3. Where NAP consistency is shown as "—" it was not evaluated. Do not assert a mismatch.
4. Do not mention any directory not listed below — irrelevant directories have been removed for this business category.

IMPORTANT: Do not use placeholder brackets like [Business Name] or [Date]. All fields above contain real data - use them directly in the report.
`;

    if (reportType === 'citation_audit') {
      prompt += `
LIVE — listing verified (${counts.live}):
${liveCitations.map((c: any) => `- ${c.name}`).join('\n') || '- None yet'}

POSSIBLE MATCH — listing found but not fully corroborated (${counts.possibleMatch}):
${possibleMatchCitations.map((c: any) => `- ${c.name}`).join('\n') || '- None'}

MISSING — checked, no listing found (${counts.missing}). These are the gaps:
${missingCitations.map((c: any) => `- ${c.name}`).join('\n') || '- None'}

${CANNOT_VERIFY_SECTION_LABEL} (${counts.cannotVerify}) — NOT gaps, manual check required:
${cannotVerifyCitations.map((c: any) => `- ${c.name}`).join('\n') || '- None'}

Write a detailed citation audit covering:
1. Executive Summary
2. Current Citation Profile Assessment
3. NAP Consistency Analysis (state "not evaluated" where it was not evaluated)
4. Directory Coverage Gaps (the MISSING list only)
5. ${CANNOT_VERIFY_SECTION_LABEL} (list them, state a manual check is needed)
6. Priority Actions (ranked by impact)
7. 90-Day Citation Building Strategy

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
      model: 'claude-sonnet-5',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const summary = message.content[0].type === 'text' ? message.content[0].text : '';

    // Never persist an empty report as "completed".
    if (!summary.trim()) {
      console.error('Report generation produced an empty summary; not saving.');
      return NextResponse.json(
        { error: 'Report generation produced no content — nothing was saved.' },
        { status: 502 }
      );
    }

    // Save report to database
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .insert({
        client_id: clientId,
        report_type: reportType,
        summary,
        insights: {
          live_citations: counts.live,
          possible_match_citations: counts.possibleMatch,
          missing_citations: counts.missing,
          cannot_verify_citations: counts.cannotVerify,
          checkable_citations: counts.verifiableTotal,
          total_citations: counts.total,
          citation_score: client.citation_score,
          nap_consistent: napVerdict,
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

    const message = error instanceof Error ? error.message : 'Unknown error';
    // Only blame the API key when Anthropic actually rejected authentication
    const isAnthropicAuthError =
      error instanceof Anthropic.APIError && (error.status === 401 || error.status === 403);

    return NextResponse.json(
      {
        error: isAnthropicAuthError
          ? `Claude API authentication failed (${error.status}). Check CLAUDE_API_KEY.`
          : `Failed to generate report: ${message}`,
      },
      { status: 500 }
    );
  }
}
