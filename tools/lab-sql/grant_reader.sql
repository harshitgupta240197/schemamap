SET NOCOUNT ON;
USE [master];
GO
IF SUSER_ID(N'schemamap_reader') IS NULL
    CREATE LOGIN [schemamap_reader] WITH PASSWORD = N'$(SCHEMAMAP_LAB_READER_PASSWORD)', DEFAULT_DATABASE = [master];
ELSE
    ALTER LOGIN [schemamap_reader] WITH PASSWORD = N'$(SCHEMAMAP_LAB_READER_PASSWORD)';
GO
USE [$(LAB_DB)];
GO
IF USER_ID(N'schemamap_reader') IS NULL
    CREATE USER [schemamap_reader] FOR LOGIN [schemamap_reader];
GRANT VIEW DEFINITION TO [schemamap_reader];
IF $(LAB_VIEW_DB_STATE) = 1
    GRANT VIEW DATABASE STATE TO [schemamap_reader];
ELSE
    REVOKE VIEW DATABASE STATE FROM [schemamap_reader];
GO
