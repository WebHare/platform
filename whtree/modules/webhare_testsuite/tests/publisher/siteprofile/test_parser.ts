import * as test from "@webhare/test-backend";
import { parseSiteProfile } from "@mod-publisher/lib/internal/siteprofiles/parser";
import { CSPMemberType } from "@webhare/whfs/src/siteprofiles";

async function parseSP(content: string) {
  return await parseSiteProfile("mod::webhare_testsuite/tests/publisher/siteprofile/data/test.siteprl.yml", { content });
}

async function testSPYaml() {
  await test.throws(/does not have a typeGroup/, parseSP(`---
types:
  testType:
`));

  test.eqPartial({
    contenttypes: [
      {
        namespace: 'x-webhare-scopedtype:webhare_testsuite.my_types.test_type',
        scopedtype: 'webhare_testsuite.my_types.test_type',
        type: 'contenttype',
        members:
          [{ name: 'number_field', type: CSPMemberType.Integer }]
      }
    ]
  }, await parseSP(`---
typeGroup: myTypes
types:
  testType:
    members:
      numberField:
        type: integer
`));
}

test.run([testSPYaml]);
