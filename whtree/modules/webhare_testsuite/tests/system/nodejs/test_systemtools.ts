import * as test from "@webhare/test";
import { storeDiskFile, listDirectory, deleteRecursive } from "@webhare/system-tools";
import { mkdtemp, stat } from 'node:fs/promises';
import * as path from "node:path";
import * as os from "node:os";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { Readable } from "node:stream";


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

  const modtime = (await stat(deepestfile)).mtime;
  await test.sleep((modtime.getTime() % 1000) === 0 ? 1000 : 1); //sleep 1 ms unless filesystem looks imprecise
  await storeDiskFile(deepestfile, "Deepest file", { overwrite: true, onlyIfChanged: true });
  test.eq(modtime, (await stat(deepestfile)).mtime);
  await storeDiskFile(deepestfile, "Deepest file!", { overwrite: true, onlyIfChanged: true });
  test.assert(modtime < (await stat(deepestfile)).mtime);

  const modtime2 = (await stat(deepestfile)).mtime;
  await test.sleep((modtime2.getTime() % 1000) === 0 ? 1000 : 1); //sleep 1 ms unless filesystem looks imprecise
  await storeDiskFile(deepestfile, "Deepest file!", { overwrite: true });
  test.assert(modtime2 < (await stat(deepestfile)).mtime);

  symlinkSync(path.join(tempdir, "subdir"), path.join(tempdir, "subdir", "backup"));

  const direntries = await listDirectory(tempdir, { recursive: true });
  test.eq("file", direntries.find(_ => _.fullPath === `${tempdir}/1.txt` && _.name === "1.txt")?.type);
  test.eq("directory", direntries.find(_ => _.name === "subdir")?.type);
  test.eq("symboliclink", direntries.find(_ => _.fullPath === `${tempdir}/subdir/backup` && _.name === "backup")?.type);
  test.eq("directory", direntries.find(_ => _.fullPath === `${tempdir}/subdir/deeper` && _.name === "deeper")?.type);
  test.eq("file", direntries.find(_ => _.fullPath === `${tempdir}/subdir/deeper/deepest.txt` && _.name === "deepest.txt")?.type);

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
