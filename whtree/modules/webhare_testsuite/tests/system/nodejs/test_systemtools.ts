import * as test from "@webhare/test";
import { storeDiskFile, readDirRecursive, deleteRecursive } from "@webhare/system-tools";
import { mkdtemp } from 'node:fs/promises';
import * as path from "node:path";
import * as os from "node:os";
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";

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

  mkdirSync(path.join(tempdir, "subdir"));
  mkdirSync(path.join(tempdir, "subdir", "deeper"));
  await storeDiskFile(path.join(tempdir, "subdir", "deeper", "deepest.txt"), "Deepest file");
  await storeDiskFile(path.join(tempdir, "subdir", "deeper", "deep2.txt"), "Deep file");

  symlinkSync(path.join(tempdir, "subdir"), path.join(tempdir, "subdir", "backup"));

  const direntries = await readDirRecursive(tempdir);

  test.assert(direntries.find(_ => _.path === tempdir && _.name == "1.txt")?.isFile());
  test.assert(direntries.find(_ => _.path === tempdir && _.name == "subdir")?.isDirectory());
  test.assert(!direntries.find(_ => _.path === path.join(tempdir, "subdir") && _.name == "backup")?.isDirectory());
  test.assert(direntries.find(_ => _.path === path.join(tempdir, "subdir") && _.name == "backup")?.isSymbolicLink());
  test.assert(direntries.find(_ => _.path === path.join(tempdir, "subdir") && _.name == "deeper")?.isDirectory());
  test.assert(direntries.find(_ => _.path === path.join(tempdir, "subdir", "deeper") && _.name == "deepest.txt")?.isFile());

  const should_disappear = [path.join(tempdir, "subdir", "deeper", "deepest.txt"), path.join(tempdir, "subdir", "backup")];
  should_disappear.forEach(p => test.assert(existsSync(p), `${p} should exist for now...`));

  test.eq(false, await deleteRecursive(tempdir, { keep: _ => _.name == "deep2.txt" }));
  test.assert(existsSync(path.join(tempdir, "subdir", "deeper", "deep2.txt")));
  should_disappear.forEach(p => test.assert(!existsSync(p), `${p} should be gone now...`));

  test.eq(true, await deleteRecursive(tempdir));
  test.assert(existsSync(path.join(tempdir)));

  /* Directory structure syncers (which is what readDirRecursive and deleteRecursive are actually about) often don't care about missing files. */
  await test.throws(/no such.*directory/, readDirRecursive(path.join(tempdir, "nonexistent")));
  await test.throws(/no such.*directory/, deleteRecursive(path.join(tempdir, "nonexistent")));
  test.eq([], await readDirRecursive(path.join(tempdir, "nonexistent"), { allowMissing: true }));
  test.eq(true, await deleteRecursive(path.join(tempdir, "nonexistent"), { allowMissing: true, deleteSelf: true }));

  test.eq(true, await deleteRecursive(tempdir, { deleteSelf: true }));
  test.assert(!existsSync(path.join(tempdir)));
}

test.run([
  //Filesystem basics
  testFS
]);
