import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  BOT_BLOCKED_REASON,
  CANNOT_VERIFY_SECTION_LABEL,
  EMPTY_NAP_SIGNALS,
  STATUS_WORDING,
  calculateCitationScore,
  countEvidence,
  formatMissingSummary,
  isBotBlockedDomain,
  partitionByRelevance,
  resolveNapConsistent,
  resolveSector,
  type CitationStatus,
  type EvidenceCounts,
  type NapSignals,
} from '@/lib/citations/evidence';

// The status model, the relevance rules and the NAP rules live in
// src/lib/citations/evidence.ts so the scan, the report and the dashboard
// cannot disagree about what a result means.

interface DirectoryScanResult {
  directoryId: string;
  directoryName: string;
  domain: string;
  status: CitationStatus;
  reason: string;
  listingUrl: string | null;
  verificationMethod: string;
  matchDetails: string[];
  napSignals: NapSignals;
}

interface ExcludedDirectory {
  directoryId: string;
  directoryName: string;
  domain: string;
  reason: string;
}

interface ScanSummary {
  businessName: string;
  catalogueTotal: number;
  relevantDirectories: number;
  excludedAsIrrelevant: number;
  checkedCount: number;
  liveCount: number;
  possibleMatchCount: number;
  missingCount: number;
  cannotVerifyCount: number;
  citationScore: number;
  scanDurationMs: number;
}

// ============================================================================
// GOOGLE PLACES API (New) TYPES
// ============================================================================

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

interface GooglePlacesNewPlace {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  businessStatus?: string;
  types?: string[];
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  googleMapsUri?: string;
  reviews?: Array<{
    authorAttribution?: { displayName: string };
    rating: number;
    text?: { text: string };
    publishTime?: string;
  }>;
  currentOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  addressComponents?: Array<{
    longText: string;
    shortText: string;
    types: string[];
  }>;
}

