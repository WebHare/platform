import { openBackendService } from "./backendservice";
import { generateBase64UniqueID } from "@mod-system/js/internal/util/crypto";
import { BridgeDescription, BridgeManagerLink } from "@mod-system/js/internal/types";

let bridgeconn: BridgeManagerLink;
let thepromise: Promise<BridgeManagerLink>;
const bridgeuuid = generateBase64UniqueID();

export function getBridgeInstanceID(): string {
  return bridgeuuid;
}

async function connectBridge(descr: BridgeDescription) {
  for (; ;) {
    try {
      return await openBackendService("system:bridgemanager", [descr]) as unknown as Promise<BridgeManagerLink>;
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

export async function getBridgeManagerLink() {
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
