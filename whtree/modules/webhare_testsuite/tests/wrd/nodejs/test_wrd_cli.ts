import { WRDSchema } from "@webhare/wrd";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { createWRDTestSchema, testSchemaTag, type CustomExtensions } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import type { Combine, WRDInsertable } from "@webhare/wrd/src/types";
import type { WRD_TestschemaSchemaType } from "@mod-platform/generated/wrd/webhare";
import { buildRTD, ResourceDescriptor } from "@webhare/services";
import { beginWork, commitWork } from "@webhare/whdb";
import { spawnSync } from "node:child_process";
import type { RTDExport } from "@webhare/services/src/richdocument";
import { omit } from "@webhare/std";


async function testWRDCli() { //  tests
  type TestSchemaType = Combine<[WRD_TestschemaSchemaType, CustomExtensions]>;
  const wrdschema = new WRDSchema<TestSchemaType>(testSchemaTag);
  await createWRDTestSchema();

  await beginWork();
  const testunit = await wrdschema.insert("whuserUnit", { wrdTitle: "Root unit", wrdTag: "TESTFW_ROOT_UNIT" });
  const fish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { getHash: true, getImageMetadata: true });
  const newPerson = await wrdschema.insert("wrdPerson", {
    wrdFirstName: "Alice",
    wrdLastName: "Smith",
    wrdContactEmail: "alice.smith@beta.webhare.net",
    richie: await buildRTD([{ p: ["Dit is een test met image: ", { image: fish }] }]),
    whuserUnit: testunit,
    wrdauthAccountStatus: { status: "active" },
  });

  await commitWork();

  const clonableAttributes = (await wrdschema.getType("wrdPerson").listAttributes()).
    filter(attr => !["wrdId", "wrdGuid", "wrdType", "wrdTitle", "wrdFullName", "wrdContactEmail"].includes(attr.tag)).
    map(_ => _.tag) as Array<keyof WRDInsertable<TestSchemaType["wrdPerson"]>>;
  const original = await wrdschema.getFields("wrdPerson", newPerson, clonableAttributes);

  for (const resourceMode of ["fetch", "base64"] as const) {
    const options = resourceMode === "fetch" ? [] : ["--resources", "base64"];

    const exportResult = spawnSync("wh", ["wrd", "get-entity", "--json", ...options, String(newPerson)], { shell: false, encoding: "utf-8", stdio: ['inherit', 'pipe', 'inherit'] });
    test.eq(0, exportResult.status, "wrd export command should succeed");
    const exportData = JSON.parse(exportResult.stdout);
    const richieFirstParagraph = (exportData.richie as RTDExport)[0];
    test.assert("tag" in richieFirstParagraph && richieFirstParagraph.tag === "p");
    const imageNode = richieFirstParagraph.items[1];
    test.assert("image" in imageNode);

    if (resourceMode === "base64") {
      test.assert("base64" in imageNode.image.data);
    } else {
      test.assert(!("base64" in imageNode.image.data));
    }

    const insertPerson = omit(exportData, ["wrdId", "wrdGuid"]);
    insertPerson.wrdContactEmail = `import-${resourceMode}@beta.webhare.net`;
    const insertResult = spawnSync("wh", ["wrd", "create-entity", "--json", testSchemaTag, "wrdPerson", "-"], { shell: false, encoding: "utf-8", input: JSON.stringify(insertPerson), stdio: ['pipe', 'pipe', 'inherit'] });
    test.eq(0, insertResult.status, "wrd insert command should succeed");
    const insertOutput = JSON.parse(insertResult.stdout);

    const inserted = await wrdschema.getFields("wrdPerson", insertOutput.wrdId, clonableAttributes);
    test.eq(original, inserted);
  }
}

test.runTests([
  //basic exports to get typings right
  testWRDCli,
]);
