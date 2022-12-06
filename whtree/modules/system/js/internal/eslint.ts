import { ESLint } from "eslint";

/// Format of our incoming commands
interface LintingCommand {
  path: string
  data: string
  cwd: string
  configfile: string
}

export async function handleLintingCommand(indata: LintingCommand) {
  const contents = Buffer.from(indata.data, "base64").toString("utf-8");

  const options = {
    cwd: indata.cwd,
    overrideConfigFile: indata.configfile,
    useEslintrc: false,
  };

  const eslint = new ESLint(options);
  const results = await eslint.lintText(contents, { filePath: indata.path });

  return {
    messages: results[0].messages.map((message) => ({
      line: message.line || 1,
      col: message.column || 1,
      message: message.message,
      fatal: message.fatal || false
    })),
  };
}
