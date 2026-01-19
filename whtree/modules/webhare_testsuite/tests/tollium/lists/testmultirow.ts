import * as test from '@mod-tollium/js/testframework';
import * as tt from "@mod-webhare_testsuite/js/tolliumtest-wts";

test.runTests(
  [
    "update sort",
    async function () {
      await tt.loadWTSTestScreen('tests/lists.multirow');

      const baselist = test.compByName("layout");
      const senderheader = test.qSA(baselist, '.listheader span').filter(span => span.textContent?.includes("Sender"))[0];
      test.click(senderheader);
      test.assert(senderheader.classList.contains("sortascending"), 'looks like sender column didnt get selected for sort');

      //Verify footer
      const normalrow = test.getCurrentScreen().getListRow('normal', /^SU45 .*/);
      const footerrow = test.getCurrentScreen().getListRow('normal', 'footer-subject');
      for (let i = 0; i < 4; ++i)
        test.eq(normalrow.childNodes[i].getBoundingClientRect().width,
          footerrow.childNodes[i].getBoundingClientRect().width, 'width of plain and footer cells should match in col #' + i);
    }
  ]);
