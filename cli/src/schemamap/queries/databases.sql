-- Launcher: the databases this login can open, for the database picker. System databases
-- (database_id 1 to 4: master, tempdb, model, msdb) are listed only when asked, and a database
-- that is not online is left out because it cannot be opened.
-- params: include_system
SELECT name AS database_name
FROM sys.databases
WHERE HAS_DBACCESS(name) = 1
    AND state = 0
    AND (? = 1 OR database_id > 4)
ORDER BY name;
