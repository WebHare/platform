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
        yaml: true,
        members:
          [
            {
              name: 'number_field',
              jsname: "numberField",
              type: CSPMemberType.Integer,
              title: "webhare_testsuite:base.gid.number_field",
              comment: "Got a comment",
              constraints: {
                valueType: "integer",
                minValue: -217483648,
                maxValue: 217483647
              }
            },
            { name: 'other_field', type: CSPMemberType.String, title: ":My other field" },
            {
              name: 'array_field', type: CSPMemberType.Array, children:
                [{ name: 'sub_field', jsname: "subField", type: CSPMemberType.String, title: "webhare_testsuite:base.gid.sub_field" }]
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
        comment: Got a comment
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

  // Test basic extendproperties
  test.eqPartial({
    contenttypes: [
      {
        scopedtype: 'webhare_testsuite:myTypes.testType',
      }
    ],
    rules: [
      {
        tos: [{ filetype: 'http://www.webhare.net/xmlns/publisher/richdocumentfile' }],
        applyindex: 0,
        baseproperties: { description: false, seotitle: true, haslist: ["description", "seotitle", "keywords", "seotab", "striprtdextension", "seotabrequireright"] },
        yaml: true,
        extendproperties: [
          {
            contenttype: 'webhare_testsuite:myTypes.testType',
            layout: ['folksonomy', 'numberField']
          }
        ]
      }
    ]

  }, await parseSP(`---
typeGroup: myTypes
types:
  testType:
    members:
      numberField:
        type: integer
      folksonomy:
        type: whfsrefarray
apply:
- to:
    fileType: http://www.webhare.net/xmlns/publisher/richdocumentfile
  baseProps: [seotitle]
  editProps:
    - type: testType
      layout: [folksonomy,numberField]
`));

  // Test input constraint merging
  test.eqPartial({
    contenttypes: [
      {
        scopedtype: 'webhare_testsuite:myTypes.testType',
        members:
          [
            {
              jsname: "numberField",
              type: CSPMemberType.Integer,
              constraints: {
                valueType: "integer",
                minValue: 0
              }
            },
            {
              jsname: "folksonomy"
            }
          ]
      }
    ],
    rules: [
      {
        tos: [{ filetype: 'http://www.webhare.net/xmlns/publisher/richdocumentfile' }],
        applyindex: 0,
        baseproperties: { description: false, seotitle: true, haslist: ["description", "seotitle", "keywords", "seotab", "striprtdextension", "seotabrequireright"] },
        yaml: true,
        extendproperties: [
          {
            contenttype: 'webhare_testsuite:myTypes.testType',
            override: {
              'numberField': {
                constraints: {
                  //NOTE the parser doesn't merge constraints between editProps and Type yet, they may be in different files
                  maxValue: 100
                }
              }
            }
          }
        ]
      }
    ]
  }, await parseSP(`---
typeGroup: myTypes
types:
  testType:
    members:
      numberField:
        type: integer
        constraints:
          minValue: 0
      folksonomy:
        type: whfsrefarray
apply:
- to:
    fileType: http://www.webhare.net/xmlns/publisher/richdocumentfile
  baseProps: [seotitle]
  editProps:
    - type: testType
      override:
         numberField:
          constraints:
            maxValue: 100
      `));

  //TODO add a file or foldertype and use that to prove 'apply to type:' works for a scoped type
  //     for backwardscompat/clarity no harm in separating old filetype/foldertype matching from new scopedtype matching,
  //     especially as reusing old types also requires matching their wildcard/glob rules
}

test.run([testSPYaml]);
