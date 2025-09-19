import { ESLint } from "eslint";
import { buildRelaxedConfig, buildStrictConfig } from "@webhare/eslint-config";
import { backendConfig, parseResourcePath, toFSPath } from "@webhare/services";
import { whconstant_builtinmodules } from "./webhareconstants";
import { appendToArray } from "@webhare/std";
import { readFileSync } from "node:fs";
import type { ValidationMessageType, ValidationMessageWithType } from "@mod-platform/js/devsupport/validation";

export type ESLintResult = {
  messages: ValidationMessageWithType[];
  fixes: Array<{
    resourcename: string;
    output: string;
  }>;
};

export async function handleLintingCommand(resources: Array<{
  resourcepath: string;
  contents?: string;
}>, options?: { fix: boolean; allowinlineconfig: boolean }): Promise<ESLintResult> {
  /* TODO can we combine TS and ES validation, as ES bulds up a TS compiler anyway? */

  // Group resources per module
  const toProcess = new Array<{
    resourcepath: string;
    contents?: string;
    module: string;
  }>();

  const retval: ESLintResult = { messages: [], fixes: [] };

  for (const entry of resources) {
    const isjssdk = entry.resourcepath.startsWith('direct::' + backendConfig.installationRoot + "jssdk/");
    const module = isjssdk ? "jssdk" : parseResourcePath(entry.resourcepath)?.module;
    if (!module)
      throw new Error(`No module found for '${entry.resourcepath}`);

    const isPlatform = isjssdk || whconstant_builtinmodules.includes(module);
    toProcess.push({ ...entry, module: isPlatform ? "platform" : module });
  }

  for (const [module, entries] of Map.groupBy(toProcess, x => x.module)) {
    const isStrict = ["platform", "webhare_testsuite", "devkit"].includes(module);
    const tsconfigRootDir = module === "platform" ? backendConfig.installationRoot : backendConfig.module[module].root;
    const project = tsconfigRootDir + "tsconfig.json";
    const config = isStrict ? buildStrictConfig({ project, tsconfigRootDir }) : buildRelaxedConfig({ project, tsconfigRootDir });

    const eslintoptions: ESLint.Options = {
      cwd: '/', //without this, we risk "File ignored because outside of base path."
      overrideConfigFile: true, //needed or eslint will still look for an ondisk file
      overrideConfig: config,
      fix: options?.fix,
      allowInlineConfig: options?.allowinlineconfig,
      warnIgnored: true
    };

    const eslint = new ESLint(eslintoptions);
    for (const entry of entries) {
      const diskpath = entry.resourcepath.startsWith('direct::') ? entry.resourcepath.substring(8) : toFSPath(entry.resourcepath);
      const entryResults = await eslint.lintText(entry.contents ?? readFileSync(diskpath, 'utf8'), { filePath: diskpath });
      if (entryResults.length) {
        if (typeof entryResults[0].output === "string") {
          retval.fixes.push({ resourcename: entry.resourcepath, output: entryResults[0].output });
        }

        appendToArray(retval.messages, entryResults[0].messages.map((message) => ({
          line: message.line || 1,
          col: message.column || 1,
          //a simple JS parse error (eg Unexpected character '`'") will have ruleId null
          message: `${message.message} ${message.ruleId ? `(eslint rule: ${message.ruleId})` : "(eslint)"}`,
          type: message.severity === 2 ? "error" : "warning" as ValidationMessageType,
          source: "eslint",
          resourcename: entry.resourcepath
        })));
      }
    } //for every path in this module
  } //for every module (where we combine jssdk & builtin modules to one 'platform' module)
  return retval;
}
