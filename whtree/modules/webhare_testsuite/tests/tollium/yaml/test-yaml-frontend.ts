/* The YAML screens use some alternative paths, eg for enabledOn conditions. so we may also need to test things in the frond */

import * as test from "@webhare/test-frontend";
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

async function testConditions() {
  await tt.loadYamlScreen("conditions");

  test.eq("showtime-init, color-init, showtime-set", tt.comp(":Events").getTextValue());

  test.eq(true, tt.comp("cbTextEdit").getValue());
  test.eq(false, tt.comp("controlledTextEdit").querySelector("input")?.readOnly);

  test.click(tt.comp("cBox").node);
  await test.waitForUI();
  test.eq("showtime-init, color-init, showtime-set, showtime-set", tt.comp(":Events").getTextValue());
}

test.run([testConditions]);
