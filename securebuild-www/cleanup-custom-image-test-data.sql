DELETE FROM custom_image_apko_version;
DELETE FROM custom_image_apko;
DELETE FROM custom_image;
DELETE FROM custom_image_external_registry;

SELECT 'custom_image' as table_name, COUNT(*) as remaining_records FROM custom_image
UNION ALL
SELECT 'custom_image_apko' as table_name, COUNT(*) as remaining_records FROM custom_image_apko
UNION ALL
SELECT 'custom_image_apko_version' as table_name, COUNT(*) as remaining_records FROM custom_image_apko_version
UNION ALL
SELECT 'custom_image_external_registry' as table_name, COUNT(*) as remaining_records FROM custom_image_external_registry;
