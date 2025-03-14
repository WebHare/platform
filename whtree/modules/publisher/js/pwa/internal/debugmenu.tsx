import * as dompack from 'dompack';
import "./debugmenu.scss";
import * as settings from './settings';
import * as maintenance from './maintenance';

let debuglayer: HTMLDivElement | undefined;

async function clearCache() {
  await maintenance.clearCache(settings.getAppName());
}
async function restartApp() {
  location.reload();
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

  document.body.appendChild(debuglayer!);
}


let activatetouches: number[] = [];
let expectnumtouches = Infinity;
let expecttaptime = Infinity;

function testMenuTap(event: Event) {
  activatetouches.push(Date.now());
  activatetouches = activatetouches.slice(-expectnumtouches);

  const totaltime = (activatetouches.at(-1)! - activatetouches[0]);
  if (totaltime) { // fast enough
    if (activatetouches.length > 1)
      dompack.stop(event);

    if (activatetouches.length === expectnumtouches)
      runPWADebugMenu();
  }
}

dompack.register("[data-app-activatedebugmenu]", node => {
  const settings2 = node.dataset.appActivatedebugmenu?.split(':');
  if (!settings2)
    return;

  expectnumtouches = parseInt(settings2[0]);
  expecttaptime = parseInt(settings2[1]);
  if (!expecttaptime || !expectnumtouches)
    return;

  node.addEventListener("touchstart", testMenuTap);
  node.addEventListener("click", testMenuTap);
});
