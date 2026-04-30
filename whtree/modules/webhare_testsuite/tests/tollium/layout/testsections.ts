import * as test from "@webhare/test-frontend";
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";
import { getRelativeBounds } from "@webhare/dompack";

test.runTests([
  async function () {
    await tt.loadWTSTestScreen('tests/layout.layouttest,sections');

    const s1 = tt.comp("section1");
    const s2 = tt.comp("section2");
    const s3 = tt.comp("section3");
    test.eq(tt.metrics.gridRowHeight, getRelativeBounds(s2.node, s1.node).top, "Height should match with S1 being closed (currently the row height of 28)");
    test.eq(tt.metrics.gridRowHeight, getRelativeBounds(s3.node, s2.node).top, "Height should match with S2 being closed (currently the row height of 28)");
    test.eq(false, s1.querySelector("details")?.open);
    test.eq(false, s2.querySelector("details")?.open);
    test.eq(true, s3.querySelector("details")?.open);

    //elements such as textedit,textarea should have the same width inside and outside of sections
    test.click(s2.querySelector("summary")!);
    test.eq(tt.comp("outside_textedit").node.getBoundingClientRect().width, tt.comp("s2_textedit").node.getBoundingClientRect().width, "Textedit inside section should match width outside");
    test.eq(tt.comp("outside_textarea").node.getBoundingClientRect().width, tt.comp("s2_textarea").node.getBoundingClientRect().width, "Textarea inside section should match width outside");
  }
]);
