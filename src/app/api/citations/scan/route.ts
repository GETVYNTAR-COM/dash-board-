import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

// ============================================================================
// CITATION STATUS MODEL
// ============================================================================
// live           = verified listing found
// possible_match = likely listing found but not strong enough for full confidence
// not_found      = checked and no listing found
// blocked        = directory could not be checked due to technical restrictions
// ============================================================================

type CitationStatus = 'live' | 'possible_match' | 'not_found' | 'blocked';

interface DirectoryScanResult {
  directoryId: string;
  directoryName: string;
  domain: string;
  status: CitationStatus;
  reason: string;
  listingUrl: string | null;
  verificationMethod: string;
}

interface ScanSummary {
  businessName: string;
  totalDirectories: number;
  checkedCount: number;
  liveCount: number;
  possibleMatchCount: number;
  notFoundCount: number;
  blockedCount: number;
  citationScore: number;
  scanDurationMs: number;
}

// Report wording support
const STATUS_WORDING: Record<CitationStatus, string> = {
  live: 'verified by scan',
  possible_match: 'possible listing detected',
  not_found: 'not detected by scan',
  blocked: 'directory check unavailable',
};

interface GooglePlacesCandidate {
  place_id: string;
  name: string;
  formatted_address: string;
  formatted_phone_number?: string;
  business_status?: string;
  types?: string[];
  rating?: number;
  user_ratings_total?: number;
}

interface GooglePlacesResponse {
  candidates: GooglePlacesCandidate[];
  status: string;
  error_message?: string;
}

interface GooglePlaceDetails {
  result: {
    name: string;
    formatted_address: string;
    formatted_phone_number?: string;
    international_phone_number?: string;
    website?: string;
    url?: string;
    rating?: number;
    user_ratings_total?: number;
    reviews?: Array<{
      author_name: string;
      rating: number;
      text: string;
      time: number;
    }>;
    opening_hours?: {
      open_now: boolean;
      weekday_text: string[];
    };
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  };
  status: string;
}

// Directories that can be checked via direct methods (not Google CSE)
// These are directories with known URL patterns or public APIs
const DIRECT_CHECK_DIRECTORIES: Record<string, {
  method: 'url_pattern' | 'api' | 'none';
  buildUrl?: (businessName: string, city?: string) => string;
}> = {
  // Currently no directories support direct verification without Google CSE
  // This can be expanded as we implement direct checks for specific directories
  // Example:
  // 'yell.com': {
  //   method: 'url_pattern',
  //   buildUrl: (name, city) => `https://www.yell.com/search?keywords=${encodeURIComponent(name)}&location=${encodeURIComponent(city || '')}`
  // }
};

// Rate limiting helper
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Normalise phone numbers for comparison (UK format)
function normalisePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('44')) {
    return digits.slice(2);
  }
  if (digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

// Normalise address for comparison
function normaliseAddress(address: string | null | undefined): string {
  if (!address) return '';
  return address
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\blane\b/g, 'ln')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\bcourt\b/g, 'ct')
    .replace(/\bplace\b/g, 'pl')
    .replace(/\bsuite\b/g, 'ste')
    .replace(/\bfloor\b/g, 'fl')
    .replace(/\bunit\b/g, 'u')
    .trim();
}

// Normalise business name for comparison
function normaliseName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[.,&'"-]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bltd\b/g, 'limited')
    .replace(/\blimited\b/g, '')
    .replace(/\bllc\b/g, '')
    .replace(/\binc\b/g, '')
    .replace(/\bthe\b/g, '')
    .trim();
}

// Calculate similarity score between two strings (0-100)
function similarityScore(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 100;

  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1.includes(s2) || s2.includes(s1)) {
    return 85;
  }

  const len1 = s1.length;
  const len2 = s2.length;
  const maxLen = Math.max(len1, len2);

  if (maxLen === 0) return 100;

  const arr1 = s1.split('');
  const arr2 = s2.split('');
  const intersection = arr1.filter((char) => arr2.includes(char)).length;
  const uniqueChars = new Set(arr1.concat(arr2));

  return Math.round((intersection / uniqueChars.size) * 100);
}

