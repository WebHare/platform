export let debugflags = {};
import * as domevents from './events.es';
import * as domcookie from '../extra/cookie.es';

/** Extract a specific variable from the URL
  @param varname Variable name, eg dompack-debug
*/
export function parseDebugURL(varname)
{
  //FIXME proper regex escape for varname, but fortunately this isn't user input
  let urldebugvar = window.location.href.match(new RegExp('[?&#]' + varname + '=([^&#?]*)'));
  if(urldebugvar)
  {
    let debugstr = decodeURIComponent(urldebugvar[1]).split(',');
    if(debugstr.length)
      addDebugFlags(debugstr);
  }
}
export function addDebugFlags(flags)
{
  flags.forEach(flagname =>
  {
    if(flagname.startsWith('sig='))
      return;

    debugflags[flagname] = true;
    document.documentElement.classList.add("dompack--debug-" + flagname);
  });

  if(debugflags.dompack)
    console.log('[dompack] debugging flags: ' + Object.keys(debugflags).join(', '));

  domevents.dispatchCustomEvent(document, 'dompack:debugflags-changed', {bubbles:true, cancelable:false});
}

export function initDebug()
{
  //initialize debugging support (read debugflags etc)
  parseDebugURL('wh-debug');

  let debugcookie = domcookie.read("wh-debug");
  if(debugcookie)
    addDebugFlags(debugcookie.split('.'));
}

