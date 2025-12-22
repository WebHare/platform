import bridge from "@mod-system/js/internal/whmanager/bridge";
import { loadlib } from "@webhare/harescript";
import { openBackendService } from "@webhare/services";

/** Refresh the webserver configuration.
 *
 * Ask the webserver to refresh its configuration read from the database and module definitions. The relevant changes need to be already committed. Returns when the webserver is reconfigured
*/
export async function refreshGlobalWebserverConfig() {
  //original returns 'The configuration load status as reported by ConfigureWebserver.'. mostly useful for broken listeners but then the JS webserver has to implement it too

  using smservice = await openBackendService("platform:servicemanager");
  const state = await smservice.getWebHareState();
  const haveJSWebserver = state.availableServices.find(s => s.name === "platform:webserver-node")?.isRunning;

  if (haveJSWebserver) {
    using webserver = await openBackendService("platform:webserver");
    await webserver.reloadConfig();
  }

  const getconfig = bridge.connect("system:webserver.getconfig", { global: true });
  await getconfig.activate(); //TODO what if unreachable? perhaps wait if we know its running and immediately abort otherwise ?
  getconfig.dropReference();

  /* return value of getconfig.doRequest looks like {
    status: 'ok',
    msg: '',
    reloadstatus: {
      broken_listeners: [],
      numports: 6,
      numhosts: 15,
      numrules: 1131,
      numtypes: 757
    }
  } */
  await getconfig.doRequest({ task: "rescan" });
  getconfig.close();
}

export async function reconfigureProxies() {
  return await loadlib("mod::system/lib/internal/webserver/reloadconfig.whlib").ReconfigureProxies();
}
