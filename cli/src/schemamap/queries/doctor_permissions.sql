-- Doctor: which of the permissions Schema Map uses the login holds in this database.
SELECT permission_name
FROM sys.fn_my_permissions(NULL, N'DATABASE')
WHERE permission_name IN (N'VIEW DEFINITION', N'VIEW DATABASE STATE')
ORDER BY permission_name;
