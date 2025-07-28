import { window, workspace, QuickPickItem, Range } from "vscode";


// Recognize internal files by prefix or suffix
const INTERNAL_PREFIXES = [
	"wh::",
	"mod::consilio/",
	"mod::system/",
	"mod::publisher/",
	"mod::tollium/",
	"mod::wrd/",
	// Note: module:: and modulescript:: are obsolete now
	"module::consilio/",
	"module::system/",
	"module::publisher/",
	"module::tollium/",
	"module::wrd/",
	"modulescript::consilio/",
	"modulescript::system/",
	"modulescript::publisher/",
	"modulescript::tollium/",
	"modulescript::wrd/"
];
const INTERNAL_SUFFIXES = [
	"/buildbabelexternalhelpers.js",
	"/ap.js",
	"/regenerator-runtime/runtime.js",
	"/testframework.es",
	"/testframework-rte.es",
	"/testsuite.es"
];


// File list quick pick entries
export interface FileListQuickPickEntry { //FIXME isn't this just StackTraceItem from lsp-types?
	message?: string,
	func?: string,
	function?: string,
	name?: string,
	filename: string,
	line: number,
	col: number,
	primary: boolean;
}

export function showFileListQuickPick(entries: FileListQuickPickEntry[]) {
	// Create the list of files in the stacktrace
	const items: QuickPickItem[] = [];
	// Keep the index of the first external library
	let firstExternal: QuickPickItem | null = null;
	for (const entry of entries) {
		// Show multiple lines per item, use the message or function as the label and the file path as the detail

		// The first entry has an error message, subsequent entries have function names (truncate at 100 characters)
		let label = "";
		if (entry.message) {
			label = entry.message.length > 100 ? entry.message.substr(0, 97) + "..." : entry.message;
		}
		else if (entry.function) {
			label = entry.function;
		}
		else if (entry.func) { //ADDME: Why function/func difference?
			label = entry.func;
		}
		else if (entry.name) {
			label = entry.name;
		}

		// if sys.platform.startswith("win"):
		// 	if (editorpath != "" and editorpath != "(hidden)"):
		// 		editorpath = editorpath[1:].replace("/", "\\")
		// 		print("parsed",editorpath)
		let detail = `${entry.filename}:${entry.line}:${entry.col}`;

		// Add the item
		items.push({ label, detail });

		// Check if this is the first external library
		if (entry.primary) {
			firstExternal = items[items.length - 1];
		}
	}

	// No items to show
	if (!items.length)
		return;

	// Show a quick pick with the items
	const quickPick = window.createQuickPick();
	quickPick.items = items;
	// Select the first external item
	if (firstExternal)
		quickPick.activeItems = [firstExternal];
	// When selecting an item, open it
	quickPick.onDidChangeSelection(selection => {
		if (selection[0]) {
			showFileListDocument(selection[0].detail, false);
		}
	});
	// When changing the active item, preview it
	quickPick.onDidChangeActive(selection => {
		if (selection[0]) {
			showFileListDocument(selection[0].detail, true);
		}
	});
	quickPick.onDidHide(() => quickPick.dispose());
	quickPick.show();
}

async function showFileListDocument(detail: string, preview: boolean): Promise<void> {
	// Split the "editorPath:line:col" detail
	const parts = detail.split(":");
	if (parts.length >= 3) {
		// Open the document with the editorPath
		const doc = await workspace.openTextDocument(parts[0]);
		// Create a (zero-based) selection range
		const line = parseInt(parts[1]) - 1;
		const col = parseInt(parts[2]) - 1;
		const selection = new Range(line, col, line, col);
		// Show the document, preserve focus when previewing to keep the quick pick open
		await window.showTextDocument(doc, { preview, preserveFocus: preview, selection });
	}
}
