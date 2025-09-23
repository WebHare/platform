import * as test from "@webhare/test-backend";
import { readAndParseSiteProfile } from "@mod-publisher/lib/internal/siteprofiles/parser";
import { CSPMemberType } from "@webhare/whfs/src/siteprofiles";
import { getExtractedHSConfig } from "@mod-system/js/internal/configuration";

async function parseSP(content: string) {
  return await readAndParseSiteProfile("mod::webhare_testsuite/tests/publisher/siteprofile/data/test.siteprl.yml", { overridetext: content });
}

async function testSPCompiler() {
  const csp = getExtractedHSConfig("siteprofiles");
  const basetestjs_yamlrules = csp.applies.filter(rule => rule.siteprofile.endsWith("/basetestjs.siteprl.yml"));
  test.eqPartial([
    {
      applyindex: 0
    }, {
      applyindex: 1
    }, {
      applyindex: 2,
    }, {
      applyindex: 3
    }
  ], basetestjs_yamlrules);
}

async function testSPYaml() {
  test.eqPartial({
    contenttypes: [
      {
        namespace: 'x-webhare-scopedtype:webhare_testsuite.my_types.test_type',
        scopedtype: 'webhare_testsuite:my_types.test_type',
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
            {
              name: 'other_field',
              jsname: 'otherField',
              type: CSPMemberType.String,
              title: ":My other field",
              layout: 'section'
            },
            {
              name: 'array_field', type: CSPMemberType.Array, children:
                [
                  {
                    name: 'sub_field',
                    jsname: "subField",
                    type: CSPMemberType.String,
                    title: "webhare_testsuite:base.gid.sub_field"
                  }, {
                    name: 'record_field',
                    jsname: "recordField",
                    type: CSPMemberType.Record,
                    title: "webhare_testsuite:base.gid.record_field",
                    children: [
                      { jsname: "subImageField", type: CSPMemberType.File, title: "webhare_testsuite:base.gid.sub_image_field" },
                      {
                        jsname: "subArrayField", type: CSPMemberType.Array, children: [
                          {
                            jsname: "subRecordField", children: [{ jsname: "subSubString" }]
                          }
                        ]
                      }
                    ]
                  }
                ]
            }
          ]
      },
      {
        namespace: 'x-webhare-scopedtype:webhare_testsuite.my_types.test_type2',
        scopedtype: 'webhare_testsuite:my_types.test_type2',
        type: 'contenttype',
        title: "webhare_testsuite:base.gid.tt2.test_type2",
        members:
          [{ name: 'string_field', type: CSPMemberType.String, title: "webhare_testsuite:base.gid.tt2.string_field" }]
      }
    ]
  }, await parseSP(`---
typeGroup: my_types
gid: base.gid
types:
  test_type:
    members:
      numberField:
        type: integer
        comment: Got a comment
      otherField:
        type: string
        title: My other field
        layout: section
      arrayField:
        type: array
        members:
          subField:
            type: string
          recordField:
            type: record
            members:
              subImageField:
                type: file
              subArrayField:
                type: array
                members:
                  subRecordField:
                    type: record
                    members:
                      subSubString:
                        type: string
  test_type2:
    gid: .tt2
    members:
      stringField:
        type: string
`));

  // Test no attempted tid generation if no base gids given
  test.eqPartial({
    contenttypes: [
      {
        namespace: 'x-webhare-scopedtype:webhare_testsuite.my_types.test_type',
        title: "",
        members:
          [
            {
              jsname: "numberField",
              title: ""
            }
          ]
      }
    ]
  }, await parseSP(`---
typeGroup: my_types
types:
  test_type:
    members:
      numberField:
        type: integer
`));

  // Test basic extendproperties
  test.eqPartial({
    contenttypes: [
      {
        scopedtype: 'webhare_testsuite:my_types.test_type',
      }
    ],
    rules: [
      {
        tos: [
          {
            whfstype: 'http://www.webhare.net/xmlns/publisher/richdocumentfile',
            whfspathmask: "*seofiles*"
          }
        ],
        applyindex: 0,
        baseproperties: {
          description: false, seotitle: true, haslist: ["DESCRIPTION", "KEYWORDS", "NOARCHIVE", "NOFOLLOW", "NOINDEX", "SEOTITLE", "SEOTAB", "SEOTABREQUIRERIGHT", "STRIPRTDEXTENSION", "TITLE"]
        },
        yaml: true,
        extendproperties: [
          {
            contenttype: 'webhare_testsuite:my_types.test_type',
            layout: ['folksonomy', 'numberField']
          }, {
            contenttype: 'http://www.webhare.net/xmlns/example/somelegacytype',
            layout: "all"
          }, {
            contenttype: 'mymod:global.type',
            layout: undefined
          }, {
            contenttype: 'webhare_testsuite:thismod.type',
            layout: undefined
          }
        ]
      }
    ]

  }, await parseSP(`---
types:
  my_types.test_type:
    members:
      numberField:
        type: integer
      folksonomy:
        type: whfsrefarray
apply:
- to:
    type: http://www.webhare.net/xmlns/publisher/richdocumentfile
    whfsPath: "*seofiles*"
  baseProps: [seotitle]
  editProps:
    - type: my_types.test_type
      layout: [folksonomy,numberField]
    - type: http://www.webhare.net/xmlns/example/somelegacytype
      layout: all
    - type: mymod:global.type
    - type: thismod.type
`));

  // Test input constraint merging
  test.eqPartial({
    contenttypes: [
      {
        scopedtype: 'webhare_testsuite:my_types.test_type',
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
        tos: [{ whfstype: 'http://www.webhare.net/xmlns/publisher/richdocumentfile' }],
        applyindex: 0,
        baseproperties: { description: false, seotitle: true, haslist: ["DESCRIPTION", "KEYWORDS", "NOARCHIVE", "NOFOLLOW", "NOINDEX", "SEOTITLE", "SEOTAB", "SEOTABREQUIRERIGHT", "STRIPRTDEXTENSION", "TITLE"] },
        yaml: true,
        extendproperties: [
          {
            contenttype: 'webhare_testsuite:my_types.test_type',
            override: Object.entries({
              'numberField': {
                constraints: {
                  //NOTE the parser doesn't merge constraints between editProps and Type yet, they may be in different files
                  maxValue: 100
                }
              }
            })
          }
        ]
      }
    ]
  }, await parseSP(`---
typeGroup: my_types
types:
  test_type:
    members:
      numberField:
        type: integer
        constraints:
          minValue: 0
      folksonomy:
        type: whfsrefarray
apply:
- to:
    type: http://www.webhare.net/xmlns/publisher/richdocumentfile
  baseProps: [seotitle]
  editProps:
    - type: test_type
      override:
         numberField:
          constraints:
            maxValue: 100
      `));


  // Test explicit components
  test.eqPartial({
    contenttypes: [
      {
        scopedtype: 'webhare_testsuite:my_types.sub.test_type',
        members:
          [
            {
              jsname: "whUser",
              type: CSPMemberType.String,
              component: {
                ns: "http://www.webhare.net/xmlns/system/components",
                component: "selectuser",
                yamlprops: { input_kind: "wrdGuid" }
              }
            }
          ]
      }
    ],
    rules: [
      {
        tos: [{ whfstype: 'http://www.webhare.net/xmlns/publisher/richdocumentfile' }],
        applyindex: 0,
        baseproperties: { description: false, seotitle: true, haslist: ["DESCRIPTION", "KEYWORDS", "NOARCHIVE", "NOFOLLOW", "NOINDEX", "SEOTITLE", "SEOTAB", "SEOTABREQUIRERIGHT", "STRIPRTDEXTENSION", "TITLE"] },
        yaml: true,
        extendproperties: [
          {
            contenttype: 'webhare_testsuite:sub.test_type',
            override: Object.entries({
              'numberField': {
                constraints: {
                  //NOTE the parser doesn't merge constraints between editProps and Type yet, they may be in different files
                  maxValue: 100
                },
                props: { "empty_value": 5 },
                layout: 'section' as const
              }
            })
          }
        ]
      }
    ]
  }, await parseSP(`---
typeGroup: my_types
types:
  sub.test_type:
    members:
      whUser:
        type: string
        title: WH User
        component:
          "http://www.webhare.net/xmlns/system/components#selectuser":
            inputKind: wrdGuid
apply:
- to:
    type: http://www.webhare.net/xmlns/publisher/richdocumentfile
  baseProps: [seotitle]
  editProps:
    - type: sub.test_type
      override:
        numberField:
          layout: section
          constraints:
            maxValue: 100
          props:
            emptyValue: 5
      `));

  // Test explicit components - <line>
  test.eqPartial({
    contenttypes: [
      {
        members:
          [
            {
              jsname: "multiField",
              type: CSPMemberType.Record,
              title: ":Mullti field",
              children: [
                { jsname: "num1", type: CSPMemberType.Integer },
                { jsname: "num2", type: CSPMemberType.Integer }
              ],
              component: {
                component: "__yamlholder",
                yamlprops: {
                  lines: [
                    {
                      line: {
                        parts: [
                          { textedit: { name: "num1", value_type: "integer" } },
                          { text: { value: " to " } },
                          { textedit: { name: "num2", value_type: "integer" } }
                        ]
                      }
                    }
                  ]
                }
              }
            }
          ]
      }
    ]
  }, await parseSP(`---
typeGroup: my_types
types:
  test_type:
    members:
      multiField:
        type: record
        title: Mullti field
        members:
          num1:
            type: integer
          num2:
            type: integer
        lines:
        - line:
            parts:
            - textedit:
                name: num1
                valueType: integer
            - text:
                value: " to "
            - textedit:
                name: num2
                valueType: integer
      `));


  //TODO add a file or foldertype and use that to prove 'apply to type:' works for a scoped type
  //     for backwardscompat/clarity no harm in separating old filetype/foldertype matching from new scopedtype matching,
  //     especially as reusing old types also requires matching their wildcard/glob rules
}

