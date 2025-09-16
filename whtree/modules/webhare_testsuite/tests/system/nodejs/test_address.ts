/*
To test for the backend (faster!):
wh runtest system.nodejs.test_address_backend

In the browser:
wh runtest system.nodejs.test_address_frontend
*/

import * as test from "@webhare/test";
import { joinHouseNumber, splitHouseNumber } from "@webhare/address";

function testAddress() {
  test.eq({ bareNumber: 13, suffix: "6" }, splitHouseNumber("13 6"));
  test.eq({ bareNumber: 13, suffix: "" }, splitHouseNumber("13"));
  test.eq({ bareNumber: 13, suffix: "-6" }, splitHouseNumber("13-6"));

  test.eq("13-6", joinHouseNumber(13, "-6"));
  test.eq("13 6", joinHouseNumber(13, "6"));
  test.eq("13a", joinHouseNumber(13, "a"));
  test.eq("13a", joinHouseNumber(13, " a"));
}


test.runTests([
  "@webhare/address",
  testAddress,
]);
