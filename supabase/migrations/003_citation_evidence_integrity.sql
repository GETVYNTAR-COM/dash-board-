-- Citation evidence integrity
--
-- Three corrections to how scan results are stored:
--
-- 1. BLOCKED IS NOT ABSENT
--    Directories that block automated access were stored as 'blocked' and
--    counted alongside 'not_found' as gaps. They are now 'cannot_verify' and
--    are excluded from every gap count and from the score denominator.
--
-- 2. NAP IS NULLABLE
--    nap_consistent defaulted to true and was written as false on every row,
--    including rows with no listing. A listing that does not exist cannot have
--    a NAP mismatch, so the column now defaults to NULL ("not evaluated") and
--    existing rows with no live/possible listing are reset to NULL.
--
-- 3. STATUS CHECK CONSTRAINT
--    The live table still carried the original constraint
--    ('pending','submitted','live','error') while the scanner writes scan
--    statuses. The constraint is replaced with one that matches reality.
--
-- Idempotent — safe to run on any environment, including one already correct.

-- ---------------------------------------------------------------------------
-- Columns the scanner writes (added by drift, never declared in a migration)
-- ---------------------------------------------------------------------------
ALTER TABLE citations ADD COLUMN IF NOT EXISTS listing_url TEXT;
ALTER TABLE citations ADD COLUMN IF NOT EXISTS verification_method TEXT;
ALTER TABLE citations ADD COLUMN IF NOT EXISTS verification_reason TEXT;
ALTER TABLE citations ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 1. Status: widen the constraint, then migrate 'blocked' -> 'cannot_verify'
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'citations'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE citations DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

UPDATE citations SET status = 'cannot_verify' WHERE status = 'blocked';

ALTER TABLE citations
  ADD CONSTRAINT citations_status_check
  CHECK (status IN (
    -- scan statuses
    'live', 'possible_match', 'not_found', 'cannot_verify',
    -- submission workflow statuses
    'pending', 'submitted', 'error'
  ));

-- ---------------------------------------------------------------------------
-- 2. NAP consistency: null means "not evaluated"
-- ---------------------------------------------------------------------------
ALTER TABLE citations ALTER COLUMN nap_consistent DROP NOT NULL;
ALTER TABLE citations ALTER COLUMN nap_consistent DROP DEFAULT;

-- A row with no listing cannot carry a NAP verdict. Clear the false values
-- written by the old scanner so they stop rendering as "Mismatch".
UPDATE citations
SET nap_consistent = NULL
WHERE status NOT IN ('live', 'possible_match');

-- ---------------------------------------------------------------------------
-- 3. Index the status column used by every evidence count
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_citations_status ON citations(status);
