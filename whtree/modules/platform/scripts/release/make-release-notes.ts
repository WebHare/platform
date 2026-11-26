// @webhare/cli: Merge release note fragments into the release notes

/* Release notes are added as separate fragment files (doc/release-notes/<major>.<minor>/*.md) so concurrent PRs don't
   conflict on GitHub, which ignores the union merge driver in .gitattributes. This script merges the fragments into
   doc/release-notes/<major>.<minor>.md. See .agents/skills/release-notes/SKILL.md for the format.
*/

import { CLIRuntimeError, runCli } from "@webhare/cli";
import { readReleaseNotes } from "@mod-platform/js/devsupport/release-notes";
import { existsSync, readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

/** Find the repository root (the directory containing doc/release-notes) from the current directory upwards */
function findRepositoryRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "doc/release-notes")) && existsSync(join(dir, "whtree/etc/platform.conf")))
      return dir;
    if (dirname(dir) === dir)
      throw new CLIRuntimeError("Run this command from inside a WebHare platform checkout");
  }
}

function getCurrentVersion(root: string): string {
  const match = readFileSync(join(root, "whtree/etc/platform.conf"), "utf-8").match(/^version=(\d+)\.(\d+)\./m);
  if (!match)
    throw new CLIRuntimeError("Cannot find the version in whtree/etc/platform.conf");
  return `${match[1]}.${match[2]}`;
}

runCli({
  description: "Merge the release note fragments in doc/release-notes/<version>/ into doc/release-notes/<version>.md. " +
    "Without --write, prints the merged release notes",
  flags: {
    "write": { description: "Update the release notes file and remove the merged fragments" },
  },
  arguments: [{ name: "[version]", description: "Minor version to merge, eg. 6.2. Defaults to the version being developed" }],
  async main({ args, opts }) {
    const root = findRepositoryRoot();
    const version = args.version ?? getCurrentVersion(root);
    if (!/^\d+\.\d+$/.test(version))
      throw new CLIRuntimeError(`Invalid version '${version}', expected <major>.<minor> (eg. 6.2)`);

    let notes;
    try {
      notes = await readReleaseNotes(join(root, "doc/release-notes"), version);
    } catch (e) {
      throw new CLIRuntimeError((e as Error).message);
    }
    if (!notes)
      throw new CLIRuntimeError(`No release notes or fragments for version '${version}'`);
    for (const warning of notes.warnings)
      console.error(`Warning: ${warning}`);

    if (!opts.write) {
      process.stdout.write(notes.text);
      return;
    }

    if (!notes.fragmentFiles.length) {
      console.log(`No release note fragments to merge into '${relative(root, notes.notesFile)}'`);
      return;
    }
    await writeFile(notes.notesFile, notes.text);
    for (const file of notes.fragmentFiles)
      await unlink(file);
    console.log(`Merged ${notes.fragmentFiles.length} fragment(s) into '${relative(root, notes.notesFile)}'`);
  }
});
