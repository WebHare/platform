/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import 'dompack/browserfix/reset.css';

import * as whintegration from '@mod-system/js/wh/integration';
import '@mod-system/js/wh/errorreporting'; //log JS errors to notice log

// import './shared/forms/forms';
// import './shared/rtd/rtd';
import './pwatest.scss';

import './widgets/video';

import * as pwalib from '@mod-publisher/js/pwa';

async function appEntryPoint() {
  const logdiv = <ul id="pwa-log"></ul>;
  document.querySelector('main').append(logdiv);

  const dynload = await import('./shared/testdynamicload');
  if (dynload.getAnswer() !== 42)
    throw new Error("dynload failure");

  logdiv.append(<div id="pwa-greeting">I am alive</div>);

}

function onAvailableOffline() {
  console.log(`[pwatest] I am available offline`);
  document.querySelector("#pwa-log").append(<li id="pwa-offline">I am available offline</li>);
}

function onOfflineFailed(e) {
  console.log(`[pwatest] Offline installation failed`, e);
  document.querySelector("#pwa-log").append(<li id="pwa-failed">OFFLINE INSTALLATION FAILED</li>);
}

function onUpdateAvailable() {
  document.querySelector("#pwa-log").append(<li id="pwa-update-available">An update is available</li>);
}

dompack.register("#checkforupdate", node => node.addEventListener("click", async () => {
  dompack.qS("#pwa-update-status").textContent = "Checking...";
  const updatestatus = await pwalib.checkForUpdate();
  dompack.qS("#pwa-update-status").textContent = updatestatus.needsupdate ? "UPDATE AVAILABLE" : "we are uptodate";
}));

dompack.register("#downloadupdate", node => node.addEventListener("click", async () => {
  dompack.qS("#pwa-update-status").textContent = "Downloading...";
  await pwalib.downloadUpdate();
  dompack.qS("#pwa-update-status").textContent = "DOWNLOAD COMPLETE";
  dompack.qS("#updatenow").style.display = "";
}));

dompack.register("#updatenow", node => node.addEventListener("click", async () => {
  await pwalib.updateApplication();
}));

pwalib.onReady(appEntryPoint, {
  reportusage: true,
  onAvailableOffline: onAvailableOffline,
  onOfflineFailed: onOfflineFailed
  // , onUpdateAvailable: onUpdateAvailable
});
