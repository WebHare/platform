import * as test from "@webhare/test";
import * as whfs from "@webhare/whfs";

async function testMockedTypes() {
  const builtin_normalfoldertype = await whfs.describeContentType("http://www.webhare.net/xmlns/publisher/normalfolder");
  test.eq("http://www.webhare.net/xmlns/publisher/normalfolder", builtin_normalfoldertype.namespace);
  test.eq("folderType", builtin_normalfoldertype.metaType);

  test.eq("http://www.webhare.net/xmlns/publisher/normalfolder", builtin_normalfoldertype.namespace);

  const builtin_unknownfiletype = await whfs.describeContentType("http://www.webhare.net/xmlns/publisher/unknownfile");
  test.eq("http://www.webhare.net/xmlns/publisher/unknownfile", builtin_unknownfiletype.namespace);
  test.eq("fileType", builtin_unknownfiletype.metaType);
  test.eq(false, builtin_unknownfiletype.isWebPage);

  await test.throws(/No such type/, () => whfs.describeContentType("http://www.webhare.net/xmlns/publisher/nosuchfiletype"));
  await test.throws(/No such type/, () => whfs.describeContentType("http://www.webhare.net/xmlns/publisher/nosuchfiletype", { metaType: "fileType" }));
  test.eq(null, await whfs.describeContentType("http://www.webhare.net/xmlns/publisher/nosuchfiletype", { allowMissing: true }));
  const nosuchfiletype = await whfs.describeContentType("http://www.webhare.net/xmlns/publisher/nosuchfiletype", { allowMissing: true, metaType: "fileType" });
  test.eq("http://www.webhare.net/xmlns/publisher/nosuchfiletype", nosuchfiletype.namespace);
  test.eq("fileType", nosuchfiletype.metaType);
  test.eq(false, nosuchfiletype.isWebPage);

  const htmltype = await whfs.describeContentType(5);
  test.eq("http://www.webhare.net/xmlns/publisher/htmlfile", htmltype.namespace);

  const rtdtype = await whfs.describeContentType("http://www.webhare.net/xmlns/publisher/richdocumentfile");
  test.eqProps({ name: "data", type: "richdocument" }, rtdtype.members.find(_ => _.name === "data"));

  //verify some corner cases
  await test.throws(/No such type/, () => whfs.describeContentType("", { allowMissing: true }));
  test.eq(null, await whfs.describeContentType(0, { allowMissing: true }));
  await test.throws(/No such type/, () => whfs.describeContentType("", { allowMissing: true, metaType: "fileType" }));
  test.eqProps({ title: ":#777777777777", namespace: "#777777777777", metaType: "fileType" }, await whfs.describeContentType(777777777777, { allowMissing: true, metaType: "fileType" }));

  //TODO ensure that orphans return a mockedtype unless you explicitly open in orphan mode. But consider whether we really want to describe orphans as that will require describe to be async!
}

test.run([testMockedTypes]);
