-- Rebuild step 6a: backfill watchlist_items.user_id (docs/onboarding-spec.md
-- §6.1, §8.5). Run by hand against production in Neon's SQL editor, AFTER
-- the 6a schema push and AFTER 6a is deployed (so every new row is already
-- dual-written), and BEFORE the 6b schema push (its unique (user_id,
-- film_id) needs the duplicates gone).
--
-- Three parts, each runnable on its own. Run PART 1, read it, then PART 2,
-- then PART 3. Paste PART 1's and PART 3's output into the 6b PR.
--
-- What can be lost: a person who has the same film on two memberships' lists
-- (someone who left a club and rejoined, or is in two clubs) ends up with
-- one row, the earliest added_at. The other row is deleted with its note
-- and tags. Nothing in the app writes note or tags yet; PART 1's third
-- query lists every row that would be deleted, with both, so check first.


-- ===========================================================================
-- PART 1 — PRE-CHECK (read-only)
-- ===========================================================================

-- Rows the backfill would fill.
SELECT count(*) AS rows_without_user_id
FROM watchlist_items
WHERE user_id IS NULL;

-- (user, film) pairs that would have more than one row once user_id is
-- filled in. The backfill keeps the first id listed (earliest added_at).
SELECT
  coalesce(wi.user_id, m.user_id) AS user_id,
  wi.film_id,
  count(*) AS rows,
  array_agg(wi.id ORDER BY wi.added_at, wi.id) AS item_ids_keep_first
FROM watchlist_items wi
JOIN memberships m ON m.id = wi.membership_id
GROUP BY coalesce(wi.user_id, m.user_id), wi.film_id
HAVING count(*) > 1
ORDER BY 1, 2;

-- Every row the backfill would delete, with what it carries.
SELECT id, membership_id, user_id, film_id, added_at, note, tags
FROM (
  SELECT
    wi.*,
    row_number() OVER (
      PARTITION BY coalesce(wi.user_id, m.user_id), wi.film_id
      ORDER BY wi.added_at, wi.id
    ) AS rn
  FROM watchlist_items wi
  JOIN memberships m ON m.id = wi.membership_id
) ranked
WHERE rn > 1
ORDER BY user_id, film_id, added_at;


-- ===========================================================================
-- PART 2 — BACKFILL (one transaction; idempotent, safe to re-run)
-- ===========================================================================

BEGIN;

-- Each row's owner is its membership's user (memberships.user_id is
-- NOT NULL since step 4b). Only empty rows: a re-run changes nothing.
UPDATE watchlist_items wi
SET user_id = m.user_id
FROM memberships m
WHERE wi.membership_id = m.id
  AND wi.user_id IS NULL;

-- One row per (user, film): keep the earliest added_at (id breaks a tie,
-- so the choice is deterministic). A re-run finds nothing to delete.
DELETE FROM watchlist_items wi
USING (
  SELECT
    id,
    row_number() OVER (PARTITION BY user_id, film_id ORDER BY added_at, id) AS rn
  FROM watchlist_items
  WHERE user_id IS NOT NULL
) ranked
WHERE wi.id = ranked.id
  AND ranked.rn > 1;

COMMIT;


-- ===========================================================================
-- PART 3 — POST-CHECK (read-only). Both must be 0.
-- ===========================================================================

SELECT count(*) AS rows_without_user_id
FROM watchlist_items
WHERE user_id IS NULL;

SELECT count(*) AS duplicate_user_film_pairs
FROM (
  SELECT 1
  FROM watchlist_items
  GROUP BY user_id, film_id
  HAVING count(*) > 1
) dup;
