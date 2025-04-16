import { writeRegistryKey } from "@webhare/services";
import * as whdb from "@webhare/whdb";

async function main() {
  await whdb.beginWork();
  await writeRegistryKey("webhare_testsuite.tests.runoncetest", "TS RUNONCE!");
  await whdb.commitWork();
}

void main();
