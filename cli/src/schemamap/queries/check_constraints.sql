-- Extract: check constraints of user tables; column_name is set for a column-level constraint.
SELECT
    s.name AS schema_name,
    t.name AS table_name,
    cs.name AS constraint_schema_name,
    cc.name AS constraint_name,
    cc.definition AS definition,
    c.name AS column_name,
    cc.is_disabled AS is_disabled,
    cc.is_not_trusted AS is_not_trusted
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.check_constraints AS cc ON cc.parent_object_id = t.object_id
JOIN sys.schemas AS cs ON cs.schema_id = cc.schema_id
LEFT JOIN sys.columns AS c
    ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name, cc.name;
