-- Extract: user views with their definition. A null definition means the module is encrypted
-- or the login may not see it; is_encrypted tells the two apart.
SELECT
    s.name AS schema_name,
    v.name AS view_name,
    ISNULL(sm.is_schema_bound, 0) AS is_schema_bound,
    sm.definition AS definition,
    ISNULL(OBJECTPROPERTY(v.object_id, 'IsEncrypted'), 0) AS is_encrypted
FROM sys.views AS v
JOIN sys.schemas AS s ON s.schema_id = v.schema_id
LEFT JOIN sys.sql_modules AS sm ON sm.object_id = v.object_id
WHERE v.is_ms_shipped = 0
ORDER BY s.name, v.name;
