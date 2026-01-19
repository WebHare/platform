/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import * as tt from '@mod-webhare_testsuite/js/tolliumtest-wts';
import * as rtetest from "@mod-tollium/js/testframework-rte";
import * as dompack from 'dompack';

import { selectRange } from "@mod-tollium/web/ui/components/richeditor/internal/selection";

async function openPropsOnFirstTable({ toclick } = { toclick: "td p" }) {
  const driver = new rtetest.RTEDriver('structured');
  const rtenode = test.compByName('structured');
  const table = rtenode.querySelector(".wh-rtd-editor-bodynode table");

  driver.setSelection(table.querySelector(toclick));
  test.click(table.querySelector(toclick), { button: 2 });
  test.click(test.getOpenMenuItem("Properties"));

  await test.wait('ui');
}

test.runTests(
  [
    async function () {
      await tt.loadWTSTestScreen("tests/richdoc.main");
    },

    {
      name: 'create-table',
      test: function (doc, win) {
        test.clickTolliumLabel("Tab with Structured RTE");

        const rtenode = test.compByName('structured');

        // Insert a 2-by-2 table
        test.click(rtenode.querySelector('span[data-button="table"]'));
        const menu = test.getOpenMenu();
        test.click(menu.querySelector('li[data-col="2"][data-row="2"]'));

        const table = rtenode.querySelector(".wh-rtd-editor-bodynode table");
        test.assert(table, "A 2x2 table should be created");

        // Set content for visual inspection
        const p_nodes = table.querySelectorAll("td p");
        for (let i = 0; i < p_nodes.length; ++i)
          p_nodes[i].textContent = i + 1;

        test.eq(2, table.querySelectorAll("tr").length);
        test.eq(0, table.querySelectorAll(".wh-rtd--hasrowheader, .wh-rtd--hascolheader").length, 'none of our hcol/vcol classes may exist yet');
        test.assert(table.querySelector("td").offsetWidth > 200, "if the tablecell is < 200px, it didn't receive its normal 50/50 styling at table insertion");
      }
    },

    "Test table top header",
    async function () {
      //Verify that H1 is available
      const driver = new rtetest.RTEDriver('structured');
      const rtenode = test.compByName('structured');
      driver.setSelection(driver.qS("td p"));
      const styleoptions = [...test.qR<HTMLOptionElement>(rtenode, '.wh-rtd__toolbarstyle').options].map(opt => opt.textContent);
      test.assert(styleoptions.includes("Heading 1"));

      //Switch table type
      await openPropsOnFirstTable();

      test.eq('mytable', test.getCurrentScreen().qSA("select")[0].value);
      test.fill(test.getCurrentScreen().qSA("select")[0], 'othertable');

      test.click(test.qSA('t-text').filter(node => node.textContent.includes("header row"))[0]);
      test.eq('', test.getCurrentScreen().qSA("select")[1].value);
      test.eq('Default cell styling', test.getCurrentScreen().qSA("select")[1].selectedOptions[0].textContent);
      test.fill(test.getCurrentScreen().qSA("select")[1], 'redpill');

      test.setTodd("tablecaption", " This is a test caption");

      test.clickTolliumButton("OK");

      await test.wait('ui');

      let table = test.compByName('structured').querySelector(".wh-rtd-editor-bodynode table");
      test.assert(table.classList.contains("othertable"));
      test.eq("This is a test caption", table.querySelector("caption").textContent);

      test.eq(2, table.querySelectorAll("tr").length);
      test.eq(1, table.querySelectorAll(".wh-rtd--hascolheader").length);
      test.eq(0, table.querySelectorAll(".wh-rtd--hasrowheader").length);

      let nodes = table.querySelectorAll("td,th");
      test.eq("th", nodes[0].nodeName.toLowerCase());
      test.assert(nodes[0].classList.contains("redpill"));
      test.eq("th", nodes[1].nodeName.toLowerCase());
      test.eq("td", nodes[2].nodeName.toLowerCase());
      test.eq("td", nodes[3].nodeName.toLowerCase());

      test.eq("col", nodes[0].scope);
      test.eq("col", nodes[1].scope);
      test.eq("", nodes[2].scope);

      //Verify that H1 is no longer available
      driver.setSelection(driver.qS("td p"));
      const styleoptions2 = [...test.qR<HTMLOptionElement>(rtenode, '.wh-rtd__toolbarstyle').options].map(opt => opt.textContent);
      test.assert(!styleoptions2.includes("Heading 1"));

      // See if properties are properly re-read
      await openPropsOnFirstTable({ toclick: 'caption' });

      test.eq("This is a test caption", test.compByName("tablecaption").querySelector("textarea").value);

      test.clickTolliumButton("OK");

      await test.wait('ui');

      // See if reparse keep the header structure
      test.clickTolliumButton("Rewrite");
      await test.wait("ui");

      table = test.compByName('structured').querySelector(".wh-rtd-editor-bodynode table");
      test.eq(1, table.querySelectorAll(".wh-rtd--hascolheader").length);
      test.eq(0, table.querySelectorAll(".wh-rtd--hasrowheader").length);

      nodes = table.querySelectorAll("td,th");
      test.eq("th", nodes[0].nodeName.toLowerCase());
      test.eq("th", nodes[1].nodeName.toLowerCase());
      test.eq("td", nodes[2].nodeName.toLowerCase());
      test.eq("td", nodes[3].nodeName.toLowerCase());

      test.eq("col", nodes[0].scope);
      test.eq("col", nodes[1].scope);
      test.eq("", nodes[2].scope);
    },

    "Test chrome contextmenu issue",
    async function () {
      /* Chrome seems to move the selection just before dispatching the rightclick event.
         the selection will appear to to start behind the '1' end before the "0" in the P in the NEXT cell

         We cannot use test.click(table.querySelector("td"), { button: 2 }); to test this situation
         as that one will first simulate mousedown... which already fixes the selection issue
      */
      const rtenode = test.compByName('structured');
      const table = rtenode.querySelector(".wh-rtd-editor-bodynode table");
      const td_ps = table.querySelectorAll("td p");

      selectRange({
        start: { element: td_ps[0], offset: 1 },
        end: { element: td_ps[1], offset: 0 }
      });

      dompack.dispatchDomEvent(td_ps[0], "contextmenu");
      test.click(test.getOpenMenuItem("Properties"));
      await test.wait('ui');

      test.clickTolliumButton("OK");
      await test.wait('ui');
    },

    // Test table left
    {
      name: 'leftheader-open-properties-1',
      test: function (doc, win) {
        const rtenode = test.compByName('structured');
        const table = rtenode.querySelector(".wh-rtd-editor-bodynode table");

        test.assert(table.querySelector("td").offsetWidth > 200, "if the tablecell is < 200px, the table lost its styling after rewriting");
        test.click(table.querySelector("td"), { button: 2 });
        test.click(test.getOpenMenuItem("Properties"));
      },
      waits: ["ui"]
    },
    {
      name: 'leftheader-enable',
      test: function (doc, win) {
        test.click(test.qSA('t-text').filter(node => node.textContent.includes("header row"))[0]);  // disable
        test.click(test.qSA('t-text').filter(node => node.textContent.includes("header column"))[0]);  // enable
        test.fill(test.getCurrentScreen().qSA("select")[1], 'redpill');
        test.clickTolliumButton("OK");
      },
      waits: ["ui"]
    },
    'leftheader reclick (crashed earlier when targetting existing TH)',
    async function (doc, win) {
      const rtenode = test.compByName('structured');
      const table = rtenode.querySelector(".wh-rtd-editor-bodynode table");
      test.click(table.querySelector("th"), { button: 2 });
      test.click(test.getOpenMenuItem("Properties"));
      await test.wait('ui');

      test.fill(test.getCurrentScreen().qSA("select")[1], 'bluepill');
      test.clickTolliumButton("OK");
      await test.wait('ui');
    },
    {
      name: 'leftheader-test',
      test: function (doc, win) {
        const rtenode = test.compByName('structured');
        const table = rtenode.querySelector(".wh-rtd-editor-bodynode table");
        test.eq(0, table.querySelectorAll(".wh-rtd--hascolheader").length);
        test.eq(2, table.querySelectorAll(".wh-rtd--hasrowheader").length);

        const nodes = table.querySelectorAll("td,th");
        test.eq("th", nodes[0].nodeName.toLowerCase());
        test.eq("td", nodes[1].nodeName.toLowerCase());
        test.eq("th", nodes[2].nodeName.toLowerCase());
        test.eq("td", nodes[3].nodeName.toLowerCase());

        test.eq("row", nodes[0].scope);
        test.eq("", nodes[1].scope);
        test.eq("row", nodes[2].scope);
      }
    },

    // Test table header disable
    {
      name: 'headerdisable-open-properties-1',
      test: function (doc, win) {
        const rtenode = test.compByName('structured');
        const table = rtenode.querySelector(".wh-rtd-editor-bodynode table");
        const first_td_p = table.querySelector("td p");

        const rte = rtetest.getRTE(win, 'structured');
        rtetest.setRTESelection(win, rte.getEditor(),
          {
            startContainer: first_td_p,
            startOffset: 0,
            endContainer: first_td_p,
            endOffset: 0
          });

        test.click(table.querySelector("td"), { button: 2 });
        test.click(test.getOpenMenuItem("Properties"));
      },
      waits: ["ui"]
    },
    {
      name: 'headerdisable-enable',
      test: function (doc, win) {
        test.click(test.qSA('t-text').filter(node => node.textContent.includes("header column"))[0]);  // disable
        test.clickTolliumButton("OK");
      },
      waits: ["ui"]
    },
    {
      name: 'headerdisable-test',
      test: function (doc, win) {
        const rtenode = test.compByName('structured');
        const table = rtenode.querySelector(".wh-rtd-editor-bodynode table");
        test.eq(0, table.querySelectorAll(".wh-rtd--hascolheader").length);
        test.eq(0, table.querySelectorAll(".wh-rtd--hasrowheader").length);

        const nodes = table.querySelectorAll("td,th");
        test.eq("td", nodes[0].nodeName.toLowerCase());
        test.eq("td", nodes[1].nodeName.toLowerCase());
        test.eq("td", nodes[2].nodeName.toLowerCase());
        test.eq("td", nodes[3].nodeName.toLowerCase());

        test.eq("", nodes[0].scope);
        test.eq("", nodes[1].scope);
        test.eq("", nodes[2].scope);
      }
    },

    "Remove the table",
    async function (doc, win) {
      const rtenode = test.compByName('structured');
      const driver = new rtetest.RTEDriver('structured');
      driver.setSelection(driver.qS("td p"));
      test.click(rtenode.querySelector('[data-button="action-properties"]'));
      await test.wait('ui');

      test.clickTolliumButton("Remove"); //remove table
      await test.wait('ui');

      test.clickTolliumButton("Yes"); //confirm it!
      await test.wait('ui');

      test.assert(!driver.qS("table"));
    }
  ]);
