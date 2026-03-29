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

// ============================================================================
// FIRECRAWL API INTEGRATION
// ============================================================================

interface FirecrawlResponse {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    metadata?: {
      title?: string;
      description?: string;
      sourceURL?: string;
    };
  };
  error?: string;
}

async function scrapeWithFirecrawl(url: string): Promise<{ success: boolean; markdown: string; error?: string }> {
  const apiKey = process.env.FIRECRAWL_API_KEY;

  if (!apiKey) {
    return { success: false, markdown: '', error: 'FIRECRAWL_API_KEY not configured' };
  }

  try {
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
      }),
    });

    if (!response.ok) {
      return { success: false, markdown: '', error: `Firecrawl API error: ${response.status}` };
    }

    const data: FirecrawlResponse = await response.json();

    if (!data.success || !data.data?.markdown) {
      return { success: false, markdown: '', error: data.error || 'No markdown content returned' };
    }

    return { success: true, markdown: data.data.markdown };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, markdown: '', error: errorMessage };
  }
}

// Check if business name appears in scraped content
function detectBusinessInContent(
  markdown: string,
  businessName: string,
  phone?: string,
  postcode?: string
): { found: boolean; confidence: 'high' | 'medium' | 'low'; reason: string } {
  const normalizedContent = markdown.toLowerCase();
  const normalizedName = normaliseName(businessName);
  const nameWords = normalizedName.split(' ').filter(w => w.length > 2);

  // Check for exact business name match
  if (normalizedContent.includes(businessName.toLowerCase())) {
    return { found: true, confidence: 'high', reason: 'Exact business name match found' };
  }

  // Check for normalized name match
  if (normalizedContent.includes(normalizedName)) {
    return { found: true, confidence: 'high', reason: 'Normalized business name match found' };
  }

  // Check for phone number match (strong signal)
  if (phone) {
    const normalizedPhone = normalisePhone(phone);
    const phoneInContent = normalizedContent.replace(/\D/g, '');
    if (normalizedPhone.length >= 10 && phoneInContent.includes(normalizedPhone)) {
      return { found: true, confidence: 'high', reason: 'Phone number match found' };
    }
  }

  // Check for postcode match combined with partial name match
  if (postcode) {
    const normalizedPostcode = postcode.toLowerCase().replace(/\s/g, '');
    const postcodeFound = normalizedContent.replace(/\s/g, '').includes(normalizedPostcode);

    if (postcodeFound) {
      // Count how many name words appear
      const matchedWords = nameWords.filter(word => normalizedContent.includes(word));
      if (matchedWords.length >= Math.ceil(nameWords.length * 0.6)) {
        return { found: true, confidence: 'medium', reason: 'Postcode and partial name match found' };
      }
    }
  }

  // Check for majority of business name words
  const matchedWords = nameWords.filter(word => normalizedContent.includes(word));
  if (nameWords.length >= 2 && matchedWords.length >= Math.ceil(nameWords.length * 0.8)) {
    return { found: true, confidence: 'low', reason: 'Majority of business name words found' };
  }

  // Check for "no results" indicators
  const noResultsIndicators = [
    'no results found',
    'no businesses found',
    'no matches found',
    '0 results',
    'sorry, we couldn\'t find',
    'no listings found',
    'try a different search',
  ];

  for (const indicator of noResultsIndicators) {
    if (normalizedContent.includes(indicator)) {
      return { found: false, confidence: 'high', reason: 'No results indicator found on page' };
    }
  }

  return { found: false, confidence: 'medium', reason: 'Business name not detected in content' };
}

// ============================================================================
// SERPAPI INTEGRATION (Primary search method)
// ============================================================================

interface SerpApiResult {
  position: number;
  title: string;
  link: string;
  snippet: string;
  displayed_link?: string;
}

interface SerpApiResponse {
  search_metadata?: {
    status: string;
  };
  organic_results?: SerpApiResult[];
  error?: string;
}

