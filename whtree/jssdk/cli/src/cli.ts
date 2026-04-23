// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/cli" {
}

export { setAnsiCmdMode, ansiCmd, type AnsiCommand } from "./ansi";
export { inferRunCliTypes, runCli, enumOption, intOption, floatOption, CLIRuntimeError, CLISyntaxError, type CLIArgumentType } from "./run";

import { runCli } from "./run";
/** @deprecated - use cliRun instead, run is too generic a name. Deprecated in WH 6.0 */
export const run = runCli;
