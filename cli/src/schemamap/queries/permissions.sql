-- Doctor and extract: which of the permissions Schema Map uses the login holds in this
-- database. The second branch is object-level: SELECT on one system catalog view.
SELECT permission_name AS permission_name
FROM sys.fn_my_permissions(NULL, N'DATABASE')
WHERE permission_name IN (N'VIEW DEFINITION', N'VIEW DATABASE STATE')
UNION ALL
SELECT N'SELECT ON sys.sql_expression_dependencies' AS permission_name
FROM sys.fn_my_permissions(N'sys.sql_expression_dependencies', N'OBJECT')
WHERE permission_name = N'SELECT'
ORDER BY permission_name;
