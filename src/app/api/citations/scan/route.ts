import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

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

interface GoogleCustomSearchResponse {
  items?: Array<{
    title: string;
    link: string;
    snippet: string;
    displayLink: string;
  }>;
  searchInformation?: {
    totalResults: string;
  };
  error?: {
    code: number;
    message: string;
  };
}

// Priority directories to check - expanded list for better UK coverage
const PRIORITY_DIRECTORIES = [
  'yell.com',
  'yelp.co.uk',
  'freeindex.co.uk',
  'thomsonlocal.com',
  'facebook.com',
  'checkatrade.com',
  'trustpilot.com',
  'touchlocal.com',
  'scoot.co.uk',
  'hotfrog.co.uk',
];

// Max directories to check per scan (to conserve API quota - 100/day free tier)
const MAX_DIRECTORIES_PER_SCAN = 5;

// Rate limiting helper - sleep for specified ms
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

// Google Custom Search helper with detailed return
interface GoogleSearchResult {
  totalResults: number;
  itemsLen: number;
  firstLink?: string;
  error?: { code: number; message: string };
}

async function googleSearch(
  query: string,
  apiKey: string,
  searchEngineId: string
): Promise<GoogleSearchResult> {
  const fullSearchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}`;

  console.log(`[Google API] >>> Making request`);
  console.log(`[Google API]     Query: "${query}"`);
  console.log(`[Google API]     API Key: ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`);
  console.log(`[Google API]     Search Engine ID: ${searchEngineId}`);
  console.log('🌐 Google API URL:', fullSearchUrl.replace(apiKey, 'API_KEY_HIDDEN'));

  try {
    const response = await fetch(fullSearchUrl);
    const data: GoogleCustomSearchResponse = await response.json();

    console.log('📊 Google API Response:', response.status, 'Items found:', data.items?.length || 0);

    if (data.error) {
      console.log(`[Google API] ❌ ERROR from Google API:`);
      console.log(`[Google API]     Code: ${data.error.code}`);
      console.log(`[Google API]     Message: ${data.error.message}`);
      return {
        totalResults: 0,
        itemsLen: 0,
        error: data.error,
      };
    }

    const totalResults = Number(data.searchInformation?.totalResults) || 0;
    const itemsLen = data.items?.length ?? 0;
    const firstLink = data.items?.[0]?.link;

    console.log(`[Google API] ✅ SUCCESS: totalResults=${totalResults}, itemsLen=${itemsLen}, firstLink=${firstLink ?? 'none'}`);

    return { totalResults, itemsLen, firstLink };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.log(`[Google API] ❌ EXCEPTION: ${errorMessage}`);
    console.log(`[Google API] Full error:`, error);
    return {
      totalResults: 0,
      itemsLen: 0,
      error: { code: -1, message: errorMessage },
    };
  }
}

// Normalize domain for specific cases (e.g., Trustpilot UK)
function normalizeDomain(domain: string): string {
  if (domain.includes('trustpilot.com') && !domain.includes('uk.trustpilot.com')) {
    return 'uk.trustpilot.com';
  }
  return domain;
}

// Strip common suffixes from business name for variant D query
function stripBusinessNameSuffixes(name: string): string {
  // Business suffixes
  const businessSuffixes = [
    'ltd', 'limited', 'llc', 'inc', 'company', 'co', 'corp', 'corporation',
    'services', 'solutions', 'group', 'international', 'associates', 'partners',
    'consulting', 'consultancy', 'agency', 'studio', 'digital', 'media',
    'marketing', 'seo', 'web', 'design', 'development', 'plc', 'uk'
  ];

  // UK cities and regions
  const ukLocations = [
    'london', 'manchester', 'birmingham', 'liverpool', 'leeds', 'sheffield',
    'bristol', 'newcastle', 'nottingham', 'leicester', 'coventry', 'bradford',
    'edinburgh', 'glasgow', 'cardiff', 'belfast', 'brighton', 'plymouth',
    'stoke', 'wolverhampton', 'derby', 'swansea', 'southampton', 'salford',
    'portsmouth', 'aberdeen', 'westminster', 'york', 'peterborough', 'dundee',
    'lancaster', 'oxford', 'cambridge', 'canterbury', 'winchester', 'bath',
    'preston', 'chester', 'durham', 'exeter', 'gloucester', 'lincoln',
    'worcester', 'carlisle', 'norwich', 'ipswich', 'blackpool', 'bournemouth',
    'widnes', 'warrington', 'st helens', 'runcorn', 'crewe', 'macclesfield'
  ];

  const allSuffixes = [...businessSuffixes, ...ukLocations];

  let stripped = name.toLowerCase();
  for (const suffix of allSuffixes) {
    stripped = stripped.replace(new RegExp(`\\b${suffix}\\b`, 'gi'), '').trim();
  }
  // Clean up extra spaces
  stripped = stripped.replace(/\s+/g, ' ').trim();
  return stripped || name; // Return original if everything was stripped
}

// Check if a business exists on a directory using Google Custom Search API with query variants
async function checkDirectoryWithGoogleSearch(
  businessName: string,
  domain: string,
  apiKey: string,
  searchEngineId: string,
  city?: string,
  postcode?: string
): Promise<{ found: boolean; url?: string; queriesUsed: number }> {
  const normalizedDomain = normalizeDomain(domain);
  let queriesUsed = 0;

  // Build query variants - try multiple approaches to find listings
  const variants: string[] = [];

  // Variant A: Exact business name with quotes
  variants.push(`"${businessName}" site:${normalizedDomain}`);

  // Variant B: Business name WITHOUT quotes (catches partial matches)
  variants.push(`${businessName} site:${normalizedDomain}`);

  // Variant C: Business name + city/postcode (if available)
  if (city || postcode) {
    const location = city || postcode;
    variants.push(`"${businessName}" "${location}" site:${normalizedDomain}`);
  }

  // Variant D: Stripped business name (if different from original)
  const strippedName = stripBusinessNameSuffixes(businessName);
  if (strippedName.toLowerCase() !== businessName.toLowerCase() && strippedName.length > 2) {
    variants.push(`"${strippedName}" site:${normalizedDomain}`);
  }

  console.log(`[Google Search] ${domain} -> ${normalizedDomain}: trying ${variants.length} query variants`);

  // Try each variant, stop on first hit
  for (const query of variants) {
    queriesUsed++;
    const result = await googleSearch(query, apiKey, searchEngineId);

    console.log(`[Google Search] ${normalizedDomain}: query="${query}", totalResults=${result.totalResults}, itemsLen=${result.itemsLen}, firstLink=${result.firstLink ?? 'none'}${result.error ? `, error=${JSON.stringify(result.error)}` : ''}`);

    // Found logic: itemsLen > 0 is the reliable indicator
    if (result.itemsLen > 0) {
      console.log(`[Google Search] ${normalizedDomain}: FOUND on variant "${query}"`);
      return { found: true, url: result.firstLink, queriesUsed };
    }

    if (result.error) {
      console.log(`[Google Search] ${normalizedDomain}: API error on variant, stopping: ${result.error.message}`);
      return { found: false, queriesUsed };
    }

    // Rate limit between variant attempts
    if (variants.indexOf(query) < variants.length - 1) {
      await sleep(500);
    }
  }

  console.log(`[Google Search] ${normalizedDomain}: NOT FOUND after ${queriesUsed} queries`);
  return { found: false, queriesUsed };
}

// Scan cooldown: prevent re-scanning same client within 5 minutes
const SCAN_COOLDOWN_MS = 5 * 60 * 1000;
const recentScans = new Map<string, number>();

export async function POST(request: NextRequest) {
  try {
    const { clientId, force } = await request.json();

    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    // Check cooldown (skip if force=true)
    const lastScan = recentScans.get(clientId);
    const now = Date.now();
    if (!force && lastScan && now - lastScan < SCAN_COOLDOWN_MS) {
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

    console.log('🔍 Starting citation scan for business:', client.business_name);
    console.log('🔍 Client ID:', clientId);
    console.log('🔍 Location:', client.city, client.postcode);

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

    // Search Google Places for the business
    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
    let googlePlacesData: GooglePlacesCandidate | null = null;
    let googlePlaceDetails: GooglePlaceDetails['result'] | null = null;

    if (googleApiKey) {
      try {
        const searchQuery = encodeURIComponent(`${client.business_name} ${client.city} ${client.postcode}`);
        const findPlaceUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${searchQuery}&inputtype=textquery&fields=place_id,name,formatted_address,formatted_phone_number,business_status,rating,user_ratings_total&key=${googleApiKey}`;

        const findResponse = await fetch(findPlaceUrl);
        const findData: GooglePlacesResponse = await findResponse.json();

        if (findData.status === 'OK' && findData.candidates.length > 0) {
          googlePlacesData = findData.candidates[0];

          const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${googlePlacesData.place_id}&fields=name,formatted_address,formatted_phone_number,international_phone_number,website,url,rating,user_ratings_total,reviews,opening_hours,address_components&key=${googleApiKey}`;

          const detailsResponse = await fetch(detailsUrl);
          const detailsData: GooglePlaceDetails = await detailsResponse.json();

          if (detailsData.status === 'OK') {
            googlePlaceDetails = detailsData.result;
          }
        }
      } catch (googleError) {
        console.error('Google Places API error:', googleError);
      }
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
    }

    // Get existing citations for this client
    const { data: existingCitations } = await supabase
      .from('citations')
      .select('directory_id')
      .eq('client_id', clientId);

    const existingDirectoryIds = new Set(existingCitations?.map((c) => c.directory_id) || []);

    // Create citation records for all directories not already tracked
    const newCitations = [];
    const directoryCount = directories?.length || 0;

    for (const directory of directories || []) {
      if (!existingDirectoryIds.has(directory.id)) {
        newCitations.push({
          client_id: clientId,
          directory_id: directory.id,
          status: 'pending',
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
        console.error('Failed to insert citations:', insertError);
      } else {
        insertedCount = inserted?.length || 0;
      }
    }

    // Google Custom Search directory detection
    console.log(`[Directory Detection] ========== ENHANCED DETECTION START ==========`);
    console.log(`[Directory Detection] Checking environment variables...`);
    console.log(`[Directory Detection]   GOOGLE_SEARCH_API_KEY: ${process.env.GOOGLE_SEARCH_API_KEY ? 'SET (' + process.env.GOOGLE_SEARCH_API_KEY.length + ' chars)' : 'NOT SET'}`);
    console.log(`[Directory Detection]   GOOGLE_SEARCH_ENGINE_ID: ${process.env.GOOGLE_SEARCH_ENGINE_ID ? 'SET (' + process.env.GOOGLE_SEARCH_ENGINE_ID + ')' : 'NOT SET'}`);

    const googleSearchApiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const googleSearchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
    let listingsDetected = 0;
    let directoriesChecked = 0;
    let totalQueriesUsed = 0;

    if (googleSearchApiKey && googleSearchEngineId) {
      console.log(`[Directory Detection] Credentials found - proceeding with scan`);
      console.log(`[Directory Detection] Client: "${client.business_name}" (${client.city}, ${client.postcode})`);
      console.log(`[Directory Detection] API Key preview: ${googleSearchApiKey.slice(0, 8)}...${googleSearchApiKey.slice(-4)}`);
      console.log(`[Directory Detection] Search Engine ID: ${googleSearchEngineId}`);

      // Get all citations with directory info
      const { data: allCitationsWithDirs } = await supabase
        .from('citations')
        .select('id, directory_id, status, directories(id, name, domain)')
        .eq('client_id', clientId);

      // Build a map of domain -> citation info
      const citationsByDomain = new Map<
        string,
        { citationId: string; directoryId: string; directoryName: string }
      >();

      for (const citation of allCitationsWithDirs || []) {
        const dir = (citation as unknown as { directories: { id: string; name: string; domain: string } }).directories;
        if (dir?.domain) {
          citationsByDomain.set(dir.domain, {
            citationId: citation.id,
            directoryId: dir.id,
            directoryName: dir.name,
          });
        }
      }

      console.log(`[Directory Detection] Found ${citationsByDomain.size} directories in database`);
      console.log(`[Directory Detection] Priority directories: ${PRIORITY_DIRECTORIES.slice(0, MAX_DIRECTORIES_PER_SCAN).join(', ')}`);

      // Check priority directories (limited by MAX_DIRECTORIES_PER_SCAN to conserve quota)
      for (const domain of PRIORITY_DIRECTORIES.slice(0, MAX_DIRECTORIES_PER_SCAN)) {
        const citationInfo = citationsByDomain.get(domain);
        if (!citationInfo) {
          console.log(`[Directory Detection] Skipping ${domain} - no matching directory in database`);
          continue;
        }

        console.log(`[Directory Detection] Checking ${citationInfo.directoryName} (${domain})...`);

        const result = await checkDirectoryWithGoogleSearch(
          client.business_name,
          domain,
          googleSearchApiKey,
          googleSearchEngineId,
          client.city,
          client.postcode
        );

        directoriesChecked++;
        totalQueriesUsed += result.queriesUsed;

        if (result.found) {
          listingsDetected++;
          console.log(`[Directory Detection] ✓ ${citationInfo.directoryName}: LIVE at ${result.url}`);
          console.log('💾 Saving to database - Directory:', citationInfo.directoryName, 'Found:', result.found, 'URL:', result.url);

          const { data: updateData, error: updateError } = await supabase
            .from('citations')
            .update({
              status: 'live',
              listing_url: result.url ?? null,
              nap_consistent: true,
              verified_at: new Date().toISOString(),
            })
            .eq('id', citationInfo.citationId)
            .select();

          console.log('✅ Database save result:', updateError ? `ERROR: ${JSON.stringify(updateError)}` : `SUCCESS - Updated ${updateData?.length || 0} rows`);

          if (updateError) {
            console.error(`[Directory Detection] ❌ Failed to update citation for ${domain}:`, updateError);
          }
        } else {
          console.log(`[Directory Detection] ✗ ${citationInfo.directoryName}: not found`);
          console.log('💾 Skipping database save - Directory:', citationInfo.directoryName, 'Found:', result.found);
        }

        // Rate limit: 500ms between directories
        await sleep(500);
      }

      console.log(`[Directory Detection] === SCAN COMPLETE ===`);
      console.log(`[Directory Detection] Directories checked: ${directoriesChecked}`);
      console.log(`[Directory Detection] Listings found: ${listingsDetected}`);
      console.log(`[Directory Detection] Total API queries used: ${totalQueriesUsed}`);
    } else {
      console.log('[Directory Detection] Skipped - GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_ENGINE_ID not configured');
      if (!googleSearchApiKey) console.log('[Directory Detection] Missing: GOOGLE_SEARCH_API_KEY');
      if (!googleSearchEngineId) console.log('[Directory Detection] Missing: GOOGLE_SEARCH_ENGINE_ID');
    }

    // Calculate citation score based on live citations
    console.log('📈 ========== CITATION SCORE CALCULATION ==========');
    const { data: allCitations, error: fetchCitationsError } = await supabase
      .from('citations')
      .select('status, nap_consistent')
      .eq('client_id', clientId);

    if (fetchCitationsError) {
      console.log('📈 ❌ Error fetching citations:', fetchCitationsError);
    }

    console.log('📈 All citations for client:', JSON.stringify(allCitations));

    const totalCitations = allCitations?.length || 0;
    const liveCitations = allCitations?.filter((c) => c.status === 'live').length || 0;

    console.log('📈 Total citations in DB:', totalCitations);
    console.log('📈 Live citations:', liveCitations);
    console.log('📈 Directory count:', directoryCount);

    // Citation score: live citations / total directories * 100
    const citationScore = directoryCount > 0 ? Math.round((liveCitations / directoryCount) * 100) : 0;

    console.log('📈 Final citation score calculation:', liveCitations, '/', directoryCount, '=', citationScore, '%');

    // Update client's citation score and Google Places data
    const updateData: Record<string, unknown> = {
      citation_score: citationScore,
      updated_at: new Date().toISOString(),
    };

    if (googlePlaceDetails) {
      updateData.google_place_id = googlePlacesData?.place_id;
      updateData.google_rating = googlePlaceDetails.rating;
      updateData.google_reviews_count = googlePlaceDetails.user_ratings_total;
    }

    console.log('📈 Updating client record with:', JSON.stringify(updateData));

    const { data: clientUpdateResult, error: updateError } = await supabase
      .from('clients')
      .update(updateData)
      .eq('id', clientId)
      .select();

    if (updateError) {
      console.error('📈 ❌ Failed to update client citation score:', updateError);
    } else {
      console.log('📈 ✅ Client update result:', JSON.stringify(clientUpdateResult));
    }

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
            place_id: googlePlacesData?.place_id,
            name: googlePlaceDetails.name,
            address: googlePlaceDetails.formatted_address,
            phone: googlePlaceDetails.formatted_phone_number,
            rating: googlePlaceDetails.rating,
            reviews_count: googlePlaceDetails.user_ratings_total,
            website: googlePlaceDetails.website,
            maps_url: googlePlaceDetails.url,
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
        total_directories: directoryCount,
        existing_citations: existingDirectoryIds.size,
        new_citations_created: insertedCount,
        live_citations: liveCitations,
        coverage_percentage: directoryCount > 0 ? Math.round((liveCitations / directoryCount) * 100) : 0,
      },
      directory_detection: {
        method: 'google_custom_search',
        listings_detected: listingsDetected,
        directories_checked: directoriesChecked,
        total_queries_used: totalQueriesUsed,
      },
      scan_timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Citation scan error:', error);
    return NextResponse.json({ error: 'Failed to scan citations' }, { status: 500 });
  }
}
