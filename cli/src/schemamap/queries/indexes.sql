-- Extract: every index of every user table (heaps have none), with the key constraint it
-- enforces when it backs a primary key or unique constraint.
SELECT
    s.name AS schema_name,
    t.name AS table_name,
    i.index_id AS index_id,
    i.name AS index_name,
    i.type AS index_type,
    i.is_unique AS is_unique,
    i.is_disabled AS is_disabled,
    i.filter_definition AS filter_definition,
    kc.type AS key_constraint_type,
    ks.name AS key_constraint_schema_name,
    kc.name AS key_constraint_name
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.indexes AS i ON i.object_id = t.object_id
LEFT JOIN sys.key_constraints AS kc
    ON kc.parent_object_id = i.object_id AND kc.unique_index_id = i.index_id
LEFT JOIN sys.schemas AS ks ON ks.schema_id = kc.schema_id
WHERE t.is_ms_shipped = 0
  AND i.type > 0
  AND i.is_hypothetical = 0
ORDER BY s.name, t.name, i.index_id;
