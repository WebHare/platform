import * as test from "@mod-webhare_testsuite/js/wts-backend";
import { buildRTD, buildWidget, ResourceDescriptor, RichTextDocument, WebHareBlob } from "@webhare/services";
import { buildRTDFromHareScriptRTD, exportAsHareScriptRTD, type HareScriptRTD } from "@webhare/hscompat";
import { beginWork, commitWork, rollbackWork, runInWork } from "@webhare/whdb";
import { openType } from "@webhare/whfs";
import { loadlib } from "@webhare/harescript";
import { createWRDTestSchema, getWRDSchema } from "@mod-webhare_testsuite/js/wrd/testhelpers";
import { buildWHFSInstance, type RTDBlock, type RTDBlockItem, type RTDBuildSource, type ExportableRTD, type WHFSInstance } from "@webhare/services/src/richdocument";

// An exportable RTD should always be a valid input source
({} as ExportableRTD) satisfies RTDBuildSource;

async function verifySimpleRoundTrip(doc: RichTextDocument) {
  const exported = await doc.export();
  const docFromExported = await buildRTD(exported);
  test.eq(doc.blocks, docFromExported.blocks);

  const hs = await exportAsHareScriptRTD(doc);
  const doc2 = await buildRTDFromHareScriptRTD(hs);
  test.eq(doc.blocks, doc2.blocks);
  return hs;
}

const roundTripTests = new Array<{
  hs: HareScriptRTD;
  doc: RichTextDocument;
}>;

async function verifyRoundTrip(doc: RichTextDocument) {
  const hs = await verifySimpleRoundTrip(doc);
  roundTripTests.push({ hs, doc });

  //Test roundtrip through WHFS
  await beginWork();
  const tempfile = await (await test.getTestSiteJSTemp()).ensureFile("roundtrip", { type: "http://www.webhare.net/xmlns/publisher/richdocumentfile" });
  await openType("http://www.webhare.net/xmlns/publisher/richdocumentfile").set(tempfile.id, { data: doc });
  const doc3 = (await openType("http://www.webhare.net/xmlns/publisher/richdocumentfile").get(tempfile.id)).data as RichTextDocument;
  test.eq(doc.blocks, doc3.blocks);

  //Test roundtrip through HareScript WHFS SetInstanceData
  //FIXME this should also set whfsSettingId and whfsFileId again on instances?
  const hsWHFSType = await loadlib("mod::system/lib/whfs.whlib").openWHFSType("http://www.webhare.net/xmlns/publisher/richdocumentfile");
  await hsWHFSType.setInstanceData(tempfile.id, { data: hs });
  const doc4 = (await openType("http://www.webhare.net/xmlns/publisher/richdocumentfile").get(tempfile.id)).data as RichTextDocument;
  test.eq(doc.blocks, doc4.blocks);

  //Test roundtrip through HareScript WHFS GetInstanceData
  const hsInstance = await hsWHFSType.getInstanceData(tempfile.id);
  const doc5 = await buildRTDFromHareScriptRTD(hsInstance.data);
  test.eq(doc.blocks, doc5.blocks);

  await rollbackWork();
}

async function verifyWidgetRoundTrip(widget: WHFSInstance) {
  const testtype = openType("x-webhare-scopedtype:webhare_testsuite.global.generic_test_type");
  test.eq(await widget.export(), await (await buildWHFSInstance(await widget.export())).export());

  await beginWork();
  const tempfile = await (await test.getTestSiteJSTemp()).ensureFile("roundtrip", { type: "http://www.webhare.net/xmlns/publisher/richdocumentfile" });
  await testtype.set(tempfile.id, { anInstance: widget });
  await commitWork();
  // console.log(await widget.export());

  const returnedWidget = (await testtype.get(tempfile.id)).anInstance as WHFSInstance;
  // console.log(await returnedWidget.export());
  test.eqPartial(await returnedWidget.export(), await widget.export());
}


