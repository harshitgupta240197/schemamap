-- Extract: synonyms and the target name as written, split into its parts. A name in another
-- database or on a linked server is kept as written and never looked up: only a one- or
-- two-part name is resolved, to the local object it names.
SELECT
    s.name AS schema_name,
    syn.name AS synonym_name,
    PARSENAME(syn.base_object_name, 4) AS target_server,
    PARSENAME(syn.base_object_name, 3) AS target_database,
    PARSENAME(syn.base_object_name, 2) AS target_schema,
    PARSENAME(syn.base_object_name, 1) AS target_name,
    rs.name AS resolved_schema_name,
    ro.name AS resolved_name
FROM sys.synonyms AS syn
JOIN sys.schemas AS s ON s.schema_id = syn.schema_id
LEFT JOIN sys.objects AS ro
    ON ro.object_id = CASE
        WHEN PARSENAME(syn.base_object_name, 4) IS NULL
            AND PARSENAME(syn.base_object_name, 3) IS NULL
        THEN OBJECT_ID(syn.base_object_name)
    END
    AND ro.is_ms_shipped = 0
    AND ro.type IN ('U', 'V', 'P', 'PC', 'FN', 'FS', 'FT', 'IF', 'TF', 'TR', 'TA', 'SN')
LEFT JOIN sys.schemas AS rs ON rs.schema_id = ro.schema_id
WHERE syn.is_ms_shipped = 0
ORDER BY s.name, syn.name;
