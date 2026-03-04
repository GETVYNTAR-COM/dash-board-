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

// Priority directories to check (limited to 5 due to API quota - 100 queries/day free tier)
const PRIORITY_DIRECTORIES = [
  'yell.com',
  'yelp.co.uk',
  'freeindex.co.uk',
  'thomsonlocal.com',
  'facebook.com',
];

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

// Check if a business exists on a directory using Google Custom Search API
async function checkDirectoryWithGoogleSearch(
  businessName: string,
  domain: string,
  apiKey: string,
  searchEngineId: string
): Promise<{ found: boolean; url?: string }> {
  const query = `"${businessName}" site:${domain}`;
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url);
    const data: GoogleCustomSearchResponse = await response.json();

    if (data.error) {
      console.log(`[Google Search] ${domain}: API error - ${data.error.message}, found: false`);
      return { found: false };
    }

    const totalResults = parseInt(data.searchInformation?.totalResults || '0', 10);
    const hasItems = data.items && data.items.length > 0;
    const found = totalResults > 0 || hasItems;
    const listingUrl = hasItems ? data.items![0].link : undefined;

    console.log(`[Google Search] ${domain}: query="${query}", totalResults=${totalResults}, found=${found}`);

    return { found, url: listingUrl };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.log(`[Google Search] ${domain}: Error - ${errorMessage}, found: false`);
    return { found: false };
  }
}

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
    const googleSearchApiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const googleSearchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
    let listingsDetected = 0;
    let directoriesChecked = 0;

    if (googleSearchApiKey && googleSearchEngineId) {
      console.log(`[Directory Detection] Starting Google Custom Search for "${client.business_name}"`);

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
        const dir = (citation as any).directories;
        if (dir?.domain) {
          citationsByDomain.set(dir.domain, {
            citationId: citation.id,
            directoryId: dir.id,
            directoryName: dir.name,
          });
        }
      }

      // Check only priority directories (limit 5 due to API quota)
      for (const domain of PRIORITY_DIRECTORIES) {
        const citationInfo = citationsByDomain.get(domain);
        if (!citationInfo) {
          console.log(`[Directory Detection] Skipping ${domain} - no matching directory in database`);
          continue;
        }

        const result = await checkDirectoryWithGoogleSearch(
          client.business_name,
          domain,
          googleSearchApiKey,
          googleSearchEngineId
        );

        directoriesChecked++;

        if (result.found) {
          listingsDetected++;
          const { error: updateError } = await supabase
            .from('citations')
            .update({
              status: 'live',
              listing_url: result.url,
              nap_consistent: true,
              verified_at: new Date().toISOString(),
            })
            .eq('id', citationInfo.citationId);

          if (updateError) {
            console.error(`Failed to update citation for ${domain}:`, updateError);
          }
        }

        // Rate limit: 500ms between requests
        await sleep(500);
      }

      console.log(`[Directory Detection] Complete: ${listingsDetected}/${directoriesChecked} listings found`);
    } else {
      console.log('[Directory Detection] Skipped - GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_ENGINE_ID not configured');
    }

    // Calculate citation score based on live citations
    const { data: allCitations } = await supabase
      .from('citations')
      .select('status, nap_consistent')
      .eq('client_id', clientId);

    const totalCitations = allCitations?.length || 0;
    const liveCitations = allCitations?.filter((c) => c.status === 'live').length || 0;

    // Citation score: live citations / total directories * 100
    const citationScore = directoryCount > 0 ? Math.round((liveCitations / directoryCount) * 100) : 0;

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

    const { error: updateError } = await supabase
      .from('clients')
      .update(updateData)
      .eq('id', clientId);

    if (updateError) {
      console.error('Failed to update client citation score:', updateError);
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
      },
      scan_timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Citation scan error:', error);
    return NextResponse.json({ error: 'Failed to scan citations' }, { status: 500 });
  }
}
