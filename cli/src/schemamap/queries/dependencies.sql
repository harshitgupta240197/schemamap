-- Extract: what each user object's SQL refers to (sys.sql_expression_dependencies), one row
-- per reference. Names are as written; resolved_* is set only for a local object that exists.
-- Synonyms are covered by synonyms.sql, which the catalog does not track here.
SELECT
    s.name AS from_schema_name,
    o.name AS from_name,
    d.referenced_server_name AS target_server,
    d.referenced_database_name AS target_database,
    d.referenced_schema_name AS target_schema,
    d.referenced_entity_name AS target_name,
    rs.name AS resolved_schema_name,
    ro.name AS resolved_name
FROM sys.sql_expression_dependencies AS d
JOIN sys.objects AS o ON o.object_id = d.referencing_id
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
LEFT JOIN sys.objects AS ro
    ON ro.object_id = d.referenced_id
    AND d.referenced_server_name IS NULL
    AND d.referenced_database_name IS NULL
    AND ro.is_ms_shipped = 0
    AND ro.type IN ('U', 'V', 'P', 'PC', 'FN', 'FS', 'FT', 'IF', 'TF', 'TR', 'TA', 'SN')
LEFT JOIN sys.schemas AS rs ON rs.schema_id = ro.schema_id
WHERE d.referencing_class = 1
  AND d.referenced_class = 1
  AND o.is_ms_shipped = 0
  AND o.type IN ('U', 'V', 'P', 'PC', 'FN', 'FS', 'FT', 'IF', 'TF', 'TR', 'TA')
ORDER BY s.name, o.name, d.referenced_server_name, d.referenced_database_name,
    d.referenced_schema_name, d.referenced_entity_name;
