import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";


test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen('tests/layout.layouttest_panel_visibleon');
      await test.wait("ui");

      test.eq(false, test.canClick(tt.comp("panel1text").node));
      test.eq(false, test.canClick(tt.comp("panel1text2").node));

      tt.comp("showmode").setValue("showpanel1");

      test.eq(true, test.canClick(tt.comp("panel1text").node));
      test.eq(true, test.canClick(tt.comp("panel1text2").node));

      tt.comp("showmode").setValue("hidepanel1");

      test.eq(false, test.canClick(tt.comp("panel1text").node));
      test.eq(false, test.canClick(tt.comp("panel1text2").node));
    }
  ]);
