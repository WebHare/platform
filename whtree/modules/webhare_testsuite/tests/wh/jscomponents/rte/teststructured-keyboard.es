import * as dompack from "dompack";
import * as browser from "dompack/extra/browser";
import * as test from "@mod-tollium/js/testframework";
import * as rtetest from "@mod-tollium/js/testframework-rte";
import * as domlevel from "@mod-tollium/web/ui/components/richeditor/internal/domlevel";
import * as richdebug from "@mod-tollium/web/ui/components/richeditor/internal/richdebug";
import Range from '@mod-tollium/web/ui/components/richeditor/internal/dom/range';


test.registerTests(
  [ async function()
    {
      await test.load('/.webhare_testsuite/tests/pages/rte/?editor=structured');
      const driver = new rtetest.RTEDriver();
      driver.setSelection(driver.rte.qS("body h1").firstChild,1); //set inside first H1

      let stylepulldown = driver.rte.toolbarnode.querySelector(".wh-rtd__toolbarstyle");
      test.eq("HEADING1", stylepulldown.value);

      driver.rte.takeFocus();
      let keycombo = navigator.platform == "MacIntel" ? { metaKey: true, altKey: true } : { ctrlKey: true, altKey: true};

      await test.pressKey("2", keycombo); //FIXME other keys on windows?
      await test.sleep(1);
      test.eq("HEADING2", stylepulldown.value);

      await test.pressKey("2", keycombo); //FIXME other keys on windows?
      await test.sleep(1);
      test.eq("HEADING2B", stylepulldown.value);

      await test.pressKey("1", keycombo); //FIXME other keys on windows?
      await test.sleep(1);
      test.eq("HEADING1", stylepulldown.value);

      await test.pressKey("0", keycombo); //FIXME other keys on windows?
      await test.sleep(1);
      test.eq("CONTENTTAB", stylepulldown.value); //we select this one as it's on top!

      await test.pressKey("0", keycombo); //FIXME other keys on windows?
      await test.sleep(1);
      test.eq("NORMAL", stylepulldown.value); //we select this one as it's on top!
    }

  ]);
