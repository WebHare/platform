import * as idb from 'idb';

export async function deleteDatabase(appname: string) {
  try {
    await idb.deleteDB('pwadb-' + appname);
  } catch (e) {
    console.log("Deletedb failed", e);
  }
}

export async function clearCache(appname: string) {
  try {
    const cache = await window.caches.open("pwacache-" + appname);
    for (const key of await cache.keys())
      await cache.delete(key);
  } catch (e) {
    console.error("Cache cleanup failed", e);
    throw e;
  }
}

export async function unregisterServiceWorkers() {
  const currentregistrations = await navigator.serviceWorker.getRegistrations();
  for (const reg of currentregistrations)
    await reg.unregister();
}
