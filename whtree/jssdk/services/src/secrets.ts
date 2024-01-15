import * as crypto from "node:crypto";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";


//Create a signature for this server
export function getSignatureForThisServer(scope: string, text: string): string {
  const hasher = crypto.createHash("SHA-256");
  hasher.update(text + "\t" + scope + "\t" + getFullConfigFile().secrets.cookie);
  return hasher.digest().toString("base64url");
}

//Validate a generated signature
export function validateSignatureForThisServer(scope: string, text: string, signature: string): boolean {
  return getSignatureForThisServer(scope, text) === signature;
}
