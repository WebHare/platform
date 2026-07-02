import { sql } from "kysely";

export function selectFSLink(table?: string) {
  if (table && !table.match(/^[a-zA-Z_]+$/)) //sanity check as we'll be injecting it into generated SQL
    throw new Error(`Invalid table name '${table}' for selectFSLink`);
  return sql<string>`webhare_proc_fs_objects_indexurl(${sql.raw(table ? `${table}.` : "")}id,${sql.raw(table ? `${table}.` : "")}name,${sql.raw(table ? `${table}.` : "")}isfolder,${sql.raw(table ? `${table}.` : "")}parent,${sql.raw(table ? `${table}.` : "")}published,${sql.raw(table ? `${table}.` : "")}type,${sql.raw(table ? `${table}.` : "")}externallink,${sql.raw(table ? `${table}.` : "")}filelink,${sql.raw(table ? `${table}.` : "")}indexdoc)`;
}
export function selectFSFullPath(table?: string) {
  if (table && !table.match(/^[a-zA-Z_]+$/)) //sanity check as we'll be injecting it into generated SQL
    throw new Error(`Invalid table name '${table}' for selectFSFullPath`);
  return sql<string>`webhare_proc_fs_objects_fullpath(${sql.raw(table ? `${table}.` : "")}id,${sql.raw(table ? `${table}.` : "")}isfolder)`;
}
export function selectFSWHFSPath(table?: string) {
  if (table && !table.match(/^[a-zA-Z_]+$/)) //sanity check as we'll be injecting it into generated SQL
    throw new Error(`Invalid table name '${table}' for selectFSWHFSPath`);
  return sql<string>`webhare_proc_fs_objects_whfspath(${sql.raw(table ? `${table}.` : "")}id,${sql.raw(table ? `${table}.` : "")}isfolder)`;
}
export function selectFSHighestParent(table?: string) {
  if (table && !table.match(/^[a-zA-Z_]+$/)) //sanity check as we'll be injecting it into generated SQL
    throw new Error(`Invalid table name '${table}' for selectFSHighestParent`);
  return sql<number | null>`webhare_proc_fs_objects_highestparent(${sql.raw(table ? `${table}.` : "")}id, NULL)`;
}
export function selectFSIsActive(table?: string) {
  if (table && !table.match(/^[a-zA-Z_]+$/)) //sanity check as we'll be injecting it into generated SQL
    throw new Error(`Invalid table name '${table}' for selectFSIsActive`);
  return sql<boolean>`webhare_proc_fs_objects_isactive(${sql.raw(table ? `${table}.` : "")}id)`;
}
export function selectFSPublish(table?: string) {
  if (table && !table.match(/^[a-zA-Z_]+$/)) //sanity check as we'll be injecting it into generated SQL
    throw new Error(`Invalid table name '${table}' for selectFSPublish`);
  return sql<boolean>`webhare_proc_fs_objects_publish(${sql.raw(table ? `${table}.` : "")}isfolder, ${sql.raw(table ? `${table}.` : "")}published)`;
}
export function selectSitesWebRoot(table?: string) {
  if (table && !table.match(/^[a-zA-Z_]+$/)) //sanity check as we'll be injecting it into generated SQL
    throw new Error(`Invalid table name '${table}' for selectSitesWebRoot`);
  return sql<string>`webhare_proc_sites_webroot(${sql.raw(table ? `${table}.` : "")}outputweb, ${sql.raw(table ? `${table}.` : "")}outputfolder)`;
}
