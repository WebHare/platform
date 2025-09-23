import { ansiCmd } from "@webhare/cli";
import type { ValidationMessage, ValidationResult } from "../devsupport/validation";

function formatMsgNoType(msg: ValidationMessage): string {
  return `${msg.resourcename}:${msg.line}:${msg.col}: ${msg.message}`;
}
export function logValidationResultToConsole(res: ValidationResult) {
  const prologues = {
    error: ansiCmd("red") + "ERR:  " + ansiCmd("reset"),
    warning: ansiCmd("yellow") + "WARN: " + ansiCmd("reset"),
    hint: "HINT: "
  };

  for (const msg of res.messages)
    console.log(`${prologues[msg.type]}${formatMsgNoType(msg)}`);
}
