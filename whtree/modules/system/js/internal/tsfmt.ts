import * as typescriptFormat from "typescript-formatter";

/// Format of our incoming commands
interface FormattingCommand {
  path: string;
  data: string;
  basedir: string;
  tsfmtfile: string;
}

export type TSFormatResult = {
  path: string;
  error: string;
  output: string;
};

export async function handleFormattingCommand(indata: FormattingCommand): Promise<TSFormatResult> {
  const options: typescriptFormat.Options = {
    baseDir: indata.basedir,
    replace: false,
    verify: false,
    tsconfig: true,
    tsconfigFile: null,
    tslint: false,
    tslintFile: null,
    editorconfig: false,
    vscode: false,
    vscodeFile: null,
    tsfmt: true,
    tsfmtFile: indata.tsfmtfile
  };

  const contents = Buffer.from(indata.data, "base64").toString("utf-8");
  const result = await typescriptFormat.processString(indata.path, contents, options);

  return {
    path: indata.path,
    error: "",
    output: Buffer.from(result.dest, "utf-8").toString("base64")
  };
}
