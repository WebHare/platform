import * as test from '@mod-tollium/js/testframework';
import * as dompack from 'dompack';

function getTags(node)
{
  return dompack.qSA(node, '.wh-tagedit-tag').map(node => node.textContent);
}

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/layout.layouttest,autosuggest')
    , waits: [ 'ui' ]
    }

  , 'legacy combobox'
  , async function()
    {
      test.click(test.compByName('legacystatic'));
      await test.waitUIFree();

      test.true(test.getOpenSelectList(),"expecting immediate open on legacy comboboxes");
      test.eq("6", test.getSelectListVisibleItems()[0].textContent);
      test.click(test.getSelectListVisibleItems()[0]);

      test.click(test.compByName('legacydynamic'));
      await test.waitUIFree();
      test.eq(3, test.getSelectListVisibleItems().length);

      test.click(test.compByName('legacyextra'));
      await test.waitUIFree();

      test.click(test.compByName('legacydynamic'));
      await test.waitUIFree();
      test.eq(6, test.getSelectListVisibleItems().length);
      test.click(test.getSelectListVisibleItems()[5]);
    }

  , 'testcombobox'
  , async function()
    {
      test.click(test.compByName('enablecombo'));
      await test.waitUIFree();
    }

  , 'cant triger disabled combo'
  , async function()
    {
      test.click(test.compByName('combo'));
      test.false(test.compByName('combo').querySelector("input").classList.contains("t-selectlist--autosuggesting"));

      test.false(test.getOpenSelectList());
      test.click(test.compByName('enablecombo'));
      await test.waitUIFree();
    }

  , 'CAN triger enabled combo'
  , async function()
    {
      test.click(test.compByName('combo'));
      test.fill(test.compByName('combo').querySelector("input"),"COMBO");
      test.true(test.compByName('combo').querySelector("input").classList.contains("t-selectlist--autosuggesting"));
      await test.waitUIFree();
      test.true(test.getOpenSelectList());
      test.eq(2, test.getSelectListVisibleItems().length);
      test.eq("Combo1", test.getSelectListVisibleItems()[0].textContent);
      test.eq("I Haz Combo2", test.getSelectListVisibleItems()[1].textContent);
      test.fill(test.compByName('combo').querySelector("input"),"COMBO1");
      await test.waitUIFree();
      test.eq(1, test.getSelectListVisibleItems().length);
      test.click(test.getSelectListVisibleItems()[0]);
      test.eq("Combo1", test.compByName('combo').querySelector("input").value);
    }

   , 'Test dynamic autocomplete'
   , async function()
     {
       test.click(test.compByName('combodynamic'));
       test.fill(test.compByName('combodynamic').querySelector("input"),"Test");
       test.true(test.compByName('combodynamic').querySelector("input").classList.contains("t-selectlist--autosuggesting"));
       await test.waitUIFree();

       test.eq("Test1", test.getSelectListVisibleItems()[0].textContent);
       test.eq("Test2(2)", test.getSelectListVisibleItems()[1].textContent);
       test.fill(test.compByName('combodynamic').querySelector("input"),"tEst15");
       await test.waitUIFree();

       test.eq("tEst151", test.getSelectListVisibleItems()[0].textContent);
     }

   , 'Test tagedit'
   , async function()
     {
       await test.pressKey('Tab'); //moves to tagedit
       test.false(test.getOpenSelectList(), "Tab should close current selectlist");

       test.fill(test.compByName('tagedit').querySelector("input"),"test");
       test.true(test.compByName('tagedit').querySelector("input").classList.contains("t-selectlist--autosuggesting"));
       await test.waitUIFree();

       test.click(test.getSelectListVisibleItems()[1]);
       await test.waitUIFree();
       test.true(test.hasFocus(test.compByName('tagedit').querySelector("input")),"Focus back to input after selecting an item");

       test.eq(['test2'], getTags(test.compByName('tagedit')));

       test.fill(test.compByName('tagedit').querySelector("input"),"c");
       await test.pressKey("Enter");
       await test.waitUIFree();

       test.eq(['test2','c'], getTags(test.compByName('tagedit')));
       test.true(test.hasFocus(test.compByName('tagedit').querySelector("input")),"Focus back to input after selecting an item");

       // test.eq("test1", test.getSelectListVisibleItems()[0].textContent);
       // test.fill(test.compByName('tagedit').querySelector("input"),"test15");
       // await test.waitUIFree();

       // test.eq("test151", test.getSelectListVisibleItems()[0].textContent);
     }

   , 'Test restricted tagedit'
   , async function()
     {
       test.click(test.compByName('tageditrestrict').querySelector("input"));

       test.fill(test.compByName('tageditrestrict').querySelector("input"),"test");
       test.true(test.compByName('tageditrestrict').querySelector("input").classList.contains("t-selectlist--autosuggesting"));
       await test.waitUIFree();

       test.click(test.getSelectListVisibleItems()[1]);
       await test.waitUIFree();
       test.true(test.hasFocus(test.compByName('tageditrestrict').querySelector("input")),"Focus back to input after selecting an item");

       test.eq(['test2'], getTags(test.compByName('tageditrestrict')));

       test.fill(test.compByName('tageditrestrict').querySelector("input"),"c");
       await test.pressKey("Enter");
       await test.waitUIFree();

       test.eq(['test2'], getTags(test.compByName('tageditrestrict')), '"c" blocked by restriction');
       test.true(test.hasFocus(test.compByName('tageditrestrict').querySelector("input")),"Focus back to input after selecting an item");

       // test.eq("test1", test.getSelectListVisibleItems()[0].textContent);
       // test.fill(test.compByName('tagedit').querySelector("input"),"test15");
       // await test.waitUIFree();

       // test.eq("test151", test.getSelectListVisibleItems()[0].textContent);
     }
  ]);
