import * as test from "@webhare/test-backend";
import { anonymizeIPAddress } from "@mod-platform/js/logging/parsersupport.ts";

async function testBasicAPIs() {
  test.eq("12.214.31.0", anonymizeIPAddress("12.214.31.144"));
  test.eq("2001:67c:2564::", anonymizeIPAddress("2001:67c:2564:a102::1:1"));
  test.eq("2001:67c:2564::", anonymizeIPAddress("2001:67c:2564:a102:1:2:3:4"));
}

test.run([
  testBasicAPIs,
]);
