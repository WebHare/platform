import * as test from "@webhare/test";
import * as whfs from "@webhare/whfs";

async function testMockedTypes() {
  const builtin_normalfoldertype = whfs.describeContentType("http://www.webhare.net/xmlns/publisher/normalfolder");
  test.eq("http://www.webhare.net/xmlns/publisher/normalfolder", builtin_normalfoldertype.namespace);
  test.eq("foldertype", builtin_normalfoldertype.kind);

  test.eq("http://www.webhare.net/xmlns/publisher/normalfolder", builtin_normalfoldertype.namespace);

  const builtin_unknownfiletype = whfs.describeContentType("http://www.webhare.net/xmlns/publisher/unknownfile");
  test.eq("http://www.webhare.net/xmlns/publisher/unknownfile", builtin_unknownfiletype.namespace);
  test.eq("filetype", builtin_unknownfiletype.kind);
  test.eq(false, builtin_unknownfiletype.iswebpage);

  await test.throws(/No such type/, () => whfs.describeContentType("http://www.webhare.net/xmlns/publisher/nosuchfiletype"));
  await test.throws(/No such type/, () => whfs.describeContentType("http://www.webhare.net/xmlns/publisher/nosuchfiletype", { kind: "filetype" }));
  test.eq(null, whfs.describeContentType("http://www.webhare.net/xmlns/publisher/nosuchfiletype", { allowMissing: true }));
  const nosuchfiletype = whfs.describeContentType("http://www.webhare.net/xmlns/publisher/nosuchfiletype", { allowMissing: true, kind: "filetype" });
  test.eq("http://www.webhare.net/xmlns/publisher/nosuchfiletype", nosuchfiletype.namespace);
  test.eq("filetype", nosuchfiletype.kind);
  test.eq(false, nosuchfiletype.iswebpage);

  const htmltype = whfs.describeContentType(5);
  test.eq("http://www.webhare.net/xmlns/publisher/htmlfile", htmltype.namespace);

  const rtdtype = whfs.describeContentType("http://www.webhare.net/xmlns/publisher/richdocumentfile");
  test.eqProps({ name: "data", type: "richdocument" }, rtdtype.members.find(_ => _.name === "data"));

  //verify some corner cases
  await test.throws(/No such type/, () => whfs.describeContentType("", { allowMissing: true }));
  test.eq(null, whfs.describeContentType(0, { allowMissing: true }));
  await test.throws(/No such type/, () => whfs.describeContentType("", { allowMissing: true, kind: "filetype" }));
  test.eqProps({ title: ":#777777777777", namespace: "#777777777777", kind: "filetype" }, whfs.describeContentType(777777777777, { allowMissing: true, kind: "filetype" }));

  //TODO ensure that orphans return a mockedtype unless you explicitly open in orphan mode. But consider whether we really want to describe orphans as that will require describe to be async!
}

test.run([testMockedTypes]);
