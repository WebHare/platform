import { sql } from "kysely";

export function selectFSLink() {
  return sql<string>`webhare_proc_fs_objects_indexurl(id,name,isfolder,parent,published,type,externallink,filelink,indexdoc)`;
}
export function selectFSFullPath() {
  return sql<string>`webhare_proc_fs_objects_fullpath(id,isfolder)`;
}
export function selectFSWHFSPath(table?: string) {
  if (table && !table.match(/^[a-zA-Z_]+$/)) //sanity check as we'll be injecting it into generated SQL
    throw new Error(`Invalid table name '${table}' for selectFSWHFSPath`);
  return sql<string>`webhare_proc_fs_objects_whfspath(${sql.raw(table ? `${table}.` : "")}id,${sql.raw(table ? `${table}.` : "")}isfolder)`;
}
export function selectFSHighestParent() {
  return sql<number | null>`webhare_proc_fs_objects_highestparent(id, NULL)`;
}
export function selectFSIsActive(table?: string) {
  if (table && !table.match(/^[a-zA-Z_]+$/)) //sanity check as we'll be injecting it into generated SQL
    throw new Error(`Invalid table name '${table}' for selectFSIsActive`);
  return sql<boolean>`webhare_proc_fs_objects_isactive(${sql.raw(table ? `${table}.` : "")}id)`;
}
export function selectFSPublish() {
  return sql<boolean>`webhare_proc_fs_objects_publish(isfolder, published)`;
}
export function selectSitesWebRoot() {
  return sql<string>`webhare_proc_sites_webroot(outputweb, outputfolder)`;
}
