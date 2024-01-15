import { DebugFlags } from "@webhare/env";
import { WebRequest } from "./request";
import { validateSignatureForThisServer } from "@webhare/services";

const whconstant_whdebug_publicflags = ["apr"];


export function getDebugSettings(req: WebRequest, { skipChecks }: { skipChecks?: boolean } = {}): { flags: DebugFlags } {
  const flags: DebugFlags = {};

  const debugCookie = req.getCookie("wh-debug");
  if (debugCookie) {
    const tokens = debugCookie.split(".");
    const hash = tokens[tokens.length - 1];
    if (skipChecks || validateSignatureForThisServer("publisher:wh-debug", debugCookie.substring(0, debugCookie.length - hash.length - 1), hash.substring(4))) {
      tokens.pop();
      for (const flag of tokens)
        flags[flag] = true;
    }
  }

  const debugVars = req.url.searchParams.get("wh-debug");
  if (debugVars) {
    for (const opt of debugVars.split(",")) {
      if (skipChecks || whconstant_whdebug_publicflags.includes(opt))
        flags[opt] = true;
    }
  }

  return { flags };
}
