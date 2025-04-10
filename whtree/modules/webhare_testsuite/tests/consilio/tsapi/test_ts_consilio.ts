import { createCatalog, openCatalog, isValidIndexName, isValidIndexSuffix, type BulkUploadError } from "@webhare/consilio";
import * as test from "@webhare/test-backend";
import { beginWork, commitWork } from "@webhare/whdb";
import { prepConsilioTests, type TestIndexDocType, type TestSuffixedTestType } from "./testhelpers";


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
  test.assert((await cat.listAttachedIndices()).length === 0); //as we just reset everything, there should be no attachments
  await beginWork();
  await cat.attachIndex();
  await commitWork();

  //FIXME We need this wait to fix a race between background consilio update creating the index but not establishing the mapping yet. can create+map be done atomically in OS ?
  await cat.waitReady(Infinity, { forStorage: true, forConfiguration: true });

  //Test bulk error handling (we weren't checking for 'create' errors earlier)
  {
    const bulk = cat.startBulkAction();
    await bulk.index({ title: "Doc 1", invalidField: 1, "@timestamp": new Date().toISOString() });

    const exc = await test.throws(/errors during/, bulk.finish({ refresh: true })) as BulkUploadError;
    test.eqPartial([{ reason: /mapping set to strict/, doc: { title: "Doc 1" } }], exc.errors);
  }

  {
    const bulk = cat.startBulkAction();
    await bulk.index({ title: "Doc 1", "@timestamp": new Date().toISOString() });
    await bulk.finish({ refresh: true });
  }

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

  //Test we can't incorrectly update it
  {
    const bulk = cat.startBulkAction();
    await bulk.index({ title: "Doc 1", invalidField: 1, "@timestamp": new Date().toISOString(), _id: docs1.hits.hits[0]._id });

    const exc = await test.throws(/errors during/, bulk.finish({ refresh: true })) as BulkUploadError;
    test.eqPartial([{ reason: /mapping set to strict/, doc: { title: "Doc 1" }, _id: docs1.hits.hits[0]._id }], exc.errors);
  }
}

async function testSuffixes() {
  await beginWork();
  const cat = await createCatalog<TestSuffixedTestType>("consilio:testfw_testindex_suffixed",
    {
      fieldGroups: ["webhare_testsuite:nosuchfieldyet"],
      managed: false,
      suffixed: true,
      priority: 9
    });

  const index1id = await cat.attachIndex();
  const attached = await cat.listAttachedIndices();
  test.eqPartial([{ id: index1id, searchPriority: 100, indexName: /c_..*/ }], attached, "test for properly structured builtin indexname");

  test.eq([], await cat.listSuffixes());

  await commitWork();
  await cat.waitReady(Infinity);

  await test.throws(/Invalid suffix/, () => cat.applyConfiguration({ suffixes: ["-badname"] }));

  // TestUnmanagedActions
  await cat.applyConfiguration({ suffixes: ["sfx1", "sfx2"] });
  test.eqPartial([{ suffix: "sfx1" }, { suffix: "sfx2" }], await cat.listSuffixes());

  await cat.deleteSuffix("sfx1");
  test.eqPartial([{ suffix: "sfx2" }], await cat.listSuffixes());

  // insert into sfx2 and sfx3, the latter gets auto-created
  {
    const inserter = cat.startBulkAction();
    await test.throws(/Invalid suffix/, () => inserter.index({ _id: "doc0", no: { such: { field: { yet: 0 } } } }, { suffix: "-invalid" }));
    await inserter.index({ _id: "doc1", no: { such: { field: { yet: 1 } } } }, { suffix: "sfx2" });
    await inserter.index({ _id: "doc2", no: { such: { field: { yet: 2 } } } }, { suffix: "sfx2" });
    await inserter.index({ _id: "doc3", no: { such: { field: { yet: 3 } } }, nosuchfieldyet_extra: "StringVeld" }, { suffix: "sfx3" });
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

  //Verify the mapping on index -sfx3
  const clientinfo = await cat.getRawClient();
  const mapping = await clientinfo.client.indices.getMapping({ index: clientinfo.indexName + "-sfx3" });
  const myMapping = mapping.body[`${clientinfo.indexName}-sfx3`].mappings;
  test.eq("keyword", myMapping.properties?.nosuchfieldyet_extra.type);
}

test.runTests([
  testBasicAPIs,
  prepConsilioTests,
  testCatalogAPI,
  testSuffixes
]);
