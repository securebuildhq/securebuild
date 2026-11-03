WITH ranked AS (
    SELECT id, processing_started_at,
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
)
SELECT count(*) AS pending_jobs,
       count(DISTINCT keeper_id) AS catalog_images,
       count(*) FILTER (WHERE processing_started_at IS NOT NULL) AS in_flight,
       count(*) FILTER (WHERE id <> keeper_id AND processing_started_at IS NULL) AS retireable_duplicates
FROM ranked;
