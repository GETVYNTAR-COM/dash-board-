// Evidence integrity tests — the three rules a customer-facing report depends on:
//   1. A directory that blocks automated access is never a gap.
//   2. A listing that does not exist cannot have a NAP mismatch.
//   3. A directory that cannot apply to the client's category is not counted.
//
// Run: npm run test:citations

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessRelevance,
  findForbiddenDirectoryMentions,
  calculateCitationScore,
  countEvidence,
  formatMissingSummary,
  isBotBlockedDomain,
  napLabel,
  normaliseStatus,
  partitionByRelevance,
  resolveNapConsistent,
  resolveSector,
} from '../src/lib/citations/evidence.ts';

describe('1. blocked must not mean absent', () => {
  const results = [
    { status: 'live' as const },
    { status: 'live' as const },
    { status: 'not_found' as const },
    { status: 'cannot_verify' as const },
    { status: 'cannot_verify' as const },
    { status: 'cannot_verify' as const },
  ];

  it('counts only not_found as missing', () => {
    assert.equal(countEvidence(results).missing, 1);
  });

  it('never folds cannot_verify into the gap count', () => {
    const counts = countEvidence(results);
    assert.equal(counts.cannotVerify, 3);
    assert.notEqual(counts.missing, counts.missing + counts.cannotVerify);
    assert.match(formatMissingSummary(counts), /Missing from 1 of the 3 directories/);
  });

  it('keeps unverifiable directories out of the score denominator', () => {
    // 2 live of 3 checkable = 67%, not 2 of 6 = 33%
    assert.equal(calculateCitationScore(countEvidence(results)), 67);
  });

  it('returns 0 rather than dividing by zero when nothing could be checked', () => {
    const allBlocked = [{ status: 'cannot_verify' as const }, { status: 'cannot_verify' as const }];
    assert.equal(calculateCitationScore(countEvidence(allBlocked)), 0);
  });

  it('treats legacy "blocked" rows as cannot_verify', () => {
    assert.equal(normaliseStatus('blocked'), 'cannot_verify');
    assert.equal(countEvidence([{ status: 'blocked' }]).missing, 0);
    assert.equal(countEvidence([{ status: 'blocked' }]).cannotVerify, 1);
  });

  it('flags the directories known to block automated access', () => {
    for (const domain of [
      'linkedin.com', 'instagram.com', 'facebook.com', 'mapsconnect.apple.com',
      'yelp.co.uk', 'tiktok.com', 'nextdoor.co.uk', 'pinterest.com',
      'cylex-uk.co.uk', 'tuugo.co.uk', 'lacartes.com', 'cityvisitor.co.uk',
      'hotfrog.co.uk',
    ]) {
      assert.ok(isBotBlockedDomain(domain), `${domain} should be bot-blocked`);
      assert.ok(isBotBlockedDomain(`www.${domain}`), `www.${domain} should be bot-blocked`);
    }
    assert.equal(isBotBlockedDomain('yell.com'), false);
  });
});

describe('2. NAP is evaluated only where a listing exists', () => {
  const signals = { phone: true, postcode: false, address: false };

  it('returns null for not_found', () => {
    assert.equal(resolveNapConsistent({ status: 'not_found', signals }), null);
  });

  it('returns null for cannot_verify', () => {
    assert.equal(resolveNapConsistent({ status: 'cannot_verify', signals }), null);
  });

  it('returns true where a phone or postcode corroborates the listing', () => {
    assert.equal(resolveNapConsistent({ status: 'live', signals }), true);
    assert.equal(
      resolveNapConsistent({ status: 'possible_match', signals: { phone: false, postcode: true, address: false } }),
      true
    );
  });

  it('returns null for a name- or address-only match — that is not NAP evidence', () => {
    assert.equal(
      resolveNapConsistent({ status: 'possible_match', signals: { phone: false, postcode: false, address: true } }),
      null
    );
  });

  it('uses the Google Places comparison where both sides exist', () => {
    assert.equal(
      resolveNapConsistent({
        status: 'live',
        signals: { phone: false, postcode: false, address: false },
        googleBaseline: { checked: true, isConsistent: false },
      }),
      false
    );
    assert.equal(
      resolveNapConsistent({
        status: 'not_found',
        signals: { phone: false, postcode: false, address: false },
        googleBaseline: { checked: true, isConsistent: false },
      }),
      null,
      'a mismatch verdict must not attach to a listing that does not exist'
    );
  });

  it('displays an unevaluated verdict as an em dash, never as Mismatch', () => {
    assert.equal(napLabel(null), '—');
    assert.equal(napLabel(undefined), '—');
    assert.equal(napLabel(true), 'Consistent');
    assert.equal(napLabel(false), 'Mismatch');
  });
});

