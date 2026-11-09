-- Extract: procedures, functions and DML triggers (with the table or view a trigger fires on).
-- has_module is 0 for CLR objects, which have no T-SQL definition. A null definition with
-- has_module = 1 means the module is encrypted or the login may not see it.
SELECT
    s.name AS schema_name,
    o.name AS routine_name,
    o.type AS type_code,
    ps.name AS parent_schema_name,
    po.name AS parent_name,
    sm.definition AS definition,
    ISNULL(OBJECTPROPERTY(o.object_id, 'IsEncrypted'), 0) AS is_encrypted,
    CASE WHEN sm.object_id IS NULL THEN 0 ELSE 1 END AS has_module
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
LEFT JOIN sys.sql_modules AS sm ON sm.object_id = o.object_id
LEFT JOIN sys.objects AS po ON po.object_id = o.parent_object_id AND o.type IN ('TR', 'TA')
LEFT JOIN sys.schemas AS ps ON ps.schema_id = po.schema_id
WHERE o.is_ms_shipped = 0
  AND o.type IN ('P', 'PC', 'FN', 'FS', 'FT', 'IF', 'TF', 'TR', 'TA')
ORDER BY s.name, o.name;
