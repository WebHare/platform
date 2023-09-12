import { loadlib } from "@webhare/harescript";
import * as whdb from "@webhare/whdb";

async function main() {
  await whdb.beginWork();
  await loadlib("mod::system/lib/configure.whlib").writeRegistryKey("webhare_testsuite.tests.runoncetest", "TS RUNONCE!");
  await whdb.commitWork();
}

main();
