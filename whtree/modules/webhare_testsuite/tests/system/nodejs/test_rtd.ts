import { buildRTD, RichTextDocument } from "@webhare/services";
import { buildRTDFromHSStructure } from "@webhare/harescript/src/import-hs-rtd";
import { type HareScriptRTD } from "@webhare/services/src/richdocument";
import * as test from "@webhare/test";

async function verifyRoundTrip(doc: RichTextDocument) {
  const hs = await doc.exportAsHareScriptRTD();
  const doc2 = await buildRTDFromHSStructure(hs);
  test.eq(doc.blocks, doc2.blocks);
}

async function testBuilder() {
  {
    const emptydoc = new RichTextDocument;
    test.eq(emptydoc.blocks, (await buildRTD([])).blocks);
    test.eq('', await emptydoc.__getRawHTML());
    await verifyRoundTrip(emptydoc);
  }

  {
    const doc = await buildRTD([
      { h1: ["Heading 1"] },
      { "p.normal": [{ text: "Hi <> everybody!" }] }
    ]);

    test.eq([
      { "h1.heading1": [{ text: "Heading 1" }] },
      { "p.normal": [{ text: "Hi <> everybody!" }] }
    ], doc.blocks);
    test.eq('<html><body><h1 class="heading1">Heading 1</h1><p class="normal">Hi &lt;&gt; everybody!</p></body></html>', await doc.__getRawHTML());

    await verifyRoundTrip(doc);
  }

  { //even shorter Build format
    const doc = await buildRTD([
      { "p": "Line 1" },
      //we're still going to retry a blocklevel tag .. having to do a `p:` doesn't seem that bad and otherwise we really start making it ambiguous?
    ]);

    test.eq([{ "p.normal": [{ text: "Line 1" }] }], doc.blocks);
    await verifyRoundTrip(doc);
  }

  {
    const doc = await buildRTD([
      {
        "p": [
          { text: "Bold", bold: true },
          ", ",
          { text: "Italic", italic: true },
          ", ",
          { text: "Underline", underline: true },
          ", ",
          { widget: { whfsType: "http://www.webhare.net/xmlns/publisher/formmergefield", fieldname: "bu_field" }, bold: true, underline: true }
        ]
      }, {
        "widget": {
          whfsType: "http://www.webhare.net/xmlns/publisher/embedhtml",
          html: "<b>BOLD</b> HTML"
        }
      }
    ]);

    test.eq([
      {
        "p.normal": [
          { text: "Bold", bold: true },
          { text: ", " },
          { text: "Italic", italic: true },
          { text: ", " },
          { text: "Underline", underline: true },
          { text: ", " },
          { widget: { whfsType: "http://www.webhare.net/xmlns/publisher/formmergefield", fieldname: "bu_field", whfsInstanceId: /^.+$/ }, bold: true, underline: true }
        ]
      }, {
        "widget": {
          whfsType: "http://www.webhare.net/xmlns/publisher/embedhtml",
          whfsInstanceId: /^.+$/,
          html: "<b>BOLD</b> HTML",
        }
      }
    ], doc.blocks);

    //this assert is mostly here to comfort typescript
    test.assert(doc.blocks[0] && "p.normal" in doc.blocks[0] && 'widget' in doc.blocks[1]);

    const firstpara = doc.blocks[0]["p.normal"];
    const secondwidget = doc.blocks[1].widget;
    test.assert(firstpara && 'widget' in firstpara[6]);

    test.eq(`<html><body><p class="normal"><b>Bold</b>, <i>Italic</i>, <u>Underline</u>, <b><u><span class="wh-rtd-embeddedobject" data-instanceid="${firstpara[6].widget.whfsInstanceId}"></span></u></b></p><div class="wh-rtd-embeddedobject" data-instanceid="${secondwidget.whfsInstanceId}"></div></body></html>`, await doc.__getRawHTML());
    await verifyRoundTrip(doc);
  }

  //Verify that we catch broken whfs types
  await test.throws(/No such type/, () => buildRTD([{ "widget": { whfsType: "http://www.webhare.net/nosuchtype" } }]));
  await test.throws(/Member 'blah' not found/, () => buildRTD([{ "widget": { whfsType: "http://www.webhare.net/xmlns/publisher/formmergefield", blah: "bu_field" } }]));


  {  //Build a RTD containing a RTD

    function verifyWidget(d: RichTextDocument) {
      test.eqPartial([
        {
          "widget": {
            whfsType: "http://www.webhare.net/xmlns/publisher/widgets/twocolumns",
          }
        }
      ], d.blocks);

      test.assert('widget' in d.blocks[0]);
      const widget = d.blocks[0].widget as unknown as { rtdleft: RichTextDocument | null; rtdright: RichTextDocument | null };
      test.eq([{ "p.normal": [{ text: "Left column" }] }], widget.rtdleft?.blocks);
      test.eq(null, widget.rtdright);
    }

    const doc = await buildRTD([
      {
        "widget": {
          whfsType: "http://www.webhare.net/xmlns/publisher/widgets/twocolumns",
          rtdleft: await buildRTD([{ "p": ["Left column"] }]),
          rtdright: null
        }
      }
    ]);

    verifyWidget(doc);

    const toHS = await doc.exportAsHareScriptRTD();
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

    const doc2 = await buildRTDFromHSStructure(toHS);
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

test.runTests(
  [
    testBuilder,
    testRTDCreation
  ]);
