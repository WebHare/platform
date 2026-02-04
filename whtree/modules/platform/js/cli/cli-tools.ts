import { enumOption } from "@webhare/cli";

//Shared code for WebHare CLI tools
export const commonFlags = {
  json: { "j,json": { description: "Output in JSON format" } },
  verbose: { "v,verbose": { description: "Show more info" } }
} as const;

export const commonOptions = {
  resources: { resources: { description: "Export resources for fetch (default) or inline as base64", type: enumOption(["fetch", "base64"]), default: "fetch" } }
} as const;
