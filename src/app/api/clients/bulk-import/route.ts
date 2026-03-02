import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

interface ClientImport {
  business_name: string;
  address: string;
  city: string;
  postcode: string;
  phone: string;
  category?: string;
  website?: string;
  email?: string;
  google_place_id?: string;
}

interface ImportResult {
  business_name: string;
  status: 'imported' | 'duplicate' | 'error';
  client_id?: string;
  error?: string;
  scan_triggered?: boolean;
}

// Normalise business name for duplicate detection
function normaliseBusinessName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,&'"\-()]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bltd\b/g, '')
    .replace(/\blimited\b/g, '')
    .replace(/\bllc\b/g, '')
    .replace(/\binc\b/g, '')
    .replace(/\bthe\b/g, '')
    .trim();
}

// Normalise postcode for comparison (UK format)
function normalisePostcode(postcode: string): string {
  return postcode.toUpperCase().replace(/\s+/g, '');
}

// Check if two clients are likely duplicates
function isDuplicate(
  newClient: ClientImport,
  existingClient: { business_name: string; postcode: string; phone?: string }
): boolean {
  const nameMatch =
    normaliseBusinessName(newClient.business_name) === normaliseBusinessName(existingClient.business_name);
  const postcodeMatch = normalisePostcode(newClient.postcode) === normalisePostcode(existingClient.postcode || '');

  // Same name and postcode = duplicate
  if (nameMatch && postcodeMatch) {
    return true;
  }

  // Same phone number (if provided) = duplicate
  if (newClient.phone && existingClient.phone) {
    const newPhone = newClient.phone.replace(/\D/g, '');
    const existingPhone = existingClient.phone.replace(/\D/g, '');
    if (newPhone.length >= 10 && newPhone === existingPhone) {
      return true;
    }
  }

  return false;
}

// Validate client data
function validateClient(client: ClientImport): string[] {
  const errors: string[] = [];

  if (!client.business_name || client.business_name.trim().length < 2) {
    errors.push('Business name is required (min 2 characters)');
  }

  if (!client.address || client.address.trim().length < 5) {
    errors.push('Address is required (min 5 characters)');
  }

  if (!client.city || client.city.trim().length < 2) {
    errors.push('City is required');
  }

  if (!client.postcode || client.postcode.trim().length < 5) {
    errors.push('Valid UK postcode is required');
  }

  if (!client.phone || client.phone.replace(/\D/g, '').length < 10) {
    errors.push('Valid phone number is required (min 10 digits)');
  }

  return errors;
}

