/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import * as browser from "dompack/extra/browser";
import * as tt from "@mod-tollium/js/tolliumtest";


let savefirstwidth;

test.runTests(
  [ // ---------------------------------------------------------------------------
    //
    // Pulldown
    //

    async function () {
      await test.load(test.getCompTestPage('select', { type: 'pulldown', rowkeytype: 34 })); // TypeID(STRING) = 34
      tt.comp(":Visible").click();
      await test.waitForUI();
      tt.comp(":Visible").click();
      await test.waitForUI();
    },
    {
      test: function (doc, win) {
        const testpanel = test.compByName("componentpanel");
        const select = testpanel.querySelector('select');
        test.assert(test.canClick(select), 'and should be clickable');
        savefirstwidth = select.getBoundingClientRect().width;
      }
    },
    {
      name: 'select second option',
      test: async function (doc, win) {
        //change the selection on the component. it should stay on its spot
        const testpanel = test.compByName("componentpanel");
        const select = testpanel.querySelector('select');
        const label = test.qSA(testpanel, "t-text").filter(text => text.textContent.includes('<title:select>'))[0];

        test.assert(!select.disabled);
        test.assert(label.getBoundingClientRect().right <= select.getBoundingClientRect().left, 'replaced element should be to the right of its label');
        test.fill(select, 'second');

        test.assert(label.getBoundingClientRect().right <= select.getBoundingClientRect().left, 'replaced element should still be to the right of its label');
        test.eq(savefirstwidth, select.getBoundingClientRect().width, 'element should still be same size after selecting second option');

        tt.comp(":Enabled").click();
        await test.waitForUI();
      }
    },

    {
      test: async function (doc, win) {
        const testpanel = test.compByName("componentpanel");
        const select = testpanel.querySelector('select');
        test.assert(select.disabled);
        test.eq(2, select.options.length);
        tt.comp(":Update options").click();
        await test.waitForUI();
      }
    },

    {
      test: async function (doc, win) {
        const testpanel = test.compByName("componentpanel");
        const select = testpanel.querySelector('select');
        // Browsers other than Firefox insert <hr> dividers instead of disabled options
        test.eq(browser.getName() === "firefox" ? 5 : 4, select.options.length);

        tt.comp(":Enabled").click();
        await test.waitForUI();
      }
    },

    {
      name: 'check dividers',
      test: function (doc, win) {
        const testpanel = test.compByName("componentpanel");
        const select = testpanel.querySelector('select');
        test.assert(!select.disabled);
      }
    },

    async function (doc, win) {
      const alternatedefault = test.compByName('alternatedefault');
      const textedit_selection = test.compByName("selection");

      const testpanel = test.compByName("componentpanel");
      const select = testpanel.querySelector('select');

      test.click(textedit_selection.querySelector("input"));
      test.assert(!alternatedefault.classList.contains("default"));

      test.click(select);
      test.assert(alternatedefault.classList.contains("default"));
    },

    // ---------------------------------------------------------------------------
    //
    // Radio
    //

    async function () {
      await test.load(test.getCompTestPage('select', { type: 'radio', rowkeytype: 34 })); // TypeID(STRING) = 34
    },

    {
      name: 'click_second',
      test: async function () {
        test.eq('"first"', test.compByName("value").querySelector("input").value);
        test.click(test.compByName("componentpanel").querySelectorAll("input")[1].nextSibling);
        await test.waitForUI();
        test.eq('"second"', test.compByName("value").querySelector("input").value);
        test.click(test.compByName("componentpanel").querySelectorAll("input")[0].nextSibling);
        await test.waitForUI();
        test.eq('"first"', test.compByName("value").querySelector("input").value);

      }
    },

    {
      name: 'enabletargets_set_1',
      test: async function (doc, win) {
        test.assert(!test.compByName("enableontarget1").querySelector("input").readOnly);
        test.assert(!test.compByName("enableontarget2").querySelector("input").readOnly);
        test.click(test.compByName("enableontarget1_include"));
        await test.waitForUI();
      }
    },
    {
      name: 'enabletargets_set_2',
      test: async function (doc, win) {
        test.click(test.compByName("enableontarget2_include"));
        await test.waitForUI();
        tt.comp(":Update options").click();
        await test.waitForUI();
        tt.comp(':This is the third available option').click();
        await test.waitForUI();
      }
    },
    {
      name: 'enabletargets_test_both_disabled',
      test: async function (doc, win) {
        test.assert(test.compByName("enableontarget1").querySelector("input").readOnly);
        test.assert(test.compByName("enableontarget2").querySelector("input").readOnly);
        tt.comp(':Another long option, but the second').click();
        await test.waitForUI();
      }
    },
    {
      name: 'enabletargets_test_both_enabled',
      test: function (doc, win) {
        test.assert(!test.compByName("enableontarget1").querySelector("input").readOnly);
        test.assert(!test.compByName("enableontarget2").querySelector("input").readOnly);
      }
    },

    async function defaultbutton_radio(doc, win) {
      const alternatedefault = test.compByName('alternatedefault');
      const textedit_selection = test.compByName("selection");

      const testpanel = test.compByName("componentpanel");
      const label = testpanel.querySelector('label');

      test.click(textedit_selection.querySelector("input"));
      await test.wait("events");
      test.assert(!alternatedefault.classList.contains("default"));

      test.click(label);
      await test.wait("events");
      test.assert(alternatedefault.classList.contains("default"));
    },

    // ---------------------------------------------------------------------------
    //
    // Checkbox
    //

    async function () {
      await test.load(test.getCompTestPage('select', { type: 'checkbox', rowkeytype: 34 })); // TypeID(STRING) = 34
    },

    {
      name: 'enabletargets_set_1',
      test: async function (doc, win) {
        test.assert(!test.compByName("enableontarget1").querySelector("input").readOnly);
        test.assert(!test.compByName("enableontarget2").querySelector("input").readOnly);
        test.click(test.compByName("enableontarget1_include"));
        await test.waitForUI();
      }
    },
    {
      name: 'enabletargets_set_2',
      test: async function (doc, win) {
        test.click(test.compByName("enableontarget2_include"));
        await test.waitForUI();
        tt.comp(":Update options").click();
        await test.waitForUI();
      }
    },
    {
      name: 'enabletargets_test_both_disabled',
      test: async function (doc, win) {
        test.assert(test.compByName("enableontarget1").querySelector("input").readOnly);
        test.assert(test.compByName("enableontarget2").querySelector("input").readOnly);
        tt.comp(':A very long first option').click();
        await test.waitForUI();
      }
    },
    {
      name: 'enabletargets_test_first_enabled',
      test: async function (doc, win) {
        test.assert(!test.compByName("enableontarget1").querySelector("input").readOnly);
        test.assert(test.compByName("enableontarget2").querySelector("input").readOnly);
        tt.comp(':Another long option, but the second').click();
        await test.waitForUI();
      }
    },
    {
      name: 'enabletargets_test_both_enabled',
      test: async function (doc, win) {
        test.assert(!test.compByName("enableontarget1").querySelector("input").readOnly);
        test.assert(!test.compByName("enableontarget2").querySelector("input").readOnly);
        tt.comp(":A very long first option").click();
        await test.waitForUI();
      }
    },
    {
      name: 'enabletargets_test_first_enabled',
      test: function (doc, win) {
        test.assert(!test.compByName("enableontarget1").querySelector("input").readOnly, "Enablecomponents of second checkbox should override the enablecomponents of the first");
        test.assert(!test.compByName("enableontarget2").querySelector("input").readOnly);
      }
    },

    async function (doc, win) {
      const alternatedefault = test.compByName('alternatedefault');
      const textedit_selection = test.compByName("selection");

      const testpanel = test.compByName("componentpanel");
      const label = testpanel.querySelector('input[type=checkbox]');

      test.click(textedit_selection.querySelector("input"));
      await test.wait("events");
      test.assert(!alternatedefault.classList.contains("default"));

      test.click(label);
      await test.wait("events");
      test.assert(alternatedefault.classList.contains("default"));
    },

    // ---------------------------------------------------------------------------
    //
    // Checkboxlist
    //

    async function () {
      await test.load(test.getCompTestPage('select', { type: 'checkboxlist', rowkeytype: 34 })); // TypeID(STRING) = 34
    },

    {
      name: 'checkboxlist_enabletest_disabled',
      test: async function (doc, win) {
        test.assert(!test.compByName("componentpanel").querySelector("input").disabled);
        tt.comp(":Enabled").click();
        await test.waitForUI();
      }
    },
    {
      name: 'checkboxlist_enabletest_disabled',
      test: async function (doc, win) {
        test.assert(test.compByName("componentpanel").querySelector("input").disabled);

        tt.comp(":Enabled").click();
        await test.waitForUI();
        tt.comp(":included1").click();
        await test.waitForUI();
        tt.comp(":included2").click();
        await test.waitForUI();
      }
    },
    {
      name: 'checkboxlist_enabletargets_test_both_disabled',
      test: function (doc, win) {
        test.assert(test.compByName("enableontarget1").querySelector("input").readOnly);
        test.assert(test.compByName("enableontarget2").querySelector("input").readOnly);
      }
    },

    {
      name: 'checkboxlist_enabletest_checkrow1',
      test: async function (doc, win) {
        test.click(test.qSA('.listrow')[0].querySelector('input[type=checkbox]'));
        await test.waitForUI();
      }
    },

    {
      name: 'checkboxlist_enabletargets_test_first_enabled',
      test: function (doc, win) {
        test.assert(!test.compByName("enableontarget1").querySelector("input").readOnly);
        test.assert(test.compByName("enableontarget2").querySelector("input").readOnly);
      }
    },

    {
      name: 'checkboxlist_enabletest_checkrow2',
      test: async function (doc, win) {
        test.click(test.qSA('.listrow')[1].querySelector('input[type=checkbox]'));
        await test.waitForUI();
      }
    },

    'checkboxlist_enabletargets_test_first_enabled',
    async function (doc, win) {
      test.assert(!test.compByName("enableontarget1").querySelector("input").readOnly);
      test.assert(!test.compByName("enableontarget2").querySelector("input").readOnly);
    },

    async function (doc, win) {
      const alternatedefault = test.compByName('alternatedefault');
      const textedit_selection = test.compByName("selection");

      const testpanel = test.compByName("componentpanel");
      const label = testpanel.querySelector('.listrow');

      test.click(textedit_selection.querySelector("input"));
      await test.wait("events");
      test.assert(!alternatedefault.classList.contains("default"));

      test.click(label);
      await test.wait("events");
      test.assert(alternatedefault.classList.contains("default"));
    }
  ]);
