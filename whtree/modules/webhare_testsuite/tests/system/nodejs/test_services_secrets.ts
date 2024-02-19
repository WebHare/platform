import { loadlib } from "@webhare/harescript";
import { callHareScript, decryptForThisServer, encryptForThisServer } from "@webhare/services";
import * as test from "@webhare/test";

async function testCryptForServer() {
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
}

test.run(
  [testCryptForServer]);
