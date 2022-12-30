import { BridgeDescription, BridgeManagerLink, BridgeClientLink } from "@mod-system/js/internal/types";
import { openBackendService } from "@webhare/services/src/backendservice";

class BridgeLink implements BridgeManagerLink {
  readonly bridge: BridgeDescription;
  readonly connected: Date;
  clientconnection: Promise<BridgeClientLink> | null = null;

  constructor(bridge: BridgeDescription) {
    this.bridge = bridge;
    this.connected = new Date;
    activelinks.set(this.bridge.instance, this);
  }

  async listConnections() {
    return [...activelinks.values()].map(link => link.bridge);
  }

  async enableInspector(instance: string) {
    return await (await getClientConnection(instance)).enableInspector();
  }
}

const activelinks = new Map<string, BridgeLink>;

async function getClientConnection(instance: string) {
  const link = activelinks.get(instance);
  if (!link)
    throw new Error("No such link: " + instance);

  if (!link.clientconnection)
    link.clientconnection = openBackendService("system:bridgeclient--" + instance) as unknown as Promise<BridgeClientLink>;
  return link.clientconnection;
}

export function openBridgeManagerConnection(bridge: BridgeDescription) {
  return new BridgeLink(bridge);
}
