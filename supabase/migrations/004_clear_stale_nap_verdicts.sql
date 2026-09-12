-- Clear the last of the fabricated NAP verdicts
--
-- Migration 003 reset nap_consistent to NULL only where status was not
-- 'live' or 'possible_match', on the grounds that a listing which does not
-- exist cannot have a NAP mismatch. That left the live and possible_match
-- rows still carrying the value the old scanner wrote.
--
-- The old scanner wrote `nap_consistent: false` on EVERY row unconditionally.
-- It never wrote true. So every `false` still in the table is that hardcoded
-- write, not a comparison — including on rows with a verified live listing,
-- where it renders to the client as "Mismatch" against a listing that is
-- actually fine.
--
-- The only legitimate false under the new model is a Google Business Profile
-- row where the client record genuinely disagrees with the Google Places
-- listing. That verdict is recomputed on the next scan of the client, so
-- clearing it here costs nothing and removes every fabricated one.
--
-- Idempotent — safe to run more than once.

UPDATE citations
SET nap_consistent = NULL
WHERE nap_consistent IS FALSE;

-- After this, every non-null nap_consistent in the table was written by the
-- current scanner from actual evidence:
--   true  = a phone or postcode matched in the listing, or Google Places
--           agreed with the client record on the GBP row
--   false = Google Places disagreed with the client record on the GBP row
--   null  = not evaluated, displayed as "—"
