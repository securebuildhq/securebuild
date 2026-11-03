WITH ranked AS (
    SELECT id,
           first_value(id) OVER (
               PARTITION BY payload->>'catalogImageId'
               ORDER BY (processing_started_at IS NOT NULL) DESC,
                        (dedupe_key IS NOT NULL) DESC,
                        COALESCE(priority, 0) DESC, created_at, id
           ) AS keeper_id
    FROM work_queue
    WHERE channel = 'scan_catalog_image'
      AND completed_at IS NULL
      AND jsonb_typeof(payload->'catalogImageId') = 'string'
      AND btrim(payload->>'catalogImageId') <> ''
), duplicates AS (
    SELECT pending.id, ranked.keeper_id
    FROM work_queue pending
    JOIN ranked ON ranked.id = pending.id
    WHERE pending.id <> ranked.keeper_id
      AND pending.completed_at IS NULL
      AND pending.processing_started_at IS NULL
    ORDER BY pending.created_at, pending.id
    LIMIT 1000
    FOR UPDATE OF pending SKIP LOCKED
)
UPDATE work_queue pending
SET completed_at = NOW(),
    dedupe_key = NULL,
    last_error = concat_ws(E'\n', pending.last_error,
        'superseded duplicate catalog scan; kept queue item ' || duplicates.keeper_id)
FROM duplicates
WHERE pending.id = duplicates.id
  AND pending.channel = 'scan_catalog_image'
  AND pending.completed_at IS NULL
  AND pending.processing_started_at IS NULL
RETURNING pending.id, pending.payload->>'catalogImageId' AS catalog_image_id,
          duplicates.keeper_id;
