import * as test from "@webhare/test-backend";
import { getApplyTesterForObject } from "@webhare/whfs/src/applytester";
import { openFile } from "@webhare/whfs";
import { describeMetaTabs, remapForHs } from "@mod-publisher/lib/internal/siteprofiles/metatabs";
import { beginWork, commitWork } from "@webhare/whdb/src/whdb";
import { getTestSiteJSTemp } from "@mod-webhare_testsuite/js/testsupport";
import { loadlib } from "@webhare/harescript/src/contextvm";

async function prep() {
  await loadlib("mod::system/lib/testframework.whlib").runTestFramework([]);
}

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
            name: "folksonomy"
          }, {
            name: "whUser",
            title: ":WH User",
            component: { "http://www.webhare.net/xmlns/system/components#selectuser": { inputKind: "wrdGuid" } }
          }
        ]
      }
    ]
  }, metatabs);

  test.eqPartial({
    types: [
      {
        namespace: 'http://www.webhare.net/xmlns/webhare_testsuite/basetestprops',
        title: ':WTS base test',
        members: [
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
            name: "folksonomy"
          }, {
            name: "wh_user",
            title: ":WH User",
            component: {
              ns: "http://www.webhare.net/xmlns/system/components",
              component: "selectuser",
              yamlprops: { input_kind: "wrdGuid", value_constraints: { value_type: "string" } }
            }
          }
        ]
      }
    ]
  }, remapForHs(metatabs!));
}

async function testOverrides() {
  await beginWork();
  const tmpfolder = await getTestSiteJSTemp();
  const metaoverride1 = await tmpfolder.createFile("metaoverride1", { type: "http://www.webhare.net/xmlns/publisher/richdocumentfile" });
  await commitWork();

  { //metaoverride1
    const applyester = await getApplyTesterForObject(metaoverride1);
    const metatabs = await describeMetaTabs(applyester);

    test.eqPartial({
      types: [
        {
          namespace: 'http://www.webhare.net/xmlns/webhare_testsuite/basetestprops',
          title: ':WTS base test',
          members: [
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
              name: "folksonomy"
            }, {
              name: "whUser",
              title: ":WH Usertje",
              component: { textarea: {} }
            }
          ]
        }
      ]
    }, metatabs);
  } //end metaoverride1

}

test.run([
  prep,
  testIgnoreMetatabsForOldContent,
  testMetadataReader,
  testOverrides
]);
