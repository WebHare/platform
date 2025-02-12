// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/cli" {
}

export { setAnsiCmdMode, ansiCmd } from "./ansi";
export { run, enumOption, intOption, floatOption, CLIRuntimeError } from "./run";