describe('3. category relevance', () => {
  const irrelevantForTrades = [
    { name: 'NHS Choices', domain: 'nhs.uk' },
    { name: 'Care Quality Commission', domain: 'cqc.org.uk' },
    { name: 'Private Healthcare UK', domain: 'privatehealthcare.co.uk' },
    { name: 'The Law Society', domain: 'lawsociety.org.uk' },
    { name: 'Solicitors Regulation Authority', domain: 'sra.org.uk' },
    { name: 'Institute of Chartered Accountants', domain: 'icaew.com' },
    { name: 'Rightmove', domain: 'rightmove.co.uk' },
    { name: 'Zoopla', domain: 'zoopla.co.uk' },
    { name: 'OnTheMarket', domain: 'onthemarket.com' },
    { name: 'OpenTable UK', domain: 'opentable.co.uk' },
    { name: 'TripAdvisor UK', domain: 'tripadvisor.co.uk' },
    { name: 'AA Garage Guide', domain: 'theaa.com' },
    { name: 'RAC Garages', domain: 'rac.co.uk' },
    { name: 'Good Garage Scheme', domain: 'goodgaragescheme.com' },
  ];

  it('recognises trade categories', () => {
    for (const category of ['Roofer', 'Builder', 'Plumber', 'Electrician', 'Landscaper', 'Removals', 'Roofing Contractor']) {
      assert.equal(resolveSector(category), 'trades', `${category} should resolve to trades`);
    }
  });

  it('excludes every listed sector directory for a trade business', () => {
    for (const directory of irrelevantForTrades) {
      assert.equal(
        assessRelevance(directory, 'Roofer').relevant,
        false,
        `${directory.name} should be excluded for a roofer`
      );
    }
  });

  it('keeps general and trade directories for a trade business', () => {
    for (const directory of [
      { name: 'Yell', domain: 'yell.com' },
      { name: 'Checkatrade', domain: 'checkatrade.com' },
      { name: 'Google Business Profile', domain: 'business.google.com' },
      { name: 'Which? Trusted Traders', domain: 'trustedtraders.which.co.uk' },
    ]) {
      assert.equal(assessRelevance(directory, 'Plumber').relevant, true, `${directory.name} should be kept`);
    }
  });

  it('keeps the full directory set for a category with no exclusion list', () => {
    for (const directory of irrelevantForTrades) {
      assert.equal(assessRelevance(directory, 'Dental Practice').relevant, true);
      assert.equal(assessRelevance(directory, '').relevant, true);
    }
  });

  it('matches on name when the stored domain has drifted', () => {
    assert.equal(assessRelevance({ name: 'AA Garage Guide', domain: 'aa-garage-guide.example' }, 'Builder').relevant, false);
  });

  it('removes excluded directories from the count, not just the display', () => {
    const catalogue = [
      { name: 'Yell', domain: 'yell.com' },
      { name: 'Rightmove', domain: 'rightmove.co.uk' },
      { name: 'NHS Choices', domain: 'nhs.uk' },
    ];
    const { relevant, excluded } = partitionByRelevance(catalogue, 'Roofer');
    assert.equal(relevant.length, 1);
    assert.equal(excluded.length, 2);
    assert.ok(excluded.every(d => d.exclusionReason.includes('trades')));
  });
});

describe('4. the report may only name directories that were scanned', () => {
  const scanned = ['Yell', 'Checkatrade', 'Google Business Profile', '192.com'];
  const catalogue = [...scanned, 'Foursquare', 'Yalwa UK', 'Which? Trusted Traders'];

  it('passes a report that names only scanned directories', () => {
    const report = 'Listings are live on Yell and Checkatrade. 192.com is missing.';
    assert.deepEqual(findForbiddenDirectoryMentions(report, scanned, catalogue), []);
  });

  it('catches a catalogue directory that was not part of this scan', () => {
    const report = 'Priority actions: submit to Foursquare and Yalwa UK.';
    assert.deepEqual(findForbiddenDirectoryMentions(report, scanned, catalogue), ['Foursquare', 'Yalwa UK']);
  });

  it('catches trade bodies and aggregators that are not directories at all', () => {
    const report = 'Consider NFRC accreditation, an FMB listing and a Data Axle submission.';
    const found = findForbiddenDirectoryMentions(report, scanned, catalogue);
    assert.ok(found.includes('NFRC'), 'NFRC should be caught');
    assert.ok(found.includes('FMB'), 'FMB should be caught');
    assert.ok(found.includes('Data Axle'), 'Data Axle should be caught');
  });

  it('catches a local chamber of commerce recommendation', () => {
    const found = findForbiddenDirectoryMentions(
      'Join the local Chamber of Commerce directory.', scanned, catalogue
    );
    assert.deepEqual(found, ['Chamber of Commerce']);
  });

  it('does not flag a term that is part of a scanned directory name', () => {
    const found = findForbiddenDirectoryMentions(
      'Which? Trusted Traders shows a live listing.',
      [...scanned, 'Which? Trusted Traders'],
      catalogue
    );
    assert.deepEqual(found, []);
  });

  it('does not flag a name embedded inside another word', () => {
    assert.deepEqual(findForbiddenDirectoryMentions('Mantaray Marketing handles this.', scanned, ['Manta']), []);
  });

  it('matches short acronyms case-sensitively so prose does not trip the guard', () => {
    assert.deepEqual(findForbiddenDirectoryMentions('The fmb of the matter.', scanned, []), []);
    assert.deepEqual(findForbiddenDirectoryMentions('An FMB listing is advised.', scanned, []), ['FMB']);
  });
});

describe('5. the score denominator excludes unverifiable directories', () => {
  it('scores 13 live of 36 checkable, not 13 of 49', () => {
    const results = [
      ...Array(13).fill({ status: 'live' as const }),
      ...Array(23).fill({ status: 'not_found' as const }),
      ...Array(13).fill({ status: 'cannot_verify' as const }),
    ];
    const counts = countEvidence(results);
    assert.equal(counts.total, 49);
    assert.equal(counts.verifiableTotal, 36);
    assert.equal(counts.missing, 23);
    assert.equal(calculateCitationScore(counts), 36);
  });

  it('never reports every scanned directory as a gap', () => {
    const results = [
      ...Array(36).fill({ status: 'not_found' as const }),
      ...Array(13).fill({ status: 'cannot_verify' as const }),
    ];
    const counts = countEvidence(results);
    assert.equal(counts.missing, 36);
    assert.notEqual(counts.missing, counts.total);
    assert.match(formatMissingSummary(counts), /Missing from 36 of the 36 directories that could be checked/);
  });
});
