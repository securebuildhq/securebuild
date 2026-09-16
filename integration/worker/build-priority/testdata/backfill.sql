-- More than two migration batches; unsupported versions must still be marked processed.
INSERT INTO image_apko (id, image_id, name, tags, created_at, updated_at)
SELECT 'backfill-' || n, 'go-image', 'backfill-' || n,
    CASE WHEN n = 1 THEN ARRAY['nightly'] ELSE ARRAY['1.9.1'] END, NOW(), NOW()
FROM generate_series(1, 1101) n;
