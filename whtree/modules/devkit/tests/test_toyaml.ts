import { importApplyTo, suggestTypeName } from "@mod-devkit/js/validation/toyaml";
import type { ApplyTo } from "@mod-platform/generated/schema/siteprofile";
import { baseApplyToRule, parseApplyTo } from "@mod-publisher/lib/internal/siteprofiles/parser";
import * as test from "@webhare/test";
import type { CSPApplyTo } from "@webhare/whfs/src/siteprofiles";

function testNaming() {
  test.eq("platform:publisher.shtmlfile", suggestTypeName("platform", "http://www.webhare.net/xmlns/publisher/shtmlfile"));
  test.eq("othermodule:webhare_testsuite.webdesign_dynfolder", suggestTypeName("othermodule", "http://www.webhare.net/xmlns/webhare_testsuite/webdesign-dynfolder"));
  test.eq("webhare_testsuite:webdesign_dynfolder", suggestTypeName("webhare_testsuite", "http://www.webhare.net/xmlns/webhare_testsuite/webdesign-dynfolder"));
}

function testToRoundtrip(finalTo: ApplyTo, sourceTo: CSPApplyTo[]) {
  const actualFinalTo = importApplyTo(sourceTo);
  const reverseSourceTo = parseApplyTo(actualFinalTo);

  test.eq(finalTo, actualFinalTo);
  test.eq(sourceTo, reverseSourceTo);
}

function testToRules() {
  testToRoundtrip("all", [{ ...baseApplyToRule, match_all: true }]);
  testToRoundtrip({ site: "?*" }, [{ ...baseApplyToRule, match_all: true, sitemask: '?*' }]);
  testToRoundtrip({ site: "Repository" }, [{ ...baseApplyToRule, match_all: true, sitename: 'Repository' }]);

  testToRoundtrip({
    or: [
      {
        is: "file",
        type: "http://www.webhare.net/xmlns/publisher/javascriptfile"
      }, {
        is: "file",
        type: "http://www.webhare.net/xmlns/publisher/htmfile"
      }
    ]
  }, [
    { ...baseApplyToRule, match_file: true, filetype: 'http://www.webhare.net/xmlns/publisher/javascriptfile' },
    { ...baseApplyToRule, match_file: true, filetype: 'http://www.webhare.net/xmlns/publisher/htmfile' }
  ]);

  testToRoundtrip({
    is: "file",
    type: "http://www.webhare.net/xmlns/publisher/contentlisting",
    parentType: "http://www.webhare.net/xmlns/publisher/photoalbum",
    site: { regex: "Repository|Intranet" },
    sitePath: { regex: "^/Corporate (NL|EN|)/$" },
    whfsPath: { regex: "^/webhare-tests/.*" }
  }, [{ ...baseApplyToRule, match_file: true, parenttype: 'http://www.webhare.net/xmlns/publisher/photoalbum', filetype: 'http://www.webhare.net/xmlns/publisher/contentlisting', whfspathregex: "^/webhare-tests/.*", pathregex: "^/Corporate (NL|EN|)/$", siteregex: "Repository|Intranet" }]);

  testToRoundtrip({
    is: "file",
    withinType: 'http://www.webhare.net/xmlns/publisher/contentlibraries/slots',
    siteType: 'http://www.webhare.net/xmlns/webhare_testsuite/testsite',
    whfsPath: '/webhare-tests/*'
  }, [{ ...baseApplyToRule, match_file: true, withintype: 'http://www.webhare.net/xmlns/publisher/contentlibraries/slots', sitetype: 'http://www.webhare.net/xmlns/webhare_testsuite/testsite', whfspathmask: "/webhare-tests/*" }]);
}

test.run([
  testNaming,
  testToRules
]);
