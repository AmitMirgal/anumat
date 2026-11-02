export function normalizeMigrationSql(sql) {
  return sql.replace(/\r\n/g, '\n');
}
