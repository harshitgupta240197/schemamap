-- Extract: one row per column pair of every foreign key between user tables, in key order.
SELECT
    fs.name AS fk_schema_name,
    fk.name AS fk_name,
    ps.name AS from_schema_name,
    pt.name AS from_table_name,
    rs.name AS to_schema_name,
    rt.name AS to_table_name,
    fkc.constraint_column_id AS ordinal,
    pc.name AS from_column_name,
    rc.name AS to_column_name,
    fk.delete_referential_action AS on_delete,
    fk.update_referential_action AS on_update,
    fk.is_disabled AS is_disabled,
    fk.is_not_trusted AS is_not_trusted
FROM sys.foreign_keys AS fk
JOIN sys.schemas AS fs ON fs.schema_id = fk.schema_id
JOIN sys.foreign_key_columns AS fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.tables AS pt ON pt.object_id = fk.parent_object_id
JOIN sys.schemas AS ps ON ps.schema_id = pt.schema_id
JOIN sys.columns AS pc
    ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.tables AS rt ON rt.object_id = fk.referenced_object_id
JOIN sys.schemas AS rs ON rs.schema_id = rt.schema_id
JOIN sys.columns AS rc
    ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
WHERE pt.is_ms_shipped = 0
  AND rt.is_ms_shipped = 0
ORDER BY fs.name, fk.name, fkc.constraint_column_id;
