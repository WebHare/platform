/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-system/js/wh/testframework";
import * as maintenance from './internal/maintenance';
import * as pwadb from '@mod-publisher/js/pwa/internal/pwadb';

let appname;

export async function deleteDatabase() {
  return maintenance.deleteDatabase(appname);
}

export async function unregisterServiceWorkers() {
  return maintenance.unregisterServiceWorkers();
}

export async function prepare(setappname) {
  appname = setappname;
  await unregisterServiceWorkers();

  //Delete the PWA database
  await deleteDatabase();

  //Delete the cache
  await maintenance.clearCache(appname);
}

async function extractIDBTable(database, table) {
  let db = await pwadb.open(database);
  let keys = await db.getAllKeys(table);
  let rows = await Promise.all(keys.map(key => db.get(table, key)));
  db.close();
  return rows;
}

export async function getSWLog() {
  return await extractIDBTable(appname, 'pwa-swlog');
}

export async function touchPage() {
  return await triggerUpdate('touchpage');
}
export async function forceRefresh() {
  return await triggerUpdate('forcerefresh');
}

async function triggerUpdate(type) {
  return await test.invoke('mod::publisher/lib/internal/pwa/tests.whlib#TriggerUpdate', type, test.getWin().location.href);
}
