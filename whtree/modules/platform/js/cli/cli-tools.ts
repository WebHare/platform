import { enumOption } from "@webhare/cli";
import { openFileOrFolder, type WHFSObject } from "@webhare/whfs";

//Shared code for WebHare CLI tools
export const commonFlags = {
  json: { "j,json": { description: "Output in JSON format" } },
  verbose: { "v,verbose": { description: "Show more info" } }
} as const;

export const commonOptions = {
  resources: { resources: { description: "Export resources for fetch (default) or inline as base64", type: enumOption(["fetch", "base64"]), default: "fetch" } }
} as const;

export async function resolveWHFSPathArgument(path: string, options?: { allowRoot?: boolean }): Promise<WHFSObject> {
  return openFileOrFolder(parseInt(path) > 0 ? parseInt(path) : path, { allowHistoric: true, ...options });
}

export async function resolveWHFSPathArrayArgument(paths: string[], options?: { allowRoot?: boolean }): Promise<WHFSObject[]> {
  return Promise.all(paths.map(path => openFileOrFolder(parseInt(path) > 0 ? parseInt(path) : path, { allowHistoric: true, ...options })));
}
