import * as idb from 'idb';

export interface PWADB extends idb.DBSchema {
  "pwa-swlog": {
    key: number;
    value: {
      date: Date;
      [key: string]: unknown;
    };
  };
  "pwa-keyval": {
    key: string;
    value: unknown;
  };
}

export function open(appname: string): Promise<idb.IDBPDatabase<PWADB>> {
  return idb.openDB<PWADB>('pwadb-' + appname, 1, {
    upgrade(db) {
      db.createObjectStore('pwa-keyval');
      db.createObjectStore('pwa-swlog', { keyPath: 'id', autoIncrement: true });
    }
  });
}
