import { mapHareScriptPath } from "@webhare/harescript/src/wasm-support";
import { BackendServiceConnection, type BackendServiceController, logDebug } from "@webhare/services";
import type { WorkspaceFolder } from "vscode-languageserver";

type ShowResourceParams = {
  /// A WebHare resource path
  resource: string;
  /// Line number to move the cursor to
  line?: number;
  /// Column number to move the cursor to
  col?: number;
};

/** Describes HareScript-based services */
declare module "@webhare/services" {
  interface BackendServices {
    "devkit:lspservice": LSPClient;
  }
}

type ClientConfig = {
  workspaceFolders: WorkspaceFolder[] | null;
  clientName?: string;
  lastSeen: Date;
};

class LSPController implements BackendServiceController {
  clients: Map<LSPClient, ClientConfig>;

  constructor() {
    this.clients = new Map();
    logDebug("lsp:service", { msg: "Listening for clients" });
  }

  createClient(): Promise<LSPClient> {
    return Promise.resolve(new LSPClient(this));
  }

  registerClient(client: LSPClient, workspaceFolders: WorkspaceFolder[] | null, clientName?: string) {
    this.clients.set(client, { workspaceFolders, clientName, lastSeen: new Date() });
    logDebug("lsp:service", { msg: "Registered client", workspaceFolders, clients: this.clients.size });
  }

  unregisterClient(client: LSPClient) {
    if (this.clients.has(client)) {
      this.clients.delete(client);
      logDebug("lsp:service", { msg: "Unregistered client", clients: this.clients.size });
    }
  }

  ping(client: LSPClient) {
    if (this.clients.has(client)) {
      // logDebug("lsp:service", { msg: "Received client ping" });
      this.clients.get(client)!.lastSeen = new Date();
    }
  }

  showResource(params: ShowResourceParams) {
    logDebug("lsp:service", { msg: "Show resource", params });
    const client = this._getRelevantClient(params.resource);
    if (client) {
      const workspaceName = client.config.workspaceFolders && client.relevantWorkspace !== undefined ? client.config.workspaceFolders[client.relevantWorkspace].name : "";
      logDebug("lsp:service", { msg: "Show resource to client", clientName: client.config.clientName, workspaceName });
      client.client._showResource(params);
      return { clientName: client.config.clientName, workspaceName };
    }
  }

  _getRelevantClient(resource: string): { client: LSPClient; config: ClientConfig; relevantWorkspace?: number } | undefined {
    let pathOnDisk = mapHareScriptPath(resource);
    if (!pathOnDisk) {
      logDebug("lsp:service", { msg: "Resource not found", resource });
      return;
    }
    pathOnDisk = "file://" + pathOnDisk;
    logDebug("lsp:service", { msg: "Get relevant client", pathOnDisk });

    // Sort connected clients by most recently seen
    const sortedClients = [...this.clients.entries()]
      .map(([client, config]) => ({ client, config }))
      .sort((a, b) => b.config.lastSeen.getTime() - a.config.lastSeen.getTime());

    //TODO: Handle multiple matching clients?
    // Find a client with a workspace folder containing this resource
    for (const client of sortedClients) {
      const relevantWorkspace = client.config.workspaceFolders?.findIndex(ws => pathOnDisk!.startsWith(ws.uri));
      if (relevantWorkspace !== undefined && relevantWorkspace >= 0) {
        logDebug("lsp:service", { msg: "Relevant client with workspace", workspaceFolders: client.config.workspaceFolders });
        return { ...client, relevantWorkspace };
      }
    }

    // Find a client without workspace folders, which can accept any file
    const relevantClient = sortedClients.filter(entry => !entry.config.workspaceFolders?.length)[0];
    if (relevantClient) {
      logDebug("lsp:service", { msg: "Relevant client without workspace" });
      return { ...relevantClient, relevantWorkspace: 0 };
    }

    // Just return the most recently seen client
    logDebug("lsp:service", { msg: "No relevant client" });
    return sortedClients[0];
  }
}

class LSPClient extends BackendServiceConnection {
  controller: LSPController;

  constructor(controller: LSPController) {
    super();
    this.controller = controller;
  }

  onClose() {
    this.controller.unregisterClient(this);
  }

  _showResource(params: ShowResourceParams) {
    this.emit("showresource", params);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  //
  // LSP client API
  //

  /** Connect an LSP client to WebHare
   *  @param workspaceFolders - a list of paths on disk
   */
  connect(workspaceFolders: WorkspaceFolder[] | null, clientName?: string) {
    this.controller.registerClient(this, workspaceFolders, clientName);
  }

  /** Keep connection alive, update last seen
   */
  ping() {
    this.controller.ping(this);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  //
  // Public API
  //

  /** Open a WebHare resource in the relevant LSP client
   */
  showResource(resource: ShowResourceParams) {
    return this.controller.showResource(resource);
  }
}

export type { LSPClient, ShowResourceParams };

export async function createLSPController() {
  return new LSPController;
}
