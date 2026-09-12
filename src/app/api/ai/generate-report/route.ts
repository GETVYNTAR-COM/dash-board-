import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  CANNOT_VERIFY_SECTION_LABEL,
  STATUS_LABEL,
  calculateCitationScore,
  countEvidence,
  findForbiddenDirectoryMentions,
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

    // Every directory known to the database. Used only to catch a report that
    // names a real directory which was not part of this client's scan.
    const { data: catalogueRows } = await supabase.from('directories').select('name');
    const catalogueNames: string[] = (catalogueRows || []).map((d: any) => d.name).filter(Boolean);

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

    // A report with no scan evidence behind it is the empty-report failure in
    // another costume. Refuse rather than let Claude fill the gap with plausible
    // UK directories.
    if (counts.total === 0) {
      return NextResponse.json(
        {
          error:
            'No citation evidence for this client — run a scan that persists results before generating a report.',
        },
        { status: 422 }
      );
    }

    if (counts.verifiableTotal === 0) {
      return NextResponse.json(
        {
          error:
            `None of the ${counts.total} directories could be checked — every one blocked automated access or errored. ` +
            'There is no coverage evidence to report on. Check SERP_API_KEY and FIRECRAWL_API_KEY, then re-scan.',
        },
        { status: 422 }
      );
    }

    // Score recomputed from the rows in front of us. client.citation_score is
    // whatever the last scan managed to persist and may be stale — a report
    // must never quote a number its own evidence does not support.
    const computedScore = calculateCitationScore(counts);
    const storedScore = typeof client.citation_score === 'number' ? client.citation_score : null;
    const scoreIsStale = storedScore !== null && storedScore !== computedScore;

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
Citation Score: ${computedScore}% (${counts.live} live out of ${counts.verifiableTotal} directories that could be checked — the ${counts.cannotVerify} unverifiable directories are excluded from this calculation)

Citation Evidence Summary — ${counts.total} directories scanned for this client:
- Live listings verified: ${counts.live}
- Possible listings (found, not fully corroborated): ${counts.possibleMatch}
- MISSING (checked, no listing found): ${counts.missing}
- COULD NOT BE CHECKED (directory blocks automated access, never checked): ${counts.cannotVerify}
- Directories that could be checked: ${counts.verifiableTotal}
- Gap headline, use this figure and no other: ${formatMissingSummary(counts)}

NAP consistency: ${napLabel(napVerdict)}${napBasis}

DIRECTORY UNIVERSE — the complete and only set of directories in scope for this
report. ${counts.total} entries, each with the result of this scan:
${allCitations.map((c: any, i: number) => `${i + 1}. ${c.name} — ${STATUS_LABEL[c.status as keyof typeof STATUS_LABEL]}`).join('\n')}

EVIDENCE RULES — these are not stylistic preferences, they are accuracy requirements.
A report that breaks any of them is unusable and will be rejected:

1. GAPS. The only gap figure is ${counts.missing}. Never write that the business is
   missing from ${counts.total} directories, from ${counts.missing + counts.cannotVerify} directories, or from "all" of them.
   Never write that every scanned directory represents an active gap.

2. UNVERIFIABLE. The ${counts.cannotVerify} directories listed under
   "${CANNOT_VERIFY_SECTION_LABEL}" were never checked. They are not gaps, not
   absences, and not opportunities. Give them their own section under that exact
   heading, state that each needs a manual check, and never add them to any gap
   total or roll them into a coverage percentage.

3. NO INVENTED DIRECTORIES. You may name ONLY the ${counts.total} directories in the
   DIRECTORY UNIVERSE above. Do not name any other directory, trade body,
   professional association, review platform, data aggregator or chamber of
   commerce — not in recommendations, not in the strategy section, not as an
   example, not even in passing. If you want to recommend action beyond this
   list, describe the action generically without naming a platform.

4. NAP. Where NAP consistency shows "—" it was not evaluated. Do not assert a
   mismatch, and do not estimate a consistency percentage.

5. NO INVENTED NUMBERS. Every figure in the report must come from the data above.
   Do not estimate traffic, rankings, review counts or competitor citation counts
   that were not supplied.

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

