import * as test from "@mod-tollium/js/testframework";
import JSONRPC from '@mod-system/js/net/jsonrpc';

import ParsedStructure from "@mod-tollium/web/ui/components/richeditor/internal/parsedstructure";

// Runs restructuring tests from mod::webhare_testsuite/tests/publisher/rtd/restructuringtests.whlib

test.registerTests(
  [
    { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=structured'
    }

  , { name: 'restructuring'
    , test: async function(doc,win)
      {
        var rte=win.rte.getEditor();
        let rpc = new JSONRPC(
            { url: "/wh_services/webhare_testsuite/sharedtests/"
            , appendfunctionname: true
            });

        let tests = await rpc.async('GetRestructuringTests');

        for (let subtest of tests)
        {
          test.subtest(subtest.title);
          rte.structure = new ParsedStructure(subtest.structure);
          rte.setContentsHTML(subtest.input);

          let parser = new DOMParser();
          let expect_doc = parser.parseFromString(subtest.expect, "text/html");

          // Ignore width and height styling, they can differ between browsers
          const removestyleregex = / style="(width|height):[^"]*"/g;
          test.eqHTML(expect_doc.querySelector("body").innerHTML.replace(removestyleregex, ""), rte.getContentBodyNode().innerHTML.replace(removestyleregex, ""), `input: ${subtest.input}`);

          rte.setContentsHTML(subtest.expect);
          test.eqHTML(expect_doc.querySelector("body").innerHTML.replace(removestyleregex, ""), rte.getContentBodyNode().innerHTML.replace(removestyleregex, ""), `second restructure: ${subtest.expect}`);
        }
      }
    }
  ]);
