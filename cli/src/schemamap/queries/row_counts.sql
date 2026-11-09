-- Extract: approximate row count and reserved space of each user table, from partition
-- statistics. Needs VIEW DATABASE STATE. Rows are counted on the heap or clustered index only,
-- so secondary indexes do not double them; space covers the table and all its indexes.
SELECT
    s.name AS schema_name,
    t.name AS table_name,
    SUM(CASE WHEN ps.index_id IN (0, 1) THEN ps.row_count ELSE 0 END) AS row_count,
    SUM(ps.reserved_page_count) * 8192 AS reserved_bytes
FROM sys.dm_db_partition_stats AS ps
JOIN sys.tables AS t ON t.object_id = ps.object_id
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
WHERE t.is_ms_shipped = 0
GROUP BY s.name, t.name
ORDER BY s.name, t.name;
