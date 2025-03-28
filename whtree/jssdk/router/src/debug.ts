import type { DebugFlags } from "@webhare/env/src/envbackend";
import type { WebRequest } from "./request";
import { getSignatureForThisServer, validateSignatureForThisServer } from "@webhare/services";

const whconstant_whdebug_publicflags = ["apr"];

function parseDebugSettings(debugSetting: string, { skipChecks }: { skipChecks?: boolean } = {}) {
  const tokens = debugSetting.split(/[.,]/);
  const lastTok = tokens[tokens.length - 1];

  if (lastTok.startsWith("sig="))
    tokens.pop(); //remove the sig= part

  //Can we set protected flags?
  const trusted = skipChecks || (lastTok.startsWith("sig=") && validateSignatureForThisServer("publisher:wh-debug", debugSetting.substring(0, debugSetting.length - lastTok.length - 1), lastTok.substring(4)));
  return tokens.filter(tok => trusted || whconstant_whdebug_publicflags.includes(tok));
}

export function getDebugSettings(req: WebRequest, { skipChecks }: { skipChecks?: boolean } = {}): { flags: DebugFlags } {
  const flags: DebugFlags = {};

  const debugCookie = req.getCookie("wh-debug");
  if (debugCookie)
    for (const flag of parseDebugSettings(debugCookie, { skipChecks }))
      flags[flag] = true;

  const debugVars = new URL(req.url).searchParams.get("wh-debug");
  if (debugVars) { //TODO should we limit the validity of signed wh-debug= toks? pretty easy to leak!
    for (const flag of parseDebugSettings(debugVars, { skipChecks }))
      flags[flag] = true;
  }

  return { flags };
}

export function getSignedWHDebugOptions({ debugFlags }: { debugFlags: DebugFlags }): string {
  const debugCookie = [...Object.entries(debugFlags)].filter(([flag, enabled]) => enabled).map(([flag]) => flag).join(".");
  if (!debugCookie)
    return "";

  return debugCookie + ".sig=" + getSignatureForThisServer("publisher:wh-debug", debugCookie); //adding .sig is backwards compatible with old dompacks, as it tokenizes on '.'
}
