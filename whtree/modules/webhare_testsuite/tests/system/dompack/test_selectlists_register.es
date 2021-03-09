import * as test from "@mod-system/js/wh/testframework";
import * as testhelpers from './testhelpers.es';

test.registerTests(
[ "Pulldown seqnr/registerMissed test"
, async function()
  {
    await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=pulldown&addseqnr=1');
  }

, async function()
  {
    let alwaysopendown_replacement = test.qS('#alwaysopendown').nextSibling;
    test.eq("Should always open down req#1 (current)", alwaysopendown_replacement.querySelector(".selectlist__current").textContent);

    test.click(alwaysopendown_replacement);

    let visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq("One req#1 (item)", visibleitems[0].textContent);
    test.click(visibleitems[0]);

    test.eq("One req#1 (current)", alwaysopendown_replacement.querySelector(".selectlist__current").textContent, 'item should have been updated');

    test.click(alwaysopendown_replacement);
    visibleitems = testhelpers.getSelectListVisibleItems();
    test.eq("One req#1 (item)", visibleitems[0].textContent);

    test.click(visibleitems[0]);

    test.eq("One req#1 (current)", alwaysopendown_replacement.querySelector(".selectlist__current").textContent, 'reclick should not reupdate item');

  }
]);