// Trigger citation scan for a client (fire and forget)
async function triggerCitationScan(clientId: string, baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/citations/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    });
    return response.ok;
  } catch (error) {
    console.error(`Citation scan failed for client ${clientId}:`, error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { clients, agency_id, trigger_scans = true } = body;

    if (!Array.isArray(clients) || clients.length === 0) {
      return NextResponse.json(
        { error: 'clients array is required and must not be empty' },
        { status: 400 }
      );
    }

    if (!agency_id) {
      return NextResponse.json({ error: 'agency_id is required' }, { status: 400 });
    }

    // Limit bulk import size
    if (clients.length > 100) {
      return NextResponse.json(
        { error: 'Maximum 100 clients per bulk import' },
        { status: 400 }
      );
    }

    const supabase = createServiceRoleClient();

    // Verify agency exists
    const { data: agency, error: agencyError } = await supabase
      .from('agencies')
      .select('id')
      .eq('id', agency_id)
      .single();

    if (agencyError || !agency) {
      return NextResponse.json({ error: 'Agency not found' }, { status: 404 });
    }

    // Get existing clients for this agency (for duplicate detection)
    const { data: existingClients } = await supabase
      .from('clients')
      .select('id, business_name, postcode, phone')
      .eq('agency_id', agency_id);

    const existingClientsList = existingClients || [];

    const results: ImportResult[] = [];
    const clientsToInsert: Array<{
      business_name: string;
      address: string;
      city: string;
      postcode: string;
      phone: string;
      category: string;
      website: string | null;
      email: string | null;
      google_place_id: string | null;
      agency_id: string;
      citation_score: number;
      created_at: string;
    }> = [];
    const importIndexMap: number[] = []; // Track which original index each insert corresponds to

    // Process each client
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i] as ClientImport;

      // Validate
      const validationErrors = validateClient(client);
      if (validationErrors.length > 0) {
        results.push({
          business_name: client.business_name || `Client ${i + 1}`,
          status: 'error',
          error: validationErrors.join('; '),
        });
        continue;
      }

      // Check for duplicates against existing clients
      const existingDuplicate = existingClientsList.find((existing) => isDuplicate(client, existing));
      if (existingDuplicate) {
        results.push({
          business_name: client.business_name,
          status: 'duplicate',
          client_id: existingDuplicate.id,
          error: `Duplicate of existing client: ${existingDuplicate.business_name}`,
        });
        continue;
      }

      // Check for duplicates within the import batch
      const batchDuplicate = clientsToInsert.find((pending) =>
        isDuplicate(client, { business_name: pending.business_name, postcode: pending.postcode, phone: pending.phone })
      );
      if (batchDuplicate) {
        results.push({
          business_name: client.business_name,
          status: 'duplicate',
          error: `Duplicate within import batch: ${batchDuplicate.business_name}`,
        });
        continue;
      }

      // Prepare for insert
      clientsToInsert.push({
        business_name: client.business_name.trim(),
        address: client.address.trim(),
        city: client.city.trim(),
        postcode: client.postcode.trim().toUpperCase(),
        phone: client.phone.trim(),
        category: client.category?.trim() || 'Local Business',
        website: client.website?.trim() || null,
        email: client.email?.trim() || null,
        google_place_id: client.google_place_id || null,
        agency_id: agency_id,
        citation_score: 0,
        created_at: new Date().toISOString(),
      });
      importIndexMap.push(i);
    }

    // Bulk insert valid clients
    const insertedClients: Array<{ id: string; business_name: string }> = [];
    if (clientsToInsert.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from('clients')
        .insert(clientsToInsert)
        .select('id, business_name');

      if (insertError) {
        console.error('Bulk insert error:', insertError);
        // Mark all pending as errors
        for (const client of clientsToInsert) {
          results.push({
            business_name: client.business_name,
            status: 'error',
            error: `Database error: ${insertError.message}`,
          });
        }
      } else if (inserted) {
        insertedClients.push(...inserted);
      }
    }

    // Get base URL for internal API calls
    const baseUrl = request.nextUrl.origin;

    // Process inserted clients - add to results and trigger scans
    for (let i = 0; i < insertedClients.length; i++) {
      const inserted = insertedClients[i];
      let scanTriggered = false;

      if (trigger_scans) {
        // Trigger citation scan asynchronously
        scanTriggered = await triggerCitationScan(inserted.id, baseUrl);
      }

      results.push({
        business_name: inserted.business_name,
        status: 'imported',
        client_id: inserted.id,
        scan_triggered: scanTriggered,
      });
    }

    // Sort results to match original input order (imported ones might be out of order)
    // Results already contains errors and duplicates in order, now we have imported ones
    const finalResults = results;

    // Calculate summary
    const summary = {
      total_submitted: clients.length,
      imported: finalResults.filter((r) => r.status === 'imported').length,
      duplicates: finalResults.filter((r) => r.status === 'duplicate').length,
      errors: finalResults.filter((r) => r.status === 'error').length,
      scans_triggered: finalResults.filter((r) => r.scan_triggered).length,
    };

    return NextResponse.json({
      success: true,
      summary,
      results: finalResults,
      import_timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Bulk import error:', error);
    return NextResponse.json({ error: 'Failed to process bulk import' }, { status: 500 });
  }
}
