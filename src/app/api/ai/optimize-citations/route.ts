import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { clientId } = await request.json();

    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    // Get client details
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Get all directories
    const { data: directories } = await supabase
      .from('directories')
      .select('*')
      .order('domain_authority', { ascending: false });

    // Get existing citations for this client
    const { data: existingCitations } = await supabase
      .from('citations')
      .select('directory_id, status')
      .eq('client_id', clientId);

    const allDirectories = directories || [];
    const allExisting = existingCitations || [];
    const existingDirIds = new Set(allExisting.map((c: any) => c.directory_id));
    const availableDirectories = allDirectories.filter((d: any) => !existingDirIds.has(d.id));

    // Call Claude to optimize
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `You are a UK local SEO expert. Analyze this business and recommend the best directories to submit to.

Business Details:
- Name: ${client.business_name}
- Category: ${client.category}
- City: ${client.city}
- Postcode: ${client.postcode}
- Current citation score: ${client.citation_score}%

Available directories (not yet submitted to):
${availableDirectories.map((d: any) => `- ${d.name} (Tier ${d.tier}, DA: ${d.domain_authority}, Categories: ${d.categories?.join(', ')}, Automation: ${d.automation_level})`).join('\n')}

Already submitted to ${allExisting.length} directories.

Please provide:
1. A prioritized list of the top 15 directories to submit to next, with reasoning
2. Category-specific recommendations
3. Expected impact on local rankings
4. Any NAP consistency tips specific to this business type

Format as a structured JSON response with keys: prioritized_directories (array of {name, reason, priority}), category_tips (string), expected_impact (string), nap_tips (string).`,
        },
      ],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    // Try to parse as JSON, fallback to raw text
    let recommendations;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      recommendations = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw: responseText };
    } catch {
      recommendations = { raw: responseText };
    }

    return NextResponse.json({
      client: client.business_name,
      existing_citations: allExisting.length,
      available_directories: availableDirectories.length,
      recommendations,
    });
  } catch (error) {
    console.error('Citation optimization error:', error);
    return NextResponse.json(
      { error: 'Failed to optimize citations. Check CLAUDE_API_KEY.' },
      { status: 500 }
    );
  }
}
