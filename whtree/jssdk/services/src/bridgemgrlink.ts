import { openBackendService } from "./backendservice";
import { generateBase64UniqueID } from "@mod-system/js/internal/util/crypto";
import { BridgeClientLink, BridgeDescription, BridgeManagerLink } from "@mod-system/js/internal/types";
import runWebHareService from "@mod-system/js/internal/webhareservice";
import * as inspector from "node:inspector";

let bridgeconn: BridgeManagerLink;
let thepromise: Promise<BridgeManagerLink>;
const bridgeuuid = generateBase64UniqueID();

export function getBridgeInstanceID(): string {
  return bridgeuuid;
}

async function connectBridge(descr: BridgeDescription) {
  for (; ;) {
    try {
      //FIXME reconnect bridge once connection is lost
      const link = (await openBackendService("system:bridgemanager", [descr])) as unknown as BridgeManagerLink;
      return link;
    } catch (e) {
      //TODO exp backoff? and immediately retry if someone invokes getBridgeManagerLink again?
      //TODO ensure that us getting stuck connecting does not
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 1000);
        timeout.unref(); //we shouldn't be blocking exit
      });
    }
  }
}

//TODO: We probably need to convert the incoming service and outgoing data to a IPC link or some whmanger-bridge-native construct..
//      and only use a service for the actual bridge API (eg ListServices)

export async function getBridgeManagerLink(): Promise<BridgeManagerLink> {
  if (!thepromise) {
    const descr: BridgeDescription = {
      instance: getBridgeInstanceID(),
      pid: process.pid,
      interpreter: process.argv[0] || '',
      script: process.argv[1] || ''
    };
    thepromise = connectBridge(descr);
  }
  if (!bridgeconn) {
    // eslint-disable-next-line require-atomic-updates -- all races would be updating bridgeservice with the same value
    bridgeconn = await thepromise;
  }
  return bridgeconn;
}

class BridgeClient implements BridgeClientLink {
  async enableInspector() {
    //FIXME bridgme should coordinate ports and prevent reuse, or we need to be able to find a free port ourselves
    let url = inspector.url();
    if (!url) {
      inspector.open();
      url = inspector.url();
    }

    return url ? { url } : null;
  }
}

runWebHareService("system:bridgeclient--" + getBridgeInstanceID(), () => new BridgeClient, { __droplistenerreference: true });
