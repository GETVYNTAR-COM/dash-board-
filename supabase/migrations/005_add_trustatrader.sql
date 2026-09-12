-- Add TrustATrader to the directory table
--
-- TrustATrader is one of the sources AI answer engines cite most for UK trade
-- businesses, and it was missing from the directories table entirely — so it
-- never appeared as a gap, because it was never checked.
--
-- Tier 2, categories ["trades"], so the category relevance filter keeps it in
-- scope for trade clients and out of scope for everyone else.
--
-- Guarded on name rather than ON CONFLICT: the table has no unique constraint
-- on name or url. Idempotent — safe to run more than once.

INSERT INTO directories (name, url, tier, domain_authority, categories, automation_level)
SELECT 'TrustATrader', 'https://www.trustatrader.com', 2, 55, ARRAY['trades'], 'manual'
WHERE NOT EXISTS (
  SELECT 1 FROM directories WHERE lower(name) = 'trustatrader'
);
