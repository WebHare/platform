export function getLocalStorageKeys(varname)
{
  try
  {
    let settings = JSON.parse(localStorage[varname]);
    if(typeof settings == "object")
      return settings;
  }
  catch(ignore)
  {
  }
  return {};
}

export function setLocalStorageKey(varname, key, value)
{
  let currentsettings = getLocalStorageKeys(varname);

  try
  {
    if(value !== undefined)
    {
      currentsettings[key] = value;
    }
    else
    {
      delete currentsettings[key];
      if(Object.keys(currentsettings).length == 0)
      {
        delete localStorage[varname];
        return;
      }
    }

    localStorage[varname] = JSON.stringify(currentsettings);
  }
  catch(ignore)
  {
  }
}
