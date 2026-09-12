// ============================================================================
// CITATION EVIDENCE MODEL
// ============================================================================
// Single source of truth for what a scan result means. The scan route, the
// report generator and the dashboard all read from here so a directory can
// never be described one way in the table and another way in the report.
//
// live           = listing found and corroborated by a NAP element
// possible_match = listing likely found, not corroborated strongly enough
// not_found      = the directory WAS checked and the business is not listed
// cannot_verify  = the directory could not be checked at all
//
// The distinction that matters commercially: only `not_found` is evidence of
// absence. `cannot_verify` is absence of evidence and must never be counted,
// scored or presented as a gap.
// ============================================================================

export type CitationStatus = 'live' | 'possible_match' | 'not_found' | 'cannot_verify';

export const STATUS_WORDING: Record<CitationStatus, string> = {
  live: 'verified by scan',
  possible_match: 'possible listing detected',
  not_found: 'not detected by scan',
  cannot_verify: 'could not be checked — directory blocks automated access',
};

export const STATUS_LABEL: Record<CitationStatus, string> = {
  live: 'Live',
  possible_match: 'Possible match',
  not_found: 'Not found',
  cannot_verify: 'Could not check',
};

// Heading used wherever unverifiable directories are shown to a client.
export const CANNOT_VERIFY_SECTION_LABEL =
  'Could not check — directory blocks automated access';

// ============================================================================
// DIRECTORIES THAT BLOCK AUTOMATED ACCESS
// ============================================================================
// These return bot-blocks, 403s, captchas or login walls to every automated
// check. A scan of them produces no evidence either way, so they are marked
// cannot_verify up front — which also stops us spending SerpAPI/Firecrawl
// credits on a call whose result we could never trust.
// ============================================================================

export const BOT_BLOCKED_DOMAINS = new Set<string>([
  'linkedin.com',
  'instagram.com',
  'facebook.com',
  'mapsconnect.apple.com',
  'apple.com',
  'yelp.co.uk',
  'yelp.com',
  'tiktok.com',
  'nextdoor.co.uk',
  'nextdoor.com',
  'pinterest.com',
  'pinterest.co.uk',
  'cylex-uk.co.uk',
  'tuugo.co.uk',
  'lacartes.com',
  'cityvisitor.co.uk',
  'hotfrog.co.uk',
]);

export const BOT_BLOCKED_REASON = 'Directory blocks automated access — not checked';

export function isBotBlockedDomain(domain: string): boolean {
  return BOT_BLOCKED_DOMAINS.has(normaliseDomain(domain));
}

// ============================================================================
// CATEGORY RELEVANCE
// ============================================================================
// Sector-specific directories a trade business can never be listed on pad the
// gap count with entries no action could ever close. They are excluded from
// the scan, the counts and the report for the categories they cannot apply to.
//
// Add a sector by adding its keywords to SECTOR_KEYWORDS and its irrelevant
// directories to SECTOR_EXCLUSIONS. A category that matches no sector keeps
// the full directory set.
// ============================================================================

export type Sector = 'trades';

const SECTOR_KEYWORDS: Record<Sector, string[]> = {
  trades: [
    'trade', 'tradesman', 'builder', 'building', 'construction', 'roofer', 'roofing',
    'plumber', 'plumbing', 'heating', 'boiler', 'gas engineer', 'hvac',
    'electrician', 'electrical', 'landscaper', 'landscaping', 'gardener', 'gardening',
    'groundwork', 'removals', 'removal', 'man and van', 'joiner', 'joinery',
    'carpenter', 'carpentry', 'plasterer', 'plastering', 'painter', 'decorator',
    'decorating', 'tiler', 'tiling', 'scaffolder', 'scaffolding', 'glazier',
    'glazing', 'window fitter', 'drainage', 'drain', 'paving', 'driveway', 'tarmac',
    'fencing', 'locksmith', 'handyman', 'kitchen fitter', 'bathroom fitter',
    'flooring', 'insulation', 'damp proofing', 'guttering', 'tree surgeon',
    'skip hire', 'plant hire', 'renovation', 'extension', 'loft conversion',
  ],
};

// Directories excluded per sector, matched on domain first and on a name
// pattern as a fallback (the live directory table has drifted from the seed
// script, so a domain alone is not a safe key).
const SECTOR_EXCLUSIONS: Record<Sector, { domains: string[]; namePatterns: string[] }> = {
  trades: {
    domains: [
      'nhs.uk',
      'cqc.org.uk',
      'privatehealthcare.co.uk',
      'lawsociety.org.uk',
      'sra.org.uk',
      'icaew.com',
      'rightmove.co.uk',
      'zoopla.co.uk',
      'onthemarket.com',
      'opentable.co.uk',
      'opentable.com',
      'tripadvisor.co.uk',
      'tripadvisor.com',
      'theaa.com',
      'rac.co.uk',
      'goodgaragescheme.com',
    ],
    namePatterns: [
      'nhs',
      'care quality',
      'private healthcare',
      'law society',
      'solicitors regulation',
      'icaew',
      'chartered accountants',
      'rightmove',
      'zoopla',
      'onthemarket',
      'on the market',
      'opentable',
      'open table',
      'tripadvisor',
      'trip advisor',
      'aa garage',
      'rac garage',
      'good garage',
    ],
  },
};

export interface DirectoryLike {
  name: string;
  domain: string;
}

export interface RelevanceDecision {
  relevant: boolean;
  sector: Sector | null;
  reason: string;
}

