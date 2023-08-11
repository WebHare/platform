import * as path from "node:path";
import * as typescriptFormat from "typescript-formatter";
import { ESLint } from "eslint";
import { backendConfig, toFSPath } from "@webhare/services";

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

export async function lintFile(libdata: string, resourcename: string, { fix, allowInlineConfig = true }: { fix?: boolean; allowInlineConfig: boolean }): Promise<ESLintResult> {
  const filePath = resourcename.includes("::") ? toFSPath(resourcename) : resourcename;
  const eslintrcpath = path.join(backendConfig.installationroot, ".eslintrc.json");

  const options = {
    cwd: backendConfig.installationroot,
    overrideConfigFile: eslintrcpath,
    useEslintrc: false,
    fix,
    allowInlineConfig
  };

  const eslint = new ESLint(options);
  const results = await eslint.lintText(libdata, { filePath });

  return {
    messages: results[0].messages.map((message) => ({
      line: message.line || 1,
      col: message.column || 1,
      message: message.message,
      fatal: message.fatal || false
    })),
    hasfixes: typeof results[0].output === "string",
    output: results[0].output ?? libdata
  };
}

export type TSFormatResult = {
  path: string;
  error: string;
  output: string;
};

async function runTSFormat(libdata: string, resourcepath: string, tsfmtFile: string): Promise<TSFormatResult> {
  const baseDir = path.basename(resourcepath);
  tsfmtFile = path.relative(baseDir, tsfmtFile);

  const options: typescriptFormat.Options = {
    baseDir,
    replace: false,
    verify: false,
    tsconfig: false,
    tsconfigFile: null,
    tslint: false,
    tslintFile: null,
    editorconfig: false,
    vscode: false,
    vscodeFile: null,
    tsfmt: true,
    tsfmtFile
  };

  const result = await typescriptFormat.processString(resourcepath, libdata, options);

  return {
    path: resourcepath,
    error: "",
    output: result.dest ?? libdata
  };
}

export async function formatFile(data: string, resourcepath: string): Promise<TSFormatResult> {
  const res = await lintFile(data, resourcepath, { fix: true, allowInlineConfig: false });

  const res2 = await runTSFormat(res.output, resourcepath, path.join(backendConfig.installationroot, "tsfmt.json"));
  if (res2.output !== res.output && !res2.error) {
    // Re-run eslint to clean up formatting result (which sometimes leaves trailing spaces)
    const res3 = await lintFile(res2.output, resourcepath, { fix: true, allowInlineConfig: false });
    return {
      ...res2,
      output: res3.output
    };
  }
  return res2;
}