async function searchWithSerpApi(
  businessName: string,
  siteDomain: string,
  city?: string
): Promise<{ success: boolean; results: SerpApiResult[]; listingUrl: string | null; error?: string }> {
  const apiKey = process.env.SERP_API_KEY;

  if (!apiKey) {
    return { success: false, results: [], listingUrl: null, error: 'SERP_API_KEY not configured' };
  }

  try {
    // Build search query: "business name city site:directory.com"
    const searchQuery = city
      ? `"${businessName}" ${city} site:${siteDomain}`
      : `"${businessName}" site:${siteDomain}`;

    const params = new URLSearchParams({
      api_key: apiKey,
      engine: 'google',
      q: searchQuery,
      num: '10',
    });

    console.log(`[SerpAPI] Searching: ${searchQuery}`);

    const response = await fetch(`https://serpapi.com/search?${params.toString()}`);

    if (!response.ok) {
      return { success: false, results: [], listingUrl: null, error: `SerpAPI error: ${response.status}` };
    }

    const data: SerpApiResponse = await response.json();

    if (data.error) {
      return { success: false, results: [], listingUrl: null, error: data.error };
    }

    const results = data.organic_results || [];

    // Find the most relevant listing URL
    let listingUrl: string | null = null;
    if (results.length > 0) {
      // Prefer results that contain the business name in title
      const nameMatch = results.find(r =>
        r.title.toLowerCase().includes(businessName.toLowerCase().split(' ')[0])
      );
      listingUrl = nameMatch?.link || results[0]?.link || null;
    }

    console.log(`[SerpAPI] Found ${results.length} results for ${siteDomain}`);

    return { success: true, results, listingUrl };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, results: [], listingUrl: null, error: errorMessage };
  }
}

// Analyze SerpAPI results to determine if business is listed
function analyzeSerpResults(
  results: SerpApiResult[],
  businessName: string,
  phone?: string,
  postcode?: string
): { found: boolean; confidence: 'high' | 'medium' | 'low'; reason: string; listingUrl: string | null } {
  if (results.length === 0) {
    return { found: false, confidence: 'high', reason: 'No search results found on directory', listingUrl: null };
  }

  const normalizedName = normaliseName(businessName);
  const nameWords = normalizedName.split(' ').filter(w => w.length > 2);

  for (const result of results) {
    const titleLower = result.title.toLowerCase();
    const snippetLower = (result.snippet || '').toLowerCase();
    const combined = `${titleLower} ${snippetLower}`;

    // Check for exact business name in title (high confidence)
    if (titleLower.includes(businessName.toLowerCase())) {
      return {
        found: true,
        confidence: 'high',
        reason: 'Exact business name found in search result title',
        listingUrl: result.link
      };
    }

    // Check for phone number in snippet (high confidence)
    if (phone) {
      const normalizedPhone = normalisePhone(phone);
      const snippetDigits = snippetLower.replace(/\D/g, '');
      if (normalizedPhone.length >= 10 && snippetDigits.includes(normalizedPhone)) {
        return {
          found: true,
          confidence: 'high',
          reason: 'Phone number found in search result',
          listingUrl: result.link
        };
      }
    }

    // Check for postcode + partial name match (medium confidence)
    if (postcode) {
      const normalizedPostcode = postcode.toLowerCase().replace(/\s/g, '');
      if (combined.replace(/\s/g, '').includes(normalizedPostcode)) {
        const matchedWords = nameWords.filter(word => combined.includes(word));
        if (matchedWords.length >= Math.ceil(nameWords.length * 0.5)) {
          return {
            found: true,
            confidence: 'medium',
            reason: 'Postcode and partial business name found in search results',
            listingUrl: result.link
          };
        }
      }
    }

    // Check for majority of business name words (medium confidence)
    const matchedWords = nameWords.filter(word => combined.includes(word));
    if (nameWords.length >= 2 && matchedWords.length >= Math.ceil(nameWords.length * 0.7)) {
      return {
        found: true,
        confidence: 'medium',
        reason: 'Majority of business name words found in search results',
        listingUrl: result.link
      };
    }
  }

  // Results exist but no strong match
  return {
    found: false,
    confidence: 'medium',
    reason: 'Search results found but no confident match to business',
    listingUrl: null
  };
}

