import * as process from "node:process";

type AnsiMode = "" | "enabled" | "disabled";

// Ansi color mode ('' (get from environment), 'enabled', 'disabled'
let ansimode: AnsiMode = '';

/** Override whether ANSI escape sequences will be generated
    @param mode - Mode. Modes:
        <ul>
          <li>'enabled': Always generate</li>
          <li>'disabled': Never generate</li>
          <li>''/'default': Only generate when the console is a terminal (default)
        </ul>
    @see AnsiCMD, IsAnsiCmdEnabled
*/
export function setAnsiCmdMode(mode: AnsiMode | "default") {
  if (!["enabled", "disabled", "default", ""].includes(mode))
    throw new Error("Illegal ANSI mode");

  ansimode = mode === "default" ? "" : mode;
}

/** Returns whether ANSI escape sequences will be generated. Defaults to whether the console is a terminal.
    @returns true if ANSI escape sequences are enabled.
    @see AnsiCmd, SetAnsiCmdMode
*/
function isAnsiCmdEnabled(): boolean {
  // Overridden?
  if (ansimode)
    return ansimode === "enabled";

  // No terminal: no color
  if (!process.stdout.isTTY)
    return false;

  // Color terminal?
  return process.env.TERM?.includes('color') || process.env.CLICOLOR === "1";
}

const basicEscapeCodes = {
  "reset": "\x1b[0m",

  "bold": "\x1b[1m",
  "bold-off": "\x1b[22m",
  "underline": "\x1b[4m",

  "black": "\x1b[30m",
  "red": "\x1b[31m",
  "green": "\x1b[32m",
  "yellow": "\x1b[33m",
  "blue": "\x1b[34m",
  "magenta": "\x1b[35m",
  "cyan": "\x1b[36m",
  "white": "\x1b[37m",
  "bblack": "\x1b[90m",
  "bred": "\x1b[91m",
  "bgreen": "\x1b[92m",
  "byellow": "\x1b[93m",
  "bblue": "\x1b[94m",
  "bmagenta": "\x1b[95m",
  "bcyan": "\x1b[96m",
  "bwhite": "\x1b[97m",
  "default": "\x1b[39m",

  "back-black": "\x1b[40m",
  "back-red": "\x1b[41m",
  "back-green": "\x1b[42m",
  "back-yellow": "\x1b[43m",
  "back-blue": "\x1b[44m",
  "back-magenta": "\x1b[45m",
  "back-cyan": "\x1b[46m",
  "back-white": "\x1b[47m",
  "back-bblack": "\x1b[100m",
  "back-bred": "\x1b[101m",
  "back-bgreen": "\x1b[102m",
  "back-byellow": "\x1b[103m",
  "back-bblue": "\x1b[104m",
  "back-bmagenta": "\x1b[105m",
  "back-bcyan": "\x1b[106m",
  "back-bwhite": "\x1b[107m",
  "back-default": "\x1b[49m",

  "erasedisplay": "\x1b[2J",
  "clearscrollback": "\x1b[3J",
} as const;


export type AnsiCommand = keyof typeof basicEscapeCodes | {
  /** Set cursor position */
  pos: {
    /** X-coordinate, 0-based, 0 is leftmost side */
    x: number;
    /** X-coordinate, 0-based, 0 is top line */
    y: number;
  };
} | { up: number } | { down: number } | { left: number } | { right: number };

/** Generate ANSI-escape codes.
    @param cmds - Command or array of commands to geneate
    @returns ANSI escape sequences. If no terminal is present, empty strings are returned. Use SetAnsiCmdMode to override.
    @see SetAnsiCmdMode, IsAnsiCmdEnabled
    @example
// Prints a red word
console.log(`${AnsiCmd("red")}red${AnsiCmd("reset")}`);
*/
export function ansiCmd(...cmds: AnsiCommand[]): string {
  if (!isAnsiCmdEnabled())
    return '';

  let retval = '';
  for (const cmd of cmds) {
    if (typeof cmd === "string") {
      if (basicEscapeCodes[cmd])
        retval += basicEscapeCodes[cmd];
      else
        throw new Error(`Unrecognized ANSI command: ${cmd}`);
    } else { //object based command
      if ("pos" in cmd) {
        const { x, y } = cmd.pos;
        retval += `\x1b[${y - 1};${x - 1}H`;
      } else if ("up" in cmd)
        retval += `\x1b[${cmd.up}A`;
      else if ("down" in cmd)
        retval += `\x1b[${cmd.down}B`;
      else if ("left" in cmd)
        retval += `\x1b[${cmd.left}C`;
      else if ("right" in cmd)
        retval += `\x1b[${cmd.right}D`;
      else
        throw new Error(`Unrecognized ANSI command: keys: ${Object.keys(cmd).join(',')}`);
    }
  }
  return retval;
}
