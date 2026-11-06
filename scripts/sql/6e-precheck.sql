-- Rebuild step 6e PRE-CHECK (read-only). Run in Neon's SQL editor against
-- production AFTER 6e is merged and deployed, BEFORE the 6e schema push
-- (which drops watchlist_items.membership_id and makes user_id NOT NULL).
-- Paste the output into the 6e PR. Every row is read-only; nothing here
-- changes the database.

-- Must be 0, or the push's SET NOT NULL on user_id fails.
SELECT count(*) AS rows_without_user_id
FROM watchlist_items
WHERE user_id IS NULL;

-- For comparison after the push: the drop removes a column, never a row.
SELECT count(*) AS total_rows
FROM watchlist_items;

-- Must be 0: one row per person per film (the unique index
-- watchlist_items_user_id_film_id_unique already enforces it; this
-- confirms nothing slipped in before it existed).
SELECT count(*) AS duplicate_user_film_pairs
FROM (
  SELECT 1
  FROM watchlist_items
  GROUP BY user_id, film_id
  HAVING count(*) > 1
) dup;

-- Informational: how many rows still carry a membership_id, i.e. what the
-- drop discards. Nothing in the app has read it since step 6b.
SELECT count(membership_id) AS rows_with_membership_id
FROM watchlist_items;
