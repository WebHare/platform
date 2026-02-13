import * as path from "path";

import {
	commands,
	workspace,
	ConfigurationChangeEvent,
	ExtensionContext,
	languages,
	window,
	extensions,
	TextDocument,
	lm,
	McpStdioServerDefinition,
	type Disposable as VSCodeDisposable
} from "vscode";

import {
	LanguageClientOptions,
	ServerOptions,
	ShowMessageNotification,
	TransportKind
} from "vscode-languageclient/node";

import { startClient, stopClient } from "./client";
import { getStackTraceHandler, showLastStackTraceHandler, getLastStackTracesHandler, copyResourcePath } from "./stacktrace";
import { activateYAML } from './yaml';
import { activateXML } from './xml';
import { runScript } from './tasks';
import { existsSync } from "fs";

let usingRunKitPath: string | null = null;
let currentMcpServer: VSCodeDisposable | null = null;

function fixDocFormat(d: TextDocument) {
	if (d.languageId == "xml") {
		const prolog = d.getText().substring(0, 200);
		if (prolog.match(/<screens /)) {
			languages.setTextDocumentLanguage(d, "webhare-screens-xml");
		}
	}
}

function getRunKitPath() {
	let runkitPath: string | null = workspace.getConfiguration("webhare").get("runkitPath") || null;
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
		currentMcpServer = lm.registerMcpServerDefinitionProvider('webhare-devkit-mcp', {
			provideMcpServerDefinitions() {
				return [new McpStdioServerDefinition("WebHare Devkit MCP Server", usingRunKitPath!, ["wh", "devkit:mcp-server"])];
			}
		});
	}
}

export function activate(context: ExtensionContext) {
	checkRunkitPath();

	activateXML(context);
	activateYAML(context);

	// Scan all open editors. We're activated by XML docs being open so we need to catch up on alreay open editors
	workspace.textDocuments.forEach(fixDocFormat);

	// And from now on fix the format on all future opened docs
	workspace.onDidOpenTextDocument(fixDocFormat);

	// Register commands
	context.subscriptions.push(commands.registerCommand("webhare.getStackTrace", getStackTraceHandler));
	context.subscriptions.push(commands.registerCommand("webhare.showStackTrace", showLastStackTraceHandler));
	context.subscriptions.push(commands.registerCommand("webhare.getLastStackTraces", getLastStackTracesHandler));
	context.subscriptions.push(commands.registerCommand("webhare.copyResourcePath", copyResourcePath));
	context.subscriptions.push(commands.registerCommand("webhare.run", runScript));

	// Listen for configuration changes
	context.subscriptions.push(workspace.onDidChangeConfiguration(didChangeConfiguration));
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
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher("**/.clientrc")
		},
		outputChannelName: "WebHare Language Server"
	};

	return { serverOptions, clientOptions };
}

function didChangeConfiguration(event: ConfigurationChangeEvent) {
	if (event.affectsConfiguration("webhare"))
		checkRunkitPath();
}
