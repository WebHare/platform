//still using internal names. not sure which parts we should publish
//this is currently a test of cleaning up tollium testframework

import * as test from "@webhare/test";
import * as tt from "@mod-tollium/js/tolliumtest";

async function testTTAPI() {
  await tt.launchScreen("mod::webhare_testsuite/screens/tests/tolliumtests.xml");

  test.assert(tt.comp("button") === tt.comp(":First button"));
  test.assert(tt.comp("textedit") === tt.comp(":First textedit"));
}

test.run(
  [
    "Basic tests",
    testTTAPI
  ]);