export function normaliseDomain(domain: string): string {
  return (domain || '').trim().toLowerCase().replace(/^www\./, '');
}

export function resolveSector(category: string | null | undefined): Sector | null {
  const value = (category || '').toLowerCase();
  if (!value) return null;

  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS) as [Sector, string[]][]) {
    if (keywords.some(keyword => value.includes(keyword))) {
      return sector;
    }
  }

  return null;
}

// A directory is relevant unless the client's sector is one we hold an
// exclusion list for AND the directory is on it. Unknown categories keep
// every directory — we never silently shrink a scan on a guess.
export function assessRelevance(
  directory: DirectoryLike,
  category: string | null | undefined
): RelevanceDecision {
  const sector = resolveSector(category);
  if (!sector) {
    return { relevant: true, sector: null, reason: 'No sector exclusions for this category' };
  }

  const exclusions = SECTOR_EXCLUSIONS[sector];
  const domain = normaliseDomain(directory.domain);
  const name = (directory.name || '').toLowerCase();

  const domainHit = exclusions.domains.some(
    excluded => domain === excluded || domain.endsWith(`.${excluded}`)
  );
  const nameHit = exclusions.namePatterns.some(pattern => name.includes(pattern));

  if (domainHit || nameHit) {
    return {
      relevant: false,
      sector,
      reason: `Sector-specific directory — cannot apply to a ${sector} business`,
    };
  }

  return { relevant: true, sector, reason: `Relevant to ${sector}` };
}

export function partitionByRelevance<T extends DirectoryLike>(
  directories: T[],
  category: string | null | undefined
): { relevant: T[]; excluded: Array<T & { exclusionReason: string }> } {
  const relevant: T[] = [];
  const excluded: Array<T & { exclusionReason: string }> = [];

  for (const directory of directories) {
    const decision = assessRelevance(directory, category);
    if (decision.relevant) {
      relevant.push(directory);
    } else {
      excluded.push({ ...directory, exclusionReason: decision.reason });
    }
  }

  return { relevant, excluded };
}

// ============================================================================
// NAP CONSISTENCY
// ============================================================================
// A listing that does not exist cannot have a NAP mismatch. NAP is evaluated
// only where a listing was actually found, and only from evidence we hold:
//
//   - Google Business Profile: the client record is compared against the
//     Google Places record, so a genuine mismatch is detectable (true/false).
//   - Any other directory: a phone or postcode matched in the listing
//     corroborates NAP (true). A name- or address-only match proves nothing
//     about NAP, so it stays unknown (null → displayed as "—").
//
// null means "not evaluated". It must never be rendered as "Mismatch".
// ============================================================================

export interface NapSignals {
  phone: boolean;
  postcode: boolean;
  address: boolean;
}

export const EMPTY_NAP_SIGNALS: NapSignals = { phone: false, postcode: false, address: false };

export function resolveNapConsistent(input: {
  status: CitationStatus;
  signals?: NapSignals;
  // Supplied only for the Google Business Profile row, where both sides of the
  // comparison are available.
  googleBaseline?: { checked: boolean; isConsistent: boolean } | null;
}): boolean | null {
  const { status, signals = EMPTY_NAP_SIGNALS, googleBaseline = null } = input;

  if (status !== 'live' && status !== 'possible_match') {
    return null;
  }

  if (googleBaseline?.checked) {
    return googleBaseline.isConsistent;
  }

  if (signals.phone || signals.postcode) {
    return true;
  }

  return null;
}

export function napLabel(value: boolean | null | undefined): string {
  if (value === true) return 'Consistent';
  if (value === false) return 'Mismatch';
  return '—';
}

// ============================================================================
// COUNTS AND SCORE
// ============================================================================

export interface EvidenceCounts {
  total: number;
  live: number;
  possibleMatch: number;
  missing: number;
  cannotVerify: number;
  verifiableTotal: number;
}

export function countEvidence(results: Array<{ status: CitationStatus | string }>): EvidenceCounts {
  const live = results.filter(r => r.status === 'live').length;
  const possibleMatch = results.filter(r => r.status === 'possible_match').length;
  const missing = results.filter(r => r.status === 'not_found').length;
  const cannotVerify = results.filter(
    r => r.status === 'cannot_verify' || r.status === 'blocked'
  ).length;

  return {
    total: results.length,
    live,
    possibleMatch,
    missing,
    cannotVerify,
    verifiableTotal: results.length - cannotVerify,
  };
}

// Score over directories we could actually check. Unverifiable directories are
// out of the denominator so a bot-block never deflates a client's score.
export function calculateCitationScore(counts: EvidenceCounts): number {
  if (counts.verifiableTotal <= 0) return 0;
  return Math.round((counts.live / counts.verifiableTotal) * 100);
}

// The only sanctioned phrasing for the gap headline. Built from `missing`
// alone so a bot-blocked directory can never be described as a gap.
export function formatMissingSummary(counts: EvidenceCounts): string {
  return `Missing from ${counts.missing} of the ${counts.verifiableTotal} directories that could be checked`;
}

// Legacy rows written before this model used status 'blocked'.
export function normaliseStatus(status: string): CitationStatus {
  if (status === 'blocked') return 'cannot_verify';
  if (
    status === 'live' ||
    status === 'possible_match' ||
    status === 'not_found' ||
    status === 'cannot_verify'
  ) {
    return status;
  }
  return 'cannot_verify';
}