// Check NAP consistency between client data and Google Places data
function checkNAPConsistency(
  client: { business_name: string; address: string; phone: string; city: string; postcode: string },
  googleData: { name: string; formatted_address: string; formatted_phone_number?: string }
): { isConsistent: boolean; nameMatch: number; addressMatch: number; phoneMatch: number; details: string[] } {
  const details: string[] = [];

  const clientName = normaliseName(client.business_name);
  const googleName = normaliseName(googleData.name);
  const nameMatch = similarityScore(clientName, googleName);

  if (nameMatch < 70) {
    details.push(`Name mismatch: "${client.business_name}" vs "${googleData.name}"`);
  }

  const clientAddress = normaliseAddress(`${client.address} ${client.city} ${client.postcode}`);
  const googleAddress = normaliseAddress(googleData.formatted_address);
  const addressMatch = similarityScore(clientAddress, googleAddress);

  const postcodeInGoogle = googleData.formatted_address
    .toUpperCase()
    .includes(client.postcode.toUpperCase().replace(/\s/g, ''));

  if (addressMatch < 60 && !postcodeInGoogle) {
    details.push(`Address mismatch: "${client.address}, ${client.city}" vs "${googleData.formatted_address}"`);
  }

  const clientPhone = normalisePhone(client.phone);
  const googlePhone = normalisePhone(googleData.formatted_phone_number);
  const phoneMatch = clientPhone && googlePhone ? (clientPhone === googlePhone ? 100 : 0) : 50;

  if (clientPhone && googlePhone && clientPhone !== googlePhone) {
    details.push(`Phone mismatch: "${client.phone}" vs "${googleData.formatted_phone_number}"`);
  }

  const weightedScore = nameMatch * 0.4 + (postcodeInGoogle ? 100 : addressMatch) * 0.35 + phoneMatch * 0.25;
  const isConsistent = weightedScore >= 70;

  return { isConsistent, nameMatch, addressMatch: postcodeInGoogle ? 100 : addressMatch, phoneMatch, details };
}

// ============================================================================
// DIRECTORY VERIFICATION
// ============================================================================
// Checks a single directory and returns a result with status
// Never throws - converts all errors to "blocked" status
// ============================================================================

