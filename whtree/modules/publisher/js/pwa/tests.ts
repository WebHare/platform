import * as test from "@mod-system/js/wh/testframework";
import * as maintenance from './internal/maintenance';
import * as pwadb from '@mod-publisher/js/pwa/internal/pwadb';
import type { StoreNames } from "idb";

let appname: string | undefined;

export async function deleteDatabase() {
  if (!appname)
    throw new Error("Appname not set, call prepare() first");
  return maintenance.deleteDatabase(appname);
}

export async function unregisterServiceWorkers() {
  return maintenance.unregisterServiceWorkers();
}

export async function prepare(setappname: string) {
  appname = setappname;
  await unregisterServiceWorkers();

  //Delete the PWA database
  await deleteDatabase();

  //Delete the cache
  await maintenance.clearCache(appname);
}

async function extractIDBTable(database: string, table: StoreNames<pwadb.PWADB>) {
  const db = await pwadb.open(database);
  const keys = await db.getAllKeys(table);
  const rows = await Promise.all(keys.map(key => db.get(table, key)));
  db.close();
  return rows;
}

interface SWLog { //TODO can PWA define and restrict this ?
  event: string;
  url?: string;
}

export async function getSWLog(): Promise<SWLog[]> {
  if (!appname)
    throw new Error("Appname not set, call prepare() first");
  return await extractIDBTable(appname, 'pwa-swlog') as SWLog[];
}

export async function touchPage() {
  return await triggerUpdate('touchpage');
}
export async function forceRefresh() {
  return await triggerUpdate('forcerefresh');
}

async function triggerUpdate(type: "touchpage" | "forcerefresh") {
  return await test.invoke('mod::publisher/lib/internal/pwa/tests.whlib#TriggerUpdate', type, test.getWin().location.href);
}
