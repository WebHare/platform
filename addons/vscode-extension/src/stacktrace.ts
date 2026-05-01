import { window, QuickPickItem, env, Uri } from "vscode";
import type { StackTraceParams, StackTraceResponse, StackTraceError } from "@webhare/lsp-types";

import { client } from "./client";
import { showFileListQuickPick } from "./filelistquickpick";
import { basename, dirname } from 'path';
import { existsSync } from 'fs';

// The last retrieved stack trace
let lastStackTrace: StackTraceError;


export async function getStackTraceHandler() {
  // Request the last stack traces
  if (window.activeTextEditor) {
    const trace: StackTraceParams = {
      textDocument: { uri: window.activeTextEditor.document.uri.toString() },
      lastGuid: ""
    };
    const response: StackTraceResponse = await client.sendRequest("webHare/getStackTrace", trace);
    // If there are any stack traces, save and show them
    if (response.errors.length) {
      lastStackTrace = response.errors[0];
      showLastStackTraceHandler();
    }
  }
}

export function getModuleAndPath(uri: Uri) {
  const resourcepath = uri.path;
  let path = dirname(resourcepath);
  while (path.length > 1) {
    if (existsSync(path + "/moduledefinition.xml") || existsSync(path + "/moduledefinition.yml")) { //root found!
      return { module: basename(path), path: resourcepath.substring(path.length) };
    }
    path = dirname(path);
  }
  return null;
}

export function copyResourcePath(uri: Uri) {
  const lookup = getModuleAndPath(uri);
  if (lookup)
    env.clipboard.writeText(`mod::${lookup.module}${lookup.path}`);
  else
    window.showErrorMessage(`Unable to find module for ${uri.path}`);
}

export async function showLastStackTraceHandler() {
  // If there are no stack traces, retrieve them, otherwise show the quick pick
  if (!lastStackTrace) {
    await getStackTraceHandler();
  } else {
    showFileListQuickPick(lastStackTrace.stack);
  }
}

class StackTraceQuickPickItem implements QuickPickItem {
  label: string
  detail: string
  error: StackTraceError
}

export async function getLastStackTracesHandler() {
  if (window.activeTextEditor) {
    // Request the last stack traces
    const trace: StackTraceParams = {
      textDocument: { uri: window.activeTextEditor.document.uri.toString() },
      lastGuid: ""
    };
    const response: StackTraceResponse = await client.sendRequest("webHare/getStackTrace", trace);

    const items: StackTraceQuickPickItem[] = [];
    for (const error of response.errors) {
      const item = new StackTraceQuickPickItem;
      item.label = error.stack.length ? error.stack[0].message ?? "no message" : "no message";
      item.detail = `${error.date}, ${error.groupid}`;
      item.error = error;
      items.push(item);
    }

    const quickPick = window.createQuickPick<StackTraceQuickPickItem>();
    quickPick.items = items;
    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.onDidAccept(() => {
      if (quickPick.selectedItems.length) {
        lastStackTrace = quickPick.selectedItems[0].error;
        showLastStackTraceHandler();
      }
    });
    quickPick.show();
  }
}
