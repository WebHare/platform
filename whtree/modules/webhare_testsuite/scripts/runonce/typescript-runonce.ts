import * as services from "@webhare/services";
import { extendWorkToCoHSVM, getCoHSVM } from "@webhare/services/src/co-hsvm";
import * as whdb from "@webhare/whdb";

services.ready().then(async () => {
  const vm = await getCoHSVM();
  await whdb.beginWork();
  await extendWorkToCoHSVM();
  await vm.loadlib("mod::system/lib/configure.whlib").writeRegistryKey("webhare_testsuite.tests.runoncetest", "TS RUNONCE!");
  await whdb.commitWork();
});
