import { ansiCmd } from "@webhare/cli";
import type { ValidationMessage, ValidationResult } from "../devsupport/validation";

function formatMsgNoType(msg: ValidationMessage): string {
  return `${msg.resourcename}:${msg.line}:${msg.col}: ${msg.message}`;
}
export function logValidationResultToConsole(res: ValidationResult) {
  for (const msg of res.errors)
    console.log(ansiCmd("red") + "ERR:  " + ansiCmd("reset") + formatMsgNoType(msg));

  for (const msg of res.warnings)
    console.log(ansiCmd("yellow") + "WARN: " + ansiCmd("reset") + formatMsgNoType(msg));

  for (const msg of res.hints)
    console.log("HINT: " + formatMsgNoType(msg));
}
