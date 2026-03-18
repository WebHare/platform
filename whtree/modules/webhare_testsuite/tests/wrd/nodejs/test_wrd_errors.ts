/** test errors and regressions */

import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { createWRDTestSchema, testSchemaTag } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { beginWork, db, rollbackWork } from "@webhare/whdb";
import { WRDSchema } from "@webhare/wrd";

async function testIntegrityChecks() {
  await beginWork();
  const schema = new WRDSchema(testSchemaTag);//extendWith<SchemaUserAPIExtension>().extendWith<CustomExtensions>();

  const parentType = schema.getType("testDomain_1");
  const childType = schema.getType("testDomain1Child");

  //first break the schema
  await parentType.createAttribute("conflict", { attributeType: "string" });
  await childType.createAttribute("conflict2", { attributeType: "string" });

  await db<PlatformDB>().updateTable("wrd.attrs").set({ tag: "conflict" }).where("type", "=", (await schema.describeType("testDomain1Child"))!.id).execute();

  //this poisons the type (or perhaps the schema) to ensure that you can't use the schema
  schema.__clearCache(); //clears internal caches
  await test.throws(/duplicate attribute/, () => childType.listAttributes());

  schema.__clearCache();
  await test.throws(/duplicate attribute/, () => schema.query("testDomain1Child").select(["wrdId"]).limit(1).execute());

  schema.__clearCache();
  await test.throws(/duplicate attribute/, () => schema.insert("testDomain1Child", { wrdTitle: "test" }));

  schema.__clearCache();
  await rollbackWork();
}

test.runTests([
  async () => { await createWRDTestSchema(); }, //test.runTests doesn't like tests returning values
  testIntegrityChecks,
]);
