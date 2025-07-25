import { spawn, spawnSync } from 'child_process';
import * as vscode from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions
} from "vscode-languageclient/node";


export let client: LanguageClient | null;

export function startClient(serverOptions: ServerOptions, clientOptions: LanguageClientOptions) {
	stopClient();

	// Create the language client
	client = new LanguageClient(
		"webhareLanguageServer",
		"WebHare Language Server",
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();

	// Watch for 'reveal' requests from WebHare. This is the reason we need `activationEvents`: `onStartupFinished`
	client.onRequest("window/showDocument", async param => {
		//appRoot contains eg '"/Applications/Visual Studio Code.app/Contents/Resources/app". we strip after .app
		const appname = vscode.env.appRoot.match(/^(.*\.app)/)[1];

		const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(param.uri));
		const editor = await vscode.window.showTextDocument(doc);
		// Line added - by having a selection at the same position twice, the cursor jumps there
		editor.selections = [new vscode.Selection(param.selection.start, param.selection.end)];

		// And the visible range jumps there too
		var range = new vscode.Range(param.selection.start, param.selection.start);
		editor.revealRange(range);

		//FIXME mac only. can we detect the app name?
		if (appname)
			spawn("osascript", ['-e', `activate application ${JSON.stringify(appname)}`], { detached: true });
	});
}

export function stopClient() {
	if (client) {
		client.stop();
	}
	client = null;
}

export async function getWebHareResource(path: string): Promise<string> {
	const schema = await client.sendRequest("webHare/getWebHareResource", path);
	return schema as string;
}

export async function toFSPath(path: string): Promise<string> {
	const schema = await client.sendRequest("webHare/toFSPath", path);
	return schema as string;
}
