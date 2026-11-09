-- Extract: user-visible schemas (not sys, INFORMATION_SCHEMA, guest or the fixed roles).
SELECT s.name AS schema_name
FROM sys.schemas AS s
WHERE s.schema_id NOT IN (2, 3, 4)
  AND s.schema_id < 16384
ORDER BY s.name;
