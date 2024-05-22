import * as test from "@webhare/test-backend";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
import { openFile } from "@webhare/whfs";
import { describeMetaTabs } from "@mod-publisher/lib/internal/siteprofiles/metatabs";

async function testIgnoreMetatabsForOldContent() {
  //watches for global triggers of new metadata screens. we need to avoid that for now, don't surprise existing users
  const richdocfile = await openFile("site::webhare_testsuite.testsite/testpages/staticpage");
  const applyester = await getApplyTesterForObject(richdocfile);
  const metatabs = await describeMetaTabs(applyester);
  test.eq(null, metatabs);
}

async function testMetadataReader() {
  const richdocfile = await openFile("site::webhare_testsuite.testsitejs/testpages/staticpage");
  const applyester = await getApplyTesterForObject(richdocfile);
  const metatabs = await describeMetaTabs(applyester);

  test.eqPartial({
    types: [
      {
        namespace: 'http://www.webhare.net/xmlns/webhare_testsuite/basetestprops',
        title: ':WTS base test',
        members: [
          {
            name: "anyField",
            title: ":Any field"
          }, {
            name: "folksonomy"

          }
        ]
      }
    ]
  }, metatabs);
}

test.run([
  testIgnoreMetatabsForOldContent,
  testMetadataReader
]);
