import test from "@mod-tollium/js/testframework";

test.registerTests(
  [ { loadpage: test.getTestScreen('tests/regressions.test_fragment_visibility')
    , waits: [ 'ui' ]
    }

  , { test: function(doc, win)
      {
        var holder = test.compByName('componentpanel');
        // The uploadfield's label should not be visible
        var label = holder.querySelector('[data-name$="#linelabel"]');
        test.false(label);
        // The boxcheck's label should not be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.false(label);
        // The newbox's label should not be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.false(label);
        // No texts should be visible
        var texts = holder.querySelectorAll("t-text");
        test.eq(0, texts.length);
        // The uploadfield's icon buttons should not be visible
        var buttons = holder.querySelectorAll("t-button.icon");
        test.eq(0, buttons.length);
        // No checkboxes should be visible
        texts = holder.querySelectorAll(".wh-checkbox");
        test.eq(0, texts.length);

        // Toggle visibility to visible
        test.click(test.compByName('togglebutton'));
      }
    , waits: [ 'ui' ]
    }

  , { test: function(doc, win)
      {
        var holder = test.compByName('componentpanel');
        // The uploadfield's label should be visible
        var label = holder.querySelector('[data-name$="#linelabel"]');
        console.log(label);
        test.true(label);
        // The boxcheck's label should be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.true(label);
        // The newbox's label should not be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.false(label);
        // There should be 4 texts visible: uploadfield's title, uploadfield's value, boxcheck's header and boxcheck's content
        var texts = holder.querySelectorAll("t-text");
        test.eq(4, texts.length);
        // The uploadfield's icon buttons should be visible
        var buttons = holder.querySelectorAll("t-button.icon");
        test.eq(3, buttons.length);
        // The boxcheck's checkbox should be visible
        texts = holder.querySelectorAll(".wh-checkbox");
        test.eq(1, texts.length);

        // Toggle visibility to invisible
        test.click(test.compByName('togglebutton'));
      }
    , waits: [ 'ui' ]
    }

  , { test: function(doc, win)
      {
        var holder = test.compByName('componentpanel');
        // The uploadfield's label should not be visible
        var label = holder.querySelector('[data-name$="#linelabel"]');
        test.false(label);
        // The boxcheck's label should not be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.false(label);
        // The newbox's label should not be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.false(label);
        // No texts should be visible
        var texts = holder.querySelectorAll("t-text");
        test.eq(0, texts.length);
        // The uploadfield's icon buttons should not be visible
        var buttons = holder.querySelectorAll("t-button.icon");
        test.eq(0, buttons.length);
        // No checkboxes should be visible
        texts = holder.querySelectorAll(".wh-checkbox");
        test.eq(0, texts.length);

        // Toggle visibility to visible
        test.click(test.compByName('togglebutton'));
      }
    , waits: [ 'ui' ]
    }

  , { test: function(doc, win)
      {
        var holder = test.compByName('componentpanel');
        // The uploadfield's label should be visible
        var label = holder.querySelector('[data-name$="#linelabel"]');
        test.true(label);
        // The boxcheck's label should be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.true(label);
        // The newbox's label should not be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.false(label);
        // There should be 4 texts visible: uploadfield's title, uploadfield's value, boxcheck's header and boxcheck's content
        var texts = holder.querySelectorAll("t-text");
        test.eq(4, texts.length);
        // The uploadfield's icon buttons should be visible
        var buttons = holder.querySelectorAll("t-button.icon");
        test.eq(3, buttons.length);
        // The boxcheck's checkbox should be visible
        texts = holder.querySelectorAll(".wh-checkbox");
        test.eq(1, texts.length);

        // Replace the static box with a dynamic box
        test.click(test.compByName('replacebutton'));
      }
    , waits: [ 'ui' ]
    }

  , { test: function(doc, win)
      {
        var holder = test.compByName('componentpanel');
        // The uploadfield's label should be visible
        var label = holder.querySelector('[data-name$="#linelabel"]');
        test.true(label);
        // The boxcheck's label should not be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.false(label);
        // The newbox's label should be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.true(label);
        // There should be 4 texts visible: uploadfield's title, uploadfield's value, newbox's header and newbox's content
        var texts = holder.querySelectorAll("t-text");
        test.eq(4, texts.length);
        // The uploadfield's icon buttons should be visible
        var buttons = holder.querySelectorAll("t-button.icon");
        test.eq(3, buttons.length);
        // The newbox's checkbox should be visible
        texts = holder.querySelectorAll(".wh-checkbox");
        test.eq(1, texts.length);

        // Toggle visibility to invisible
        test.click(test.compByName('togglebutton'));
      }
    , waits: [ 'ui' ]
    }

  , { test: function(doc, win)
      {
        var holder = test.compByName('componentpanel');
        // The uploadfield's label should not be visible
        var label = holder.querySelector('[data-name$="#linelabel"]');
        test.false(label);
        // The boxcheck's label should not be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.false(label);
        // The newbox's label should not be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.false(label);
        // No texts should be visible
        var texts = holder.querySelectorAll("t-text");
        test.eq(0, texts.length);
        // The uploadfield's icon buttons should not be visible
        var buttons = holder.querySelectorAll("t-button.icon");
        test.eq(0, buttons.length);
        // No checkboxes should be visible
        texts = holder.querySelectorAll(".wh-checkbox");
        test.eq(0, texts.length);

        // Toggle visibility to visible
        test.click(test.compByName('togglebutton'));
      }
    , waits: [ 'ui' ]
    }

  , { test: function(doc, win)
      {
        var holder = test.compByName('componentpanel');
        // The uploadfield's label should be visible
        var label = holder.querySelector('[data-name$="#linelabel"]');
        test.true(label);
        // The boxcheck's label should not be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.false(label);
        // The newbox's label should be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.true(label);
        // There should be 4 texts visible: uploadfield's title, uploadfield's value, boxcheck's header and boxcheck's content
        var texts = holder.querySelectorAll("t-text");
        test.eq(4, texts.length);
        // The uploadfield's icon buttons should be visible
        var buttons = holder.querySelectorAll("t-button.icon");
        test.eq(3, buttons.length);
        // The boxcheck's checkbox should be visible
        texts = holder.querySelectorAll(".wh-checkbox");
        test.eq(1, texts.length);
      }
    }
  ]);
