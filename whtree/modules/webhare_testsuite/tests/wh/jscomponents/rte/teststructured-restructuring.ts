/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as test from "@mod-tollium/js/testframework";
import JSONRPC from '@mod-system/js/net/jsonrpc';

import ParsedStructure from "@mod-tollium/web/ui/components/richeditor/internal/parsedstructure";

// Runs restructuring tests from mod::webhare_testsuite/tests/publisher/rtd/restructuringtests.whlib

function getFixedRTEInput(rte) {
  return getComparableRTEText(rte.getBody());
}

function getComparableRTEText(rtenode) {
  let input = rtenode.innerHTML;

  // Ignore width and height styling, they can differ between browsers
  input = input.replaceAll(/ style="(width|height):[^"]*"/g, "");

  const tempdiv = document.createElement("div");
  tempdiv.innerHTML = input;
  test.qSA(tempdiv, `[contenteditable="false"]`).forEach(_ => _.removeAttribute("contenteditable"));
  test.qSA(tempdiv, `.wh-rtd-embeddedobject`).forEach(_ => _.innerHTML = "");

  return tempdiv.innerHTML;
}

test.registerTests(
  [
    {
      loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=structured'
    },

    {
      name: 'restructuring',
      test: async function (doc, win) {
        const rte = win.rte.getEditor();
        const rpc = new JSONRPC(
          {
            url: "/wh_services/webhare_testsuite/sharedtests/",
            appendfunctionname: true
          });

        const tests = await rpc.async('GetRestructuringTests');

        for (const subtest of tests) {
          test.subtest(subtest.title);
          rte.structure = new ParsedStructure(subtest.structure);
          rte.setContentsHTML(subtest.input);

          const parser = new DOMParser();
          const expect_doc = parser.parseFromString(subtest.expect, "text/html");

          test.eqHTML(getComparableRTEText(expect_doc.querySelector("body")), getFixedRTEInput(rte), `input: ${subtest.input}`);

          rte.setContentsHTML(subtest.expect);
          test.eqHTML(getComparableRTEText(expect_doc.querySelector("body")), getFixedRTEInput(rte), `second restructure: ${subtest.expect}`);
        }
      }
    }
  ]);
