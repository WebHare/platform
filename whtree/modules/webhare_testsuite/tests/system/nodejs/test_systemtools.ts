import * as test from "@webhare/test";
import { storeDiskFile, storeTempFile, listDirectory, deleteRecursive } from "@webhare/system-tools";
import { chmod, mkdir, mkdtemp, rm, stat, utimes } from 'node:fs/promises';
import * as path from "node:path";
import * as os from "node:os";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { backendConfig } from "@webhare/services";

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

  const buf = new ArrayBuffer(6);
  new Uint8Array(buf).set("test 4".split("").map(c => c.charCodeAt(0)));
  await storeDiskFile(path.join(tempdir, "1.txt"), buf, { overwrite: true, inPlace: false });
  test.eq("test 4", readFileSync(path.join(tempdir, "1.txt"), 'utf8'));
  await storeDiskFile(path.join(tempdir, "1.txt"), new Uint8Array(buf), { overwrite: true, inPlace: false });
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

  //file modes, should not be affected by umask
  const oldUmask = process.umask(0o077);
  const modedir = await mkdtemp(path.join(os.tmpdir(), "test-storediskfile-mode-"));
  try {
    const getMode = async (file: string) => (await stat(file)).mode & 0o777;
    await storeDiskFile(path.join(modedir, "mode1.txt"), "mode 1", { mode: "600" });
    test.eq(0o600, await getMode(path.join(modedir, "mode1.txt")));
    await storeDiskFile(path.join(modedir, "mode1.txt"), "mode 1b", { mode: "0644", overwrite: true });
    test.eq(0o644, await getMode(path.join(modedir, "mode1.txt")));
    test.eq("mode 1b", readFileSync(path.join(modedir, "mode1.txt"), 'utf8'));
    await storeDiskFile(path.join(modedir, "mode1.txt"), "mode 1c", { mode: "640", overwrite: true, inPlace: true });
    test.eq(0o640, await getMode(path.join(modedir, "mode1.txt")));
    await storeDiskFile(path.join(modedir, "mode2.txt"), "mode 2", { mode: "400", inPlace: true });
    test.eq(0o400, await getMode(path.join(modedir, "mode2.txt")));
    test.eq("mode 2", readFileSync(path.join(modedir, "mode2.txt"), 'utf8'));
    await storeDiskFile(path.join(modedir, "mode3.txt"), Readable.from("mode 3"), { mode: "600" });
    test.eq(0o600, await getMode(path.join(modedir, "mode3.txt")));

    //onlyIfChanged should still fix the mode of an unchanged file, without touching it otherwise
    await storeDiskFile(path.join(modedir, "mode5.txt"), "mode 5", { mode: "644" });
    const mode5Time = await rewindAndGetModTime(path.join(modedir, "mode5.txt"));
    test.eq({ skipped: true }, await storeDiskFile(path.join(modedir, "mode5.txt"), "mode 5", { mode: "600", overwrite: true, onlyIfChanged: true }));
    test.eq(0o600, await getMode(path.join(modedir, "mode5.txt")));
    test.eq(mode5Time, (await stat(path.join(modedir, "mode5.txt"))).mtime);
    test.eq({ skipped: true }, await storeDiskFile(path.join(modedir, "mode5.txt"), "mode 5", { overwrite: true, onlyIfChanged: true }));
    test.eq(0o600, await getMode(path.join(modedir, "mode5.txt")), "mode should be left alone if not specified");

    for (const badMode of ["", "60", "800", "0x180", "rw-------", "12345"])
      await test.throws(/Invalid file mode/, storeDiskFile(path.join(modedir, "mode4.txt"), "bad", { mode: badMode }));
    test.assert(!existsSync(path.join(modedir, "mode4.txt")));
  } finally {
    process.umask(oldUmask);
    await rm(modedir, { recursive: true });
  }

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

  // non-overwrite with a stream that fails should not create the file after the function returns
  test.assert(!existsSync(path.join(tempdir, "3.txt")), "File should not exist before testing non-overwrite");
  await test.throws(/Test error/, () => storeDiskFile(path.join(tempdir, "3.txt"), new Readable({ read() { this.destroy(new Error("Test error")); } }), { overwrite: false }));
  test.assert(!existsSync(path.join(tempdir, "3.txt")), "File should not exist after failed write");

  // should error out when the file already exists with overwrite: false
  await storeDiskFile(path.join(tempdir, "3.txt"), "a", { overwrite: false });
  await test.throws(/file already exists/, storeDiskFile(path.join(tempdir, "3.txt"), "a", { overwrite: false }));
  await rm(path.join(tempdir, "3.txt"));

  symlinkSync(path.join(tempdir, "subdir"), path.join(tempdir, "subdir", "backup"));

  const direntries = await listDirectory(tempdir, { recursive: true });
  test.eq("file", direntries.find(_ => _.fullPath === `${tempdir}/1.txt` && _.name === "1.txt")?.type);
  test.eq("directory", direntries.find(_ => _.name === "subdir")?.type);
  test.eq("symboliclink", direntries.find(_ => _.fullPath === `${tempdir}/subdir/backup` && _.name === "backup")?.type);
  test.eq("directory", direntries.find(_ => _.fullPath === `${tempdir}/subdir/deeper` && _.name === "deeper")?.type);
  test.eq("file", direntries.find(_ => _.fullPath === `${tempdir}/subdir/deeper/deepest.txt` && _.name === "deepest.txt")?.type);
  test.eq("deepest.txt", direntries.find(_ => _.subPath === 'subdir/deeper/deepest.txt')?.name);

  const direntriesSkipDeeper = await listDirectory(tempdir, { recursive: true, skip: /^subdir$/ });
  test.eq("file", direntriesSkipDeeper.find(_ => _.fullPath === `${tempdir}/1.txt` && _.name === "1.txt")?.type);
  test.eq([], direntriesSkipDeeper.filter(_ => _.subPath.includes("subdir")));

  // "Regression" - fullPath didn't contain the exact basedir if eg. there were multiple slashes, breaking tricks taking fullPath.substring(basepath.length) - so now explicitly returning subPath
  const lastSlash = tempdir.lastIndexOf('/');
  const tripleSlashTempDir = tempdir.substring(0, lastSlash) + '//' + tempdir.substring(lastSlash);
  const tripleSlashEntries = await listDirectory(tripleSlashTempDir, { recursive: true });
  test.eq("deepest.txt", tripleSlashEntries.find(_ => _.subPath === 'subdir/deeper/deepest.txt')?.name);
  test.eq(direntries, tripleSlashEntries);

  // And now try with a relative basepath:
  const saveCWD = process.cwd();
  try {
    process.chdir(backendConfig.dataRoot + "config"); //in dataroot/config we surely should go up to find the temp dir..
    const relPath = path.relative(process.cwd(), tempdir);
    test.assert(relPath.startsWith("../"));
    const relativeSlashEntries = await listDirectory(relPath, { recursive: true });
    test.eq("deepest.txt", relativeSlashEntries.find(_ => _.subPath === 'subdir/deeper/deepest.txt')?.name);
    test.eq(direntries, relativeSlashEntries);
  } finally {
    process.chdir(saveCWD); //restore CWD
  }

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

