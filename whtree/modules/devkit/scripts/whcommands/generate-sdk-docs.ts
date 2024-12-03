/*
watch mode: wh devkit:generate-docs -w
*/

import * as TypeDoc from "typedoc";

import { program } from 'commander';
import { uploadGeneratedDocumentation } from "@mod-devkit/js/sdk-docs/upload";
import { renderDocsProject } from "@mod-devkit/js/sdk-docs/rendering";
import { setupDocGenerator } from "@mod-devkit/js/sdk-docs/generate";
import { toFSPath } from "@webhare/services";
import { join } from "path";

program
  .name('generate-sdk-docs')
  .option('-w --watch', 'Watch docs')
  .option('--json', 'Add JSON data')
  .option('--upload', 'Upload after generating')
  .option('--ci', 'Run in CI mode')
  .parse();

async function renderProject(app: TypeDoc.Application, project: TypeDoc.Models.ProjectReflection) {
  let docsDir = toFSPath("storage::devkit/sdk-docs");
  if (program.opts().ci && process.env.TESTFW_OUTDIR) { //running in CI mode - output to TESTFW_OUTDIR if its set
    docsDir = join(process.env.TESTFW_OUTDIR, "sdk-docs");
  }
  await renderDocsProject(docsDir, app, project);
  if (program.opts().upload)
    await uploadGeneratedDocumentation(docsDir);
}

async function main() {
  const app = await setupDocGenerator();

  console.log(`Using TypeScript ${app.getTypeScriptVersion()} in ${app.getTypeScriptPath()}`);

  if (program.opts().watch) {
    await app.convertAndWatch(p => renderProject(app, p));
  } else {
    const project = await app.convert();
    if (project)
      await renderProject(app, project);
    else
      process.exit(1);
  }
}

main().catch(console.error);