async function testBuilder() {
  // eslint-disable-next-line no-constant-condition -- TS API type tests
  if (false) {
    ({ text: "A text", bold: true }) satisfies RTDBlockItem;
    ///@ts-expect-error kabooya is not valid
    ({ text: "A text", bold: true, kabooya: true }) satisfies RTDBlockItem;
    ({ text: "text-me", link: "https://webhare.dev/" }) satisfies RTDBlockItem;
    ({ text: "text-me", link: "https://webhare.dev/", target: "_blank" }) satisfies RTDBlockItem;
    ({ text: "text-me", target: "_blank" }) satisfies RTDBlockItem;
  }

  {
    const emptydoc = new RichTextDocument;
    test.eq(emptydoc.blocks, (await buildRTD([])).blocks);
    test.eq('', await emptydoc.__getRawHTML());
    test.assert(emptydoc.isEmpty());
    await verifySimpleRoundTrip(emptydoc); //verifyRoundTrip doesn't support 'null' documents
  }

  {
    const doc = await buildRTD([
      { h1: ["Heading 1"] },
      { tag: "p" }, //empty line without items
      { "p.superpara": [{ text: "Hi <> everybody!" }] },
      { "p.normal": [{ text: "default p" }] }
    ]);
    test.assert(!doc.isEmpty());

    test.eq([
      { tag: "h1", items: [{ text: "Heading 1" }] },
      { tag: "p", items: [] }, //empty line
      { tag: "p", className: "superpara", items: [{ text: "Hi <> everybody!" }] },
      { tag: "p", items: [{ text: "default p" }] }
    ], doc.blocks);
    test.eq('<html><body><h1 class="heading1">Heading 1</h1><p class="normal"></p><p class="superpara">Hi &lt;&gt; everybody!</p><p class="normal">default p</p></body></html>', await doc.__getRawHTML());

    await verifyRoundTrip(doc);
  }

  { //even shorter Build format
    const doc = await buildRTD([
      { "p": "Line 1" },
      //we're still going to retry a blocklevel tag .. having to do a `p:` doesn't seem that bad and otherwise we really start making it ambiguous?
    ]);

    test.eq([{ tag: "p", items: [{ text: "Line 1" }] }], doc.blocks);
    await verifyRoundTrip(doc);
  }

  { //test the inline tags
    const doc = await buildRTD([
      {
        "p": [
          { text: "b", bold: true },
          { text: "i", italic: true },
          { text: "u", underline: true },
          { text: "sup", superScript: true },
          { text: "sub", subScript: true },
          { text: "strikeThrough", strikeThrough: true },
        ],
      }, {
        "p": [
          "we have... ",
          { text: "all of them", bold: true, italic: true, underline: true, superScript: true, subScript: true, strikeThrough: true }
        ]
      }
    ]);

    test.eq(`<html><body><p class="normal"><b>b</b><i>i</i><u>u</u><sup>sup</sup><sub>sub</sub><strike>strikeThrough</strike></p><p class="normal">we have... <i><b><u><strike><sub><sup>all of them</sup></sub></strike></u></b></i></p></body></html>`, await doc.__getRawHTML());
    await verifyRoundTrip(doc);
  }

  { //test a-href merging (can't roundtrip that as it's fixed by the parser)
    const doc = await buildRTD([
      {
        "p": [
          { text: "This is a " },
          { text: "hyper", link: "https://webhare.dev/" },
          { text: "link", link: "https://webhare.dev/" },
          { text: "y", link: "https://webhare.dev/", bold: true }
        ]
      }
    ]);

    test.eq(`<html><body>`
      + `<p class="normal">This is a <a href="https://webhare.dev/">hyperlink<b>y</b></a></p>`
      + `</body></html>`, await doc.__getRawHTML());
  }

  { //test a-href and not being broken up by substyle changes
    const doc = await buildRTD([
      {
        "p": [
          { text: "This is a " },
          { text: "hyperlink", link: "https://webhare.dev/" },
          { text: "y", link: "https://webhare.dev/2" },
          { text: "thing", bold: true, link: "https://webhare.dev/2" },
          { text: "y", link: "https://webhare.dev/2" },
          { text: "doo", italic: true, link: "https://webhare.dev/2" },
          { text: "dle", italic: true },
        ]
      }, {
        "p": [
          { text: "This is a " },
          { text: "new window", link: "https://webhare.dev/", target: "_blank" },
          { text: "-link", link: "https://webhare.dev/" }
        ]
      }
    ]);

    test.eq(`<html><body>`
      + `<p class="normal">This is a <a href="https://webhare.dev/">hyperlink</a><a href="https://webhare.dev/2">y<b>thing</b>y<i>doo</i></a><i>dle</i></p>`
      + `<p class="normal">This is a <a href="https://webhare.dev/" target="_blank">new window</a><a href="https://webhare.dev/">-link</a></p>`
      + `</body></html>`, await doc.__getRawHTML());
    await verifyRoundTrip(doc);
  }
}