MISSING — checked, no listing found (${counts.missing}). These are the only gaps:
${missingCitations.map((c: any) => `- ${c.name}`).join('\n') || '- None'}

${CANNOT_VERIFY_SECTION_LABEL} (${counts.cannotVerify}) — NOT gaps:
${cannotVerifyCitations.map((c: any) => `- ${c.name}`).join('\n') || '- None'}

Write a competitor analysis covering:
1. Executive Summary
2. Citation Gap Analysis vs Competitors (name only directories from the DIRECTORY UNIVERSE)
3. Competitor Strengths and Weaknesses
4. Opportunities to Outperform
5. Recommended Strategy
6. Priority Action Items

Keep it professional and data-driven. Use UK English.`;
    } else {
      prompt += `
MISSING — checked, no listing found (${counts.missing}). These are the only gaps:
${missingCitations.map((c: any) => `- ${c.name}`).join('\n') || '- None'}

${CANNOT_VERIFY_SECTION_LABEL} (${counts.cannotVerify}) — NOT gaps:
${cannotVerifyCitations.map((c: any) => `- ${c.name}`).join('\n') || '- None'}

Write a monthly performance report covering:
1. Executive Summary
2. Citation Growth This Period
3. Directory Coverage Progress (the MISSING list only)
4. NAP Consistency (state "not evaluated" where it was not evaluated)
5. ${CANNOT_VERIFY_SECTION_LABEL} (list them, manual check needed)
6. Local Search Visibility Indicators
7. Recommendations for Next Month

Keep it professional, concise, and client-friendly. Use UK English.`;
    }

    // Call Claude
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const scannedNames: string[] = allCitations.map((c: any) => c.name);

    const generate = async (turns: Anthropic.MessageParam[]): Promise<string> => {
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 3000,
        messages: turns,
      });
      return message.content[0].type === 'text' ? message.content[0].text : '';
    };

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];
    let summary = await generate(messages);

    // ========================================================================
    // DIRECTORY UNIVERSE GUARD
    // ========================================================================
    // A report that names a directory outside this client's scan is fabricated
    // evidence. One corrective pass, then refuse — a rejected report is
    // recoverable, a fabricated one shown to a customer is not.
    // ========================================================================
    let violations = findForbiddenDirectoryMentions(summary, scannedNames, catalogueNames);

    if (violations.length > 0) {
      console.warn('[Report] Invented directories on first pass:', violations);

      messages.push({ role: 'assistant', content: summary });
      messages.push({
        role: 'user',
        content:
          `That draft names directories that were not scanned for this client: ${violations.join(', ')}. ` +
          'None of them may appear in the report. Rewrite the full report naming only the directories in the ' +
          'DIRECTORY UNIVERSE list, keeping every other rule. Where you recommended an action tied to one of ' +
          'those names, describe the action without naming a platform. Output the complete rewritten report only.',
      });

      summary = await generate(messages);
      violations = findForbiddenDirectoryMentions(summary, scannedNames, catalogueNames);
    }

    // Never persist an empty report as "completed".
    if (!summary.trim()) {
      console.error('Report generation produced an empty summary; not saving.');
      return NextResponse.json(
        { error: 'Report generation produced no content — nothing was saved.' },
        { status: 502 }
      );
    }

    if (violations.length > 0) {
      console.error('[Report] Invented directories survived the corrective pass:', violations);
      return NextResponse.json(
        {
          error:
            'Report rejected — it named directories that were not scanned for this client: ' +
            `${violations.join(', ')}. Nothing was saved. Generate again.`,
          invented_directories: violations,
        },
        { status: 422 }
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
          citation_score_computed: computedScore,
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
      // The evidence the report was built from, so the numbers on the page can
      // be checked against the numbers in the prose.
      evidence: {
        directories_scanned: counts.total,
        live_count: counts.live,
        possible_match_count: counts.possibleMatch,
        missing_count: counts.missing,
        cannot_verify_count: counts.cannotVerify,
        checkable_count: counts.verifiableTotal,
        missing_summary: formatMissingSummary(counts),
        nap_consistent: napVerdict,
      },
      citation_score: {
        computed: computedScore,
        stored: storedScore,
        stale: scoreIsStale,
        formula: 'live / (scanned - cannot_verify) * 100',
      },
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
