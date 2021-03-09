import * as test from "@mod-system/js/wh/testframework";
import * as testhelpers from './testhelpers.es';

test.registerTests(
  [ "Autosuggest test"
  , async function()
    {
      await test.load('/.webhare_testsuite/tests/pages/dompack/?testpage=autosuggest&addseqnr=1');

      test.eq(false, test.qS('#alwaysopendown').classList.contains("selectlist--autosuggesting"));
      test.fill(test.qS('#alwaysopendown'), 'test');
      test.eq(true, test.qS('#alwaysopendown').classList.contains("selectlist--autosuggesting"));

      await test.waitUIFree();
      test.eq(false, test.qS('#alwaysopendown').classList.contains("selectlist--autosuggesting"));

      let items = testhelpers.getSelectListVisibleItems();
      test.eq(11, items.length);
      test.eq('test1', items[0].textContent);

      test.fill(test.qS('#alwaysopendown'), 'test5');
      test.eq(true, test.qS('#alwaysopendown').classList.contains("selectlist--autosuggesting"));
      await test.waitUIFree();

      items = testhelpers.getSelectListVisibleItems();
      test.eq(11, items.length);
      test.eq('test51', items[0].textContent);
      test.eq(false, test.qS('#alwaysopendown').classList.contains("selectlist--autosuggesting"));

      await test.pressKey('-');
      await test.waitUIFree();
      items = testhelpers.getSelectListVisibleItems();
      test.eq(0, items.length, "List should have closed after no more matches");

      await test.pressKey('Backspace');
      await test.waitUIFree();
      items = testhelpers.getSelectListVisibleItems();
      test.eq(11, items.length, "Backspace should have brought the list back");

      test.click(items[3]);
      test.eq(true, test.qS('#alwaysopendown').classList.contains("selectlist--autosuggesting"));
      test.eq('test54', test.qS('#alwaysopendown').value);
      items = testhelpers.getSelectListVisibleItems();
      test.eq(0, items.length, "List should have closed after auto suggest");
    }

  , "Test disabled & readonly"
  , async function ()
    {
      test.click(test.qS('#disabledlist'));
      test.eq(false, test.qS('#disabledlist').classList.contains("selectlist--autosuggesting"));
      test.click(test.qS('#readonlylist'));
      test.eq(false, test.qS('#readonlylist').classList.contains("selectlist--autosuggesting"));
    }

  , "Staticlist tests"
  , async function()
    {
      test.click('#simplelist');
      let items = testhelpers.getSelectListVisibleItems();
      test.eq(0, items.length); //there should be NO items now
      test.eq(false, !!testhelpers.getOpenSelectList());

      test.fill('#simplelist','a');
      await test.waitUIFree();
      items = testhelpers.getSelectListVisibleItems();
      test.eq('Aap', items[0].textContent);
      test.eq(2, items.length);
      test.click(items[0]);
      test.eq(false, test.qS('#alwaysopendown').classList.contains("selectlist--autosuggesting"));

      //even with spaces, should still work
      test.fill('#simplelist',' a ');
      await test.waitUIFree();
      items = testhelpers.getSelectListVisibleItems();
      test.eq('Aap', items[0].textContent);

      test.fill('#casesensitivelist','a');
      await test.waitUIFree();
      test.eq(false, !!testhelpers.getOpenSelectList(), "There should be no selectlist");

      //should fail with spaces, as we also disabled trim for the case sensitive list
      test.fill('#casesensitivelist',' A ');
      await test.waitUIFree();
      items = testhelpers.getSelectListVisibleItems();
      test.eq(0, items.length);

      test.fill('#casesensitivelist','A');
      await test.waitUIFree();
      test.eq(true, !!testhelpers.getOpenSelectList());
      items = testhelpers.getSelectListVisibleItems();
      test.eq(2, items.length);
      test.eq("Aap", items[0].textContent);

      await test.pressKey("Tab", { shiftKey: true });
      test.eq(false, !!testhelpers.getOpenSelectList(), "selectlist must close when tabbing away");
    }

  , "Immediatelist tests"
  , async function()
    {
      test.click('#immediatelist');
      await test.waitUIFree();

      test.eq(true, !!testhelpers.getOpenSelectList(), "list should immediately open");
      let items = testhelpers.getSelectListVisibleItems();
      test.click(items[0]);
    }

  , "With titles"
  , async function()
    {
      test.click('#withtitleslist');
      await test.waitUIFree();
      test.eq(true, !!testhelpers.getOpenSelectList(), "#withtitleslist list should immediately open");

      let items = testhelpers.getSelectListVisibleItems();
      test.eq(3, items.length);
      test.eq("Do", items[0].querySelector(".selectlist__itemvalue").textContent);
      test.eq("(waarop je 'n deksel doet)", items[0].querySelector(".selectlist__itemappend").textContent);
      test.click(items[0]);
      test.eq("Do", test.qS('#withtitleslist').value);
    }

  , "Space tests"
  , async function()
    {
      test.click('#casesensitivelist');
      test.fill('#casesensitivelist','Spa');
      await test.waitUIFree();

      let items = testhelpers.getSelectListVisibleItems();
      test.eq(1, items.length);
      test.click(items[0]);
      test.eq("Spatie ", test.qS("#casesensitivelist").value);
    }

  // , "Keyboard tests"
  // , async function()
  //   {
  //     test.click(test.qS('#alwaysopendown'));
  //     let items = testhelpers.getSelectListVisibleItems();
  //     test.eq(0, items.length);

  //     test.pressKey("ArrowDown");
  //     items = testhelpers.getSelectListVisibleItems();
  //     test.eq(11, items.length);
  //   }

  ]);