async function verifyDirectory(
  businessName: string,
  domain: string,
  directoryId: string,
  directoryName: string,
  _city?: string,
  _postcode?: string
): Promise<DirectoryScanResult> {
  const baseResult: DirectoryScanResult = {
    directoryId,
    directoryName,
    domain,
    status: 'blocked',
    reason: '',
    listingUrl: null,
    verificationMethod: 'none',
  };

  try {
    // Check if we have a direct verification method for this directory
    const directMethod = DIRECT_CHECK_DIRECTORIES[domain];

    if (directMethod && directMethod.method !== 'none') {
      // Future: implement direct verification methods here
      // For now, mark as blocked since Google CSE is removed
      baseResult.status = 'blocked';
      baseResult.reason = 'Direct verification method not yet implemented';
      baseResult.verificationMethod = 'pending_implementation';
    } else {
      // No verification method available for this directory
      baseResult.status = 'blocked';
      baseResult.reason = 'Google Custom Search API removed; no alternative verification method available';
      baseResult.verificationMethod = 'none';
    }

    console.log(`[Directory Scan] ${directoryName} (${domain}): status=${baseResult.status}, reason="${baseResult.reason}"`);
    return baseResult;

  } catch (error) {
    // Convert any error to blocked status - never let one directory break the scan
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Directory Scan] ${directoryName} (${domain}): ERROR - ${errorMessage}`);

    return {
      ...baseResult,
      status: 'blocked',
      reason: `Error during verification: ${errorMessage}`,
      verificationMethod: 'error',
    };
  }
}

// ============================================================================
// CITATION SCORE CALCULATION
// ============================================================================
// Formula:
// score = ((live * 1) + (possible_match * 0.5)) / (total - blocked) * 100
// Blocked directories are excluded from the denominator
// ============================================================================

function calculateCitationScore(results: DirectoryScanResult[]): number {
  const liveCount = results.filter(r => r.status === 'live').length;
  const possibleMatchCount = results.filter(r => r.status === 'possible_match').length;
  const blockedCount = results.filter(r => r.status === 'blocked').length;
  const totalDirectories = results.length;

  const denominator = totalDirectories - blockedCount;

  if (denominator <= 0) {
    // All directories are blocked - cannot calculate a meaningful score
    console.log('[Score] All directories blocked, returning 0');
    return 0;
  }

  const numerator = (liveCount * 1) + (possibleMatchCount * 0.5);
  const score = Math.round((numerator / denominator) * 100);

  console.log(`[Score] Calculation: ((${liveCount} * 1) + (${possibleMatchCount} * 0.5)) / (${totalDirectories} - ${blockedCount}) * 100 = ${score}%`);

  return score;
}

// ============================================================================
// SCAN SUMMARY LOGGING
// ============================================================================

function logScanSummary(summary: ScanSummary): void {
  console.log('');
  console.log('========== CITATION SCAN SUMMARY ==========');
  console.log(`Business:          ${summary.businessName}`);
  console.log(`Total Directories: ${summary.totalDirectories}`);
  console.log(`Checked:           ${summary.checkedCount}`);
  console.log(`-------------------------------------------`);
  console.log(`Live:              ${summary.liveCount}`);
  console.log(`Possible Match:    ${summary.possibleMatchCount}`);
  console.log(`Not Found:         ${summary.notFoundCount}`);
  console.log(`Blocked:           ${summary.blockedCount}`);
  console.log(`-------------------------------------------`);
  console.log(`Citation Score:    ${summary.citationScore}%`);
  console.log(`Scan Duration:     ${summary.scanDurationMs}ms`);
  console.log('============================================');
  console.log('');
}

function logDirectoryResult(result: DirectoryScanResult): void {
  const statusEmoji: Record<CitationStatus, string> = {
    live: '✓',
    possible_match: '~',
    not_found: '✗',
    blocked: '⊘',
  };

  const emoji = statusEmoji[result.status];
  const urlInfo = result.listingUrl ? ` -> ${result.listingUrl}` : '';

  console.log(`[Directory] ${emoji} ${result.directoryName} (${result.domain}): ${result.status} - ${result.reason}${urlInfo}`);
}

// Scan cooldown: prevent re-scanning same client within 5 minutes
const SCAN_COOLDOWN_MS = 5 * 60 * 1000;
const recentScans = new Map<string, number>();

export async function POST(request: NextRequest) {
  const scanStartTime = Date.now();

  try {
    const { clientId, force } = await request.json();

    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    // Check cooldown (skip if force=true)
    const lastScan = recentScans.get(clientId);
    const now = Date.now();
    if (force !== true && lastScan && now - lastScan < SCAN_COOLDOWN_MS) {
      const remainingMs = SCAN_COOLDOWN_MS - (now - lastScan);
      const remainingMins = Math.ceil(remainingMs / 60000);
      console.log(`[Scan Cooldown] Client ${clientId} was scanned recently, ${remainingMins}min remaining`);
      return NextResponse.json({
        success: false,
        error: 'cooldown',
        message: `Please wait ${remainingMins} minute(s) before scanning again`,
        cooldown_remaining_ms: remainingMs,
      }, { status: 429 });
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

    console.log('');
    console.log('========== CITATION SCAN START ==========');
    console.log(`Business: ${client.business_name}`);
    console.log(`Client ID: ${clientId}`);
    console.log(`Location: ${client.city}, ${client.postcode}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('=========================================');

    // Mark scan start time
    recentScans.set(clientId, now);

    // Get all directories from database
    const { data: directories, error: dirError } = await supabase
      .from('directories')
      .select('*')
      .order('tier', { ascending: true });

    if (dirError) {
      console.error('Failed to fetch directories:', dirError);
      return NextResponse.json({ error: 'Failed to fetch directories' }, { status: 500 });
    }

    const directoryList = directories ?? [];
    console.log(`[Scan] Found ${directoryList.length} directories to check`);

    // Search Google Places for the business (still works - separate from Custom Search)
    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
    let googlePlacesData: GooglePlacesCandidate | null = null;
    let googlePlaceDetails: GooglePlaceDetails['result'] | null = null;

    if (googleApiKey) {
      try {
        console.log('[Google Places] Searching for business...');
        const searchQuery = encodeURIComponent(`${client.business_name} ${client.city} ${client.postcode}`);
        const findPlaceUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${searchQuery}&inputtype=textquery&fields=place_id,name,formatted_address,formatted_phone_number,business_status,rating,user_ratings_total&key=${googleApiKey}`;

        const findResponse = await fetch(findPlaceUrl);
        const findData: GooglePlacesResponse = await findResponse.json();

        if (findData.status === 'OK' && findData.candidates.length > 0) {
          googlePlacesData = findData.candidates[0];
          console.log(`[Google Places] Found: ${googlePlacesData.name}`);

          const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${googlePlacesData.place_id}&fields=name,formatted_address,formatted_phone_number,international_phone_number,website,url,rating,user_ratings_total,reviews,opening_hours,address_components&key=${googleApiKey}`;

          const detailsResponse = await fetch(detailsUrl);
          const detailsData: GooglePlaceDetails = await detailsResponse.json();

          if (detailsData.status === 'OK') {
            googlePlaceDetails = detailsData.result;
            console.log(`[Google Places] Details retrieved successfully`);
          }
        } else {
          console.log(`[Google Places] Business not found or API error: ${findData.status}`);
        }
      } catch (googleError) {
        console.error('[Google Places] API error:', googleError);
      }
    } else {
      console.log('[Google Places] Skipped - GOOGLE_PLACES_API_KEY not configured');
    }

    // Check NAP consistency with Google
    let napConsistency = {
      isConsistent: false,
      nameMatch: 0,
      addressMatch: 0,
      phoneMatch: 0,
      details: ['Google Places API not configured or business not found'],
    };

    if (googlePlaceDetails) {
      napConsistency = checkNAPConsistency(client, {
        name: googlePlaceDetails.name,
        formatted_address: googlePlaceDetails.formatted_address,
        formatted_phone_number: googlePlaceDetails.formatted_phone_number,
      });
      console.log(`[NAP Check] Consistent: ${napConsistency.isConsistent}, Name: ${napConsistency.nameMatch}%, Address: ${napConsistency.addressMatch}%, Phone: ${napConsistency.phoneMatch}%`);
    }

    // Get existing citations for this client
    const { data: existingCitations } = await supabase
      .from('citations')
      .select('directory_id')
      .eq('client_id', clientId);

    const existingDirectoryIds = new Set(existingCitations?.map((c: { directory_id: string }) => c.directory_id) ?? []);

    // Create citation records for all directories not already tracked
    const newCitations = [];

    for (const directory of directoryList) {
      if (!existingDirectoryIds.has(directory.id)) {
        newCitations.push({
          client_id: clientId,
          directory_id: directory.id,
          status: 'pending' as const,
          nap_consistent: napConsistency.isConsistent,
          created_at: new Date().toISOString(),
        });
      }
    }

    // Insert new citations
    let insertedCount = 0;
    if (newCitations.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from('citations')
        .insert(newCitations)
        .select();

      if (insertError) {
        console.error('[Citations] Failed to insert:', insertError);
      } else {
        insertedCount = inserted?.length ?? 0;
        console.log(`[Citations] Created ${insertedCount} new citation records`);
      }
    }

    // ========================================================================
    // DIRECTORY VERIFICATION
    // ========================================================================
    console.log('');
    console.log('[Scan] Starting directory verification...');
    console.log('[Scan] Note: Google Custom Search API has been removed');
    console.log('[Scan] Directories without direct verification will be marked as "blocked"');
    console.log('');

    // Get all citations with directory info
    const { data: allCitationsWithDirs } = await supabase
      .from('citations')
      .select('id, directory_id, status, directories(id, name, domain)')
      .eq('client_id', clientId);

    const scanResults: DirectoryScanResult[] = [];

    for (const citation of allCitationsWithDirs ?? []) {
      const dir = (citation as unknown as { directories: { id: string; name: string; domain: string } | null }).directories;

      if (!dir) {
        console.warn(`[Scan] Citation ${citation.id} has no associated directory`);
        continue;
      }

      // Verify this directory
      const result = await verifyDirectory(
        client.business_name,
        dir.domain,
        dir.id,
        dir.name,
        client.city,
        client.postcode
      );

      // Log individual result
      logDirectoryResult(result);

      // Use upsert to handle both existing and new citation records
      const { error: upsertError } = await supabase
        .from('citations')
        .upsert({
          client_id: clientId,
          directory_id: dir.id,
          status: result.status,
          listing_url: result.listingUrl,
          nap_consistent: result.status === 'live' ? true : napConsistency.isConsistent,
          verified_at: new Date().toISOString(),
          verification_method: result.verificationMethod,
          verification_reason: result.reason,
        }, {
          onConflict: 'client_id,directory_id'
        });

      if (upsertError) {
        console.error(`[Scan] Failed to upsert citation for ${dir.domain}`, upsertError);
      }

      scanResults.push(result);

      // Small delay between directories to avoid rate limiting
      await sleep(100);
    }

    // ========================================================================
    // CALCULATE CITATION SCORE
    // ========================================================================
    const citationScore = calculateCitationScore(scanResults);

    // Count statuses
    const liveCount = scanResults.filter(r => r.status === 'live').length;
    const possibleMatchCount = scanResults.filter(r => r.status === 'possible_match').length;
    const notFoundCount = scanResults.filter(r => r.status === 'not_found').length;
    const blockedCount = scanResults.filter(r => r.status === 'blocked').length;

    // Log summary
    const scanDuration = Date.now() - scanStartTime;
    const summary: ScanSummary = {
      businessName: client.business_name,
      totalDirectories: directoryList.length,
      checkedCount: scanResults.length,
      liveCount,
      possibleMatchCount,
      notFoundCount,
      blockedCount,
      citationScore,
      scanDurationMs: scanDuration,
    };

    logScanSummary(summary);

    // Update client's citation score and Google Places data
    const updateData: Record<string, unknown> = {
      citation_score: citationScore,
      updated_at: new Date().toISOString(),
    };

    if (googlePlaceDetails) {
      updateData.google_place_id = googlePlacesData?.place_id ?? null;
      updateData.google_rating = googlePlaceDetails.rating ?? null;
      updateData.google_reviews_count = googlePlaceDetails.user_ratings_total ?? null;
    }

    const { error: clientUpdateError } = await supabase
      .from('clients')
      .update(updateData)
      .eq('id', clientId);

    if (clientUpdateError) {
      console.error('[Scan] Failed to update client:', clientUpdateError);
    } else {
      console.log(`[Scan] Client citation score updated to ${citationScore}%`);
    }

    // ========================================================================
    // BUILD RESPONSE
    // ========================================================================
    return NextResponse.json({
      success: true,
      client: {
        id: client.id,
        business_name: client.business_name,
        citation_score: citationScore,
      },
      google_places: googlePlaceDetails
        ? {
            found: true,
            place_id: googlePlacesData?.place_id ?? null,
            name: googlePlaceDetails.name,
            address: googlePlaceDetails.formatted_address,
            phone: googlePlaceDetails.formatted_phone_number ?? null,
            rating: googlePlaceDetails.rating ?? null,
            reviews_count: googlePlaceDetails.user_ratings_total ?? null,
            website: googlePlaceDetails.website ?? null,
            maps_url: googlePlaceDetails.url ?? null,
          }
        : {
            found: false,
            message: 'Business not found on Google Places or API not configured',
          },
      nap_consistency: {
        is_consistent: napConsistency.isConsistent,
        name_match: napConsistency.nameMatch,
        address_match: napConsistency.addressMatch,
        phone_match: napConsistency.phoneMatch,
        issues: napConsistency.details,
      },
      citations: {
        total_directories: directoryList.length,
        existing_citations: existingDirectoryIds.size,
        new_citations_created: insertedCount,
        live_count: liveCount,
        possible_match_count: possibleMatchCount,
        not_found_count: notFoundCount,
        blocked_count: blockedCount,
      },
      citation_score: {
        value: citationScore,
        formula: '((live * 1) + (possible_match * 0.5)) / (total - blocked) * 100',
        calculation: {
          live: liveCount,
          possible_match: possibleMatchCount,
          not_found: notFoundCount,
          blocked: blockedCount,
          denominator: directoryList.length - blockedCount,
        },
      },
      directory_results: scanResults.map(r => ({
        directory: r.directoryName,
        domain: r.domain,
        status: r.status,
        status_wording: STATUS_WORDING[r.status],
        reason: r.reason,
        listing_url: r.listingUrl,
        verification_method: r.verificationMethod,
      })),
      scan_info: {
        method: 'resilient_scan_v2',
        google_cse_enabled: false,
        google_places_enabled: Boolean(googleApiKey),
        scan_duration_ms: scanDuration,
        timestamp: new Date().toISOString(),
      },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Scan] Fatal error:', errorMessage);
    console.error('[Scan] Stack:', error);

    return NextResponse.json({
      success: false,
      error: 'Failed to scan citations',
      message: errorMessage,
      scan_duration_ms: Date.now() - scanStartTime,
    }, { status: 500 });
  }
}
