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

  , "Test pulldown visibleon (initial mode)"
  , async function(doc,win)
    {
      var tabs = getTabs(test.compByName('tabs'));
      test.click(tabs[0]);

      await test.wait(100); //FIXME wait('ui') should have worked

      test.eq('tab1', test.compByName('selectedtab').textContent);

      test.eq('P01', test.compByName('typepulldown').value);
      test.true(test.isElementClickable(test.compByName('productsku')));
      test.false(test.isElementClickable(test.compByName('type_imagetext_title')));

      var elt = test.compByName('typepulldown');
      elt.propTodd.setValue('P02');

      await test.wait("ui");

      test.false(test.isElementClickable(test.compByName('productsku')));
      test.true(test.isElementClickable(test.compByName('type_imagetext_title')));
    }

  , "Test radio visibleon"
  , async function(doc,win)
    {
      test.fill(test.compByName("selectortype"), "radio");
      await test.wait("ui");

      test.eq(2, test.compByName("tab1").querySelectorAll("input[type=radio]").length, "Ensure our radio buttons are there");
      test.eq(true, test.compByName("tab1").querySelectorAll("input[type=radio]")[0].checked, "And P01 got reselected");

      test.true(test.isElementClickable(test.compByName('productsku')));
      test.false(test.isElementClickable(test.compByName('type_imagetext_title')));

      test.click(test.compByName("tab1").querySelectorAll("input[type=radio]")[1].nextSibling);
      await test.wait('ui');
      test.false(test.isElementClickable(test.compByName('productsku')));
      test.true(test.isElementClickable(test.compByName('type_imagetext_title')));

      test.click(test.compByName("tab1").querySelectorAll("input[type=radio]")[0].nextSibling);
      await test.wait('ui');
      test.true(test.isElementClickable(test.compByName('productsku')));
      test.false(test.isElementClickable(test.compByName('type_imagetext_title')));
    }

  , "Test checkbox visibleon"
  , async function(doc,win)
    {
      test.fill(test.compByName("selectortype"), "checkbox");
      await test.wait("ui");

      test.eq(2, test.compByName("tab1").querySelectorAll("input[type=checkbox]").length, "Ensure our checkbox buttons are there");
      test.eq(true, test.compByName("tab1").querySelectorAll("input[type=checkbox]")[0].checked, "And P01 got reselected");
      test.eq(false, test.compByName("tab1").querySelectorAll("input[type=checkbox]")[1].checked, "And P02 not yet");

      test.true(test.isElementClickable(test.compByName('productsku')));
      test.false(test.isElementClickable(test.compByName('type_imagetext_title')));

      //switch from ["P01"] to ["P02"]
      test.click(test.compByName("tab1").querySelectorAll("input[type=checkbox]")[0].nextSibling);
      await test.wait('ui');
      test.click(test.compByName("tab1").querySelectorAll("input[type=checkbox]")[1].nextSibling);
      await test.wait('ui');

      test.false(test.isElementClickable(test.compByName('productsku')));
      test.true(test.isElementClickable(test.compByName('type_imagetext_title')));

      //switch from ["P02"] back to ["P02"]
      test.click(test.compByName("tab1").querySelectorAll("input[type=checkbox]")[0].nextSibling);
      await test.wait('ui');
      test.click(test.compByName("tab1").querySelectorAll("input[type=checkbox]")[1].nextSibling);
      await test.wait('ui');
      test.true(test.isElementClickable(test.compByName('productsku')));
      test.false(test.isElementClickable(test.compByName('type_imagetext_title')));
    }
  ]);