async function testBuildWHFSInstance() {
  const htmlwidget = await buildWHFSInstance({ whfsType: "http://www.webhare.net/xmlns/publisher/embedhtml", html: "<b>BOLD</b> HTML" });
  test.eq("http://www.webhare.net/xmlns/publisher/embedhtml", htmlwidget.whfsType);
  test.eq({ html: "<b>BOLD</b> HTML" }, htmlwidget.data);

  const twocolwidget = await buildWHFSInstance({
    whfsType: "http://www.webhare.net/xmlns/publisher/widgets/twocolumns",
    rtdleft: await buildRTD([{ "p": ["Left column"] }]),
    rtdright: [{ items: [{ text: "Right column" }], tag: "p" }] satisfies RTDBlock[]
  });

  test.eq("http://www.webhare.net/xmlns/publisher/widgets/twocolumns", twocolwidget.whfsType);
  test.eq([{ items: [{ text: "Left column" }], tag: "p" }], (twocolwidget.data.rtdleft as RichTextDocument).blocks);
  test.eq([{ items: [{ text: "Right column" }], tag: "p" }], (twocolwidget.data.rtdright as RichTextDocument).blocks);

  test.eqPartial({
    whfsType: "http://www.webhare.net/xmlns/publisher/widgets/twocolumns",
    rtdleft: [{ items: [{ text: "Left column" }], tag: "p" }],
    rtdright: [{ items: [{ text: "Right column" }], tag: "p" }] satisfies RTDBlock[]
  }, await twocolwidget.export());

  await verifyWidgetRoundTrip(twocolwidget);

  const testsitejs = await test.getTestSiteJS();
  const imgEditFile = await testsitejs.openFile("/testpages/imgeditfile.jpeg");
  const tinyPng = await ResourceDescriptor.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==", "base64"), { sourceFile: imgEditFile.id, getHash: true, getImageMetadata: true, getDominantColor: true });
  const goldfish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { sourceFile: imgEditFile.id, getHash: true, getImageMetadata: true, getDominantColor: true });

  const videowidget = await buildWHFSInstance({
    whfsType: "http://www.webhare.net/xmlns/publisher/embedvideo",
    thumbnail: tinyPng
  });

  test.eq({
    whfsType: "http://www.webhare.net/xmlns/publisher/embedvideo",
    thumbnail: {
      data: {
        base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVR4AWNgAAAAAgABc3UBGAAAAABJRU5ErkJggg=="
      },
      sourceFile: `site::${testsitejs.name}/TestPages/imgeditfile.jpeg`,
      hash: "g2xejJS3S-eEVhIlKLsqRLTPYbOSLyEeK65b8yf5Xwk",
      extension: ".png",
      mediaType: "image/png",
      width: 1,
      height: 1,
      dominantColor: /^#.*$/
    }
  }, await videowidget.export());

  await verifyWidgetRoundTrip(videowidget);

  const realVideowidget = await buildWHFSInstance({
    whfsType: "http://www.webhare.net/xmlns/publisher/embedvideo",
    thumbnail: goldfish
  });
  test.eqPartial({
    whfsType: "http://www.webhare.net/xmlns/publisher/embedvideo",
    thumbnail: {
      data: {
        base64: /^iVBO/ //base64 of goudvis
      },
      sourceFile: `site::${testsitejs.name}/TestPages/imgeditfile.jpeg`,
      hash: "aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY",
      width: 385,
    }
  }, await realVideowidget.export());

  await verifyWidgetRoundTrip(realVideowidget);
}

