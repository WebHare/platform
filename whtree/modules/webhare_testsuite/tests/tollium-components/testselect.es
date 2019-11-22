import * as test from "@mod-tollium/js/testframework";


var savefirstwidth;

test.registerTests(
  [ // ---------------------------------------------------------------------------
    //
    // Pulldown
    //

    { loadpage: test.getCompTestPage('select', { type: 'pulldown', rowkeytype: 34 }) // TypeID(STRING) = 34
    , waits: [ 'ui' ]
    }
  , test.testClickTolliumLabel('Visible')
  , test.testClickTolliumLabel('Visible')
  , { test:function(doc,win)
      {
        var testpanel = test.compByName("componentpanel");
        var select = testpanel.querySelector('select');
        test.true(test.canClick(select), 'and should be clickable');
        savefirstwidth = select.getBoundingClientRect().width;
      }
    }
  , { name: 'select second option'
    , test:function(doc,win)
      {
        //change the selection on the component. it should stay on its spot
        var testpanel = test.compByName("componentpanel");
        var select = testpanel.querySelector('select');
        var label = test.qSA(testpanel,"t-text").filter(text=>text.textContent.includes('<title:select>'))[0];

        test.eq(false, select.disabled);
        test.true(label.getBoundingClientRect().right <= select.getBoundingClientRect().left, 'replaced element should be to the right of its label');
        test.fill(select,'second');

        test.true(label.getBoundingClientRect().right <= select.getBoundingClientRect().left, 'replaced element should still be to the right of its label');
        test.eq(savefirstwidth, select.getBoundingClientRect().width, 'element should still be same size after selecting second option');
      }
    }

  , test.testClickTolliumLabel('Enabled')
  , { test:function(doc,win)
      {
        var testpanel = test.compByName("componentpanel");
        var select = testpanel.querySelector('select');
        test.eq(true, select.disabled);
        test.eq(2,select.options.length);
      }
    }

  , test.testClickTolliumButton('Update options')
  , { test:function(doc,win)
      {
        var testpanel = test.compByName("componentpanel");
        var select = testpanel.querySelector('select');
        test.eq(5,select.options.length);
      }
    }
  , test.testClickTolliumLabel('Enabled')

  , { name:'check dividers'
    , test:function(doc,win)
      {
        var testpanel = test.compByName("componentpanel");
        var select = testpanel.querySelector('select');
        test.eq(false, select.disabled);
      }
    }

  , async function(doc,win)
    {
      let alternatedefault = test.compByName('alternatedefault');
      let textedit_selection = test.compByName("selection");

      let testpanel = test.compByName("componentpanel");
      let select = testpanel.querySelector('select');

      test.click(textedit_selection.querySelector("input"));
      test.false(alternatedefault.classList.contains("default"));

      test.click(select);
      test.true(alternatedefault.classList.contains("default"));
    }

    // ---------------------------------------------------------------------------
    //
    // Radio
    //

  , { loadpage: test.getCompTestPage('select', { type: 'radio', rowkeytype: 34 }) // TypeID(STRING) = 34
    , waits: [ 'ui' ]
    }

  , { name: 'click_second'
    , test: async function()
      {
        test.eq('"first"', test.compByName("value").querySelector("input").value);
        test.click(test.compByName("componentpanel").querySelectorAll("input")[1].nextSibling);
        await test.wait('ui');
        test.eq('"second"', test.compByName("value").querySelector("input").value);
        test.click(test.compByName("componentpanel").querySelectorAll("input")[0].nextSibling);
        await test.wait('ui');
        test.eq('"first"', test.compByName("value").querySelector("input").value);

      }
    }

  , { name: 'enabletargets_set_1'
    , test:function(doc,win)
      {
        test.false(test.compByName("enableontarget1").querySelector("input").readOnly);
        test.false(test.compByName("enableontarget2").querySelector("input").readOnly);
        test.click(test.compByName("enableontarget1_include"));
      }
    , waits: [ "ui" ]
    }
  , { name: 'enabletargets_set_2'
    , test:function(doc,win)
      {
        test.click(test.compByName("enableontarget2_include"));
      }
    , waits: [ "ui" ]
    }
  , test.testClickTolliumButton('Update options')
  , test.testClickTolliumLabel('This is the third available option')
  , { name: 'enabletargets_test_both_disabled'
    , test:function(doc,win)
      {
        test.true(test.compByName("enableontarget1").querySelector("input").readOnly);
        test.true(test.compByName("enableontarget2").querySelector("input").readOnly);
      }
    }
  , test.testClickTolliumLabel('Another long option, but the second')
  , { name: 'enabletargets_test_both_enabled'
    , test:function(doc,win)
      {
        test.false(test.compByName("enableontarget1").querySelector("input").readOnly);
        test.false(test.compByName("enableontarget2").querySelector("input").readOnly);
      }
    }

  , async function defaultbutton_radio(doc,win)
    {
      let alternatedefault = test.compByName('alternatedefault');
      let textedit_selection = test.compByName("selection");

      let testpanel = test.compByName("componentpanel");
      let label = testpanel.querySelector('label');

      test.click(textedit_selection.querySelector("input"));
      await test.wait("events");
      test.false(alternatedefault.classList.contains("default"));

      test.click(label);
      await test.wait("events");
      test.true(alternatedefault.classList.contains("default"));
    }

    // ---------------------------------------------------------------------------
    //
    // Checkbox
    //

  , { loadpage: test.getCompTestPage('select', { type: 'checkbox', rowkeytype: 34 }) // TypeID(STRING) = 34
    , waits: [ 'ui' ]
    }

  , { name: 'enabletargets_set_1'
    , test:function(doc,win)
      {
        test.false(test.compByName("enableontarget1").querySelector("input").readOnly);
        test.false(test.compByName("enableontarget2").querySelector("input").readOnly);
        test.click(test.compByName("enableontarget1_include"));
      }
    , waits: [ "ui" ]
    }
  , { name: 'enabletargets_set_2'
    , test:function(doc,win)
      {
        test.click(test.compByName("enableontarget2_include"));
      }
    , waits: [ "ui" ]
    }
  , test.testClickTolliumButton('Update options')
  , { name: 'enabletargets_test_both_disabled'
    , test:function(doc,win)
      {
        test.true(test.compByName("enableontarget1").querySelector("input").readOnly);
        test.true(test.compByName("enableontarget2").querySelector("input").readOnly);
      }
    }
  , test.testClickTolliumLabel('A very long first option')
  , { name: 'enabletargets_test_first_enabled'
    , test:function(doc,win)
      {
        test.false(test.compByName("enableontarget1").querySelector("input").readOnly);
        test.true(test.compByName("enableontarget2").querySelector("input").readOnly);
      }
    }
  , test.testClickTolliumLabel('Another long option, but the second')
  , { name: 'enabletargets_test_both_enabled'
    , test:function(doc,win)
      {
        test.false(test.compByName("enableontarget1").querySelector("input").readOnly);
        test.false(test.compByName("enableontarget2").querySelector("input").readOnly);
      }
    }
  , test.testClickTolliumLabel('A very long first option')
  , { name: 'enabletargets_test_first_enabled'
    , test:function(doc,win)
      {
        test.false(test.compByName("enableontarget1").querySelector("input").readOnly, "Enablecomponents of second checkbox should override the enablecomponents of the first");
        test.false(test.compByName("enableontarget2").querySelector("input").readOnly);
      }
    }

  , async function(doc,win)
    {
      let alternatedefault = test.compByName('alternatedefault');
      let textedit_selection = test.compByName("selection");

      let testpanel = test.compByName("componentpanel");
      let label = testpanel.querySelector('label');

      test.click(textedit_selection.querySelector("input"));
      await test.wait("events");
      test.false(alternatedefault.classList.contains("default"));

      test.click(label);
      await test.wait("events");
      test.true(alternatedefault.classList.contains("default"));
    }

    // ---------------------------------------------------------------------------
    //
    // Checkboxlist
    //

  , { loadpage: test.getCompTestPage('select', { type: 'checkboxlist', rowkeytype: 34 }) // TypeID(STRING) = 34
    , waits: [ 'ui' ]
    }

  , { name: 'checkboxlist_enabletest_disabled'
    , test:function(doc,win)
      {
        test.false(test.compByName("componentpanel").querySelector("input").disabled);
      }
    }
  , test.testClickTolliumLabel('Enabled')
  , { name: 'checkboxlist_enabletest_disabled'
    , test:function(doc,win)
      {
        test.true(test.compByName("componentpanel").querySelector("input").disabled);
      }
    }

  , test.testClickTolliumLabel('Enabled')
  , test.testClickTolliumLabel('included1')
  , test.testClickTolliumLabel('included2')

  , { name: 'checkboxlist_enabletargets_test_both_disabled'
    , test:function(doc,win)
      {
        test.true(test.compByName("enableontarget1").querySelector("input").readOnly);
        test.true(test.compByName("enableontarget2").querySelector("input").readOnly);
      }
    }

  , { name: 'checkboxlist_enabletest_checkrow1'
    , test:function(doc,win)
      {
        test.click(test.qSA('.listrow')[0].querySelector('input[type=checkbox]'));
      }
    , waits: [ 'ui' ]
    }

  , { name: 'checkboxlist_enabletargets_test_first_enabled'
    , test:function(doc,win)
      {
        test.false(test.compByName("enableontarget1").querySelector("input").readOnly);
        test.true(test.compByName("enableontarget2").querySelector("input").readOnly);
      }
    }

  , { name: 'checkboxlist_enabletest_checkrow2'
    , test:function(doc,win)
      {
        test.click(test.qSA('.listrow')[1].querySelector('input[type=checkbox]'));
      }
    , waits: [ 'ui' ]
    }

  , 'checkboxlist_enabletargets_test_first_enabled'
  , async function(doc,win)
    {
      test.false(test.compByName("enableontarget1").querySelector("input").readOnly);
      test.false(test.compByName("enableontarget2").querySelector("input").readOnly);
    }

  , async function(doc,win)
    {
      let alternatedefault = test.compByName('alternatedefault');
      let textedit_selection = test.compByName("selection");

      let testpanel = test.compByName("componentpanel");
      let label = testpanel.querySelector('.listrow');

      test.click(textedit_selection.querySelector("input"));
      await test.wait("events");
      test.false(alternatedefault.classList.contains("default"));

      test.click(label);
      await test.wait("events");
      test.true(alternatedefault.classList.contains("default"));
    }
  ]);
