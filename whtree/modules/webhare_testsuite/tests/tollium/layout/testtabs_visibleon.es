import * as test from '@mod-tollium/js/testframework';


function getTabs(startnode)
{
  return Array.from(startnode.querySelectorAll("div[data-tab]")).filter(node => node.closest('t-tabs') == startnode);
}

test.registerTests(
  [ async function()
    {
      await test.load(test.getTestScreen('tests/layout.layouttest,tabs'));
      await test.wait("ui");

      test.false(test.canClick(test.compByName('tabs')));
      var A01 = test.getMenu(['M01','A01']);
      test.click(A01);
      await test.wait("ui");
    }

  , async function(doc,win)
    {
      var tabs = getTabs(test.compByName('tabs'));
      test.click(tabs[0]);

      await test.wait(100); //FIXME wait('ui') should have worked

      test.eq('tab1', test.compByName('selectedtab').textContent);

      test.eq('P01', test.compByName('tab1').querySelector("select").value);
      test.true(test.isElementClickable(test.compByName('productsku')));
      test.false(test.isElementClickable(test.compByName('type_imagetext_title')));

      var elt = test.compByName('tab1').querySelector("select");
      elt.propTodd.setValue('P02');

      await test.wait("ui");

      test.false(test.isElementClickable(test.compByName('productsku')));
      test.true(test.isElementClickable(test.compByName('type_imagetext_title')));
    }

  ]);
