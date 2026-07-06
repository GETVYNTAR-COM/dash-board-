-- Fix schema drift: the live citations/competitors tables were created from an
-- older schema, and 001_create_tables.sql uses CREATE TABLE IF NOT EXISTS, which
-- skips existing tables and never adds columns declared later.
--
-- Postgres error 42703 observed in production:
--   column citations.submitted_at does not exist
--   column competitors.citation_score does not exist
--
-- Idempotent — safe to run on any environment, including ones where the
-- columns already exist.

ALTER TABLE citations
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS citation_score INTEGER DEFAULT 0;

-- Range check to match 001_create_tables.sql (added conditionally so re-runs
-- and already-correct databases don't error)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competitors_citation_score_check'
      AND conrelid = 'competitors'::regclass
  ) THEN
    ALTER TABLE competitors
      ADD CONSTRAINT competitors_citation_score_check
      CHECK (citation_score >= 0 AND citation_score <= 100);
  END IF;
END $$;
