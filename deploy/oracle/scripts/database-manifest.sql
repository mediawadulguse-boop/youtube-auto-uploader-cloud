\set ON_ERROR_STOP on
-- No extension or writes required. Run before app startup on both source and
-- target. All writers must remain stopped between source inventory and dump.
-- PostgreSQL's JSONB text representation preserves numbers without JS rounding.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
COPY (WITH inventory AS (
 SELECT 'app_documents' AS table_name, key AS row_id,
        md5(row_to_json(d)::jsonb::text) AS row_digest
 FROM public.app_documents d
 UNION ALL
 SELECT 'app_backups', id::text, md5(row_to_json(b)::jsonb::text)
 FROM public.app_backups b
 UNION ALL
 SELECT 'app_migrations', id, md5(row_to_json(m)::jsonb::text)
 FROM public.app_migrations m
) SELECT * FROM inventory ORDER BY table_name COLLATE "C", row_id COLLATE "C"
) TO STDOUT WITH (FORMAT csv, HEADER true);
COMMIT;
