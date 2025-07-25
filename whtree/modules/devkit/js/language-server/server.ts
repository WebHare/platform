/* The main script that handles the editor connection */

import {
  CodeActionKind,
  type InitializeParams,
  type InitializeResult,
  RequestType,
  type ShowDocumentParams,
  TextDocumentSyncKind
} from "vscode-languageserver/node";

import { connection, connectionConfig, documents, onConnectionMessage } from "./connection";

import * as services from "./service";
import type * as lspTypes from "@webhare/lsp-types";
import { backendConfig, openBackendService } from "@webhare/services";
import { mapHareScriptPath } from "@webhare/harescript/src/wasm-support";
import type { LSPClient, ShowResourceParams } from "./whservice";
import { sleep } from "@webhare/std";
import * as util from "node:util";

//Kill the LS on exceptions (or perhaps only on out-of-date exceptions?)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO fix the wrapper to not require any?
function wrapCheck<T extends (...args: any[]) => any>(cb: T): T {
  return function (...args: unknown[]): unknown {
    try {
      const result = cb(...args);
      if ((result as Promise<void>)?.then) {
        (result as Promise<void>).catch(e => {
          console.error(`** Fatal rejection ${cb?.name ? `from ${cb.name} ` : ""}- will abort`, e);
          setTimeout(() => process.exit(1), 50); //allow some time to send/report dying screams
          throw e;
        });
      }
      return result;
    } catch (e) {
      console.error(`** Fatal exception ${cb?.name ? `from ${cb.name} ` : ""}- will abort`, e);
      setTimeout(() => process.exit(1), 50); //allow some time to send/report dying screams
      throw e;
    }
  } as T;
}

async function runLspServiceCpnnection(clientName: string, signal: AbortSignal) {
  //TODO have openBackendService integrate abort signals
  const whClient = await openBackendService<LSPClient>("dev:lspservice", undefined, { linger: true, timeout: 5000 });
  const closed = new Promise<void>(resolve => whClient.addEventListener("close", () => resolve()));
  onConnectionMessage((_) => void whClient.ping());

  const workspaceFolders = await connection.workspace.getWorkspaceFolders();
  whClient.addEventListener("showresource", (event: Event) => {
    const detail = (event as CustomEvent<ShowResourceParams>).detail;
    const params: ShowDocumentParams = {
      uri: "file://" + mapHareScriptPath(detail.resource),
      takeFocus: true
    };
    if (detail.line) {
      params.selection = {
        start: { line: detail.line - 1, character: 0 },
        end: { line: detail.line - 1, character: 0 }
      };
      if (detail.col) {
        params.selection.start.character = detail.col - 1;
        params.selection.end.character = detail.col - 1;
      }
    }
    console.log("showresource", detail, params);
    void connection.sendRequest("window/showDocument", params);
  });
  await whClient.connect(workspaceFolders, clientName);
  await closed;
}

async function lspServiceLoop(clientName: string, signal: AbortSignal) {
  for (; ;) {
    try {
      await runLspServiceCpnnection(clientName, signal);
    } catch (e) {
      if (signal.aborted)
        break;
      //TODO exp. backoff if we disconnected too fast
      console.log("LSP connection lost", (e as Error).message);
      await sleep(100);
    }
  }
}

export async function runWebHareLSP() {
  let clientName: string | undefined;

  console.dir = function (arg, options) {
    connection.console.log(util.inspect(arg, options));
  };
  console.log = function (...args: unknown[]) {
    return connection.console.log(util.format(...args));
  };

  // Initialize the editor connection
  connection.onInitialize((params: InitializeParams) => {
    // Store the connection configuration
    connectionConfig.capabilities = params.capabilities;
    connectionConfig.initializationOptions = params.initializationOptions;
    clientName = params.clientInfo?.name;

    // Return our capabilities
    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Incremental,
          save: { includeText: true }
        },
        definitionProvider: true,
        documentFormattingProvider: true,
        hoverProvider: true,
        codeActionProvider: {
          codeActionKinds: [
            CodeActionKind.QuickFix,
            CodeActionKind.Source,
            CodeActionKind.SourceOrganizeImports
          ]
        },
        executeCommandProvider: {
          commands: [
            "addMissingLoadlib",
            "removeUnusedLoadlib",
            "organizeLoadlibs"
          ]
        }
      },
      serverInfo: {
        name: "WebHare",
        version: backendConfig.whVersion
      },
      whServerInfo: {
        dataRoot: backendConfig.dataRoot
      }
    } satisfies InitializeResult & lspTypes.WHServerInitializeResult;
  });

  const exitcontroller = new AbortController;
  connection.onInitialized(() => {
    void lspServiceLoop(clientName!, exitcontroller.signal);
  });

  connection.onExit(() => {
    console.error("OnExit");
    exitcontroller.abort();
  });
  connection.onDefinition(wrapCheck(services.definitionRequest));

  connection.onHover(wrapCheck(services.hoverRequest));

  connection.onDocumentFormatting(wrapCheck(services.formattingRequest));

  connection.onCodeAction(wrapCheck(services.codeActionRequest));

  connection.onExecuteCommand(wrapCheck(services.executeCommandRequest));

  setupCustomMessages();

  connection.listen();
  documents.listen(connection);
  documents.onDidChangeContent(wrapCheck(services.didChangeContent));
}

function setupCustomMessages() {
  connection.onRequest(new RequestType<lspTypes.StackTraceParams, lspTypes.StackTraceResponse, void>("webHare/getStackTrace"), services.stackTraceRequest);
  connection.onRequest(new RequestType<string, string, void>("webHare/getWebHareResource"), services.webHareResourceRequest);
  connection.onRequest(new RequestType<string, string, void>("webHare/toFSPath"), services.toFSPathRequest);
  connection.onRequest(new RequestType<string, string, void>("webHare/toResourcePath"), services.toResourcePathRequest);
}
