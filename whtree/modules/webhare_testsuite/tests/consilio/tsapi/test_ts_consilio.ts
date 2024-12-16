import { createCatalog, openCatalog, type Catalog, listCatalogs, isValidIndexName, isValidIndexSuffix } from "@webhare/consilio";
import * as test from "@webhare/test-backend";
import { beginWork, commitWork } from "@webhare/whdb";

interface TestIndexDocType {
  "@timestamp": string;
  title: string;
}

interface TestSuffixedTestType {
  no: { such: { field: { yet: number } } };
}


async function deleteTestCatalogs() {
  const testcatalogs = await listCatalogs();
  await beginWork();
  for (const catalog of testcatalogs.filter(c => c.tag.startsWith("consilio:testfw_")))
    await (await openCatalog(catalog.tag)).deleteSelf();
  await commitWork();

}

async function clearCatalog(cat: Catalog) {
  const rawclient = await cat.getRawClient();
  await rawclient.client.deleteByQuery({
    body: { query: { match_all: {} } },
    index: rawclient.indexname + rawclient.suffix,
    refresh: true
  });
}

async function testBasicAPIs() {
  test.eq(false, isValidIndexName("_abc"));
  test.eq(false, isValidIndexName(".kibana"));
  test.eq(false, isValidIndexName("KIBANA"));
  test.eq(true, isValidIndexName("mydata"));
  test.eq(false, isValidIndexName("mydata-"));
  test.eq(false, isValidIndexName("mydata_"));
  test.eq(true, isValidIndexName("my_data"));
  test.eq(false, isValidIndexName(""));

  test.eq(false, isValidIndexName("2022"));
  test.eq(false, isValidIndexName("2022-05"));

  test.eq(true, isValidIndexSuffix("2022"));
  test.eq(true, isValidIndexSuffix("2022-05"));
  test.eq(false, isValidIndexSuffix(""));
  test.eq(false, isValidIndexSuffix("-abc"));
  test.eq(false, isValidIndexSuffix("_abc"));
  test.eq(false, isValidIndexSuffix("ABC"));
  test.eq(false, isValidIndexSuffix("abc-"));
  test.eq(true, isValidIndexSuffix("abc"));
}

async function testCatalogAPI() {
  const cat = await openCatalog<TestIndexDocType>("webhare_testsuite:testindex");
  test.assert((await cat.listAttachedIndices()).length > 0);

  await clearCatalog(cat);
  const bulk = cat.startBulkAction();
  await bulk.index({ title: "Doc 1", "@timestamp": new Date().toISOString() });
  await bulk.finish({ refresh: true });

  //Find doc1
  const docs1 = await cat.search({
    body: {
      fields: [],
      _source: false,
      query: { match: { "title": "Doc 1" } }
    }
  });

  // console.dir(docs1, { depth: 10 });
  test.eqPartial({
    hits: {
      hits: [
        {
          _index: /^c_.*$/,
          _id: /^.*$/,
        }
      ]
    }
  }, docs1);

  test.assert(!("_source" in docs1.hits.hits[0]), "we didn't ask for _source so we shouldn't see it");

  const docs2 = await cat.search({
    body: {
      fields: [],
      _source: ["title"],
      query: { match: { "title": "Doc 1" } }
    }
  });

  test.eqPartial({
    hits: {
      total: { value: 1 },
      hits: [
        {
          _index: /^c_.*$/,
          _id: docs1.hits.hits[0]._id,
          _source: { title: "Doc 1" }
        }
      ]
    }
  }, docs2);
}

async function testSuffixes() {
  await beginWork();
  const cat = await createCatalog<TestSuffixedTestType>("consilio:testfw_testindex_suffixed",
    {
      fieldgroups: ["webhare_testsuite:nosuchfieldyet"],
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

  test.eq([], await cat.listSuffixes());

  const cat_index1_view = await createCatalog("consilio:testfw_index1_view", { managed: false, suffixed: true });
  await cat_index1_view.attachIndex({ indexName: attached[0].indexName });

  const cat_index2_view = await createCatalog("consilio:testfw_index2_view", { managed: false, suffixed: true });
  await cat_index2_view.attachIndex({ indexName: attached[1].indexName });

  console.log(`${await cat.getStorageInfo()}, ${await cat_index1_view.getStorageInfo()}, ${await cat_index2_view.getStorageInfo()}`);
  test.eq(attached[0].indexName, (await cat_index1_view.listAttachedIndices())[0].indexName);
  test.eq(attached[1].indexName, (await cat_index2_view.listAttachedIndices())[0].indexName);
  test.eq(index2name, (await cat_index2_view.listAttachedIndices())[0].indexName);

  await commitWork();
  await cat.waitReady(Infinity);

  await test.throws(/Invalid suffix/, () => cat.applyConfiguration({ suffixes: ["-badname"] }));

  // TestUnmanagedActions
  await cat.applyConfiguration({ suffixes: ["sfx1", "sfx2"] });
  test.eqPartial([{ suffix: "sfx1" }, { suffix: "sfx2" }], await cat.listSuffixes());
  test.eqPartial([{ suffix: "sfx1" }, { suffix: "sfx2" }], await cat_index1_view.listSuffixes());
  test.eqPartial([{ suffix: "sfx1" }, { suffix: "sfx2" }], await cat_index2_view.listSuffixes());

  await cat.deleteSuffix("sfx1");
  test.eqPartial([{ suffix: "sfx2" }], await cat.listSuffixes());

  // insert into sfx2 and sfx3, the latter gets auto-created
  {
    const inserter = cat.startBulkAction();
    await test.throws(/Invalid suffix/, () => inserter.index({ _id: "doc0", no: { such: { field: { yet: 0 } } } }, { suffix: "-invalid" }));
    await inserter.index({ _id: "doc1", no: { such: { field: { yet: 1 } } } }, { suffix: "sfx2" });
    await inserter.index({ _id: "doc2", no: { such: { field: { yet: 2 } } } }, { suffix: "sfx2" });
    await inserter.index({ _id: "doc3", no: { such: { field: { yet: 3 } } } }, { suffix: "sfx3" });
    await inserter.finish({ refresh: true });
  }

  test.eqPartial([{ suffix: "sfx2" }, { suffix: "sfx3" }], await cat.listSuffixes());

  //Search for the docs. Should automatically cover the suffixes
  const sfx2docs = await cat.search({});
  const sfx2docs_hits = sfx2docs.hits.hits.sort((a, b) => a._id.localeCompare(b._id));
  test.eqPartial([
    {
      _index: attached[0].indexName + "-sfx2",
      _id: "doc1",
      _source: { no: { such: { field: { yet: 1 } } } }
    },
    {
      _index: attached[0].indexName + "-sfx2",
      _id: "doc2",
      _source: { no: { such: { field: { yet: 2 } } } }
    },
    {
      _index: attached[0].indexName + "-sfx3",
      _id: "doc3",
      _source: { no: { such: { field: { yet: 3 } } } }
    }
  ], sfx2docs_hits);
}

test.run([
  deleteTestCatalogs,
  testBasicAPIs,
  testCatalogAPI,
  testSuffixes
]);
