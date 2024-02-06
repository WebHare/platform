import { createVM } from "@webhare/harescript";
import * as test from "@webhare/test";
import { toFSPath } from "@webhare/services";
import { storeDiskFile } from "@webhare/system-tools/src/fs";
import { sleep } from "@webhare/std";

async function testCacheBasics() {
  const whlib_data = `<?wh
LOADLIB "wh::adhoccache.whlib";
LOADLIB "wh::os.whlib";

INTEGER toreturn := 24742;
RECORD FUNCTION GetCacheabletInfiniteDAta() { toreturn := toreturn + 1; RETURN [ value := toreturn, eventmasks := ["webhare_testsuite:unlikeltyevent" ] ]; }
PUBLIC INTEGER FUNCTION GetInfiniteDAta() { RETURN GetAdhocCached([ type := 'GetCacheabletInfiniteDAta' ], PTR GetCacheabletInfiniteDAta); }
`;

  const resource = "mod::webhare_testsuite/web/tests/temp/basictest.whlib";

  await storeDiskFile(toFSPath(resource), whlib_data, { overwrite: true });
  {
    using vm = await createVM();
    test.eq(24743, await vm.loadlib(resource).GetInfiniteData());
    await sleep(50);
    //NOTE this doesn't really crash unfortunately but it produces a lot of 'TimeoutOverflowWarning: 8638292777098454 does not fit into a 32-bit signed integer.' noise if the fix isn't there
    test.eq(24743, await vm.loadlib(resource).GetInfiniteData());
  }
}

async function testInvalidationByLibraryUpdate() {

  const whlib_data = `<?wh
LOADLIB "wh::adhoccache.whlib";
LOADLIB "wh::os.whlib";

RECORD params := DecodeJSON((GetConsoleArguments() ?? ["{}"])[0]);

STRING postfix;
PUBLIC STRING FUNCTION GetCachedData() { RETURN GetAdhocCached([ type := 1 ], PTR GetData) || postfix; }
RECORD FUNCTION GetData() { RETURN [ ttl := 60 * 1000, value := params.value ]; }
`;

  const whlib_data2 = whlib_data + "postfix := '-whlib_data';\n";

  const resource = "mod::webhare_testsuite/web/tests/temp/invalidationtest.whlib";

  await storeDiskFile(toFSPath(resource), whlib_data, { overwrite: true });
  {
    using vm = await createVM({
      consoleArguments: [`{ "value": "1" }`],
    });
    test.eq("1", await vm.loadlib(resource).GetCachedData());
  }

  {
    using vm = await createVM({
      consoleArguments: [`{ "value": "2" }`],
    });
    test.eq("1", await vm.loadlib(resource).GetCachedData());
  }

  await storeDiskFile(toFSPath(resource), whlib_data2, { overwrite: true });
  const replaced = Date.now();

  // wait max 3 seconds for the change to be picked up
  for (; ;) {
    const start = Date.now();
    using vm = await createVM({
      consoleArguments: [`{ "value": "3" }`],
    });
    const data = await vm.loadlib(resource).GetCachedData();

    // Test for 3 seconds
    if (data === "1" && replaced + 3000 > start) {
      await test.sleep(100);
      continue;
    }
    // 1-: did not pick up file update in adhoccache
    test.eq("3-whlib_data", data);
    break;
  }
}

test.run([
  testCacheBasics,
  testInvalidationByLibraryUpdate
]);
