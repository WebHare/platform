/* @recommendedimport: import * as storage from 'dompack/extra/storage';

   A storage API that will mock when access is being denied to the browser storage objects (eg Chrome incognito 'Block third-party cookies')
*/
const backupsession: Record<string, unknown> = {};
const backuplocal: Record<string, unknown> = {};
let sessionfail: boolean;
let localfail: boolean;

//isolate us when running previews, CI tests use same Chrome for both preview and tests so the previews start increasing visitorcounts behind our back
const isolated = typeof document === "undefined" || "whIsolateStorage" in document.documentElement.dataset;

/** @returns True if our storage is fully isolated */
export function isIsolated() {
  return isolated;
}

// Report whether browser storage APIs are unavailable. They might not be in eg Chrome incognito 'Block third-party cookies'
let _available: boolean;
export function isStorageAvailable(): boolean {
  if (isolated)
    return true;

  if (_available === undefined) {
    try {
      _available = Boolean(window.sessionStorage);
    } catch (ignore) {
      _available = false;
    }
  }
  return _available as boolean;
}

export function setSession<T>(key: string, value: T) {
  try {
    if (value !== null) {
      backupsession[key] = value;
      if (!isolated)
        window.sessionStorage.setItem(key, JSON.stringify(value));
    } else {
      delete backupsession[key];
      if (!isolated)
        window.sessionStorage.removeItem(key);
    }

    if (sessionfail) {
      console.log("storage.setSession succeed after earlier fail");
      sessionfail = false;
    }
  } catch (e) {
    if (!sessionfail) {
      console.log("storage.setSession failed", e);
      sessionfail = true;
    }
  }
}

export function getSession<T>(key: string): T | null {
  if (!isolated) {
    try {
      const retval = window.sessionStorage[key];
      try {
        return retval ? JSON.parse(retval) : null;
      } catch (e) {
        console.log("Failed to parse sessionStorage", e, key);
        return null;
      }
    } catch (e) {
      if (!sessionfail) {
        console.log("getSessionStorage failed", e);
        sessionfail = true;
      }
    }
  }
  return key in backupsession ? backupsession[key] as T : null;
}

export function setLocal<T>(key: string, value: T) {
  try {
    if (value !== null) {
      backuplocal[key] = value;
      if (!isolated)
        window.localStorage.setItem(key, JSON.stringify(value));
    } else {
      delete backuplocal[key];
      if (!isolated)
        window.localStorage.removeItem(key);
    }

    if (localfail) {
      console.log("storage.setLocal succeed after earlier fail");
      localfail = false;
    }
  } catch (e) {
    if (!localfail) {
      console.log("storage.setLocal failed", e);
      localfail = true;
    }
  }
}

export function getLocal<T>(key: string): T | null {
  if (!isolated) {
    try {
      const retval = window.localStorage[key];
      try {
        return retval ? JSON.parse(retval) : null;
      } catch (e) {
        console.log("Failed to parse localStorage", e, key);
        return null;
      }
    } catch (e) {
      if (!localfail) {
        console.log("getLocalStorage failed", e);
        localfail = true;
      }
    }
  }
  return key in backuplocal ? backuplocal[key] as T : null;
}
