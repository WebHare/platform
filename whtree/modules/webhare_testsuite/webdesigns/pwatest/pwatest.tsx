import * as dompack from '@webhare/dompack';
import 'dompack/browserfix/reset.css';

import '@mod-system/js/wh/errorreporting'; //log JS errors to notice log

// import './shared/forms/forms';
// import './shared/rtd/rtd';
import './pwatest.scss';

import './widgets/video';

import * as pwalib from '@mod-publisher/js/pwa';

async function appEntryPoint() {
  const logdiv = <ul id="pwa-log"></ul>;
  dompack.qR('main').append(logdiv);

  const dynload = await import('./shared/testdynamicload');
  if (dynload.getAnswer() !== 42)
    throw new Error("dynload failure");

  logdiv.append(<div id="pwa-greeting">I am alive</div>);

}

function onAvailableOffline() {
  console.log(`[pwatest] I am available offline`);
  dompack.qR("#pwa-log").append(<li id="pwa-offline">I am available offline</li>);
}

function onOfflineFailed(e: Error) {
  console.log(`[pwatest] Offline installation failed`, e);
  dompack.qR("#pwa-log").append(<li id="pwa-failed">OFFLINE INSTALLATION FAILED</li>);
}

dompack.register("#checkforupdate", node => node.addEventListener("click", async () => {
  dompack.qR("#pwa-update-status").textContent = "Checking...";
  const updatestatus = await pwalib.checkForUpdate() as { needsupdate: boolean }; //TODO type as part of sendSWRequestTo protocol
  dompack.qR("#pwa-update-status").textContent = updatestatus.needsupdate ? "UPDATE AVAILABLE" : "we are uptodate";
}));

dompack.register("#downloadupdate", node => node.addEventListener("click", async () => {
  dompack.qR("#pwa-update-status").textContent = "Downloading...";
  await pwalib.downloadUpdate();
  dompack.qR("#pwa-update-status").textContent = "DOWNLOAD COMPLETE";
  dompack.qR("#updatenow").style.display = "";
}));

dompack.register("#updatenow", node => node.addEventListener("click", async () => {
  await pwalib.updateApplication();
}));

pwalib.onReady(appEntryPoint, {
  reportusage: true,
  onAvailableOffline: onAvailableOffline,
  onOfflineFailed: onOfflineFailed
});
