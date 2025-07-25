/* Shared code with editor connection */

import {
  type ClientCapabilities,
  TextDocuments,
  createConnection,
  type Message,
} from "vscode-languageserver/node";

import { TextDocument } from 'vscode-languageserver-textdocument';

//TODO: Find a nicer way to ping the WebHare connection at every request
let messageHandler: ((message: Message) => void) | null = null;
export function onConnectionMessage(handler: (message: Message) => void) {
  messageHandler = handler;
}

// Create a connection for the server. The connection uses stdin/stdout as a transport.
export const connection = createConnection(process.stdin, process.stdout, {
  messageStrategy: {
    handleMessage: (message, next) => {
      if (messageHandler)
        messageHandler(message);
      next(message);
    }
  }
});

export const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

interface ConnectionConfig {
  capabilities: ClientCapabilities | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initializationOptions?: any;
}

// Shared connection configuration
export const connectionConfig: ConnectionConfig = {
  capabilities: null,
  initializationOptions: null
};
