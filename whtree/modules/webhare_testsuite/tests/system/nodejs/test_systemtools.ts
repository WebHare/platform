import * as test from "@webhare/test";
import { storeDiskFile } from "@webhare/system-tools";
import { mkdtemp } from 'node:fs/promises';
import * as path from "node:path";
import * as os from "node:os";
import { readFileSync } from "node:fs";

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
}

test.run([
  //Filesystem basics
  testFS
]);
