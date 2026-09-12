/**
 * Seed the UK directory catalogue into the Supabase directories table.
 *
 * This list mirrors the LIVE table (exported 2026-09-12) plus TrustATrader,
 * which migration 005 adds. It is NOT the source of truth - the directories
 * table is. Re-export and regenerate this file whenever the table changes.
 *
 * Only `name`, `url`, `tier` and `categories` are seeded. domain_authority and
 * automation_level are deliberately absent: the live values for those are not
 * in the export, and inventing them would put fabricated numbers in front of a
 * client via the recommendation prompt.
 *
 * SAFE TO RE-RUN. The script inserts only directories whose name is not
 * already in the table, so it can never duplicate a row or overwrite live
 * data. The previous version POSTed the whole list with
 * Prefer: resolution=merge-duplicates, which needs a unique constraint the
 * table does not have - against a populated table that inserted a second copy
 * of every directory.
 *
 * Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-directories.mjs
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const directories = [
  // ===== TIER 1 =====
  { name: "192.com", url: "https://www.192.com", tier: 1, categories: ["general"] },
  { name: "Apple Maps", url: "https://mapsconnect.apple.com", tier: 1, categories: ["general"] },
  { name: "Bing Places", url: "https://www.bingplaces.com", tier: 1, categories: ["general"] },
  { name: "Google Business Profile", url: "https://business.google.com", tier: 1, categories: ["general"] },
  { name: "Scoot", url: "https://www.scoot.co.uk", tier: 1, categories: ["general"] },
  { name: "Thomson Local", url: "https://www.thomsonlocal.com", tier: 1, categories: ["general"] },
  { name: "Yell.com", url: "https://www.yell.com", tier: 1, categories: ["general"] },

  // ===== TIER 2 =====
  { name: "Bark.com", url: "https://www.bark.com", tier: 2, categories: ["services"] },
  { name: "Checkatrade", url: "https://www.checkatrade.com", tier: 2, categories: ["trades"] },
  { name: "Facebook Business", url: "https://www.facebook.com/business", tier: 2, categories: ["general"] },
  { name: "FreeIndex", url: "https://www.freeindex.co.uk", tier: 2, categories: ["general"] },
  { name: "Hotfrog UK", url: "https://www.hotfrog.co.uk", tier: 2, categories: ["general"] },
  { name: "Instagram", url: "https://business.instagram.com", tier: 2, categories: ["general"] },
  { name: "LinkedIn", url: "https://www.linkedin.com", tier: 2, categories: ["general","b2b"] },
  { name: "MyBuilder", url: "https://www.mybuilder.com", tier: 2, categories: ["trades"] },
  { name: "Nextdoor", url: "https://nextdoor.co.uk/business", tier: 2, categories: ["general","trades"] },
  { name: "Pinterest Business", url: "https://business.pinterest.com", tier: 2, categories: ["general"] },
  { name: "Rated People", url: "https://www.ratedpeople.com", tier: 2, categories: ["trades"] },
  { name: "TikTok Business", url: "https://www.tiktok.com/business", tier: 2, categories: ["general"] },
  { name: "TrustATrader", url: "https://www.trustatrader.com", tier: 2, categories: ["trades"] },
  { name: "Trustpilot", url: "https://uk.trustpilot.com", tier: 2, categories: ["general"] },
  { name: "Yelp UK", url: "https://www.yelp.co.uk", tier: 2, categories: ["general","hospitality"] },
  { name: "YouTube", url: "https://www.youtube.com", tier: 2, categories: ["general"] },

  // ===== TIER 3 =====
  { name: "Approved Business", url: "https://www.approvedbusiness.co.uk", tier: 3, categories: ["general"] },
  { name: "Brownbook", url: "https://www.brownbook.net/gb", tier: 3, categories: ["general"] },
  { name: "City Visitor", url: "https://www.cityvisitor.co.uk", tier: 3, categories: ["general"] },
  { name: "Cylex UK", url: "https://uk.cylex.com", tier: 3, categories: ["general"] },
  { name: "Find Open", url: "https://www.findopen.co.uk", tier: 3, categories: ["general"] },
  { name: "Lacartes UK", url: "https://uk.lacartes.com", tier: 3, categories: ["general"] },
  { name: "Opendi UK", url: "https://www.opendi.co.uk", tier: 3, categories: ["general"] },
  { name: "Touch Local", url: "https://www.touchlocal.com", tier: 3, categories: ["general"] },
  { name: "Tuugo UK", url: "https://uk.tuugo.biz", tier: 3, categories: ["general"] },
  { name: "UK Small Business Directory", url: "https://www.uksmallbusinessdirectory.co.uk", tier: 3, categories: ["general"] },

  // ===== TIER 4 =====
  { name: "AA Garage Guide", url: "https://www.theaa.com", tier: 4, categories: ["automotive"] },
  { name: "Care Quality Commission", url: "https://www.cqc.org.uk", tier: 4, categories: ["healthcare"] },
  { name: "Federation of Master Builders", url: "https://www.fmb.org.uk", tier: 4, categories: ["trades","construction"] },
  { name: "Good Garage Scheme", url: "https://www.goodgaragescheme.com", tier: 4, categories: ["automotive"] },
  { name: "Guild of Master Craftsmen", url: "https://www.guildmc.com", tier: 4, categories: ["trades"] },
  { name: "ICAEW", url: "https://www.icaew.com", tier: 4, categories: ["accounting"] },
  { name: "Law Society", url: "https://www.lawsociety.org.uk", tier: 4, categories: ["legal"] },
  { name: "NHS", url: "https://www.nhs.uk", tier: 4, categories: ["healthcare"] },
  { name: "OnTheMarket", url: "https://www.onthemarket.com", tier: 4, categories: ["property"] },
  { name: "OpenTable UK", url: "https://www.opentable.co.uk", tier: 4, categories: ["restaurants"] },
  { name: "Private Healthcare UK", url: "https://www.privatehealth.co.uk", tier: 4, categories: ["healthcare"] },
  { name: "RAC Garages", url: "https://www.rac.co.uk/approved-garages", tier: 4, categories: ["automotive"] },
  { name: "Rightmove", url: "https://www.rightmove.co.uk", tier: 4, categories: ["property"] },
  { name: "SRA", url: "https://www.sra.org.uk", tier: 4, categories: ["legal"] },
  { name: "TripAdvisor UK", url: "https://www.tripadvisor.co.uk", tier: 4, categories: ["hospitality","restaurants"] },
  { name: "TrustMark", url: "https://www.trustmark.org.uk", tier: 4, categories: ["trades"] },
  { name: "Zoopla", url: "https://www.zoopla.co.uk", tier: 4, categories: ["property"] },
];

const headers = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
};

async function seed() {
  const existingResponse = await fetch(`${SUPABASE_URL}/rest/v1/directories?select=name`, { headers });

  if (!existingResponse.ok) {
    console.error(`Failed to read existing directories: ${existingResponse.status} ${await existingResponse.text()}`);
    process.exit(1);
  }

  const existing = await existingResponse.json();
  const existingNames = new Set(existing.map(d => String(d.name).trim().toLowerCase()));

  const missing = directories.filter(d => !existingNames.has(d.name.trim().toLowerCase()));

  console.log(`Catalogue: ${directories.length} | already present: ${directories.length - missing.length} | to insert: ${missing.length}`);

  if (missing.length === 0) {
    console.log('Nothing to do - the table already holds every directory in this list.');
    return;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/directories`, {
    method: 'POST',
    headers,
    body: JSON.stringify(missing),
  });

  if (!response.ok) {
    console.error(`Failed to seed: ${response.status} ${await response.text()}`);
    process.exit(1);
  }

  console.log(`Inserted ${missing.length} directories:`);
  missing.forEach(d => console.log(`  + ${d.name} (tier ${d.tier}, ${d.categories.join(', ')})`));
}

seed().catch(error => {
  console.error(error);
  process.exit(1);
});
