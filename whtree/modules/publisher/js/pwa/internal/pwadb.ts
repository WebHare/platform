/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as idb from 'idb';

export function open(appname) {
  return idb.openDB('pwadb-' + appname, 1, {
    upgrade(db) {
      db.createObjectStore('pwa-keyval');
      db.createObjectStore('pwa-swlog', { keyPath: 'id', autoIncrement: true });
    }
  });
}
