/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import "./debugmenu.scss";
import * as settings from './settings';
import * as maintenance from './maintenance';

let debuglayer;

async function clearCache() {
  await maintenance.clearCache(settings.getAppName());
  //location.reload(true);
}
async function restartApp() {
  location.reload(true);
}
async function unregisterServiceWorkers() {
  await maintenance.unregisterServiceWorkers();
}

export function runPWADebugMenu() {
  if (debuglayer)
    debuglayer.remove();

  debuglayer =
    <div id="pwadebugmenu">
      <h1>PWA Debugger</h1>
      <div>
        <button type="button" onClick={clearCache}>Clear cache</button><br />
        <button type="button" onClick={unregisterServiceWorkers}>unregisterServiceWorkers</button><br />
        <button type="button" onClick={restartApp}>Restart application</button><br />
      </div>
    </div>;

  document.body.appendChild(debuglayer);
}


let activatetouches = [];
let expectnumtouches;
let expecttaptime;

function testMenuTap(event) {
  activatetouches.push(Date.now());
  activatetouches = activatetouches.slice(-expectnumtouches);

  const totaltime = (activatetouches.at(-1) - activatetouches[0]);
  if ((activatetouches.at(-1) - activatetouches[0]) < expecttaptime) // fast enough
  {
    if (activatetouches.length > 1)
      dompack.stop(event);

    if (activatetouches.length === expectnumtouches)
      runPWADebugMenu();
  }
}

dompack.register("[data-app-activatedebugmenu]", node => {
  const settings = node.dataset.appActivatedebugmenu.split(':');
  expectnumtouches = parseInt(settings[0]);
  expecttaptime = parseInt(settings[1]);
  if (!expecttaptime || !expectnumtouches)
    return;

  node.addEventListener("touchstart", testMenuTap);
  node.addEventListener("click", testMenuTap);
});
