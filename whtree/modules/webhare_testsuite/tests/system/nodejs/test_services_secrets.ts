import { loadlib } from "@webhare/harescript";
import { callHareScript, decryptForThisServer, encryptForThisServer } from "@webhare/services";
import { Money } from "@webhare/std";
import * as test from "@webhare/test";

declare module "@webhare/services" {
  interface ServerEncryptionScopes {
    "webhare_testsuite:string": string;
    "webhare_testsuite:data": {
      test: number;
      date: Date;
      money: Money;
    };
    "webhare_testsuite:simple": boolean | number | Date | null;
  }
}

async function testCryptForServer() {
  test.typeAssert<test.Assignable<number, 2>>();
  test.typeAssert<test.Equals<string, ReturnType<typeof decryptForThisServer < "webhare_testsuite:string" >>>>();

  // @ts-expect-error -- and not something else:
  test.typeAssert<test.Equals<boolean, ReturnType<typeof decryptForThisServer < "webhare_testsuite:string" >>>>();
  // @ts-expect-error -- and not something else:
  test.typeAssert<test.Equals<unknown, ReturnType<typeof decryptForThisServer < "webhare_testsuite:string" >>>>();

  // @ts-expect-error -- should fail because of incorrect type
  encryptForThisServer("webhare_testsuite:string", 16);

  const roundtrip1 = encryptForThisServer("webhare_testsuite:string", "Hello, world!");
  test.eq(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, roundtrip1);
  test.eq("Hello, world!", decryptForThisServer("webhare_testsuite:string", roundtrip1));
  test.throws(/unable to authenticate/, () => decryptForThisServer("webhare_testsuite:otherscope", roundtrip1), "invalid scope should fail decryption");

  //Test compatibility with Legacy HareScript
  test.eq("Hello, world!", await callHareScript("mod::system/lib/services.whlib#DecryptForThisServer", ["webhare_testsuite:string", roundtrip1]));

  const from_native_hs = await callHareScript("mod::system/lib/services.whlib#EncryptForThisServer", ["webhare_testsuite:string2", "Hallo, Wereld"]) as string;
  test.eq(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, from_native_hs);
  test.eq("Hallo, Wereld", decryptForThisServer("webhare_testsuite:string2", from_native_hs));

  //Test compatibility with WASM HareScript
  test.eq("Hello, world!", await loadlib("mod::system/lib/services.whlib").DecryptForThisServer("webhare_testsuite:string", roundtrip1));

  const from_wasm_hs = await loadlib("mod::system/lib/services.whlib").EncryptForThisServer("webhare_testsuite:string2", "Hallo, Wereld");
  test.eq(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, from_wasm_hs);
  test.eq("Hallo, Wereld", decryptForThisServer("webhare_testsuite:string2", from_wasm_hs));

  //crypt should support JSON-like data
  const testdata = { test: 42, date: new Date("2022-01-01"), money: new Money("42.42") };
  const roundtrip_js = encryptForThisServer("webhare_testsuite:data", testdata);
  test.eq(testdata, decryptForThisServer("webhare_testsuite:data", roundtrip_js));

  //test compatibility. now that primitives have been verified, dont bother with the legacy HareScript engine
  test.eq(testdata, await loadlib("mod::system/lib/services.whlib").DecryptForThisServer("webhare_testsuite:data", roundtrip_js));

  //test tricky strings that look like specific encoding but should still pass through
  for (const trickyString of ['test', '{"test"}', 'hson:"test"']) {
    const tricky_from_ts = encryptForThisServer("webhare_testsuite:tricky", trickyString);
    test.eq(trickyString, decryptForThisServer("webhare_testsuite:tricky", tricky_from_ts));
    test.eq(trickyString, await loadlib("mod::system/lib/services.whlib").DecryptForThisServer("webhare_testsuite:tricky", tricky_from_ts));

    const tricky_from_hs = await loadlib("mod::system/lib/services.whlib").EncryptForThisServer("webhare_testsuite:tricky", trickyString);
    test.eq(trickyString, decryptForThisServer("webhare_testsuite:tricky", tricky_from_hs));
    test.eq(trickyString, await loadlib("mod::system/lib/services.whlib").DecryptForThisServer("webhare_testsuite:tricky", tricky_from_hs));
  }

  //and ensure we support the simple things fully
  for (const simpleThing of [false, true, null, 42, 8.125, new Date("2023-01-01")]) {
    const simple_from_ts = encryptForThisServer("webhare_testsuite:simple", simpleThing);
    test.eq(simpleThing, decryptForThisServer("webhare_testsuite:simple", simple_from_ts));
    test.eq(simpleThing, await loadlib("mod::system/lib/services.whlib").DecryptForThisServer("webhare_testsuite:simple", simple_from_ts));

    const simple_from_hs = await loadlib("mod::system/lib/services.whlib").EncryptForThisServer("webhare_testsuite:simple", simpleThing);
    test.eq(simpleThing, decryptForThisServer("webhare_testsuite:simple", simple_from_hs));
    test.eq(simpleThing, await loadlib("mod::system/lib/services.whlib").DecryptForThisServer("webhare_testsuite:simple", simple_from_hs));
  }
}

test.run(
  [testCryptForServer]);
