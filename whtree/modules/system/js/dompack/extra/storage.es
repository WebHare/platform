/* @recommendedimport: import * as storage from 'dompack/extra/storage';
*/

let backupsession = {}, backuplocal = {};
let sessionfail, localfail;

export function setSession(key, value)
{
  try
  {
    if(value !== null)
    {
      backupsession[key] = value;
      window.sessionStorage.setItem(key, JSON.stringify(value));
    }
    else
    {
      delete backupsession[key];
      window.sessionStorage.removeItem(key);
    }

    if(sessionfail)
    {
      console.log("storage.setSession succeed after earlier fail");
      sessionfail = false;
    }
  }
  catch(e)
  {
    if(!sessionfail)
    {
      console.log("storage.setSession failed", e);
      sessionfail = true;
    }
  }
}

export function getSession(key)
{
  let retval;
  try
  {
    retval = window.sessionStorage[key];
    try
    {
      return retval ? JSON.parse(retval) : null;
    }
    catch(e)
    {
      console.log("Failed to parse sessionStorage",e,key);
      return null;
    }
  }
  catch(e)
  {
    if(!sessionfail)
    {
      console.log("getSessionStorage failed", e);
      sessionfail = true;
    }
    return key in backupsession ? backupsession[key] : null;
  }
}

export function setLocal(key, value)
{
  try
  {
    if(value !== null)
    {
      backuplocal[key] = value;
      window.localStorage.setItem(key, JSON.stringify(value));
    }
    else
    {
      delete backuplocal[key];
      window.localStorage.removeItem(key);
    }

    if(localfail)
    {
      console.log("storage.setLocal succeed after earlier fail");
      localfail = false;
    }
  }
  catch(e)
  {
    if(!localfail)
    {
      console.log("storage.setLocal failed", e);
      localfail = true;
    }
  }
}

export function getLocal(key)
{
  let retval;
  try
  {
    retval = window.localStorage[key];
    try
    {
      return retval ? JSON.parse(retval) : null;
    }
    catch(e)
    {
      console.log("Failed to parse localStorage",e,key);
      return null;
    }
  }
  catch(e)
  {
    if(!localfail)
    {
      console.log("getLocalStorage failed", e);
      localfail = true;
    }
    return key in backuplocal ? backuplocal[key] : null;
  }
}
