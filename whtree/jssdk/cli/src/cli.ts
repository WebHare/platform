// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/cli" {
}

export { setAnsiCmdMode, ansiCmd, type AnsiCommand } from "./ansi";
export { run, enumOption, intOption, floatOption, CLIRuntimeError, CLISyntaxError, type CLIArgumentType } from "./run";