async function testTempFile() {
  const tempdir = await mkdtemp(path.join(os.tmpdir(), "test-storetempfile-"));
  try {
    let savedPath = "";
    {
      await using tempFile = await storeTempFile("test.screens.yml", "temp 1", { dir: tempdir });
      savedPath = tempFile.path;
      test.eq(tempdir, path.dirname(tempFile.path));
      test.eq(/^test-[^.]+\.screens\.yml$/, path.basename(tempFile.path));
      test.eq("temp 1", readFileSync(tempFile.path, 'utf8'));
      test.eq(0o600, (await stat(tempFile.path)).mode & 0o777);
    }
    test.assert(!existsSync(savedPath), "should be removed by await using");

    { //sync dispose
      using tempFile = await storeTempFile("entity-15.yml", Buffer.from("temp 2"), { dir: tempdir, mode: "640" });
      savedPath = tempFile.path;
      test.eq(/^entity-15-[^.]+\.yml$/, path.basename(tempFile.path));
      test.eq(0o640, (await stat(tempFile.path)).mode & 0o777);
    }
    test.assert(!existsSync(savedPath), "should be removed by using");

    //explicit unlink, then dispose should not complain. Also verify a missing file doesn't throw
    {
      await using tempFile = await storeTempFile("noext", "temp 3", { dir: tempdir });
      test.eq(/^noext-[^.]+$/, path.basename(tempFile.path));
      await tempFile.unlink();
      test.assert(!existsSync(tempFile.path));
      await tempFile.unlink();
    }
    {
      await using tempFile = await storeTempFile(".env", "temp 4", { dir: tempdir });
      test.eq(/^\.env-[^.]+$/, path.basename(tempFile.path));
      await rm(tempFile.path);
    }

    //defaults to the system temp directory
    {
      await using tempFile = await storeTempFile("", "temp 5");
      test.eq(os.tmpdir(), path.dirname(tempFile.path));
      test.eq("temp 5", readFileSync(tempFile.path, 'utf8'));
      savedPath = tempFile.path;
    }
    test.assert(!existsSync(savedPath));

    //A failed removal should be retried on the next unlink or dispose. Root ignores directory permissions, so we can't test this as root
    if (process.getuid?.() !== 0) {
      const lockeddir = path.join(tempdir, "locked");
      await mkdir(lockeddir);
      const asyncFile = await storeTempFile("async.txt", "temp 6", { dir: lockeddir });
      const syncFile = await storeTempFile("sync.txt", "temp 7", { dir: lockeddir });
      await chmod(lockeddir, 0o500);
      try {
        await test.throws(/EACCES/, asyncFile.unlink());
        test.throws(/EACCES/, () => syncFile[Symbol.dispose]());
      } finally {
        await chmod(lockeddir, 0o700);
      }
      await asyncFile[Symbol.asyncDispose]();
      syncFile[Symbol.dispose]();
      test.eq([], await listDirectory(lockeddir));
      await rm(lockeddir, { recursive: true });
    }

    //moveTo moves the file to its final location, after which it's no longer removed
    {
      const finalPath = path.join(tempdir, "final.txt");
      {
        await using tempFile = await storeTempFile("final.txt", "final 1", { dir: tempdir });
        const origPath = tempFile.path;
        await tempFile.moveTo(finalPath);
        test.eq(finalPath, tempFile.path);
        test.assert(!existsSync(origPath));
        await test.throws(/already been removed or moved/, tempFile.moveTo(finalPath + ".2"));
        await tempFile.unlink(); //should not remove the moved file
      }
      test.eq("final 1", readFileSync(finalPath, 'utf8'));
      test.eq(0o600, (await stat(finalPath)).mode & 0o777);

      {
        await using tempFile = await storeTempFile("final.txt", "final 2", { dir: tempdir });
        await test.throws(/EEXIST/, tempFile.moveTo(finalPath));
        test.assert(existsSync(tempFile.path), "failed move should leave the temporary file");
        savedPath = tempFile.path;
      }
      test.assert(!existsSync(savedPath), "a temporary file that failed to move should still be removed");
      test.eq("final 1", readFileSync(finalPath, 'utf8'));

      {
        await using tempFile = await storeTempFile("final.txt", "final 3", { dir: tempdir });
        await tempFile.moveTo(finalPath, { overwrite: true });
      }
      test.eq("final 3", readFileSync(finalPath, 'utf8'));
      await rm(finalPath);
    }

    await test.throws(/should not contain a directory/, storeTempFile("sub/file.txt", "bad", { dir: tempdir }));
    await test.throws(/should not contain a directory/, storeTempFile("..", "bad", { dir: tempdir }));
    await test.throws(/Test error/, storeTempFile("failing.txt", new Readable({ read() { this.destroy(new Error("Test error")); } }), { dir: tempdir }));
    test.eq([], await listDirectory(tempdir), "no files should be left behind");
  } finally {
    await rm(tempdir, { recursive: true });
  }
}