async function testBuildingRTDsWithInstances() {
  const testsitejs = await test.getTestSiteJS();
  const imgEditFile = await testsitejs.openFile("/testpages/imgeditfile.jpeg");
  const goldfish = await ResourceDescriptor.fromResource("mod::system/web/tests/goudvis.png", { sourceFile: imgEditFile.id, getHash: true, getImageMetadata: true, getDominantColor: true });

  {
    const doc = await buildRTD([
      {
        "p": [
          { text: "Bold", bold: true },
          ", ",
          { text: "Italic", italic: true },
          ", ",
          { text: "Underline", underline: true },
          ", ", //keeping *one* buildWidget until all module users have removed it
          { widget: await buildWidget("http://www.webhare.net/xmlns/publisher/formmergefield", { fieldname: "bu_field" }), bold: true, underline: true }
        ]
      }, {
        "widget": await buildWHFSInstance({ whfsType: "http://www.webhare.net/xmlns/publisher/embedhtml", html: "<b>BOLD</b> HTML" })
      }, {
        "widget": await buildWHFSInstance({
          whfsType: "http://www.webhare.net/xmlns/publisher/embedvideo",
          thumbnail: goldfish
        })
      }
    ]);

    test.eq([
      {
        tag: "p",
        items: [
          { text: "Bold", bold: true },
          { text: ", " },
          { text: "Italic", italic: true },
          { text: ", " },
          { text: "Underline", underline: true },
          { text: ", " },
          { widget: test.expectWHFSInstance("http://www.webhare.net/xmlns/publisher/formmergefield", { fieldname: "bu_field" }), bold: true, underline: true }
        ]
      }, {
        widget: test.expectWHFSInstance("http://www.webhare.net/xmlns/publisher/embedhtml", { html: "<b>BOLD</b> HTML" })
      }, {
        widget: test.expectWHFSInstance("http://www.webhare.net/xmlns/publisher/embedvideo", {
          thumbnail: (eGR: ResourceDescriptor) => eGR.sourceFile === imgEditFile.id && eGR.hash === "aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY" && eGR.width === 385
        }, { partial: true })
      }
    ], doc.blocks);

    test.eq([
      {
        tag: "p",
        items: [
          { text: "Bold", bold: true },
          { text: ", " },
          { text: "Italic", italic: true },
          { text: ", " },
          { text: "Underline", underline: true },
          { text: ", " },
          {
            widget: {
              whfsType: "http://www.webhare.net/xmlns/publisher/formmergefield",
              fieldname: "bu_field"
            },
            bold: true,
            underline: true
          }
        ]
      }, {
        widget: {
          whfsType: "http://www.webhare.net/xmlns/publisher/embedhtml",
          html: "<b>BOLD</b> HTML"
        }
      }, {
        widget: w => Boolean(test.eqPartial({
          whfsType: "http://www.webhare.net/xmlns/publisher/embedvideo",
          thumbnail: {
            data: {
              base64: /^iVBO/ //base64 of goudvis
            },
            sourceFile: `site::${testsitejs.name}/TestPages/imgeditfile.jpeg`,
            hash: "aO16Z_3lvnP2CfebK-8DUPpm-1Va6ppSF0RtPPctxUY",
            width: 385
          }
        }, w))
      }
    ], await doc.export());

    test.eq(/^<html><body><p class="normal"><b>Bold<\/b>, <i>Italic<\/i>, <u>Underline<\/u>, <b><u><span class="wh-rtd-embeddedobject" data-instanceid=".*"><\/span><\/u><\/b><\/p><div class="wh-rtd-embeddedobject" data-instanceid=".*"><\/div><\/body><\/html>$/, await doc.__getRawHTML());
    await verifyRoundTrip(doc);

    //Now put that doc into a widget so we can build an Instance containing a Doc containing a Widget containing a Resource
    const twocolwidget = await buildWHFSInstance({
      whfsType: "http://www.webhare.net/xmlns/publisher/widgets/twocolumns",
      rtdleft: await buildRTD([{ "p": ["Left column"] }]),
      rtdright: doc
    });

    await verifyWidgetRoundTrip(twocolwidget);
  }

  //Verify that we catch broken whfs types
  await test.throws(/No such type/, () => buildWHFSInstance({ whfsType: "http://www.webhare.net/nosuchtype" }));
  await test.throws(/Member 'blah' not found/, () => buildWHFSInstance({ whfsType: "http://www.webhare.net/xmlns/publisher/formmergefield", blah: "bu_field" }));


  {  //Build a RTD containing a RTD

    function verifyWidget(d: RichTextDocument) {
      test.eqPartial([
        {
          "widget": test.expectWHFSInstance("http://www.webhare.net/xmlns/publisher/widgets/twocolumns", {}, { partial: true })
        }
      ], d.blocks);

      test.assert('widget' in d.blocks[0]);
      const widget = d.blocks[0].widget.data as { rtdleft: RichTextDocument | null; rtdright: RichTextDocument | null };
      test.eq([{ tag: "p", items: [{ text: "Left column" }] }], widget.rtdleft?.blocks);
      test.eq(null, widget.rtdright);
    }

    const doc = await buildRTD([
      {
        "widget": await buildWHFSInstance({
          whfsType: "http://www.webhare.net/xmlns/publisher/widgets/twocolumns",
          rtdleft: await buildRTD([{ "p": ["Left column"] }]),
          rtdright: null
        })
      }
    ]);

    test.eq([
      {
        widget: {
          whfsType: "http://www.webhare.net/xmlns/publisher/widgets/twocolumns",
          rtdleft: [{ tag: "p", items: [{ text: "Left column" }] }],
        }
      }
    ], await doc.export());

    verifyWidget(doc);
    await verifyRoundTrip(doc);

    const toHS = await exportAsHareScriptRTD(doc);
    test.eqPartial([
      {
        instanceid: /.+/,
        data: {
          whfstype: 'http://www.webhare.net/xmlns/publisher/widgets/twocolumns',
          rtdleft: {
            instances: [], embedded: [], links: []
          }
        }
      }
    ], toHS.instances);

    test.eq(`<html><body><div class="wh-rtd-embeddedobject" data-instanceid="${toHS.instances[0].instanceid}"></div></body></html>`, await toHS.htmltext.text());

    const rawwidget = toHS.instances[0].data as unknown as { rtdleft: HareScriptRTD | null; rtdright: HareScriptRTD | null };
    test.eq('<html><body><p class="normal">Left column</p></body></html>', await rawwidget.rtdleft?.htmltext.text());

    const doc2 = await buildRTDFromHareScriptRTD(toHS);
    verifyWidget(doc2); //can't directly test.eq compare them due to embedded objects
  }
}

