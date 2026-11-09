-- Extract: the columns of every index, with key order, direction and the included flag.
-- A column with key_ordinal 0 that is not included is either the column of an XML or spatial
-- index, or (when partition_ordinal > 0) only a partitioning column.
SELECT
    s.name AS schema_name,
    t.name AS table_name,
    ic.index_id AS index_id,
    c.name AS column_name,
    ic.key_ordinal AS key_ordinal,
    ic.partition_ordinal AS partition_ordinal,
    ic.index_column_id AS index_column_id,
    ic.is_descending_key AS is_descending,
    ic.is_included_column AS is_included
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.index_columns AS ic ON ic.object_id = t.object_id
JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
JOIN sys.indexes AS i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
WHERE t.is_ms_shipped = 0
  AND i.type > 0
  AND i.is_hypothetical = 0
ORDER BY s.name, t.name, ic.index_id, ic.key_ordinal, ic.index_column_id;