// Directories configuration
// serpApiSupported: Use SerpAPI as primary search (better results for major directories)
// firecrawlFallback: Use Firecrawl if SerpAPI fails or as only method
const DIRECT_CHECK_DIRECTORIES: Record<string, {
  serpApiSupported: boolean;
  firecrawlFallback: boolean;
  buildUrl?: (businessName: string, city?: string, postcode?: string) => string;
}> = {
  // Priority directories - SerpAPI primary with Firecrawl fallback
  'yell.com': {
    serpApiSupported: true,
    firecrawlFallback: true,
    buildUrl: (name, city) => `https://www.yell.com/ucs/UcsSearchAction.do?keywords=${encodeURIComponent(name)}&location=${encodeURIComponent(city || '')}`,
  },
  'thomsonlocal.com': {
    serpApiSupported: true,
    firecrawlFallback: true,
    buildUrl: (name, city) => `https://www.thomsonlocal.com/search/${encodeURIComponent(name)}/${encodeURIComponent(city || '')}`,
  },
  'checkatrade.com': {
    serpApiSupported: true,
    firecrawlFallback: true,
    buildUrl: (name, city) => `https://www.checkatrade.com/search/?what=${encodeURIComponent(name)}&where=${encodeURIComponent(city || '')}`,
  },
  // Secondary directories - Firecrawl only
  'yelp.co.uk': {
    serpApiSupported: false,
    firecrawlFallback: true,
    buildUrl: (name, city) => `https://www.yelp.co.uk/search?find_desc=${encodeURIComponent(name)}&find_loc=${encodeURIComponent(city || '')}`,
  },
  'cylex-uk.co.uk': {
    serpApiSupported: false,
    firecrawlFallback: true,
    buildUrl: (name, city) => `https://www.cylex-uk.co.uk/search/${encodeURIComponent(name)}-${encodeURIComponent(city || '')}.html`,
  },
  'freeindex.co.uk': {
    serpApiSupported: false,
    firecrawlFallback: true,
    buildUrl: (name, city) => `https://www.freeindex.co.uk/search/?k=${encodeURIComponent(name)}&l=${encodeURIComponent(city || '')}`,
  },
  'hotfrog.co.uk': {
    serpApiSupported: false,
    firecrawlFallback: true,
    buildUrl: (name, city) => `https://www.hotfrog.co.uk/search/${encodeURIComponent(city || '')}/${encodeURIComponent(name)}`,
  },
  'scoot.co.uk': {
    serpApiSupported: false,
    firecrawlFallback: true,
    buildUrl: (name, city) => `https://www.scoot.co.uk/find/${encodeURIComponent(name)}/in/${encodeURIComponent(city || '')}`,
  },
  '192.com': {
    serpApiSupported: false,
    firecrawlFallback: true,
    buildUrl: (name, city, postcode) => `https://www.192.com/businesses/${encodeURIComponent(postcode || city || '')}/${encodeURIComponent(name)}/`,
  },
  'businessmagnet.co.uk': {
    serpApiSupported: false,
    firecrawlFallback: true,
    buildUrl: (name, city) => `https://www.businessmagnet.co.uk/search/?search=${encodeURIComponent(name)}&location=${encodeURIComponent(city || '')}`,
  },
  'brownbook.net': {
    serpApiSupported: false,
    firecrawlFallback: true,
    buildUrl: (name, city) => `https://www.brownbook.net/search/?what=${encodeURIComponent(name)}&where=${encodeURIComponent(city || '')},+United+Kingdom`,
  },
  'misterwhat.co.uk': {
    serpApiSupported: false,
    firecrawlFallback: true,
    buildUrl: (name, city) => `https://www.misterwhat.co.uk/search?what=${encodeURIComponent(name)}&where=${encodeURIComponent(city || '')}`,
  },
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
// Checks a single directory using SerpAPI (primary) with Firecrawl fallback
// Never throws - converts all errors to "blocked" status
// ============================================================================

async function verifyDirectory(
  businessName: string,
  domain: string,
  directoryId: string,
  directoryName: string,
  city?: string,
  postcode?: string,
  phone?: string
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
    const directoryConfig = DIRECT_CHECK_DIRECTORIES[domain];

    if (!directoryConfig) {
      baseResult.status = 'blocked';
      baseResult.reason = 'No search method configured for this directory';
      baseResult.verificationMethod = 'none';
      console.log(`[Directory Scan] ${directoryName} (${domain}): status=${baseResult.status}, reason="${baseResult.reason}"`);
      return baseResult;
    }

    // ========================================================================
    // STEP 1: Try SerpAPI (primary method for supported directories)
    // ========================================================================
    if (directoryConfig.serpApiSupported && process.env.SERP_API_KEY) {
      console.log(`[SerpAPI] Checking ${directoryName} (${domain})...`);

      const serpResult = await searchWithSerpApi(businessName, domain, city);

      if (serpResult.success && serpResult.results.length > 0) {
        // Analyze SerpAPI results
        const analysis = analyzeSerpResults(serpResult.results, businessName, phone, postcode);

        if (analysis.found) {
          baseResult.status = analysis.confidence === 'high' ? 'live' : 'possible_match';
          baseResult.reason = analysis.reason;
          baseResult.listingUrl = analysis.listingUrl;
          baseResult.verificationMethod = 'serpapi';

          console.log(`[Directory Scan] ${directoryName} (${domain}): status=${baseResult.status}, reason="${baseResult.reason}"`);
          return baseResult;
        } else {
          // SerpAPI found results but no match - this is a valid "not found"
          baseResult.status = 'not_found';
          baseResult.reason = analysis.reason;
          baseResult.verificationMethod = 'serpapi';

          console.log(`[Directory Scan] ${directoryName} (${domain}): status=${baseResult.status}, reason="${baseResult.reason}"`);
          return baseResult;
        }
      } else if (serpResult.error) {
        console.warn(`[SerpAPI] Failed for ${directoryName}: ${serpResult.error}, trying Firecrawl fallback...`);
      } else {
        console.log(`[SerpAPI] No results for ${directoryName}, trying Firecrawl fallback...`);
      }
    }

    // ========================================================================
    // STEP 2: Firecrawl fallback (or primary for non-SerpAPI directories)
    // ========================================================================
    if (directoryConfig.firecrawlFallback && directoryConfig.buildUrl) {
      const searchUrl = directoryConfig.buildUrl(businessName, city, postcode);
      console.log(`[Firecrawl] Scraping ${directoryName}: ${searchUrl}`);

      const scrapeResult = await scrapeWithFirecrawl(searchUrl);

      if (!scrapeResult.success) {
        console.error(`[Firecrawl] Failed to scrape ${directoryName}: ${scrapeResult.error}`);
        baseResult.status = 'blocked';
        baseResult.reason = `Firecrawl error: ${scrapeResult.error}`;
        baseResult.verificationMethod = 'firecrawl_error';
      } else {
        // Analyze the scraped content
        const detection = detectBusinessInContent(
          scrapeResult.markdown,
          businessName,
          phone,
          postcode
        );

        if (detection.found) {
          baseResult.status = detection.confidence === 'high' ? 'live' : 'possible_match';
          baseResult.reason = detection.reason;
          baseResult.listingUrl = searchUrl;
        } else {
          baseResult.status = 'not_found';
          baseResult.reason = detection.reason;
        }

        baseResult.verificationMethod = 'firecrawl';
      }
    } else if (!directoryConfig.serpApiSupported) {
      // No methods available
      baseResult.status = 'blocked';
      baseResult.reason = 'No search method available for this directory';
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
    // DIRECTORY VERIFICATION (SerpAPI primary + Firecrawl fallback)
    // ========================================================================
    console.log('');
    console.log('[Scan] Starting directory verification...');
    console.log(`[Scan] SerpAPI configured: ${Boolean(process.env.SERP_API_KEY)} (primary for Yell, Thomson, Checkatrade)`);
    console.log(`[Scan] Firecrawl configured: ${Boolean(process.env.FIRECRAWL_API_KEY)} (fallback)`);
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

      // Verify this directory using Firecrawl
      const result = await verifyDirectory(
        client.business_name,
        dir.domain,
        dir.id,
        dir.name,
        client.city,
        client.postcode,
        client.phone
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
        method: 'serpapi_firecrawl_v1',
        serpapi_enabled: Boolean(process.env.SERP_API_KEY),
        firecrawl_enabled: Boolean(process.env.FIRECRAWL_API_KEY),
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
