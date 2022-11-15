import { KeyValueObject } from "../../types";
import * as domcookie from '../extra/cookie';

export const debugflags: KeyValueObject<boolean> = {};

/**
   Extract a specific variable from the URL
 *
  @param varname Variable name, eg dompack-debug
 */
export function parseDebugURL(varname: string)
{
  //FIXME proper regex escape for varname, but fortunately this isn't user input
  const urldebugvar = window.location.href.match(new RegExp('[?&#]' + varname + '=([^&#?]*)'));
  if(urldebugvar)
  {
    const debugstr = decodeURIComponent(urldebugvar[1]).split(',');
    if(debugstr.length)
      addDebugFlags(debugstr);
  }
}
export function addDebugFlags(flags: string[])
{
  for (const flagname of flags)
  {
    if(flagname.startsWith('sig='))
      return;

    debugflags[flagname] = true;
    document.documentElement.classList.add("dompack--debug-" + flagname);
  }

  if(debugflags.dompack)
    console.log('[dompack] debugging flags: ' + Object.keys(debugflags).join(', '));
}

export function initDebug()
{
  //no-op but there are still external callers which need fixing
}

//initialize debugging support (read debugflags etc)
parseDebugURL('wh-debug');

const debugcookie = domcookie.read("wh-debug");
if(debugcookie)
  addDebugFlags(debugcookie.split('.'));
