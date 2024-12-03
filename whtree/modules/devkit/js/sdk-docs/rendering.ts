import * as TypeDoc from "typedoc";

import { program } from 'commander';
import { mkdir, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import { deleteRecursive } from "@webhare/system-tools/src/fs";

export async function renderDocsProject(docsDir: string, app: TypeDoc.Application, project: TypeDoc.Models.ProjectReflection) {
  const buildDocsDir = join(docsDir, "..", basename(docsDir) + ".new");
  const backupDir = join(docsDir, "..", basename(docsDir) + ".bak");
  await mkdir(buildDocsDir, { recursive: true });
  await deleteRecursive(backupDir, { allowMissing: true });

  console.log("Generating doc update for", docsDir);

  if (project.children)
    for (const lib of project.children) {
      // Replace library names "forms/src/forms" with "@webhare/forms"
      const firstpart = lib.name.split('/')[0];
      lib.name = `@webhare/${firstpart}`;

      // get rid of 'defined in:' lines on the library page. noone cares @webhare/deps is defined on line 1 of webhare/deps
      lib.sources = [];
    }

  // Rendered docs
  await app.generateDocs(project, buildDocsDir);
  // Alternatively generate JSON output. Doesn't seem that useful yet, we're not intending to rebuild the docs from scratch?
  if (program.opts().json)
    await app.generateJson(project, buildDocsDir + "/documentation.json");

  try {
    await rename(docsDir, backupDir);
  } catch { } //ignoring, perhaps docsDir didn't exist yet

  await rename(buildDocsDir, docsDir);
  await deleteRecursive(backupDir, { allowMissing: true });
}
