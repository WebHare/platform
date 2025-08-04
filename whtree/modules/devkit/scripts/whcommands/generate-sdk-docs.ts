/*
watch mode: wh devkit:generate-sdk-docs -w
*/

import type * as TypeDoc from "typedoc";

import { uploadGeneratedDocumentation } from "@mod-devkit/js/sdk-docs/upload";
import { renderDocsProject } from "@mod-devkit/js/sdk-docs/rendering";
import { setupDocGenerator } from "@mod-devkit/js/sdk-docs/generate";
import { toFSPath } from "@webhare/services";
import { join } from "path";
import { run } from "@webhare/cli";

async function renderProject(app: TypeDoc.Application, project: TypeDoc.Models.ProjectReflection, { ci = false, upload = false, json = false } = {}) {
  let docsDir = toFSPath("storage::devkit/sdk-docs");
  if (ci && process.env.TESTFW_OUTDIR) { //running in CI mode - output to TESTFW_OUTDIR if its set
    docsDir = join(process.env.TESTFW_OUTDIR, "sdk-docs");
  }
  await renderDocsProject(docsDir, app, project, json);
  if (upload)
    await uploadGeneratedDocumentation(docsDir);
}

run({
  flags: {
    "w,watch": { description: "Watch docs" },
    "json": { description: " Add JSON data" },
    "upload": { description: "Upload after generating" },
    "ci": { description: "Run in CI mode" },
  },
  main: async ({ opts }) => {
    const app = await setupDocGenerator();

    console.log(`Using TypeScript ${app.getTypeScriptVersion()} in ${app.getTypeScriptPath()}`);

    if (opts.watch) {
      await app.convertAndWatch(p => renderProject(app, p, opts));
    } else {
      const project = await app.convert();
      if (!project)
        return 1;

      await renderProject(app, project, opts);
      return app.logger.warningCount === 0 && app.logger.errorCount === 0 ? 0 : 1;
    }

    return 0;
  }
});
