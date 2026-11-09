-- Doctor: Query Store state of the current database.
SELECT actual_state_desc AS state
FROM sys.database_query_store_options;
