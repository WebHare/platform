import { logValidationResultToConsole } from "@mod-platform/js/cli/output";
import type { ValidationResult } from "@mod-platform/js/devsupport/validation";
import { parseSchema } from "@webhare/wrd/src/schemaparser";
import { run } from "@webhare/cli";
import { loadlib } from "@webhare/harescript";
import { backendConfig, toResourcePath } from "@webhare/services";
import path from "path";

run({
  description: "Validate a WebHare resourrce",
  flags: {
    "tids": "Show tids",
    "parsed": "Show parse result",
  },
  arguments: [{ name: "<files...>", description: "Files to validate" }],
  main: async function main({ opts, args }) {
    const jssdk = `${backendConfig.installationRoot}jssdk/`;
    let anyErrors = false;

    for (let file of args.files) {
      if (!path.isAbsolute(file) && !file.includes("::"))
        file = path.resolve(process.cwd(), file);

      const resname = file.startsWith(jssdk) ? `direct::${file}` : toResourcePath(file, { keepUnmatched: true });
      const result = await loadlib("mod::system/lib/validation.whlib").ValidateSingleFileAdHoc(resname) as ValidationResult;
      if (result.errors.length)
        anyErrors = true;

      if (opts.parsed) {
        if (result.errors.length) {
          console.error("Cannot show parsed version, fix errors first");
        } else if (file.endsWith(".wrdschema.xml")) {
          //FIXME this is just equivalent of 'wh wrd parse-schema' -- what we really want is a parse *without* merging imports
          console.log(JSON.stringify(await parseSchema(toResourcePath(file, { keepUnmatched: true }), true, null), null, 2));
          continue;
        } else {
          console.log("Parsed result not available for this file type");
          continue;
        }
      }

      logValidationResultToConsole(result);

      if (opts.tids)
        console.table(result.tids);
    }

    return anyErrors ? 1 : 0;
  }
});
