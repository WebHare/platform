import * as path from "path";
import { spawn } from "child_process";

import * as vscode from "vscode";

import {
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from "vscode-languageclient/node";

import { startClient, stopClient } from "./client";
import { getStackTraceHandler, showLastStackTraceHandler, getLastStackTracesHandler, copyResourcePath, getModuleAndPath } from "./stacktrace";
import { activateYAML } from './yaml';
import { activateXML } from './xml';
import { runScript } from './tasks';
import { existsSync } from "fs";

let usingRunKitPath: string | null = null;
let currentMcpServer: vscode.Disposable | null = null;

async function runWebHareToolInline(token: vscode.CancellationToken, args: string[]) {
  const command = usingRunKitPath ?? "wh";
  const commandArgs = usingRunKitPath ? ["wh", ...args] : args;
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  return await new Promise<vscode.LanguageModelToolResult>((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (message: string) => {
      if (settled)
        return;
      settled = true;
      resolve(new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(message)]));
    };

    const cancellationListener = token.onCancellationRequested(() => {
      child.kill();
      finish("Command cancelled.");
    });

    child.stdout.on("data", chunk => {
      stdout += String(chunk);
    });

    child.stderr.on("data", chunk => {
      stderr += String(chunk);
    });

    child.on("error", error => {
      cancellationListener.dispose();
      finish(`Failed to run ${commandArgs.join(" ")}: ${error.message}`);
    });

    child.on("close", code => {
      cancellationListener.dispose();
      const sections = [
        `Command: ${commandArgs.join(" ")}`,
        `Exit code: ${code ?? "unknown"}`
      ];

      if (stdout.trim())
        sections.push(`stdout:\n${stdout.trim()}`);

      if (stderr.trim())
        sections.push(`stderr:\n${stderr.trim()}`);

      finish(sections.join("\n\n"));
    });
  });
}

function fixDocFormat(d: vscode.TextDocument) {
  if (d.languageId == "xml") {
    const prolog = d.getText().substring(0, 200);
    if (prolog.match(/<screens /)) {
      vscode.languages.setTextDocumentLanguage(d, "webhare-screens-xml");
    }
  }
}

function getRunKitPath() {
  let runkitPath: string | null = vscode.workspace.getConfiguration("webhare").get("runkitPath") || null;
  if (!runkitPath) {
    const tryLocations = [
      process.env.WHRUNKIT_HOME,
      path.join(process.env.HOME, "projects/webhare-runkit/bin/runkit"),
      path.join(process.env.HOME, "webhare-runkit/bin/runkit")];
    for (const loc of tryLocations)
      if (existsSync(loc))
        runkitPath = loc;
  }
  return runkitPath;
}

function checkRunkitPath() {
  const newRunkitPath = getRunKitPath();
  if (newRunkitPath === usingRunKitPath)
    return;

  usingRunKitPath = newRunkitPath;

  stopClient();
  if (currentMcpServer) {
    currentMcpServer[Symbol.dispose]();
    currentMcpServer = null;
  }

  if (newRunkitPath) {
    // Create and start the language client
    const { serverOptions, clientOptions } = getServerClientOptions();
    startClient(serverOptions, clientOptions);

    // And the MCP server
    currentMcpServer = vscode.lm.registerMcpServerDefinitionProvider('webhare-devkit-mcp', {
      provideMcpServerDefinitions() {
        return [new vscode.McpStdioServerDefinition("WebHare Devkit MCP Server", usingRunKitPath!, ["wh", "devkit:mcp-server"])];
      }
    });
  }
}

