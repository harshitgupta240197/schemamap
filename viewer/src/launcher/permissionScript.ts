/**
 * The script shown when a login can open no database. It is text for a DBA to read and copy:
 * the launcher never sends it anywhere, and the server never runs it. It grants metadata
 * visibility only, so the login still cannot read a single row.
 */
export function permissionScript(user: string): string {
  const login = `[${user.replaceAll("]", "]]")}]`;
  return [
    "-- Run once in each database you want to map.",
    "-- Grants metadata visibility only. No SELECT, so no row data.",
    "USE [YourDatabase];",
    `CREATE USER ${login} FOR LOGIN ${login};`,
    `GRANT VIEW DEFINITION TO ${login};`,
    `GRANT SELECT ON sys.sql_expression_dependencies TO ${login};`,
  ].join("\n");
}
