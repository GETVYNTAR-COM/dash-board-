// The live directories table, exported from Supabase. The relevance filter is
// tested against the real rows rather than an idealised copy, because the
// table has drifted from scripts/seed-directories.mjs.
export interface DirectoryFixture {
  tier: number;
  name: string;
  url: string;
  categories: string[];
}

export const LIVE_DIRECTORIES: DirectoryFixture[] = [
  {"tier": 1, "name": "192.com", "url": "https://www.192.com", "categories": ["general"]},
  {"tier": 1, "name": "Apple Maps", "url": "https://mapsconnect.apple.com", "categories": ["general"]},
  {"tier": 1, "name": "Bing Places", "url": "https://www.bingplaces.com", "categories": ["general"]},
  {"tier": 1, "name": "Google Business Profile", "url": "https://business.google.com", "categories": ["general"]},
  {"tier": 1, "name": "Scoot", "url": "https://www.scoot.co.uk", "categories": ["general"]},
  {"tier": 1, "name": "Thomson Local", "url": "https://www.thomsonlocal.com", "categories": ["general"]},
  {"tier": 1, "name": "Yell.com", "url": "https://www.yell.com", "categories": ["general"]},
  {"tier": 2, "name": "Bark.com", "url": "https://www.bark.com", "categories": ["services"]},
  {"tier": 2, "name": "Checkatrade", "url": "https://www.checkatrade.com", "categories": ["trades"]},
  {"tier": 2, "name": "Facebook Business", "url": "https://www.facebook.com/business", "categories": ["general"]},
  {"tier": 2, "name": "FreeIndex", "url": "https://www.freeindex.co.uk", "categories": ["general"]},
  {"tier": 2, "name": "Hotfrog UK", "url": "https://www.hotfrog.co.uk", "categories": ["general"]},
  {"tier": 2, "name": "Instagram", "url": "https://business.instagram.com", "categories": ["general"]},
  {"tier": 2, "name": "LinkedIn", "url": "https://www.linkedin.com", "categories": ["general", "b2b"]},
  {"tier": 2, "name": "MyBuilder", "url": "https://www.mybuilder.com", "categories": ["trades"]},
  {"tier": 2, "name": "Nextdoor", "url": "https://nextdoor.co.uk/business", "categories": ["general", "trades"]},
  {"tier": 2, "name": "Pinterest Business", "url": "https://business.pinterest.com", "categories": ["general"]},
  {"tier": 2, "name": "Rated People", "url": "https://www.ratedpeople.com", "categories": ["trades"]},
  {"tier": 2, "name": "TikTok Business", "url": "https://www.tiktok.com/business", "categories": ["general"]},
  {"tier": 2, "name": "Trustpilot", "url": "https://uk.trustpilot.com", "categories": ["general"]},
  {"tier": 2, "name": "Yelp UK", "url": "https://www.yelp.co.uk", "categories": ["general", "hospitality"]},
  {"tier": 2, "name": "YouTube", "url": "https://www.youtube.com", "categories": ["general"]},
  {"tier": 3, "name": "Approved Business", "url": "https://www.approvedbusiness.co.uk", "categories": ["general"]},
  {"tier": 3, "name": "Brownbook", "url": "https://www.brownbook.net/gb", "categories": ["general"]},
  {"tier": 3, "name": "City Visitor", "url": "https://www.cityvisitor.co.uk", "categories": ["general"]},
  {"tier": 3, "name": "Cylex UK", "url": "https://uk.cylex.com", "categories": ["general"]},
  {"tier": 3, "name": "Find Open", "url": "https://www.findopen.co.uk", "categories": ["general"]},
  {"tier": 3, "name": "Lacartes UK", "url": "https://uk.lacartes.com", "categories": ["general"]},
  {"tier": 3, "name": "Opendi UK", "url": "https://www.opendi.co.uk", "categories": ["general"]},
  {"tier": 3, "name": "Touch Local", "url": "https://www.touchlocal.com", "categories": ["general"]},
  {"tier": 3, "name": "Tuugo UK", "url": "https://uk.tuugo.biz", "categories": ["general"]},
  {"tier": 3, "name": "UK Small Business Directory", "url": "https://www.uksmallbusinessdirectory.co.uk", "categories": ["general"]},
  {"tier": 4, "name": "AA Garage Guide", "url": "https://www.theaa.com", "categories": ["automotive"]},
  {"tier": 4, "name": "Care Quality Commission", "url": "https://www.cqc.org.uk", "categories": ["healthcare"]},
  {"tier": 4, "name": "Federation of Master Builders", "url": "https://www.fmb.org.uk", "categories": ["trades", "construction"]},
  {"tier": 4, "name": "Good Garage Scheme", "url": "https://www.goodgaragescheme.com", "categories": ["automotive"]},
  {"tier": 4, "name": "Guild of Master Craftsmen", "url": "https://www.guildmc.com", "categories": ["trades"]},
  {"tier": 4, "name": "ICAEW", "url": "https://www.icaew.com", "categories": ["accounting"]},
  {"tier": 4, "name": "Law Society", "url": "https://www.lawsociety.org.uk", "categories": ["legal"]},
  {"tier": 4, "name": "NHS", "url": "https://www.nhs.uk", "categories": ["healthcare"]},
  {"tier": 4, "name": "OnTheMarket", "url": "https://www.onthemarket.com", "categories": ["property"]},
  {"tier": 4, "name": "OpenTable UK", "url": "https://www.opentable.co.uk", "categories": ["restaurants"]},
  {"tier": 4, "name": "Private Healthcare UK", "url": "https://www.privatehealth.co.uk", "categories": ["healthcare"]},
  {"tier": 4, "name": "RAC Garages", "url": "https://www.rac.co.uk/approved-garages", "categories": ["automotive"]},
  {"tier": 4, "name": "Rightmove", "url": "https://www.rightmove.co.uk", "categories": ["property"]},
  {"tier": 4, "name": "SRA", "url": "https://www.sra.org.uk", "categories": ["legal"]},
  {"tier": 4, "name": "TripAdvisor UK", "url": "https://www.tripadvisor.co.uk", "categories": ["hospitality", "restaurants"]},
  {"tier": 4, "name": "TrustMark", "url": "https://www.trustmark.org.uk", "categories": ["trades"]},
  {"tier": 4, "name": "Zoopla", "url": "https://www.zoopla.co.uk", "categories": ["property"]},
];