async function testComplexTo() {
  // Test explicit components
  test.eqPartial({
    rules: [
      {
        yaml: true,
        tos: [
          {
            type: "and",
            criteria: [
              {
                type: "to",
                match_file: true,
              }, {
                type: "not",
                criteria: [
                  {
                    type: "and",
                    criteria: [
                      {
                        type: "to",  //isIndex
                        match_file: true,
                        match_index: true
                      }, {
                        type: "to", //parenPath /
                        parentmask: "/"
                      }
                    ]
                  }
                ]
              }, {
                type: "not",
                criteria: [
                  {
                    type: "or",
                    criteria: [
                      {
                        type: "to",
                        whfstype: "https://example.nl/innovations"
                      },
                      {
                        type: "to",
                        parenttype: "https://example.nl/programfolder"
                      }
                    ]
                  }
                ]
              }, {
                type: "not",
                criteria: [
                  {
                    type: "testdata",
                    typedef: "https://example.nl/page",
                    target: "self",
                    membername: "header_content_per_slide",
                    value: "true"
                  }
                ]
              }
            ]
          }
        ],
        userdata: [{ key: "webhare_testsuite:match_first", value: "Yes" }]
      },
    ]
  }, await parseSP(`---
apply:
- to:
    and:
    - isFile
    - not:
        and:
        - isIndex
        - parentPath: /
    - not:
        or:
        - type: https://example.nl/innovations
        - parentType: https://example.nl/programfolder
    - not:
        testSetting:
          target: self
          type: https://example.nl/page
          member: headerContentPerSlide
          value: "true"
  userData:
    matchFirst: "Yes"
`));
}

test.runTests([
  testSPCompiler,
  testSPYaml,
  testComplexTo
]);
