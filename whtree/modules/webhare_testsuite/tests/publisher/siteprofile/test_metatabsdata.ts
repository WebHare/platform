import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { getApplyTesterForMockedObject, getApplyTesterForObject } from "@webhare/whfs/src/applytester";
import { openFile, openFolder } from "@webhare/whfs";
import { describeMetaTabs, remapForHs } from "@mod-publisher/lib/internal/siteprofiles/metatabs";
import { beginWork, commitWork } from "@webhare/whdb/src/whdb";
import { loadlib } from "@webhare/harescript/src/contextvm";

async function prep() {
  await loadlib("mod::system/lib/testframework.whlib").runTestFramework([]);
}

async function testIgnoreMetatabsForOldContent() {
  //watches for global triggers of new metadata screens. we need to avoid that for now, don't surprise existing users
  const richdocfile = await openFile("site::webhare_testsuite.testsite/testpages/staticpage");
  const applyester = await getApplyTesterForObject(richdocfile);
  const metatabs = await describeMetaTabs(applyester);
  test.eqPartial({ types: [] }, metatabs);
}

async function testMetadataReader() {
  const richdocfile = await openFile("site::webhare_testsuite.testsitejs/testpages/staticpage");
  const applyester = await getApplyTesterForObject(richdocfile);
  const metatabs = await describeMetaTabs(applyester);

  test.eqPartial({
    types: [
      {
        namespace: 'http://www.webhare.net/xmlns/webhare_testsuite/basetestprops',
        sections: [
          {
            title: ':WTS base test',
            fields: [
              {
                name: "anyField",
                title: ":Any field",
                component: { textedit: { valueConstraints: { maxBytes: 4096 } } }
              }, {
                name: "numberField",
                constraints: {
                  valueType: "integer",
                  minValue: 0,
                  maxValue: 100
                },
                component: { textedit: { valueType: 'integer', suffix: "kg", emptyValue: 1 } }
              }, {
                name: "whUser",
                title: "~username",
                component: { "http://www.webhare.net/xmlns/system/components#selectuser": { inputKind: "wrdGuid" } }
              }, {
                name: "rtd"
              }, {
                name: "multiField"
              }, {
                name: "checkIt"
              }, {
                name: "extControlledField"
              }
            ]
          }, {
            title: ":Folksonomy tags",
            fields: [
              {
                name: "folksonomy"
              }
            ]
          },
        ]
      }
    ]
  }, metatabs);

  test.eqPartial({
    types: [
      {
        namespace: 'http://www.webhare.net/xmlns/webhare_testsuite/basetestprops',
        sections: [
          {
            title: ':WTS base test',
            fields: [
              {
                name: "any_field",
                title: ":Any field",
                component: {
                  ns: "http://www.webhare.net/xmlns/tollium/screens",
                  component: "textedit",
                  yamlprops: { value_constraints: { max_bytes: 4096 } }
                }
              }, {
                name: "number_field",
                constraints: {
                  value_type: "integer",
                  min_value: 0,
                  max_value: 100
                },
                component: {
                  ns: "http://www.webhare.net/xmlns/tollium/screens",
                  component: "textedit",
                  yamlprops: { value_type: "integer", value_constraints: { max_value: 100 } }
                }
              }, {
                name: "wh_user",
                title: "~username",
                component: {
                  ns: "http://www.webhare.net/xmlns/system/components",
                  component: "selectuser",
                  yamlprops: { input_kind: "wrdGuid", value_constraints: { value_type: "string" } }
                }
              }, {
                name: "rtd"
              }, {
                name: "multi_field"
              }, {
                name: "check_it"
              }, {
                name: "ext_controlled_field"
              }
            ]
          }, {
            title: ":Folksonomy tags",
            fields: [
              {
                name: "folksonomy"
              }
            ]
          }
        ]
      }
    ]
  }, remapForHs(metatabs!));
}

