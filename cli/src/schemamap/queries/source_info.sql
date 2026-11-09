-- Snapshot source: server version and the settings of the database we are connected to.
SELECT
    CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS product_version,
    CAST(SERVERPROPERTY('EngineEdition') AS int) AS engine_edition,
    CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition,
    d.compatibility_level AS compatibility_level,
    d.collation_name AS collation_name,
    d.name AS database_name
FROM sys.databases AS d
WHERE d.database_id = DB_ID();