async function testTempFileCleanup() {
  const tempdir = await mkdtemp(path.join(os.tmpdir(), "test-tempfilecleanup-"));
  try {
    const helper = path.join(__dirname, "data", "tempfile-signals.ts");
    const signalExitCodes: Record<string, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
    for (const how of ["SIGINT", "SIGTERM", "SIGHUP", "exit", "throw", "handled-sigint"]) {
      const result = spawnSync("wh", ["run", helper, tempdir, how], { encoding: "utf-8", stdio: ['ignore', 'pipe', 'pipe'] });
      const [tempPath, ...rest] = result.stdout.trim().split("\n");
      test.eq(tempdir, path.dirname(tempPath), `${how}: ${result.stderr}`);
      test.assert(!existsSync(tempPath), `${how}: temporary file should be removed`);

      if (how in signalExitCodes) //we should still have been terminated by the signal (wh may report it as an exit code)
        test.assert(result.signal === how || result.status === signalExitCodes[how], `${how}: unexpected status ${result.status} signal ${result.signal}`);
      else if (how === "exit")
        test.eq(3, result.status);
      else if (how === "throw")
        test.eq(/Uncaught test error/, result.stderr);
      else
        test.eq({ status: 0, rest: ["survived"] }, { status: result.status, rest });
      test.assert(!rest.includes("still alive"), `${how}: should have been terminated`);
    }

    //Handlers should only be installed while temporary files exist
    const baseline = process.listenerCount("SIGTERM"), baselineExit = process.listenerCount("exit");
    const file1 = await storeTempFile("handlers.txt", "1", { dir: tempdir });
    const file2 = await storeTempFile("handlers.txt", "2", { dir: tempdir });
    test.eq(baseline + 1, process.listenerCount("SIGTERM"));
    await file1.unlink();
    test.eq(baseline + 1, process.listenerCount("SIGTERM"));
    file2[Symbol.dispose]();
    test.eq(baseline, process.listenerCount("SIGTERM"));
    test.eq(0, process.listenerCount("exit") - baselineExit);
    const file3 = await storeTempFile("handlers.txt", "3", { dir: tempdir });
    test.eq(baseline + 1, process.listenerCount("SIGTERM"));
    await file3.moveTo(path.join(tempdir, "moved.txt"));
    test.eq(baseline, process.listenerCount("SIGTERM"), "moved files should no longer be tracked");
    await test.throws(/Test error/, storeTempFile("failing.txt", new Readable({ read() { this.destroy(new Error("Test error")); } }), { dir: tempdir }));
    test.eq(baseline, process.listenerCount("SIGTERM"));
  } finally {
    await rm(tempdir, { recursive: true });
  }
}

test.runTests([
  //Filesystem basics
  testFS,
  testTempFile,
  testTempFileCleanup
]);
