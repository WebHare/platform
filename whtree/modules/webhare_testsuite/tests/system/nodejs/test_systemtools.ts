import * as test from "@webhare/test";
import { storeDiskFile, listDirectory, deleteRecursive } from "@webhare/system-tools";
import { mkdtemp, stat, utimes } from 'node:fs/promises';
import * as path from "node:path";
import * as os from "node:os";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { Readable } from "node:stream";

async function rewindAndGetModTime(file: string) {
  /* Just reading modtime and sleeping is unreliable because a FS may have only 1 second precision (eg overlayfs used in CI)
     AND linux is imprecise when reading/setting modtimes - reading mtime, sleeping for 1 sec, touching does not guarantee that
     the 2 modtimes are 1 second apart as many failed CI runs can attest  */
  const setDate = new Date(Date.now() - 5000);
  await utimes(file, setDate, setDate);
  return (await stat(file)).mtime;
}

async function testFS() {
  const tempdir = await mkdtemp(path.join(os.tmpdir(), "test-systemtools-"));

  await storeDiskFile(path.join(tempdir, "1.txt"), "test 1", { inPlace: false });
  test.eq("test 1", readFileSync(path.join(tempdir, "1.txt"), 'utf8'));

  await storeDiskFile(path.join(tempdir, "2.txt"), "test 2", { inPlace: true });
  test.eq("test 2", readFileSync(path.join(tempdir, "2.txt"), 'utf8'));

  await test.throws(/file already exists/, storeDiskFile(path.join(tempdir, "2.txt"), "test 3", { inPlace: false }));
  await test.throws(/file already exists/, storeDiskFile(path.join(tempdir, "2.txt"), "test 3", { inPlace: true }));
  test.eq("test 2", readFileSync(path.join(tempdir, "2.txt"), 'utf8'));

  await storeDiskFile(path.join(tempdir, "1.txt"), "test 4", { overwrite: true, inPlace: false });
  test.eq("test 4", readFileSync(path.join(tempdir, "1.txt"), 'utf8'));

  await storeDiskFile(path.join(tempdir, "1.txt"), "test 5", { overwrite: true, inPlace: true });
  test.eq("test 5", readFileSync(path.join(tempdir, "1.txt"), 'utf8'));

  await storeDiskFile(path.join(tempdir, "3".repeat(240) || ".txt"), "test 6", { inPlace: true });
  test.eq("test 6", readFileSync(path.join(tempdir, "3".repeat(240) || ".txt"), 'utf8'));

  await storeDiskFile(path.join(tempdir, "4".repeat(240) || ".txt"), "test 7", { inPlace: false });
  test.eq("test 7", readFileSync(path.join(tempdir, "4".repeat(240) || ".txt"), 'utf8'));

  await storeDiskFile(path.join(tempdir, "1.txt"), Buffer.from("test 8"), { overwrite: true });
  test.eq("test 8", readFileSync(path.join(tempdir, "1.txt"), 'utf8'));

  await storeDiskFile(path.join(tempdir, "1.txt"), Readable.from("test 9"), { overwrite: true });
  test.eq("test 9", readFileSync(path.join(tempdir, "1.txt"), 'utf8'));

  await storeDiskFile(path.join(tempdir, "1.txt"), Readable.toWeb(Readable.from("test 10")), { overwrite: true });
  test.eq("test 10", readFileSync(path.join(tempdir, "1.txt"), 'utf8'));

  await storeDiskFile(path.join(tempdir, "1.txt"), new Blob(["test 11"]), { overwrite: true });
  test.eq("test 11", readFileSync(path.join(tempdir, "1.txt"), 'utf8'));

  const deepestfile = path.join(tempdir, "subdir", "deeper", "deepest.txt");
  await storeDiskFile(deepestfile, "Deepest file", { mkdir: true });
  await storeDiskFile(path.join(tempdir, "subdir", "deeper", "deep2.txt"), "Deep file", { onlyIfChanged: true }); //verify it won't crash on non-existing files

  let modtime = await rewindAndGetModTime(deepestfile);
  test.eq({ skipped: true }, await storeDiskFile(deepestfile, "Deepest file", { overwrite: true, onlyIfChanged: true }));
  test.eq(modtime, (await stat(deepestfile)).mtime, "Should be unchanged (onlyIfChanged: true)");
  test.eq({ skipped: false }, await storeDiskFile(deepestfile, "Deepest file!", { overwrite: true, onlyIfChanged: true }));
  test.assert(modtime < (await stat(deepestfile)).mtime, "Should have been touched (onlyIfChanged: true, but actual changes!)");

  modtime = await rewindAndGetModTime(deepestfile);
  test.eq({ skipped: false }, await storeDiskFile(deepestfile, "Deepest file!", { overwrite: true }));
  test.assert(modtime < (await stat(deepestfile)).mtime, "Should have been touched (onlyIfChanged not set)");

  symlinkSync(path.join(tempdir, "subdir"), path.join(tempdir, "subdir", "backup"));

  const direntries = await listDirectory(tempdir, { recursive: true });
  test.eq("file", direntries.find(_ => _.fullPath === `${tempdir}/1.txt` && _.name === "1.txt")?.type);
  test.eq("directory", direntries.find(_ => _.name === "subdir")?.type);
  test.eq("symboliclink", direntries.find(_ => _.fullPath === `${tempdir}/subdir/backup` && _.name === "backup")?.type);
  test.eq("directory", direntries.find(_ => _.fullPath === `${tempdir}/subdir/deeper` && _.name === "deeper")?.type);
  test.eq("file", direntries.find(_ => _.fullPath === `${tempdir}/subdir/deeper/deepest.txt` && _.name === "deepest.txt")?.type);
  test.eq("deepest.txt", direntries.find(_ => _.subPath === 'subdir/deeper/deepest.txt')?.name);

  // "Regression" - fullPath didn't contain the exact basedir if eg. there were multiple slahses, breaking tricks taking fullPath.substring(basepath.length) - so now explicitly returning subPath
  const lastSlash = tempdir.lastIndexOf('/');
  const tripleSlashTempDir = tempdir.substring(0, lastSlash) + '//' + tempdir.substring(lastSlash);
  const tripleSlashEntries = await listDirectory(tripleSlashTempDir, { recursive: true });
  test.eq("deepest.txt", tripleSlashEntries.find(_ => _.subPath === 'subdir/deeper/deepest.txt')?.name);
  test.eq(direntries, tripleSlashEntries);

  // And now try with a relative basepath:
  const relPath = path.relative(process.cwd(), tempdir);
  test.assert(relPath.startsWith("../"));
  const relativeSlashEntries = await listDirectory(relPath, { recursive: true });
  test.eq("deepest.txt", relativeSlashEntries.find(_ => _.subPath === 'subdir/deeper/deepest.txt')?.name);
  test.eq(direntries, relativeSlashEntries);

  const direntries_txt = await listDirectory(tempdir, { recursive: true, mask: "*.txt" });
  test.eq(4, direntries_txt.length);

  const direntries_deep = await listDirectory(tempdir, { recursive: true, mask: /deep/ });
  test.eq(new Set(["deeper", "deepest.txt", "deep2.txt"]), new Set(direntries_deep.map(_ => _.name)));

  const should_disappear = [path.join(tempdir, "subdir", "deeper", "deepest.txt"), path.join(tempdir, "subdir", "backup")];
  should_disappear.forEach(p => test.assert(existsSync(p), `${p} should exist for now...`));

  test.eq(false, await deleteRecursive(tempdir, { keep: _ => _.name === "deep2.txt" }));
  test.assert(existsSync(path.join(tempdir, "subdir", "deeper", "deep2.txt")));
  should_disappear.forEach(p => test.assert(!existsSync(p), `${p} should be gone now...`));

  test.eq(true, await deleteRecursive(tempdir));
  test.assert(existsSync(path.join(tempdir)));

  /* Directory structure syncers (which is what readDirRecursive and deleteRecursive are actually about) often don't care about missing files. */
  await test.throws(/no such.*directory/, listDirectory(path.join(tempdir, "nonexistent")));
  await test.throws(/no such.*directory/, deleteRecursive(path.join(tempdir, "nonexistent")));
  test.eq([], await listDirectory(path.join(tempdir, "nonexistent"), { allowMissing: true }));
  test.eq(true, await deleteRecursive(path.join(tempdir, "nonexistent"), { allowMissing: true, deleteSelf: true }));

  test.eq(true, await deleteRecursive(tempdir, { deleteSelf: true }));
  test.assert(!existsSync(path.join(tempdir)));
}

test.runTests([
  //Filesystem basics
  testFS
]);
