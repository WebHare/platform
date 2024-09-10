import { ESLint } from "eslint";

/// Format of our incoming commands
interface LintingCommand {
  path: string;
  data: string;
  cwd: string;
  configfile: string;
  fix: boolean;
  allowinlineconfig: boolean;
}

export type ESLintResult = {
  messages: Array<{
    line: number;
    col: number;
    message: string;
    fatal: boolean;
  }>;
  hasfixes: boolean;
  output: string;
};


export async function handleLintingCommand(indata: LintingCommand): Promise<ESLintResult> {
  const contents = Buffer.from(indata.data, "base64").toString("utf-8");

  const options: ESLint.Options = {
    cwd: indata.cwd,
    overrideConfigFile: indata.configfile,
    useEslintrc: false,
    fix: indata.fix,
    allowInlineConfig: indata.allowinlineconfig
  };

  const eslint = new ESLint(options);
  /* 'overrides' doesn't work with absolute paths to filePath. just removing the '/' fixes it
     and makes eslint tolerate explicit 'any' in test files, just the way VSCode understood it */
  const results = await eslint.lintText(contents, { filePath: indata.path.substring(1) });
  return {
    messages: results[0].messages.map((message) => ({
      line: message.line || 1,
      col: message.column || 1,
      //a simple JS parse error (eg Unexpected character '`'") will have ruleId null
      message: `${message.message} ${message.ruleId ? `(eslint rule: ${message.ruleId})` : "(eslint)"}`,
      fatal: message.severity === 2, //2 = error
      source: "eslint"
    })),
    hasfixes: typeof results[0].output === "string",
    output: Buffer.from(results[0].output || "", "utf-8").toString("base64")
  };
}
