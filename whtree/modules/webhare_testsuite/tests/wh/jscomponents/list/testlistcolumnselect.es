import * as test from "@mod-tollium/js/testframework";

test.registerTests(
  [ async function()
    {
      await test.load(test.getTestSiteRoot() + 'testpages/listtest/?selectmode=single&columnselectmode=single');

      test.true(test.qS("#listview.wh-ui-listview--columnselect"));

      test.click(test.getListViewRow('Rij #1.').childNodes[0]);
      test.eq(0, test.qSA(".wh-list__row--selected").length);
      test.eq(1, test.qSA(".wh-list__cell--selected").length);
      test.true(test.getListViewRow('Rij #1.').childNodes[0].classList.contains("wh-list__cell--selected"));

      test.click(test.getListViewRow('Rij #1.').childNodes[1]);
      test.eq(1, test.qSA(".wh-list__cell--selected").length);
      test.true(test.getListViewRow('Rij #1.').childNodes[1].classList.contains("wh-list__cell--selected"));

      test.click(test.getListViewRow('Rij #2.').childNodes[1]);
      test.false(test.getListViewRow('Rij #2.').classList.contains("wh-list__row--selected"));
      test.false(test.getListViewRow('Rij #2.').childNodes[0].classList.contains("wh-list__cell--selected"));
      test.true(test.getListViewRow('Rij #2.').childNodes[1].classList.contains("wh-list__cell--selected"));

    }

  , "Test column select combined with multiple select mode"
  , async function()
    {
      test.fill('#selectmode', 'multiple');

      test.click(test.getListViewRow('Rij #1.').childNodes[0]);
      test.eq(0, test.qSA(".wh-list__row--selected").length);
      test.eq(1, test.qSA(".wh-list__cell--selected").length);
      test.true(test.getListViewRow('Rij #1.').childNodes[0].classList.contains("wh-list__cell--selected"));

      test.click(test.getListViewRow('Rij #2.').childNodes[1], { cmd: true});
      test.eq(0, test.qSA(".wh-list__row--selected").length);
      test.eq(2, test.qSA(".wh-list__cell--selected").length);
      test.true(test.getListViewRow('Rij #1.').childNodes[1].classList.contains("wh-list__cell--selected"));
      test.true(test.getListViewRow('Rij #2.').childNodes[1].classList.contains("wh-list__cell--selected"));
    }
  ]);
