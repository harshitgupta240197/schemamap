-- Extract: user tables with their temporal and memory-optimized flags.
SELECT
    s.name AS schema_name,
    t.name AS table_name,
    t.temporal_type AS temporal_type,
    t.is_memory_optimized AS is_memory_optimized
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
WHERE t.is_ms_shipped = 0
ORDER BY s.name, t.name;
