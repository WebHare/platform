/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';
import * as test from "@mod-tollium/js/testframework";

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/regressions.test_fragment_visibility");
    },

    {
      test: function (doc, win) {
        const holder = test.compByName('componentpanel');
        // The uploadfield's label should not be visible
        let label = holder.querySelector('[data-name$="#linelabel"]');
        test.assert(!label);
        // The boxcheck's label should not be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.assert(!label);
        // The newbox's label should not be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.assert(!label);
        // No texts should be visible
        let texts = holder.querySelectorAll("t-text");
        test.eq(0, texts.length);
        // The uploadfield's icon buttons should not be visible
        const buttons = holder.querySelectorAll("button.icon");
        test.eq(0, buttons.length);
        // No checkboxes should be visible
        texts = holder.querySelectorAll(".t-checkbox");
        test.eq(0, texts.length);

        // Toggle visibility to visible
        test.click(test.compByName('togglebutton'));
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        const holder = test.compByName('componentpanel');
        // The uploadfield's label should be visible
        let label = holder.querySelector('[data-name$="#linelabel"]');
        console.log(label);
        test.assert(label);
        // The boxcheck's label should be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.assert(label);
        // The newbox's label should not be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.assert(!label);
        // There should be 4 texts visible: uploadfield's title, uploadfield's value, boxcheck's header and boxcheck's content
        let texts = holder.querySelectorAll("t-text");
        test.eq(4, texts.length);
        // The uploadfield's icon buttons should be visible
        const buttons = holder.querySelectorAll("button.icon");
        test.eq(3, buttons.length);
        // The boxcheck's checkbox should be visible
        texts = holder.querySelectorAll(".t-checkbox");
        test.eq(1, texts.length);

        // Toggle visibility to invisible
        test.click(test.compByName('togglebutton'));
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        const holder = test.compByName('componentpanel');
        // The uploadfield's label should not be visible
        let label = holder.querySelector('[data-name$="#linelabel"]');
        test.assert(!label);
        // The boxcheck's label should not be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.assert(!label);
        // The newbox's label should not be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.assert(!label);
        // No texts should be visible
        let texts = holder.querySelectorAll("t-text");
        test.eq(0, texts.length);
        // The uploadfield's icon buttons should not be visible
        const buttons = holder.querySelectorAll("button.icon");
        test.eq(0, buttons.length);
        // No checkboxes should be visible
        texts = holder.querySelectorAll(".t-checkbox");
        test.eq(0, texts.length);

        // Toggle visibility to visible
        test.click(test.compByName('togglebutton'));
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        const holder = test.compByName('componentpanel');
        // The uploadfield's label should be visible
        let label = holder.querySelector('[data-name$="#linelabel"]');
        test.assert(label);
        // The boxcheck's label should be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.assert(label);
        // The newbox's label should not be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.assert(!label);
        // There should be 4 texts visible: uploadfield's title, uploadfield's value, boxcheck's header and boxcheck's content
        let texts = holder.querySelectorAll("t-text");
        test.eq(4, texts.length);
        // The uploadfield's icon buttons should be visible
        const buttons = holder.querySelectorAll("button.icon");
        test.eq(3, buttons.length);
        // The boxcheck's checkbox should be visible
        texts = holder.querySelectorAll(".t-checkbox");
        test.eq(1, texts.length);

        // Replace the static box with a dynamic box
        test.click(test.compByName('replacebutton'));
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        const holder = test.compByName('componentpanel');
        // The uploadfield's label should be visible
        let label = holder.querySelector('[data-name$="#linelabel"]');
        test.assert(label);
        // The boxcheck's label should not be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.assert(!label);
        // The newbox's label should be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.assert(label);
        // There should be 4 texts visible: uploadfield's title, uploadfield's value, newbox's header and newbox's content
        let texts = holder.querySelectorAll("t-text");
        test.eq(4, texts.length);
        // The uploadfield's icon buttons should be visible
        const buttons = holder.querySelectorAll("button.icon");
        test.eq(3, buttons.length);
        // The newbox's checkbox should be visible
        texts = holder.querySelectorAll(".t-checkbox");
        test.eq(1, texts.length);

        // Toggle visibility to invisible
        test.click(test.compByName('togglebutton'));
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        const holder = test.compByName('componentpanel');
        // The uploadfield's label should not be visible
        let label = holder.querySelector('[data-name$="#linelabel"]');
        test.assert(!label);
        // The boxcheck's label should not be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.assert(!label);
        // The newbox's label should not be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.assert(!label);
        // No texts should be visible
        let texts = holder.querySelectorAll("t-text");
        test.eq(0, texts.length);
        // The uploadfield's icon buttons should not be visible
        const buttons = holder.querySelectorAll("button.icon");
        test.eq(0, buttons.length);
        // No checkboxes should be visible
        texts = holder.querySelectorAll(".t-checkbox");
        test.eq(0, texts.length);

        // Toggle visibility to visible
        test.click(test.compByName('togglebutton'));
      },
      waits: ['ui']
    },

    {
      test: function (doc, win) {
        const holder = test.compByName('componentpanel');
        // The uploadfield's label should be visible
        let label = holder.querySelector('[data-name$="#linelabel"]');
        test.assert(label);
        // The boxcheck's label should not be visible
        label = holder.querySelector('[data-name*="boxcheck"]');
        test.assert(!label);
        // The newbox's label should be visible
        label = holder.querySelector('[data-name*="fragment1"]');
        test.assert(label);
        // There should be 4 texts visible: uploadfield's title, uploadfield's value, boxcheck's header and boxcheck's content
        let texts = holder.querySelectorAll("t-text");
        test.eq(4, texts.length);
        // The uploadfield's icon buttons should be visible
        const buttons = holder.querySelectorAll("button.icon");
        test.eq(3, buttons.length);
        // The boxcheck's checkbox should be visible
        texts = holder.querySelectorAll(".t-checkbox");
        test.eq(1, texts.length);
      }
    }
  ]);
