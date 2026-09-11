//still using internal names. not sure which parts we should publish
//this is currently a test of cleaning up tollium testframework

import * as test from "@webhare/test";
import * as tt from "@webhare/tollium-test";

async function testTTAPI() {
  await tt.launchScreen("mod::webhare_testsuite/screens/tests/tolliumtests.xml");

  test.assert(tt.comp("button") === tt.comp(":First button"));
  test.assert(tt.comp("textedit") === tt.comp(":First textedit"));
  test.assert(tt.comp("pulldown") === tt.comp(":First pulldown"));
  test.assert(tt.comp("text") === tt.comp(":Textfield"));
  test.eq("Opt 1", tt.comp("pulldown").getTextValue());
  test.eq("opt1", tt.comp("pulldown").getValue());
  tt.comp("pulldown").setValue("opt2");
  test.eq("Opt 2", tt.comp("pulldown").getTextValue());
  tt.comp("pulldown").setValue(":Opt 1");
  test.eq("opt1", tt.comp("pulldown").getValue());
  test.eq("Textvalue", tt.comp("text").getTextValue());
  test.eq("Textvalue", tt.comp("text").getValue());

  const api = tt.loadRemote<{
    add: (lhs: number, rhs: number) => number;
    setTextEdit: (newtext: string) => string;
  }>("mod::webhare_testsuite/screens/tests/tolliumtests.whlib");
  test.eq(42, await api.add(40, 2));
  test.eq("", await api.setTextEdit("Val 1"));
  test.eq("Val 1", await api.setTextEdit("Val 2"));
  test.eq("Val 2", tt.comp("textedit").getValue());
}

test.runTests(
  [
    "Basic tests",
    testTTAPI
  ]);
