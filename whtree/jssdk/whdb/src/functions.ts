import { sql } from "kysely";

export function selectFSLink() {
  return sql<string>`webhare_proc_fs_objects_indexurl(id,name,isfolder,parent,published,type,externallink,filelink,indexdoc)`;
}
export function selectFSFullPath() {
  return sql<string>`webhare_proc_fs_objects_fullpath(id,isfolder)`;
}
export function selectFSWHFSPath() {
  return sql<string>`webhare_proc_fs_objects_whfspath(id,isfolder)`;
}
export function selectFSHighestParent() {
  return sql<number | null>`webhare_proc_fs_objects_highestparent(id, NULL)`;
}
export function selectFSIsActive() {
  return sql<boolean>`webhare_proc_fs_objects_isactive(id)`;
}
export function selectFSPublish() {
  return sql<boolean>`webhare_proc_fs_objects_publish(isfolder, published)`;
}
export function selectSitesWebRoot() {
  return sql<string>`webhare_proc_sites_webroot(outputweb, outputfolder)`;
}
