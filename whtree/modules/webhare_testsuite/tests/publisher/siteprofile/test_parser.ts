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
        scopedtype: 'webhare_testsuite:myTypes.testType',
        type: 'contenttype',
        title: "webhare_testsuite:base.gid.test_type",
        members:
          [
            { name: 'number_field', type: CSPMemberType.Integer, title: "webhare_testsuite:base.gid.number_field" },
            { name: 'other_field', type: CSPMemberType.String, title: ":My other field" },
            {
              name: 'array_field', type: CSPMemberType.Array, children:
                [{ name: 'sub_field', type: CSPMemberType.String, title: "webhare_testsuite:base.gid.sub_field" }]
            }
          ]
      },
      {
        namespace: 'x-webhare-scopedtype:webhare_testsuite.my_types.test_type2',
        scopedtype: 'webhare_testsuite:myTypes.testType2',
        type: 'contenttype',
        title: "webhare_testsuite:base.gid.tt2.test_type2",
        members:
          [{ name: 'string_field', type: CSPMemberType.String, title: "webhare_testsuite:base.gid.tt2.string_field" }]
      }
    ]
  }, await parseSP(`---
typeGroup: myTypes
gid: base.gid
types:
  testType:
    members:
      numberField:
        type: integer
      otherField:
        type: string
        title: My other field
      arrayField:
        type: array
        members:
          subField:
            type: string
  testType2:
    gid: .tt2
    members:
      stringField:
        type: string
`));
}

test.run([testSPYaml]);
