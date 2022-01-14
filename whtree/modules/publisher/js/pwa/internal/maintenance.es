import * as idb from 'idb';

export async function deleteDatabase(appname)
{
  try
  {
    await idb.deleteDB('pwadb-' + appname);
  }
  catch(e)
  {
    console.log("Deletedb failed",e);
  }
}

export async function clearCache(appname)
{
  try
  {
    let cache = await window.caches.open("pwacache-" + appname);
    for(let key of await cache.keys())
      await cache.delete(key);
  }
  catch(e)
  {
    console.error("Cache cleanup failed",e);
    throw e;
  }
}

export async function unregisterServiceWorkers()
{
  let currentregistrations = await navigator.serviceWorker.getRegistrations();
  for(let reg of currentregistrations)
    await reg.unregister();
}

