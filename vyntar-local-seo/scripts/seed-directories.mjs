/**
 * Seed 65 UK directories into the Supabase directories table.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-directories.mjs
 *
 * Or with .env.local loaded via dotenv:
 *   node -e "require('dotenv').config({path:'.env.local'})" scripts/seed-directories.mjs
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const directories = [
  // ===== TIER 1 — Core High-Authority Directories =====
  { name: 'Google Business Profile', url: 'https://business.google.com', tier: 1, domain_authority: 100, categories: ['general'], automation_level: 'semi' },
  { name: 'Bing Places', url: 'https://www.bingplaces.com', tier: 1, domain_authority: 94, categories: ['general'], automation_level: 'semi' },
  { name: 'Apple Maps Connect', url: 'https://mapsconnect.apple.com', tier: 1, domain_authority: 100, categories: ['general'], automation_level: 'manual' },
  { name: 'Yell', url: 'https://www.yell.com', tier: 1, domain_authority: 72, categories: ['general'], automation_level: 'semi' },
  { name: 'Thomson Local', url: 'https://www.thomsonlocal.com', tier: 1, domain_authority: 58, categories: ['general'], automation_level: 'semi' },
  { name: '192.com', url: 'https://www.192.com', tier: 1, domain_authority: 62, categories: ['general'], automation_level: 'manual' },
  { name: 'Scoot', url: 'https://www.scoot.co.uk', tier: 1, domain_authority: 52, categories: ['general'], automation_level: 'semi' },
  { name: 'Facebook Business', url: 'https://www.facebook.com/business', tier: 1, domain_authority: 96, categories: ['general', 'social'], automation_level: 'semi' },

  // ===== TIER 2 — Major Review & Business Directories =====
  { name: 'Yelp UK', url: 'https://www.yelp.co.uk', tier: 2, domain_authority: 93, categories: ['general', 'hospitality', 'services'], automation_level: 'semi' },
  { name: 'Trustpilot', url: 'https://www.trustpilot.com', tier: 2, domain_authority: 93, categories: ['general', 'reviews'], automation_level: 'semi' },
  { name: 'Checkatrade', url: 'https://www.checkatrade.com', tier: 2, domain_authority: 68, categories: ['trades', 'home_services'], automation_level: 'semi' },
  { name: 'MyBuilder', url: 'https://www.mybuilder.com', tier: 2, domain_authority: 58, categories: ['trades', 'construction'], automation_level: 'manual' },
  { name: 'FreeIndex', url: 'https://www.freeindex.co.uk', tier: 2, domain_authority: 55, categories: ['general'], automation_level: 'full' },
  { name: 'Bark', url: 'https://www.bark.com', tier: 2, domain_authority: 62, categories: ['general', 'services'], automation_level: 'semi' },
  { name: 'Hotfrog UK', url: 'https://www.hotfrog.co.uk', tier: 2, domain_authority: 52, categories: ['general'], automation_level: 'full' },
  { name: 'Foursquare', url: 'https://foursquare.com', tier: 2, domain_authority: 91, categories: ['general', 'hospitality'], automation_level: 'semi' },
  { name: 'Central Index', url: 'https://www.centralindex.com', tier: 2, domain_authority: 42, categories: ['general'], automation_level: 'full' },
  { name: 'Cylex UK', url: 'https://www.cylex-uk.co.uk', tier: 2, domain_authority: 48, categories: ['general'], automation_level: 'full' },
  { name: 'Brownbook', url: 'https://www.brownbook.net', tier: 2, domain_authority: 52, categories: ['general'], automation_level: 'full' },
  { name: 'Lacartes', url: 'https://www.lacartes.com', tier: 2, domain_authority: 38, categories: ['general'], automation_level: 'full' },

  // ===== TIER 3 — General & Niche Directories =====
  { name: 'Touch Local', url: 'https://www.touchlocal.com', tier: 3, domain_authority: 45, categories: ['general'], automation_level: 'full' },
  { name: 'City Visitor', url: 'https://www.cityvisitor.co.uk', tier: 3, domain_authority: 40, categories: ['general', 'tourism'], automation_level: 'full' },
  { name: 'Tuugo UK', url: 'https://www.tuugo.co.uk', tier: 3, domain_authority: 42, categories: ['general'], automation_level: 'full' },
  { name: 'UK Small Business Directory', url: 'https://www.uksmallbusinessdirectory.co.uk', tier: 3, domain_authority: 38, categories: ['general', 'small_business'], automation_level: 'full' },
  { name: 'Yalwa UK', url: 'https://www.yalwa.co.uk', tier: 3, domain_authority: 40, categories: ['general'], automation_level: 'full' },
  { name: 'Opendi UK', url: 'https://www.opendi.co.uk', tier: 3, domain_authority: 38, categories: ['general'], automation_level: 'full' },
  { name: 'B2B Yellow Pages', url: 'https://www.b2byellowpages.com', tier: 3, domain_authority: 36, categories: ['general', 'b2b'], automation_level: 'full' },
  { name: 'iBegin UK', url: 'https://www.ibegin.com', tier: 3, domain_authority: 42, categories: ['general'], automation_level: 'full' },
  { name: 'Find Open', url: 'https://www.findopen.co.uk', tier: 3, domain_authority: 32, categories: ['general'], automation_level: 'full' },
  { name: 'The Sun Business Directory', url: 'https://www.thesun.co.uk/directory', tier: 3, domain_authority: 90, categories: ['general'], automation_level: 'manual' },
  { name: 'Approved Business', url: 'https://www.approvedbusiness.co.uk', tier: 3, domain_authority: 36, categories: ['general'], automation_level: 'full' },
  { name: 'BizHouse UK', url: 'https://www.bizhouse.co.uk', tier: 3, domain_authority: 30, categories: ['general'], automation_level: 'full' },
  { name: 'Business Magnet', url: 'https://www.businessmagnet.co.uk', tier: 3, domain_authority: 42, categories: ['general', 'b2b'], automation_level: 'full' },
  { name: 'Yelu UK', url: 'https://www.yelu.co.uk', tier: 3, domain_authority: 32, categories: ['general'], automation_level: 'full' },
  { name: 'Infobel UK', url: 'https://www.infobel.com/en/uk', tier: 3, domain_authority: 50, categories: ['general'], automation_level: 'full' },
  { name: 'Wand', url: 'https://www.wand.com', tier: 3, domain_authority: 34, categories: ['general'], automation_level: 'full' },
  { name: 'Misterwhat UK', url: 'https://www.misterwhat.co.uk', tier: 3, domain_authority: 38, categories: ['general'], automation_level: 'full' },
  { name: 'n49', url: 'https://www.n49.com', tier: 3, domain_authority: 36, categories: ['general'], automation_level: 'full' },
  { name: 'Where\'s the Best', url: 'https://www.wheresthebest.co.uk', tier: 3, domain_authority: 28, categories: ['general', 'local'], automation_level: 'full' },
  { name: 'Fyple UK', url: 'https://www.fyple.co.uk', tier: 3, domain_authority: 36, categories: ['general'], automation_level: 'full' },
  { name: 'Hub.biz', url: 'https://www.hub.biz', tier: 3, domain_authority: 30, categories: ['general'], automation_level: 'full' },
  { name: 'Bizify', url: 'https://www.bizify.co.uk', tier: 3, domain_authority: 32, categories: ['general'], automation_level: 'full' },
  { name: 'Top Rated Local', url: 'https://www.topratedlocal.co.uk', tier: 3, domain_authority: 30, categories: ['general'], automation_level: 'full' },
  { name: '118 Information', url: 'https://www.118information.co.uk', tier: 3, domain_authority: 40, categories: ['general'], automation_level: 'semi' },

  // ===== TIER 4 — Trade & Industry-Specific Directories =====
  { name: 'Federation of Master Builders', url: 'https://www.fmb.org.uk', tier: 4, domain_authority: 55, categories: ['trades', 'construction'], automation_level: 'manual' },
  { name: 'TrustMark', url: 'https://www.trustmark.org.uk', tier: 4, domain_authority: 52, categories: ['trades', 'home_services'], automation_level: 'manual' },
  { name: 'The Law Society', url: 'https://www.lawsociety.org.uk', tier: 4, domain_authority: 70, categories: ['legal'], automation_level: 'manual' },
  { name: 'NHS Choices', url: 'https://www.nhs.uk', tier: 4, domain_authority: 94, categories: ['health', 'medical'], automation_level: 'manual' },
  { name: 'TripAdvisor UK', url: 'https://www.tripadvisor.co.uk', tier: 4, domain_authority: 93, categories: ['hospitality', 'tourism', 'restaurants'], automation_level: 'semi' },
  { name: 'Rightmove', url: 'https://www.rightmove.co.uk', tier: 4, domain_authority: 80, categories: ['property', 'estate_agents'], automation_level: 'manual' },
  { name: 'Zoopla', url: 'https://www.zoopla.co.uk', tier: 4, domain_authority: 76, categories: ['property', 'estate_agents'], automation_level: 'manual' },
  { name: 'OnTheMarket', url: 'https://www.onthemarket.com', tier: 4, domain_authority: 62, categories: ['property', 'estate_agents'], automation_level: 'manual' },
  { name: 'Rated People', url: 'https://www.ratedpeople.com', tier: 4, domain_authority: 56, categories: ['trades', 'home_services'], automation_level: 'semi' },
  { name: 'Which? Trusted Traders', url: 'https://trustedtraders.which.co.uk', tier: 4, domain_authority: 80, categories: ['trades', 'home_services'], automation_level: 'manual' },
  { name: 'Treatwell', url: 'https://www.treatwell.co.uk', tier: 4, domain_authority: 60, categories: ['beauty', 'health'], automation_level: 'semi' },
  { name: 'BookSy', url: 'https://booksy.com', tier: 4, domain_authority: 55, categories: ['beauty', 'barbering'], automation_level: 'semi' },
  { name: 'DesignMyNight', url: 'https://www.designmynight.com', tier: 4, domain_authority: 58, categories: ['hospitality', 'nightlife', 'restaurants'], automation_level: 'semi' },
  { name: 'OpenTable UK', url: 'https://www.opentable.co.uk', tier: 4, domain_authority: 90, categories: ['restaurants', 'hospitality'], automation_level: 'semi' },
  { name: 'Good Garage Scheme', url: 'https://www.goodgaragescheme.com', tier: 4, domain_authority: 42, categories: ['automotive'], automation_level: 'manual' },
  { name: 'VetClick', url: 'https://www.vetclick.com', tier: 4, domain_authority: 35, categories: ['veterinary', 'pets'], automation_level: 'manual' },
  { name: 'Solicitors Regulation Authority', url: 'https://www.sra.org.uk', tier: 4, domain_authority: 66, categories: ['legal'], automation_level: 'manual' },
  { name: 'General Dental Council', url: 'https://www.gdc-uk.org', tier: 4, domain_authority: 60, categories: ['dental', 'health'], automation_level: 'manual' },
  { name: 'Care Quality Commission', url: 'https://www.cqc.org.uk', tier: 4, domain_authority: 72, categories: ['health', 'care_homes'], automation_level: 'manual' },
  { name: 'Institute of Chartered Accountants', url: 'https://www.icaew.com', tier: 4, domain_authority: 68, categories: ['accounting', 'finance'], automation_level: 'manual' },
  { name: 'RIBA Find an Architect', url: 'https://www.architecture.com', tier: 4, domain_authority: 62, categories: ['architecture', 'design'], automation_level: 'manual' },
];

async function seed() {
  console.log(`Seeding ${directories.length} UK directories...`);

  const response = await fetch(`${SUPABASE_URL}/rest/v1/directories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(directories),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Failed to seed: ${response.status} ${text}`);
    process.exit(1);
  }

  console.log(`Successfully seeded ${directories.length} directories!`);
  console.log(`\nBreakdown:`);
  console.log(`  Tier 1 (Core): ${directories.filter(d => d.tier === 1).length}`);
  console.log(`  Tier 2 (Major): ${directories.filter(d => d.tier === 2).length}`);
  console.log(`  Tier 3 (General/Niche): ${directories.filter(d => d.tier === 3).length}`);
  console.log(`  Tier 4 (Trade-Specific): ${directories.filter(d => d.tier === 4).length}`);
}

seed().catch(console.error);