interface GooglePlacesNewSearchResponse {
  places?: GooglePlacesNewPlace[];
  error?: {
    code: number;
    message: string;
    status: string;
  };
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

// Check if business listing exists in scraped content.
// Requires name match PLUS corroboration from at least one NAP element
// because scraped search-results pages always echo the query text.
function detectBusinessInContent(
  markdown: string,
  businessName: string,
  phone?: string,
  postcode?: string,
  address?: string
): { found: boolean; confidence: 'high' | 'medium' | 'low'; reason: string; matchDetails: string[]; napSignals: NapSignals } {
  const normalizedContent = markdown.toLowerCase();
  const normalizedName = normaliseName(businessName);
  const nameWords = normalizedName.split(' ').filter(w => w.length > 2);
  const matchDetails: string[] = [];

  // --- detect each signal independently ---

  let nameFound = false;
  let phoneFound = false;
  let postcodeFound = false;
  let addressFound = false;

  // Name
  if (normalizedContent.includes(businessName.toLowerCase())) {
    nameFound = true;
    matchDetails.push(`Exact name "${businessName}" in content`);
  } else if (normalizedContent.includes(normalizedName)) {
    nameFound = true;
    matchDetails.push(`Normalized name "${normalizedName}" in content`);
  } else if (nameWords.length >= 2) {
    const matched = nameWords.filter(w => normalizedContent.includes(w));
    if (matched.length >= Math.ceil(nameWords.length * 0.8)) {
      nameFound = true;
      matchDetails.push(`${matched.length}/${nameWords.length} name words in content`);
    }
  }

  // Phone
  if (phone) {
    const normalizedPhone = normalisePhone(phone);
    const contentDigits = normalizedContent.replace(/\D/g, '');
    if (normalizedPhone.length >= 10 && contentDigits.includes(normalizedPhone)) {
      phoneFound = true;
      matchDetails.push('Phone digits matched in content');
    }
  }

  // Postcode
  if (postcode) {
    const normalizedPostcode = postcode.toLowerCase().replace(/\s/g, '');
    if (normalizedContent.replace(/\s/g, '').includes(normalizedPostcode)) {
      postcodeFound = true;
      matchDetails.push(`Postcode ${postcode} found in content`);
    }
  }

  // Address fragment
  if (address) {
    const addrWords = normaliseAddress(address).split(' ').filter(w => w.length > 2);
    if (addrWords.length >= 2) {
      const normalizedCombined = normaliseAddress(normalizedContent);
      const matchedAddr = addrWords.filter(w => normalizedCombined.includes(w));
      if (matchedAddr.length >= Math.ceil(addrWords.length * 0.6)) {
        addressFound = true;
        matchDetails.push(`Address fragment matched (${matchedAddr.length}/${addrWords.length} words)`);
      }
    }
  }

  // NAP evidence carried out of the check: a phone or postcode found beside
  // the name is the only thing here that corroborates NAP.
  const napSignals: NapSignals = { phone: phoneFound, postcode: postcodeFound, address: addressFound };

  // --- "no results" detection (before corroboration gate) ---
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
      return { found: false, confidence: 'high', reason: 'No results indicator found on page', matchDetails: ['Page contains "no results" indicator'], napSignals };
    }
  }

  // --- corroboration gate ---
  // Name + phone → high (live)
  if (nameFound && phoneFound) {
    return { found: true, confidence: 'high', reason: 'Name + phone corroborated in content', matchDetails, napSignals };
  }
  // Name + postcode → high (live)
  if (nameFound && postcodeFound) {
    return { found: true, confidence: 'high', reason: 'Name + postcode corroborated in content', matchDetails, napSignals };
  }
  // Name + address → medium (possible_match)
  if (nameFound && addressFound) {
    return { found: true, confidence: 'medium', reason: 'Name + address fragment in content', matchDetails, napSignals };
  }
  // Phone alone is a strong signal even without name
  if (phoneFound) {
    return { found: true, confidence: 'medium', reason: 'Phone found in content without name corroboration', matchDetails, napSignals };
  }
  // Name alone — search pages echo the query so this proves nothing
  if (nameFound) {
    matchDetails.push('Name found but no NAP corroboration (search pages echo query text)');
    return { found: false, confidence: 'low', reason: 'Name found without NAP corroboration', matchDetails, napSignals };
  }

  return { found: false, confidence: 'medium', reason: 'Business not detected in content', matchDetails, napSignals };
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
): Promise<{ success: boolean; results: SerpApiResult[]; listingUrl: string | null; error?: string; rateLimited?: boolean }> {
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

    // Detect rate limiting
    if (response.status === 429) {
      console.error('[SerpAPI] Rate limit reached');
      return { success: false, results: [], listingUrl: null, error: 'SerpAPI daily limit reached, try again tomorrow', rateLimited: true };
    }

    if (!response.ok) {
      return { success: false, results: [], listingUrl: null, error: `SerpAPI error: ${response.status}` };
    }

    const data: SerpApiResponse = await response.json();

    // Check for rate limit error in response body
    if (data.error) {
      const isRateLimit = data.error.toLowerCase().includes('limit') ||
                          data.error.toLowerCase().includes('quota') ||
                          data.error.toLowerCase().includes('exceeded');
      return {
        success: false,
        results: [],
        listingUrl: null,
        error: isRateLimit ? 'SerpAPI daily limit reached, try again tomorrow' : data.error,
        rateLimited: isRateLimit
      };
    }

    const results = data.organic_results || [];

    // Find the most relevant listing URL
    let listingUrl: string | null = null;
    if (results.length > 0) {
      // Prefer results that contain the business name in title
      const nameMatch = results.find(r =>
        r.title.toLowerCase().includes(businessName.toLowerCase())
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

// Analyze SerpAPI results to determine if business is listed.
// Requires name match PLUS corroboration from at least one NAP element
// for high confidence (live). Name alone → medium (possible_match).
function analyzeSerpResults(
  results: SerpApiResult[],
  businessName: string,
  phone?: string,
  postcode?: string,
  address?: string
): { found: boolean; confidence: 'high' | 'medium' | 'low'; reason: string; listingUrl: string | null; matchDetails: string[]; napSignals: NapSignals } {
  if (results.length === 0) {
    return { found: false, confidence: 'high', reason: 'No search results found on directory', listingUrl: null, matchDetails: [], napSignals: EMPTY_NAP_SIGNALS };
  }

  const normalizedName = normaliseName(businessName);
  const nameWords = normalizedName.split(' ').filter(w => w.length > 2);

  // Track the best uncorroborated name match so we can return it as possible_match
  let bestNameOnly: { reason: string; listingUrl: string; matchDetails: string[] } | null = null;

  for (const result of results) {
    const titleLower = result.title.toLowerCase();
    const snippetLower = (result.snippet || '').toLowerCase();
    const combined = `${titleLower} ${snippetLower}`;
    const matchDetails: string[] = [];

    // --- detect each signal ---

    let nameInTitle = false;
    let partialNameMatch = false;
    let phoneMatch = false;
    let postcodeMatch = false;
    let addressMatch = false;

    // Name in title (exact or normalized)
    if (titleLower.includes(businessName.toLowerCase())) {
      nameInTitle = true;
      matchDetails.push(`Exact name in title: "${result.title}"`);
    } else if (titleLower.includes(normalizedName) && normalizedName.length > 3) {
      nameInTitle = true;
      matchDetails.push(`Normalized name in title: "${result.title}"`);
    }

    // Partial name words in combined title+snippet
    if (!nameInTitle && nameWords.length >= 2) {
      const matched = nameWords.filter(w => combined.includes(w));
      if (matched.length >= Math.ceil(nameWords.length * 0.8)) {
        partialNameMatch = true;
        matchDetails.push(`${matched.length}/${nameWords.length} name words in result`);
      }
    }

    const nameFound = nameInTitle || partialNameMatch;

    // Phone in snippet
    if (phone) {
      const normalizedPhone = normalisePhone(phone);
      const snippetDigits = snippetLower.replace(/\D/g, '');
      if (normalizedPhone.length >= 10 && snippetDigits.includes(normalizedPhone)) {
        phoneMatch = true;
        matchDetails.push('Phone digits matched in snippet');
      }
    }

    // Postcode in combined
    if (postcode) {
      const normalizedPostcode = postcode.toLowerCase().replace(/\s/g, '');
      if (combined.replace(/\s/g, '').includes(normalizedPostcode)) {
        postcodeMatch = true;
        matchDetails.push(`Postcode ${postcode} found in result`);
      }
    }

    // Address fragment in combined
    if (address) {
      const addrWords = normaliseAddress(address).split(' ').filter(w => w.length > 2);
      if (addrWords.length >= 2) {
        const normalizedCombined = normaliseAddress(combined);
        const matchedAddr = addrWords.filter(w => normalizedCombined.includes(w));
        if (matchedAddr.length >= Math.ceil(addrWords.length * 0.6)) {
          addressMatch = true;
          matchDetails.push(`Address fragment matched in result`);
        }
      }
    }

    // NAP evidence from this specific result.
    const napSignals: NapSignals = { phone: phoneMatch, postcode: postcodeMatch, address: addressMatch };

    // --- corroboration gate ---

    // Name + phone → high
    if (nameFound && phoneMatch) {
      return { found: true, confidence: 'high', reason: 'Name + phone corroborated in search result', listingUrl: result.link, matchDetails, napSignals };
    }
    // Name + postcode → high
    if (nameFound && postcodeMatch) {
      return { found: true, confidence: 'high', reason: 'Name + postcode corroborated in search result', listingUrl: result.link, matchDetails, napSignals };
    }
    // Name + address → high
    if (nameFound && addressMatch) {
      return { found: true, confidence: 'high', reason: 'Name + address corroborated in search result', listingUrl: result.link, matchDetails, napSignals };
    }
    // Phone match with partial name → high
    if (phoneMatch && partialNameMatch) {
      return { found: true, confidence: 'high', reason: 'Phone + partial name in search result', listingUrl: result.link, matchDetails, napSignals };
    }
    // Phone alone → medium (phone is a strong unique signal)
    if (phoneMatch) {
      return { found: true, confidence: 'medium', reason: 'Phone found in search result without name corroboration', listingUrl: result.link, matchDetails, napSignals };
    }

    // Track best name-only match for possible_match fallback
    if (nameInTitle && !bestNameOnly) {
      bestNameOnly = {
        reason: 'Name found in title but no NAP corroboration',
        listingUrl: result.link,
        matchDetails: [...matchDetails, 'No phone/postcode/address corroboration'],
      };
    }
  }

  // Name in title without corroboration → possible_match
  if (bestNameOnly) {
    return {
      found: true,
      confidence: 'medium',
      reason: bestNameOnly.reason,
      listingUrl: bestNameOnly.listingUrl,
      matchDetails: bestNameOnly.matchDetails,
      napSignals: EMPTY_NAP_SIGNALS,
    };
  }

  return {
    found: false,
    confidence: 'medium',
    reason: 'Search results found but no confident match to business',
    listingUrl: null,
    matchDetails: [],
    napSignals: EMPTY_NAP_SIGNALS,
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
    serpApiSupported: false,
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

// Extract domain from URL (e.g., "https://www.yell.com" -> "yell.com")
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove "www." prefix if present
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    // Fallback: try to extract domain manually
    return url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
  }
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

// Domains that are not general business directories — matching on these
// almost always produces false positives (sector-specific, social, etc.).
// A skipped check produces no evidence, so these are reported cannot_verify,
// never not_found. Where they are also irrelevant to the client's category
// they are filtered out before the scan reaches this point.
const FALSE_POSITIVE_BLOCKLIST = new Set([
  'nhs.uk',
  'lawsociety.org.uk',
  'icaew.com',
  'zoopla.co.uk',
  'tripadvisor.com',
  'tripadvisor.co.uk',
  'opentable.co.uk',
  'opentable.com',
  'youtube.com',
  'goodgaragescheme.com',
]);

// ============================================================================
// DIRECTORY VERIFICATION
// ============================================================================
// Checks a single directory using SerpAPI (primary) with Firecrawl fallback
// Never throws - converts all errors to "cannot_verify" status
// ============================================================================

async function verifyDirectory(
  businessName: string,
  domain: string,
  directoryId: string,
  directoryName: string,
  city?: string,
  postcode?: string,
  phone?: string,
  address?: string
): Promise<DirectoryScanResult> {
  const baseResult: DirectoryScanResult = {
    directoryId,
    directoryName,
    domain,
    status: 'cannot_verify',
    reason: '',
    listingUrl: null,
    verificationMethod: 'none',
    matchDetails: [],
    napSignals: EMPTY_NAP_SIGNALS,
  };

  try {
    // Directories that block automated access: never checked, never counted
    // as a gap. Short-circuited before any API call so we do not pay for a
    // result we could not trust.
    if (isBotBlockedDomain(domain)) {
      baseResult.status = 'cannot_verify';
      baseResult.reason = BOT_BLOCKED_REASON;
      baseResult.verificationMethod = 'bot_blocked';
      baseResult.matchDetails = ['Directory blocks bots, captchas or requires login'];
      console.log(`[Directory Scan] ${directoryName} (${domain}): cannot_verify (blocks automated access)`);
      return baseResult;
    }

    // Not a general business listing site — a match here would be a false
    // positive and a miss is not evidence of absence.
    if (FALSE_POSITIVE_BLOCKLIST.has(domain)) {
      baseResult.status = 'cannot_verify';
      baseResult.reason = 'Not a general business listing site — not checked';
      baseResult.verificationMethod = 'blocklist';
      baseResult.matchDetails = ['Skipped: domain is on false-positive blocklist'];
      console.log(`[Directory Scan] ${directoryName} (${domain}): skipped (blocklisted)`);
      return baseResult;
    }

    const directoryConfig = DIRECT_CHECK_DIRECTORIES[domain] ?? {
      serpApiSupported: false,
      firecrawlFallback: true,
      buildUrl: (name: string, city?: string) =>
        `https://www.${domain}/search?q=${encodeURIComponent(name)}${city ? '+' + encodeURIComponent(city) : ''}`,
    };

    // ========================================================================
    // STEP 1: Try SerpAPI (primary method for supported directories)
    // ========================================================================
    if (directoryConfig.serpApiSupported && process.env.SERP_API_KEY) {
      console.log(`[SerpAPI] Checking ${directoryName} (${domain})...`);

      const serpResult = await searchWithSerpApi(businessName, domain, city);

      // If rate limited, return immediately with the rate limit error
      if (serpResult.rateLimited) {
        console.error(`[SerpAPI] Rate limit hit for ${directoryName}`);
        baseResult.status = 'cannot_verify';
        baseResult.reason = 'SerpAPI daily limit reached, try again tomorrow';
        baseResult.verificationMethod = 'serpapi_rate_limited';
        return baseResult;
      }

      if (serpResult.success && serpResult.results.length > 0) {
        // Analyze SerpAPI results
        const analysis = analyzeSerpResults(serpResult.results, businessName, phone, postcode, address);

        if (analysis.found) {
          baseResult.status = analysis.confidence === 'high' ? 'live' : 'possible_match';
          baseResult.reason = analysis.reason;
          baseResult.listingUrl = analysis.listingUrl;
          baseResult.verificationMethod = 'serpapi';
          baseResult.matchDetails = analysis.matchDetails;
          baseResult.napSignals = analysis.napSignals;

          console.log(`[Directory Scan] ${directoryName} (${domain}): status=${baseResult.status}, reason="${baseResult.reason}"`);
          return baseResult;
        } else {
          // SerpAPI found results but no match - this is a valid "not found"
          baseResult.status = 'not_found';
          baseResult.reason = analysis.reason;
          baseResult.verificationMethod = 'serpapi';
          baseResult.matchDetails = analysis.matchDetails;
          baseResult.napSignals = analysis.napSignals;

          console.log(`[Directory Scan] ${directoryName} (${domain}): status=${baseResult.status}, reason="${baseResult.reason}"`);
          return baseResult;
        }
      } else if (serpResult.success && serpResult.results.length === 0) {
        // No results found - business not listed
        baseResult.status = 'not_found';
        baseResult.reason = 'No listing found in Google search results';
        baseResult.verificationMethod = 'serpapi';
        console.log(`[Directory Scan] ${directoryName} (${domain}): status=${baseResult.status}, reason="${baseResult.reason}"`);
        return baseResult;
      } else if (serpResult.error) {
        console.warn(`[SerpAPI] Failed for ${directoryName}: ${serpResult.error}, trying Firecrawl fallback...`);
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
        baseResult.status = 'cannot_verify';
        baseResult.reason = `Firecrawl error: ${scrapeResult.error}`;
        baseResult.verificationMethod = 'firecrawl_error';
      } else {
        // Analyze the scraped content
        const detection = detectBusinessInContent(
          scrapeResult.markdown,
          businessName,
          phone,
          postcode,
          address
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
        baseResult.matchDetails = detection.matchDetails;
        baseResult.napSignals = detection.napSignals;
      }
    } else if (!directoryConfig.serpApiSupported) {
      // No methods available
      baseResult.status = 'cannot_verify';
      baseResult.reason = 'No search method available for this directory';
      baseResult.verificationMethod = 'none';
    }

    console.log(`[Directory Scan] ${directoryName} (${domain}): status=${baseResult.status}, reason="${baseResult.reason}"`);
    return baseResult;

  } catch (error) {
    // Convert any error to cannot_verify - never let one directory break the scan
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Directory Scan] ${directoryName} (${domain}): ERROR - ${errorMessage}`);

    return {
      ...baseResult,
      status: 'cannot_verify',
      reason: `Error during verification: ${errorMessage}`,
      verificationMethod: 'error',
      matchDetails: [`Exception: ${errorMessage}`],
    };
  }
}

// ============================================================================
// SCAN SUMMARY LOGGING
// ============================================================================

function logScanSummary(summary: ScanSummary): void {
  console.log('');
  console.log('========== CITATION SCAN SUMMARY ==========');
  console.log(`Business:            ${summary.businessName}`);
  console.log(`Directory catalogue: ${summary.catalogueTotal}`);
  console.log(`Excluded (category): ${summary.excludedAsIrrelevant}`);
  console.log(`Relevant:            ${summary.relevantDirectories}`);
  console.log(`Checked:             ${summary.checkedCount}`);
  console.log(`-------------------------------------------`);
  console.log(`Live:                ${summary.liveCount}`);
  console.log(`Possible Match:      ${summary.possibleMatchCount}`);
  console.log(`Missing (not found): ${summary.missingCount}`);
  console.log(`Could not check:     ${summary.cannotVerifyCount}`);
  console.log(`-------------------------------------------`);
  console.log(`Citation Score:      ${summary.citationScore}%`);
  console.log(`Scan Duration:       ${summary.scanDurationMs}ms`);
  console.log('============================================');
  console.log('');
}

function logDirectoryResult(result: DirectoryScanResult): void {
  const statusEmoji: Record<CitationStatus, string> = {
    live: '✓',
    possible_match: '~',
    not_found: '✗',
    cannot_verify: '⊘',
  };

  const emoji = statusEmoji[result.status];
  const urlInfo = result.listingUrl ? ` -> ${result.listingUrl}` : '';
  const details = result.matchDetails.length > 0 ? ` [${result.matchDetails.join('; ')}]` : '';

  console.log(`[Directory] ${emoji} ${result.directoryName} (${result.domain}): ${result.status} - ${result.reason}${urlInfo}${details}`);
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

    const catalogue = (directories ?? []).map(directory => ({
      ...directory,
      domain: extractDomain(directory.url),
    }));

    // ========================================================================
    // CATEGORY RELEVANCE FILTER
    // ========================================================================
    // Sector-specific directories a business in this category can never be
    // listed on are removed before the scan. They are not checked, not
    // counted and not reported — a roofer is not "missing from Rightmove".
    // ========================================================================
    const { relevant: directoryList, excluded: excludedDirectories } = partitionByRelevance(
      catalogue,
      client.category
    );

    const excludedForResponse: ExcludedDirectory[] = excludedDirectories.map(directory => ({
      directoryId: directory.id,
      directoryName: directory.name,
      domain: directory.domain,
      reason: directory.exclusionReason,
    }));

    console.log(`[Scan] Catalogue: ${catalogue.length} directories`);
    console.log(`[Scan] Client category: "${client.category}" (sector: ${resolveSector(client.category) ?? 'none'})`);
    console.log(`[Scan] Excluded as irrelevant: ${excludedDirectories.length}`);
    if (excludedDirectories.length > 0) {
      console.log(`[Scan] Excluded: ${excludedDirectories.map(d => d.name).join(', ')}`);
    }
    console.log(`[Scan] Relevant directories to check: ${directoryList.length}`);

    // Rows written by earlier scans for these directories are left in place —
    // nothing is deleted — but the dashboard and the report both apply the same
    // relevance rule, so they never reach a client-facing count or page.

    // Search Google Places for the business using Places API (New)
    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
    let googlePlacesData: GooglePlacesCandidate | null = null;
    let googlePlaceDetails: GooglePlaceDetails['result'] | null = null;

    if (googleApiKey) {
      try {
        console.log('[Google Places] Searching for business via Places API (New)...');
        const searchQuery = `${client.business_name} ${client.city} ${client.postcode}`;

        const fieldMask = [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.nationalPhoneNumber',
          'places.internationalPhoneNumber',
          'places.businessStatus',
          'places.types',
          'places.rating',
          'places.userRatingCount',
          'places.websiteUri',
          'places.googleMapsUri',
          'places.reviews',
          'places.currentOpeningHours',
          'places.addressComponents',
        ].join(',');

        const searchUrl = 'https://places.googleapis.com/v1/places:searchText';
        console.log(`[Google Places] Request: POST ${searchUrl} query="${searchQuery}"`);

        const searchResponse = await fetch(searchUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': googleApiKey,
            'X-Goog-FieldMask': fieldMask,
          },
          body: JSON.stringify({ textQuery: searchQuery }),
        });

        const searchResponseText = await searchResponse.text();
        console.log(`[Google Places] Response status: ${searchResponse.status}`);

        if (!searchResponse.ok) {
          console.error(`[Google Places] HTTP error ${searchResponse.status}: ${searchResponseText}`);
        } else {
          const searchData: GooglePlacesNewSearchResponse = JSON.parse(searchResponseText);

          if (searchData.error) {
            console.error(`[Google Places] API error: code=${searchData.error.code} status=${searchData.error.status} message=${searchData.error.message}`);
          } else if (searchData.places && searchData.places.length > 0) {
            const place = searchData.places[0];
            console.log(`[Google Places] Found: ${place.displayName?.text} (id: ${place.id})`);

            // Map new API response to legacy format for downstream compatibility
            googlePlacesData = {
              place_id: place.id,
              name: place.displayName?.text || '',
              formatted_address: place.formattedAddress || '',
              formatted_phone_number: place.nationalPhoneNumber,
              business_status: place.businessStatus,
              types: place.types,
              rating: place.rating,
              user_ratings_total: place.userRatingCount,
            };

            googlePlaceDetails = {
              name: place.displayName?.text || '',
              formatted_address: place.formattedAddress || '',
              formatted_phone_number: place.nationalPhoneNumber,
              international_phone_number: place.internationalPhoneNumber,
              website: place.websiteUri,
              url: place.googleMapsUri,
              rating: place.rating,
              user_ratings_total: place.userRatingCount,
              reviews: place.reviews?.map(r => ({
                author_name: r.authorAttribution?.displayName || '',
                rating: r.rating,
                text: r.text?.text || '',
                time: r.publishTime ? Math.floor(new Date(r.publishTime).getTime() / 1000) : 0,
              })),
              opening_hours: place.currentOpeningHours ? {
                open_now: place.currentOpeningHours.openNow ?? false,
                weekday_text: place.currentOpeningHours.weekdayDescriptions || [],
              } : undefined,
              address_components: place.addressComponents?.map(c => ({
                long_name: c.longText,
                short_name: c.shortText,
                types: c.types,
              })),
            };

            console.log(`[Google Places] Details retrieved successfully`);
          } else {
            console.log(`[Google Places] No results found for query: "${searchQuery}"`);
          }
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

    // ========================================================================
    // DIRECTORY VERIFICATION (SerpAPI primary + Firecrawl fallback)
    // ========================================================================
    // NOTE: We do NOT pre-create 'pending' citations anymore.
    // Citations are only created/updated with actual scan results.
    // ========================================================================
    console.log('');
    console.log('[Scan] Starting directory verification...');
    console.log(`[Scan] SerpAPI configured: ${Boolean(process.env.SERP_API_KEY)} (primary for Yell, Thomson, Checkatrade)`);
    console.log(`[Scan] Firecrawl configured: ${Boolean(process.env.FIRECRAWL_API_KEY)} (fallback)`);
    console.log(`[Scan] Directories to scan: ${directoryList.length}`);
    console.log('');

    // Track API errors for reporting
    const apiErrors: string[] = [];
    // A row that did not persist means the dashboard and any report built off
    // this scan are reading stale evidence. Collected, not swallowed.
    const persistenceFailures: Array<{ directory: string; message: string; code?: string; hint?: string }> = [];
    let rateLimitHit = false;

    const scanResults: DirectoryScanResult[] = [];

    // Scan each directory directly (no pre-created pending records)
    for (const directory of directoryList) {
      const domain = directory.domain;

      // If rate limit was hit, stop making more API calls
      if (rateLimitHit) {
        console.log(`[Scan] Skipping ${directory.name} - rate limit hit`);
        scanResults.push({
          directoryId: directory.id,
          directoryName: directory.name,
          domain: domain,
          status: 'cannot_verify',
          reason: 'Skipped due to API rate limit',
          listingUrl: null,
          verificationMethod: 'skipped',
          matchDetails: [],
          napSignals: EMPTY_NAP_SIGNALS,
        });
        continue;
      }

      // Verify this directory using SerpAPI (for supported directories) or Firecrawl
      const result = await verifyDirectory(
        client.business_name,
        domain,
        directory.id,
        directory.name,
        client.city,
        client.postcode,
        client.phone,
        client.address
      );

      // Google Business Profile cannot be verified via scraping — flag for
      // manual check. Unverifiable, so never counted as a missing listing.
      if (domain === 'business.google.com' && result.status !== 'live') {
        result.status = 'cannot_verify';
        result.reason = 'GBP status requires manual verification';
        result.verificationMethod = 'manual_check_required';
      }

      // Check if rate limit was hit during verification
      if (result.reason.includes('rate limit') || result.reason.includes('limit reached')) {
        rateLimitHit = true;
        apiErrors.push('SerpAPI daily limit reached, try again tomorrow');
      }

      // Track other API errors
      if (result.verificationMethod === 'error' || result.verificationMethod === 'firecrawl_error') {
        apiErrors.push(`${directory.name}: ${result.reason}`);
      }

      // Log individual result
      logDirectoryResult(result);

      // Only upsert if we got a real result (not skipped)
      if (result.verificationMethod !== 'skipped') {
        // Log BEFORE upsert - show exactly what we're trying to write
        // NAP is evaluated only where a listing was actually found. Google
        // Business Profile is the one row where both sides of the comparison
        // exist (client record vs Google Places), so a genuine mismatch is
        // detectable there; elsewhere a matched phone or postcode corroborates
        // NAP and anything else stays unknown (null → displayed as "—").
        const napConsistent = resolveNapConsistent({
          status: result.status,
          signals: result.napSignals,
          googleBaseline:
            domain === 'business.google.com'
              ? { checked: Boolean(googlePlaceDetails), isConsistent: napConsistency.isConsistent }
              : null,
        });

        const upsertPayload = {
          client_id: clientId,
          directory_id: directory.id,
          status: result.status,
          listing_url: result.listingUrl,
          nap_consistent: napConsistent,
          verified_at: new Date().toISOString(),
          verification_method: result.verificationMethod,
          verification_reason: result.reason,
        };
        console.log('[Upsert BEFORE]', directory.name, JSON.stringify(upsertPayload, null, 2));

        const { data: upsertData, error: upsertError } = await supabase
          .from('citations')
          .upsert(upsertPayload, {
            onConflict: 'client_id,directory_id'
          })
          .select();

        // Log AFTER upsert - show result
        if (upsertError) {
          console.error('[Upsert FAILED]', directory.name, {
            error: upsertError.message,
            code: upsertError.code,
            details: upsertError.details,
            hint: upsertError.hint,
          });
          persistenceFailures.push({
            directory: directory.name,
            message: upsertError.message,
            code: upsertError.code,
            hint: upsertError.hint ?? undefined,
          });
        } else {
          console.log('[Upsert SUCCESS]', directory.name, 'rows:', upsertData?.length ?? 0);
        }
      }

      scanResults.push(result);

      // Small delay between directories to avoid rate limiting
      await sleep(100);
    }

    // ========================================================================
    // CALCULATE CITATION SCORE
    // ========================================================================
    // Counts come from the shared evidence model: `missing` is not_found only,
    // and directories that could not be checked are out of both the gap count
    // and the score denominator.
    const counts: EvidenceCounts = countEvidence(scanResults);
    const citationScore = calculateCitationScore(counts);

    // Log summary
    const scanDuration = Date.now() - scanStartTime;
    const summary: ScanSummary = {
      businessName: client.business_name,
      catalogueTotal: catalogue.length,
      relevantDirectories: directoryList.length,
      excludedAsIrrelevant: excludedForResponse.length,
      checkedCount: scanResults.length,
      liveCount: counts.live,
      possibleMatchCount: counts.possibleMatch,
      missingCount: counts.missing,
      cannotVerifyCount: counts.cannotVerify,
      citationScore,
      scanDurationMs: scanDuration,
    };

    logScanSummary(summary);

    // ========================================================================
    // PERSISTENCE GATE
    // ========================================================================
    // If citation rows were rejected, the scan's findings are not in the
    // database. Saying "success" here is what lets a report be generated off
    // the previous scan's rows and presented as current evidence.
    // ========================================================================
    if (persistenceFailures.length > 0) {
      const first = persistenceFailures[0];
      console.error(`[Scan] ${persistenceFailures.length} citation rows failed to persist`);
      return NextResponse.json(
        {
          success: false,
          persisted: false,
          error: `Scan ran but ${persistenceFailures.length} of ${scanResults.length} citation rows could not be saved`,
          hint:
            first.code === '23514' || /constraint/i.test(first.message)
              ? 'The citations status constraint is rejecting the scan statuses. Run migration 003_citation_evidence_integrity.sql.'
              : first.hint ?? null,
          db_error: first,
          failed_directories: persistenceFailures.map(f => f.directory),
        },
        { status: 500 }
      );
    }

    // Update client's citation score and Google Places data.
    // A scan where nothing could be checked produces no score — writing 0 there
    // would replace a real number with a fabricated one.
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (counts.verifiableTotal > 0) {
      updateData.citation_score = citationScore;
    } else {
      console.warn('[Scan] No directory could be checked — citation score left unchanged');
    }

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
      // Surface the REAL Postgres error, not a generic "it failed".
      // The code identifies the class: 22P02/22003 = type/numeric mismatch,
      // 42501 = permission/RLS, 42703 = column does not exist.
      console.error('[Scan] Failed to persist client citation score:', {
        message: clientUpdateError.message,
        code: clientUpdateError.code,
        details: clientUpdateError.details,
        hint: clientUpdateError.hint,
        attemptedUpdate: updateData,
      });
      // Do NOT report success when the write did not land — a report generated
      // off this would be an empty "completed" report.
      return NextResponse.json(
        {
          success: false,
          persisted: false,
          error: 'Scan ran but its results could not be saved to the database',
          db_error: {
            message: clientUpdateError.message,
            code: clientUpdateError.code,
            details: clientUpdateError.details,
            hint: clientUpdateError.hint,
          },
        },
        { status: 500 }
      );
    }

    console.log(
      counts.verifiableTotal > 0
        ? `[Scan] Client citation score updated to ${citationScore}% (${counts.live} live / ${counts.verifiableTotal} checkable, ${counts.cannotVerify} excluded as unverifiable)`
        : '[Scan] Citation score not updated — no directory could be checked'
    );

    // ========================================================================
    // BUILD RESPONSE
    // ========================================================================
    // Counts are split three ways on purpose:
    //   missing_count      — checked, not listed. The only gap figure.
    //   cannot_verify_count— never checked. Reported separately, never a gap.
    //   excluded_count     — irrelevant to this category. Out of the report.
    // ========================================================================

    return NextResponse.json({
      success: true,
      client: {
        id: client.id,
        business_name: client.business_name,
        category: client.category,
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
      nap_consistency: googlePlaceDetails
        ? {
            evaluated: true,
            is_consistent: napConsistency.isConsistent,
            name_match: napConsistency.nameMatch,
            address_match: napConsistency.addressMatch,
            phone_match: napConsistency.phoneMatch,
            issues: napConsistency.details,
            basis: 'Client record compared against the Google Places listing',
          }
        : {
            evaluated: false,
            is_consistent: null,
            issues: ['Not evaluated — no Google Places listing to compare against'],
          },
      citations: {
        catalogue_total: catalogue.length,
        total_directories: directoryList.length,
        scanned_count: scanResults.length,
        live_count: counts.live,
        possible_match_count: counts.possibleMatch,
        missing_count: counts.missing,
        cannot_verify_count: counts.cannotVerify,
        excluded_count: excludedForResponse.length,
        missing_summary: formatMissingSummary(counts),
      },
      category_relevance: {
        client_category: client.category,
        sector: resolveSector(client.category),
        excluded_count: excludedForResponse.length,
        excluded_directories: excludedForResponse.map(d => ({
          directory: d.directoryName,
          domain: d.domain,
          reason: d.reason,
        })),
      },
      api_status: {
        rate_limit_hit: rateLimitHit,
        errors: apiErrors.length > 0 ? apiErrors : null,
        error_message: rateLimitHit ? 'SerpAPI daily limit reached, try again tomorrow' : null,
        serpapi_configured: Boolean(process.env.SERP_API_KEY),
        firecrawl_configured: Boolean(process.env.FIRECRAWL_API_KEY),
        // Nothing could be checked: no coverage evidence exists and the stored
        // citation score was deliberately left unchanged.
        no_evidence: counts.verifiableTotal === 0,
        no_evidence_message:
          counts.verifiableTotal === 0
            ? `None of the ${counts.total} directories could be checked. Citation score left unchanged. Check SERP_API_KEY and FIRECRAWL_API_KEY.`
            : null,
      },
      citation_score: {
        value: citationScore,
        formula: 'live_count / (relevant_directories - cannot_verify) * 100',
        calculation: {
          live: counts.live,
          possible_match: counts.possibleMatch,
          missing: counts.missing,
          cannot_verify: counts.cannotVerify,
          denominator: counts.verifiableTotal,
        },
      },
      directory_results: scanResults
        .filter(r => r.status !== 'cannot_verify')
        .map(r => ({
          directory: r.directoryName,
          domain: r.domain,
          status: r.status,
          status_wording: STATUS_WORDING[r.status],
          reason: r.reason,
          listing_url: r.listingUrl,
          verification_method: r.verificationMethod,
          match_details: r.matchDetails,
        })),
      // Reported apart from the results above and never counted as gaps.
      could_not_check: {
        label: CANNOT_VERIFY_SECTION_LABEL,
        count: counts.cannotVerify,
        directories: scanResults
          .filter(r => r.status === 'cannot_verify')
          .map(r => ({
            directory: r.directoryName,
            domain: r.domain,
            status_wording: STATUS_WORDING[r.status],
            reason: r.reason,
            verification_method: r.verificationMethod,
          })),
      },
      scan_info: {
        method: 'serpapi_firecrawl_v2',
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
