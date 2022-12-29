import { BridgeDescription, BridgeManagerLink } from "@mod-system/js/internal/types";

class BridgeLink implements BridgeManagerLink {
  readonly bridge: BridgeDescription;
  readonly connected: Date;

  constructor(bridge: BridgeDescription) {
    this.bridge = bridge;
    this.connected = new Date;
    activelinks.set(this.bridge.instance, this);
  }

  async listConnections() {
    return [...activelinks.values()].map(link => link.bridge);
  }
}

const activelinks = new Map<string, BridgeLink>;

export function openBridgeManagerConnection(bridge: BridgeDescription) {
  return new BridgeLink(bridge);
}
