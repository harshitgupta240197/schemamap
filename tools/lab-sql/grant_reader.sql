SET NOCOUNT ON;
USE [master];
GO
IF SUSER_ID(N'schemamap_reader') IS NULL
    CREATE LOGIN [schemamap_reader] WITH PASSWORD = N'$(SCHEMAMAP_LAB_READER_PASSWORD)', DEFAULT_DATABASE = [master];
ELSE
    ALTER LOGIN [schemamap_reader] WITH PASSWORD = N'$(SCHEMAMAP_LAB_READER_PASSWORD)';
-- The minimal login shares the reader's lab password; it exists to test graceful degradation.
IF SUSER_ID(N'schemamap_reader_min') IS NULL
    CREATE LOGIN [schemamap_reader_min] WITH PASSWORD = N'$(SCHEMAMAP_LAB_READER_PASSWORD)', DEFAULT_DATABASE = [master];
ELSE
    ALTER LOGIN [schemamap_reader_min] WITH PASSWORD = N'$(SCHEMAMAP_LAB_READER_PASSWORD)';
GO
USE [$(LAB_DB)];
GO
IF USER_ID(N'schemamap_reader') IS NULL
    CREATE USER [schemamap_reader] FOR LOGIN [schemamap_reader];
GRANT VIEW DEFINITION TO [schemamap_reader];
-- A catalog view, not user data; SQL Server grants it only to db_owner by default.
GRANT SELECT ON sys.sql_expression_dependencies TO [schemamap_reader];
IF $(LAB_VIEW_DB_STATE) = 1
    GRANT VIEW DATABASE STATE TO [schemamap_reader];
ELSE
    REVOKE VIEW DATABASE STATE FROM [schemamap_reader];
GO
-- VIEW DEFINITION only: no VIEW DATABASE STATE, no SELECT on sys.sql_expression_dependencies.
IF USER_ID(N'schemamap_reader_min') IS NULL
    CREATE USER [schemamap_reader_min] FOR LOGIN [schemamap_reader_min];
GRANT VIEW DEFINITION TO [schemamap_reader_min];
REVOKE SELECT ON sys.sql_expression_dependencies FROM [schemamap_reader_min];
REVOKE VIEW DATABASE STATE FROM [schemamap_reader_min];
GO
