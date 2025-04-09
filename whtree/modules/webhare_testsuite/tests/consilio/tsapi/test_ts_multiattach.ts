import { createCatalog } from "@webhare/consilio";
import * as test from "@webhare/test-backend";
import { beginWork, commitWork } from "@webhare/whdb";
import { prepConsilioTests, type TestSuffixedTestType } from "./testhelpers";

async function testMultiAttach() {
  await beginWork();
  const cat = await createCatalog<TestSuffixedTestType>("consilio:testfw_testindex_suffixed",
    {
      fieldGroups: ["webhare_testsuite:nosuchfieldyet"],
      managed: false,
      suffixed: true,
      priority: 9
    });


  const index1id = await cat.attachIndex();
  let attached = await cat.listAttachedIndices();
  test.eqPartial([{ indexName: /c_..*/ }], attached, "test for properly structured builtin indexname");
  const index2name = attached[0].indexName.substring(0, attached[0].indexName.length - 3) + "_b2";
  await cat.attachIndex({ indexName: index2name });

  attached = await cat.listAttachedIndices();
  test.eqPartial([
    { id: index1id, searchPriority: 100, indexName: attached[0].indexName },
    { searchPriority: 0, indexName: index2name }
  ], attached, "attached indices");

  const cat_index1_view = await createCatalog("consilio:testfw_index1_view", { managed: false, suffixed: true });
  await cat_index1_view.attachIndex({ indexName: attached[0].indexName });

  const cat_index2_view = await createCatalog("consilio:testfw_index2_view", { managed: false, suffixed: true });
  await cat_index2_view.attachIndex({ indexName: attached[1].indexName });

  console.log(`${await cat.getStorageInfo()}, ${await cat_index1_view.getStorageInfo()}, ${await cat_index2_view.getStorageInfo()}`);
  test.eq(attached[0].indexName, (await cat_index1_view.listAttachedIndices())[0].indexName);
  test.eq(attached[1].indexName, (await cat_index2_view.listAttachedIndices())[0].indexName);
  test.eq(index2name, (await cat_index2_view.listAttachedIndices())[0].indexName);

  await cat.applyConfiguration({ suffixes: ["sfx1", "sfx2"] });
  test.eqPartial([{ suffix: "sfx1" }, { suffix: "sfx2" }], await cat.listSuffixes());
  test.eqPartial([{ suffix: "sfx1" }, { suffix: "sfx2" }], await cat_index1_view.listSuffixes());
  test.eqPartial([{ suffix: "sfx1" }, { suffix: "sfx2" }], await cat_index2_view.listSuffixes());

  //TODO deletion, creation etc of suffixes is not fully implemented yet for multiattached indices
  //     and the actual usecase isn't clear yet (WebHare-level 'clustering' of opensearches, rebuilding indices with new fieldsets)

  await commitWork();
}


test.runTests([
  prepConsilioTests,
  testMultiAttach
]);
