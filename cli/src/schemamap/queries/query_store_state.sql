-- Doctor and extract: Query Store state of the current database. Without VIEW DATABASE STATE
-- this still returns OFF, so callers must not trust it until that permission is confirmed.
SELECT actual_state_desc AS state
FROM sys.database_query_store_options;
