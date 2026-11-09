-- Extract: every column of every user view, with the same details as columns.sql.
-- is_alias_type marks a user-defined alias type; base_type_name is then the type it is based on.
SELECT
    s.name AS schema_name,
    t.name AS table_name,
    c.column_id AS ordinal,
    c.name AS column_name,
    ut.name AS type_name,
    ut.is_user_defined AS is_alias_type,
    us.name AS type_schema_name,
    bt.name AS base_type_name,
    c.max_length AS max_length,
    c.precision AS precision,
    c.scale AS scale,
    c.is_nullable AS is_nullable,
    c.is_identity AS is_identity,
    c.collation_name AS collation_name,
    cc.definition AS computed_definition,
    cc.is_persisted AS computed_persisted,
    ds.name AS default_schema_name,
    dc.name AS default_name,
    dc.definition AS default_definition
FROM sys.views AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.columns AS c ON c.object_id = t.object_id
JOIN sys.types AS ut ON ut.user_type_id = c.user_type_id
JOIN sys.schemas AS us ON us.schema_id = ut.schema_id
LEFT JOIN sys.types AS bt
    ON bt.user_type_id = ut.system_type_id AND ut.is_user_defined = 1
LEFT JOIN sys.computed_columns AS cc
    ON cc.object_id = c.object_id AND cc.column_id = c.column_id
LEFT JOIN sys.default_constraints AS dc
    ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
LEFT JOIN sys.schemas AS ds ON ds.schema_id = dc.schema_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name, c.column_id;