export function activate(context: vscode.ExtensionContext) {
  checkRunkitPath();

  activateXML(context);
  activateYAML(context);

  // Scan all open editors. We're activated by XML docs being open so we need to catch up on alreay open editors
  vscode.workspace.textDocuments.forEach(fixDocFormat);

  // And from now on fix the format on all future opened docs
  vscode.workspace.onDidOpenTextDocument(fixDocFormat);

  // Register commands
  context.subscriptions.push(vscode.commands.registerCommand("webhare.getStackTrace", getStackTraceHandler));
  context.subscriptions.push(vscode.commands.registerCommand("webhare.showStackTrace", showLastStackTraceHandler));
  context.subscriptions.push(vscode.commands.registerCommand("webhare.getLastStackTraces", getLastStackTracesHandler));
  context.subscriptions.push(vscode.commands.registerCommand("webhare.copyResourcePath", copyResourcePath));
  context.subscriptions.push(vscode.commands.registerCommand("webhare.run", runScript));

  // Listen for configuration changes
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(didChangeConfiguration));

  // Setup our tools
  vscode.lm.registerTool<{}>('webhare_getcontext', {
    async invoke(options, token) {
      let context = `
			- Use the 'webhare_validate' tool to validate WebHare files and the 'webhare_checkmodule' tool to check modules.
			- Use the 'webhare_runtest' tool to verify changes. This project uses a custom test setup, do not use tsc or npm test
      - Never suggest 'tsc' or 'npm test'.`;

      const activeDoc = vscode.window.activeTextEditor?.document;
      const lookup = activeDoc?.uri ? getModuleAndPath(activeDoc.uri) : null;
      if (lookup) {
        context += `- The current file is in WebHare module '${lookup.module}'.`;
      }

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(context)]);
    }
  });
  /* TODO webhare_validate doesn't do TSlinting yet and adding it there is extremely slow -
          not going to work until we have a background service caching this for us.

          So I told the skill to use get_errors but that one's not robust yet either (perhaps
          due to lag before problems actually arrive?) */
  vscode.lm.registerTool<{ file: string }>('webhare_validate', {
    async invoke(options, token) {
      if (!options.input.file)
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart("No file specified")]);

      return runWebHareToolInline(token, ["validate", "--", options.input.file]);
    }
  });
  vscode.lm.registerTool<{ file: string }>('webhare_runtest', {
    async invoke(options, token) {
      if (!options.input.file)
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart("No test file specified")]);

      return runWebHareToolInline(token, ["runtest", "--", options.input.file]);
    }
  });
  vscode.lm.registerTool<{ module: string }>('webhare_checkmodule', {
    async invoke(options, token) {
      if (!options.input.module)
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart("No module specified")]);

      return runWebHareToolInline(token, ["checkmodule", "--", options.input.module]);
    }
  });

  /* Register the chat agent. This was an attempt to explain basic context (such as current module)
     and initial instructions, but how to get VSCODE to talk to the agent? Couldn't find another way
     to inject some specific context from an extension yet either

  const handler: ChatRequestHandler = async (request, context, response, token) => {
    const activeDoc = window.activeTextEditor?.document;
    const isTestFile = activeDoc?.uri.fsPath.match(/[\\/]tests[\\/].+\.(whscr|ts|tsx)$/);
    const lookup = activeDoc?.uri ? getModuleAndPath(activeDoc.uri) : null;

    // This is your manual DocumentSelector logic
    let systemPrompt = "You are a general assistant. Use the 'webhare_validate' tool to validate WebHare files and the 'webhare_checkmodule' tool to check modules. Only use these tools when explicitly asked by the user or when you think it's necessary to verify a change.";
    if (isTestFile) {
      systemPrompt = "You are a Test Expert. Use the 'webhare_runtest' tool to verify changes. This project uses a custom test setup, do not use tsc or npm test";
    }
    // Standard LLM request logic would go here, passing the systemPrompt
    // TODO should we specify the current files's module here?
    response.markdown(`I am ready. ${lookup ? `The current file is in module ${lookup.module}.` : "I couldn't determine the current file's module."}`);
  };

  context.subscriptions.push(
    chat.createChatParticipant('webhare.devkit', handler)
  );
  */
}

export function deactivate(): Thenable<void> | undefined {
  stopClient();
  return undefined;
}

function getServerClientOptions() {
  // The debug options for the server

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used\
  // TODO make path to runkit and WHRUNKIT_HOME env variable configurable
  // TODO handle and explain startup failures
  const serverOptions: ServerOptions = {
    run: {
      command: usingRunKitPath!,
      args: ["wh", "devkit:languageserver"],
      transport: TransportKind.stdio
    },
    debug: {
      command: usingRunKitPath!,
      args: ["wh", "devkit:languageserver"],
      options: { env: { ...process.env, "WEBHARE_NODE_OPTIONS": "--inspect=6010" } },
      transport: TransportKind.stdio
    }
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for HareScript files. Also enables our formatter (dev:rewrite) for XML files
    documentSelector: [
      { scheme: "file", language: "harescript" },
      { scheme: "file", language: "xml" },
      { scheme: "file", language: "webhare-siteprofile-xml" },
      { scheme: "file", language: "webhare-screens-xml" },
      { scheme: "file", language: "witty-template" }
    ],
    synchronize: {
      // Notify the server about file changes to '.clientrc' files contained in the workspace
      fileEvents: vscode.workspace.createFileSystemWatcher("**/.clientrc")
    },
    outputChannelName: "WebHare Language Server"
  };

  return { serverOptions, clientOptions };
}

function didChangeConfiguration(event: vscode.ConfigurationChangeEvent) {
  if (event.affectsConfiguration("webhare"))
    checkRunkitPath();
}
