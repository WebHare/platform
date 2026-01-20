/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/enabled.enablecomponentstest");
    },

    {
      name: 'enablecomponents',
      test: function (doc, win) {
        // The box's checkbox should be disabled
        const box_checkbox_node = test.qSA(".t-checkbox")[1];
        const box_checkbox_comp = box_checkbox_node.propTodd;

        test.assert(!box_checkbox_comp.getEnabled());

        // Everything in the box should be disabled too
        let textedit_node = test.compByName('boxedit');
        let textedit_comp = textedit_node.propTodd;

        test.assert(!textedit_comp.getEnabled());

        textedit_node = test.compByName('selectedit');
        textedit_comp = textedit_node.propTodd;
        test.assert(!textedit_comp.getEnabled());

        // Toggle the 'control box' checkbox, enabling the box
        const checkbox_node = test.qSA(".t-checkbox")[0];
        test.click(checkbox_node);
      },
      waits: ["ui"] // enablecomponents are handled serverside at the moment
    },

    {
      name: 'box just enabled',
      test: function (doc, win) {
        let textedit_node = test.compByName('boxedit');
        let textedit_comp = textedit_node.propTodd;

        test.assert(!textedit_comp.getEnabled());

        textedit_node = test.compByName('selectedit');
        textedit_comp = textedit_node.propTodd;
        test.assert(!textedit_comp.getEnabled());

        const checkbox_node = test.qSA(".t-checkbox")[1];
        test.click(checkbox_node);
      },
      waits: ["ui"] // enablecomponents are handled serverside at the moment
    },

    {
      name: 'checkbox',
      test: function (doc, win) {
        const textedit_node = test.compByName('boxedit');
        const textedit_comp = textedit_node.propTodd;
        test.assert(textedit_comp.getEnabled());

        const pulldown_node = test.qSA("select")[1];
        test.fill(pulldown_node, 'enabled');
      },
      waits: ["ui"] // enablecomponents are handled serverside at the moment
    },

    {
      name: 'pulldown',
      test: function (doc, win) {
        const textedit_node = test.compByName('selectedit');
        const textedit_comp = textedit_node.propTodd;
        console.log(textedit_comp);
        test.assert(textedit_comp.getEnabled());
      }
    },

    async function () {
      await tt.loadWTSTestScreen("tests/enabled.enablecomponentstest_subwindow");
    },

    {
      name: 'enablecomponents_subwindow_open',
      test: function (doc, win) {
        const textedit_node = test.getCurrentScreen().getParent().getToddElement('boxedit');
        const textedit_comp = textedit_node.propTodd;

        test.assert(!textedit_comp.getEnabled());

        const button_node = test.qSA("button")[0];
        test.click(button_node);
      },
      waitforgestures: true,
      waits: ['ui']
    },

    {
      name: 'enablecomponents_subwindow_close',
      test: function (doc, win) {
        const textedit_node = test.compByName('boxedit');
        const textedit_comp = textedit_node.propTodd;

        test.assert(!textedit_comp.getEnabled());

        const checkbox_node = test.qSA(".t-checkbox")[0];
        test.click(checkbox_node);
      },
      waitforgestures: true,
      waits: ['ui'] // enablecomponents are handled serverside at the moment
    },

    {
      name: 'enablecomponents_subwindow_enabled',
      test: function (doc, win) {
        const textedit_node = test.compByName('boxedit');
        const textedit_comp = textedit_node.propTodd;

        test.assert(textedit_comp.getEnabled());
      }
    },

    async function () {
      await tt.loadWTSTestScreen("tests/enabled.enablecomponentstest_radio");
    },

    {
      name: 'enablecomponents_radio_select',
      test: function (doc, win) {
        const textedit_node = test.compByName('selectedit');
        const textedit_comp = textedit_node.propTodd;

        test.assert(!textedit_comp.getEnabled());

        const radio_node = test.qSA(".wh-radiobutton-wrapper")[1];
        test.click(radio_node);
      },
      waitforgestures: true,
      waits: ['ui']
    },

    {
      name: 'enablecomponents_radio_select_enabled',
      test: function (doc, win) {
        const textedit_node = test.compByName('selectedit');
        const textedit_comp = textedit_node.propTodd;

        test.assert(textedit_comp.getEnabled());

        const radio_node = test.qSA(".wh-radiobutton-wrapper")[2];
        test.click(radio_node);
      },
      waitforgestures: true,
      waits: ['ui']
    },

    {
      name: 'enablecomponents_radio_select_also_enabled',
      test: function (doc, win) {
        const textedit_node = test.compByName('selectedit');
        const textedit_comp = textedit_node.propTodd;

        test.assert(textedit_comp.getEnabled());

        const radio_node = test.qSA(".wh-radiobutton-wrapper")[1];
        test.click(radio_node);
      },
      waitforgestures: true,
      waits: ['ui']
    },

    {
      name: 'enablecomponents_radio_select_enabled_again',
      test: function (doc, win) {
        const textedit_node = test.compByName('selectedit');
        const textedit_comp = textedit_node.propTodd;

        test.assert(textedit_comp.getEnabled());

        const radio_node = test.qSA(".wh-radiobutton-wrapper")[0];
        test.click(radio_node);
      },
      waitforgestures: true,
      waits: ['ui']
    },

    {
      name: 'enablecomponents_radio_select_also_disabled',
      test: function (doc, win) {
        const textedit_node = test.compByName('selectedit');
        const textedit_comp = textedit_node.propTodd;

        test.assert(!textedit_comp.getEnabled());

        const radio_node = test.qSA(".wh-radiobutton-wrapper")[3];
        test.click(radio_node);
      },
      waitforgestures: true
      //    , waits: ['ui']
    },

    {
      name: 'enablecomponents_radio_group',
      test: function (doc, win) {
        const textedit_node = test.compByName('groupedit');
        const textedit_comp = textedit_node.propTodd;

        test.assert(!textedit_comp.getEnabled());

        const radio_node = test.qSA(".wh-radiobutton-wrapper")[4];
        test.click(radio_node);
      },
      waitforgestures: true,
      waits: ['ui']
    },

    {
      name: 'enablecomponents_radio_group_enabled',
      test: function (doc, win) {
        const textedit_node = test.compByName('groupedit');
        const textedit_comp = textedit_node.propTodd;

        test.assert(textedit_comp.getEnabled());

        const radio_node = test.qSA(".wh-radiobutton-wrapper")[5];
        test.click(radio_node);
      },
      waitforgestures: true,
      waits: ['ui']
    },

    {
      name: 'enablecomponents_radio_group_also_enabled',
      test: function (doc, win) {
        const textedit_node = test.compByName('groupedit');
        const textedit_comp = textedit_node.propTodd;

        test.assert(textedit_comp.getEnabled());

        const radio_node = test.qSA(".wh-radiobutton-wrapper")[4];
        test.click(radio_node);
      },
      waitforgestures: true,
      waits: ['ui']
    },

    {
      name: 'enablecomponents_radio_group_enabled_again',
      test: function (doc, win) {
        const textedit_node = test.compByName('groupedit');
        const textedit_comp = textedit_node.propTodd;

        test.assert(textedit_comp.getEnabled());

        const radio_node = test.qSA(".wh-radiobutton-wrapper")[3];
        test.click(radio_node);
      },
      waitforgestures: true,
      waits: ['ui']
    },

    {
      name: 'enablecomponents_radio_group_also_disabled',
      test: function (doc, win) {
        const textedit_node = test.compByName('groupedit');
        const textedit_comp = textedit_node.propTodd;

        test.assert(!textedit_comp.getEnabled());
      }
    },

    async function () {
      await tt.loadWTSTestScreen("tests/enabled.enablecomponentstest_arrayedit");
    },
    test.testClickTolliumLabel("Enabled", { name: "Enable arrayedit" }),
    {
      name: "select arrayedit row",
      test: function (doc, win) {
        test.click(test.$screen(win).getListRow("arrayedit!list", "Title"));
      },
      waits: ["ui"]
    },
    test.testClickTolliumButton("Edit", "Click edit button"),
    {
      name: "arrayedit test edit screen opened",
      test: function (doc, win) {
        test.eq("editscreen", test.$screen(win).getFrameTitle(), "Edit screen should have opened");
      }
    }
  ]);