async function testRTDCreation() {
  // const richdoc = await createRichDocument([
  //   { blockType: "h2", contents: "Intro" },
  //   { blockType: "p", contents: "Hello, World!" }
  // ]);

  // //verify class= and general syntax
  // test.eq(`<html><body><h2 class="heading2">Intro</h2><p class="normal">Hello, World!</p></body></html>`, await richdoc.__getRawHTML());
}

async function testWRDRoundTrips() {
  console.log("now testing wrd roundtrips.."); //we delayed it so other tests can fail faster as createWRDTestSchema is (still?) slow
  await createWRDTestSchema();
  await beginWork();

  const wrdschema = await getWRDSchema();
  const testuser = await wrdschema.insert("wrdPerson", { wrdContactEmail: "test_rtd@beta.webhare.net", wrdauthAccountStatus: { status: "active" } });

  const hsWRDSchema = await loadlib("mod::wrd/lib/api.whlib").openWRDSchema(wrdschema.tag);
  const hsWRDPersonType = await hsWRDSchema.getType("WRD_PERSON");
  await commitWork();

  for (const { hs, doc } of roundTripTests) {
    //run in works to ensure constraint validation
    await runInWork(async () => {
      await wrdschema.update("wrdPerson", testuser, { richie: doc });
      const { richie } = await wrdschema.getFields("wrdPerson", testuser, ["richie"]);
      test.eq(doc.blocks, richie.blocks);
    });

    await runInWork(async () => {
      //Test roundtrip through HareScript WRD UpdateEntity
      await hsWRDPersonType.UpdateEntity(testuser, { richie: hs });
      const { richie } = await wrdschema.getFields("wrdPerson", testuser, ["richie"]);
      test.eq(doc.blocks, richie.blocks);
    });

    await runInWork(async () => {
      //Test roundtrip through HareScript WRD GetEntityFields
      //FIXME this should also set whfsSettingId and whfsFileId again on instances?
      await wrdschema.update("wrdPerson", testuser, { richie: doc });
      const { richie } = await hsWRDPersonType.getEntityFields(testuser, ["richie"]);
      const richieDoc = await buildRTDFromHareScriptRTD(richie);
      test.eq(doc.blocks, richieDoc.blocks);
    });
  }
}

async function testRegressions() {
  //HTML parser needs to be loose as not everything we find in the database is consistent, we've allowed too many direct writes in the past in HS:
  const htmlWithBadClass = `<html><body><p class="MsoNormal"><span lang="EN-US">The TechMed\nCentre, formerly the Technohal, houses the institute of the same name and\nseveral research groups in the Health area. The building also contains several\nresearch labs and the educational programmes Biomedical Technology, Health\nSciences and Technical Medicine.<p xmlns:o=""></p></span></p></body></html>`;
  const parseResult = await buildRTDFromHareScriptRTD({ htmltext: WebHareBlob.from(htmlWithBadClass), instances: [], embedded: [], links: [] });
  test.eqPartial([
    {
      tag: "p",
      items: [{ text: 'The TechMed\nCentre, formerly the Technohal, houses the institute of the same name and\nseveral research groups in the Health area. The building also contains several\nresearch labs and the educational programmes Biomedical Technology, Health\nSciences and Technical Medicine.' }]
    }
  ], parseResult.blocks);
}

test.runTests(
  [
    testBuilder,
    testBuildWHFSInstance,
    testBuildingRTDsWithInstances,
    testRTDCreation,
    testWRDRoundTrips,
    testRegressions
  ]);
