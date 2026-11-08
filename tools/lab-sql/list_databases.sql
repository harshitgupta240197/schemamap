SET NOCOUNT ON;
SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name;
