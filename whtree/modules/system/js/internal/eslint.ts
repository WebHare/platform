import { ESLint } from "eslint";
import { buildRelaxedConfig, buildStrictConfig } from "@webhare/eslint-config";
import { backendConfig, parseResourcePath, toFSPath } from "@webhare/services";
import { whconstant_builtinmodules } from "./webhareconstants";

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

export async function handleLintingCommand(resourcepath: string, contents: string, fix: boolean, allowinlineconfig: boolean): Promise<ESLintResult> {
  /* TODO resetup validation and eslinting to support batch validation, entering/exiting this API per file is time waster. And we would be doing
     all platform modules + jssdk in a single command, eliminating some oddness around path handling here */

  const isjssdk = resourcepath.startsWith('direct::' + backendConfig.installationroot + "jssdk/");
  const module = isjssdk ? "jssdk" : parseResourcePath(resourcepath)?.module;
  if (!module)
    throw new Error(`No module found for '${resourcepath}`);

  const isPlatform = isjssdk || whconstant_builtinmodules.includes(module);
  const tsconfigRootDir = isPlatform ? backendConfig.installationroot : backendConfig.module[module].root;
  // Treat any module shipped with WebHare (including testsuite & devkit) as requiring strict validation - there's no reason we can can't ensure strict correctness given that platform is CI-d as a whole
  // We should mark this in the moduledefinition so other modules can go strict as well, but for now we'll just hardcode.. (can't do tricks with paths, CI installs webhare_testsuite in a different location than source)
  const isStrict = isPlatform || ["webhare_testsuite", "devkit"].includes(module);
  const project = tsconfigRootDir + "tsconfig.json";
  const config = isStrict ? buildStrictConfig({ project, tsconfigRootDir }) : buildRelaxedConfig({ project, tsconfigRootDir });

  const options: ESLint.Options = {
    cwd: '/', //without this, we risk "File ignored because outside of base path."
    overrideConfigFile: true, //needed or eslint will still look for an ondisk file
    overrideConfig: config,
    fix: fix,
    allowInlineConfig: allowinlineconfig,
    warnIgnored: true
  };

  const eslint = new ESLint(options);
  //toFSPath doesn't support direct:: yet and didn't need it until now (so may still be worth it to see if we can get rid of direct:: )
  const diskpath = resourcepath.startsWith('direct::') ? resourcepath.substring(8) : toFSPath(resourcepath);
  const results = await eslint.lintText(contents, { filePath: diskpath });
  if (!results.length) {
    // no results, file was probably ignored in the eslint configuration
    return {
      messages: [],
      hasfixes: false,
      output: ''
    };
  }

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
    output: typeof results[0].output === "string" ? Buffer.from(results[0].output || "", "utf-8").toString("base64") : ''
  };
}
