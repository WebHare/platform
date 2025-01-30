import type { DebugFlags } from "@webhare/env/src/envbackend";
import type { WebRequest } from "./request";
import { getSignatureForThisServer, validateSignatureForThisServer } from "@webhare/services";

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

  const debugVars = new URL(req.url).searchParams.get("wh-debug");
  if (debugVars) {
    for (const opt of debugVars.split(",")) {
      if (skipChecks || whconstant_whdebug_publicflags.includes(opt))
        flags[opt] = true;
    }
  }

  return { flags };
}

export function getSignedWHDebugOptions({ debugFlags }: { debugFlags: DebugFlags }): string | null {
  const debugCookie = [...Object.entries(debugFlags)].filter(([flag, enabled]) => enabled).map(([flag]) => flag).join(".");
  if (!debugCookie)
    return null;

  return debugCookie + ".sig=" + getSignatureForThisServer("publisher:wh-debug", debugCookie); //adding .sig is backwards compatible with old dompacks, as it tokenizes on '.'
}
