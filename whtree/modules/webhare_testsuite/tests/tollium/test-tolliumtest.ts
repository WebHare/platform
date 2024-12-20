//still using internal names. not sure which parts we should publish
//this is currently a test of cleaning up tollium testframework

import * as test from "@webhare/test";
import * as tt from "@mod-tollium/js/tolliumtest";

async function testTTAPI() {
  await tt.launchScreen("mod::webhare_testsuite/screens/tests/tolliumtests.xml");

  test.assert(tt.comp("button") === tt.comp(":First button"));
  test.assert(tt.comp("textedit") === tt.comp(":First textedit"));
  test.assert(tt.comp("pulldown") === tt.comp(":First pulldown"));
  test.eq("Opt 1", tt.comp("pulldown").getTextValue());
  test.eq("opt1", tt.comp("pulldown").getValue());
  tt.comp("pulldown").set("opt2");
  test.eq("Opt 2", tt.comp("pulldown").getTextValue());
  tt.comp("pulldown").set(":Opt 1");
  test.eq("opt1", tt.comp("pulldown").getValue());
}

test.runTests(
  [
    "Basic tests",
    testTTAPI
  ]);