async function testOverrides() {
  await beginWork();
  const tmpfolder = await test.getTestSiteJSTemp();
  const metaoverride1 = await tmpfolder.createFile("metaoverride1", { type: "http://www.webhare.net/xmlns/publisher/richdocumentfile" });
  await commitWork();

  { //metaoverride1
    const applyester = await getApplyTesterForObject(metaoverride1);
    const metatabs = await describeMetaTabs(applyester);

    test.eqPartial({
      types: [
        {
          namespace: 'http://www.webhare.net/xmlns/webhare_testsuite/basetestprops',
          sections: [
            {
              title: ':WTS base test',
              fields: [
                {
                  name: "anyField",
                  title: ":Any field",
                  component: { textedit: { valueConstraints: { maxBytes: 4096 } } }
                }, {
                  name: "numberField",
                  constraints: {
                    valueType: "integer",
                    minValue: 0,
                    maxValue: 100
                  },
                  component: { textedit: { valueType: 'integer', suffix: "kg", emptyValue: 2 } }
                }, {
                  name: "whUser",
                  title: ":WH Usertje",
                  component: { textarea: {} }
                }, {
                  name: "rtd"
                }, {
                  name: "multiField"
                }, {
                  name: "checkIt"
                }, {
                  name: "extControlledField"
                }
              ]
            }, {
              title: ":Folksonomy tags",
            },
          ]
        }
      ]
    }, metatabs);
  } //end metaoverride1
}

async function getMockTestApplyTester(name: string) {
  const testpages = await openFolder("site::webhare_testsuite.testsitejs/testpages");
  return await getApplyTesterForMockedObject(testpages, false, "http://www.webhare.net/xmlns/publisher/richdocumentfile", name);
}

async function testAllTypes() {
  const allpropsTabs = await describeMetaTabs(await getMockTestApplyTester("allprops"));
  test.eq([":WTS base test", ":Folksonomy tags", ":WTS Generic", ":rich"], allpropsTabs?.types.map(t => t.sections.map(s => s.title)).flat());

  const wtsgenerictab = allpropsTabs!.types[1].sections[0];
  test.eqPartial({ title: ":str" }, wtsgenerictab.fields.find(_ => _.name === 'str'));
  test.eqPartial({ component: { fileedit: {} } }, wtsgenerictab.fields.find(_ => _.name === 'blub')); //TODO but shouldn't it actually be an image?
  test.eqPartial([
    { name: "blub", component: { fileedit: {} } },
    { name: "blubImg", component: { imgedit: {} } },
  ], wtsgenerictab.fields.filter(_ => _.name === 'blub' || _.name === 'blubImg'));
  test.eqPartial([
    { name: "aDateTime", component: { datetime: { type: "datetime", storeUTC: true } } },
    { name: "aDay", component: { datetime: { type: "date", storeUTC: false } } },
  ], wtsgenerictab.fields.filter(_ => _.name === 'aDateTime' || _.name === 'aDay'));

  const missingSuggestions = wtsgenerictab.fields.filter(_ => _.component?.text?.value && _.component?.text?.enabled === false);
  //TODO can we solve these all? at least prevent more from appearing
  test.eq(["aDoc", "aRecord", "aTypedRecord", "anArray", "anInstance", "myLink", "strArray"], missingSuggestions.map(_ => _.name).sort());

  const manualTabs = await describeMetaTabs(await getMockTestApplyTester("manualtabs"));
  // console.dir(manualTabs, { depth: 10 });
  test.eqPartial([
    { title: ":Tab 1", fields: [{ name: "anyField" }, { name: "numberField" }, { name: "whUser" }] },
    { title: ":Folksonomy tags", fields: [{ name: "folksonomy" }] },
    { title: "webhare_testsuite:webdesigns.basetestjs.tab2", fields: [{ name: "rtd" }, { name: "checkIt" }] }
  ], manualTabs?.types[0].sections);
}

test.runTests([
  prep,
  testIgnoreMetatabsForOldContent,
  testMetadataReader,
  testOverrides,
  testAllTypes
]);
