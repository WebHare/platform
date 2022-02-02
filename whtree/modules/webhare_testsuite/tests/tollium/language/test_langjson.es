/* globals describe it */
let bridge = require('@mod-system/js/wh/bridge');
const path = require("path");

const assert = require("assert");
var langparser = require("@mod-tollium/js/internal/lang");

// Test the lang.json parser
describe("lang.json parser", function()
{
  it("parser", async function()
  {
    let alltexts = new Map();
    alltexts.set("webhare_testsuite", {});

    let filecache = [];
    let result = await langparser.readLanguageFile('webhare_testsuite', 'en', filecache);
    assert.strictEqual(true, filecache.includes(path.resolve(__dirname, "../../../../webhare_testsuite/language/default.xml")));

    langparser.parseLanguageFile(alltexts.get("webhare_testsuite"), [ "test", "module"], result);

    //we need to test that a subgroup does not include deeper groups
    assert.strictEqual("Test action", alltexts.get("webhare_testsuite").module.testaction);
    assert.strictEqual(true, "testsite" in alltexts.get("webhare_testsuite").module);
    assert.strictEqual(false, "testsite.title" in alltexts.get("webhare_testsuite").module);
    assert.strictEqual(true, "title" in alltexts.get("webhare_testsuite").module.testsite);

    // also test that groups and texts with the same name are handled correctly
    assert.strictEqual(true, "node" in alltexts.get("webhare_testsuite").test.testgroup);
    assert.strictEqual(true, "" in alltexts.get("webhare_testsuite").test.testgroup.node);
    assert.strictEqual(true, "text" in alltexts.get("webhare_testsuite").test.testgroup.node);

    let output = langparser.generateTexts(alltexts);
    //we can't compile code that will contain 2028 or 2029 linefeeds
    assert.strictEqual(false, output.includes("\u2028"));
    assert.strictEqual(false, output.includes("\u2029"));

    // groups and texts with the same name, group after first text and text after group
    let custom = {};
    langparser.parseLanguageFile(custom, [ "test" ],
        [ { tid: "test.group", text: "group text" }
        , { tid: "test.group.subgroup.subtext", text: "subsub text" }
        , { tid: "test.group.subgroup", text: "subgroup text" }
        ]);
    assert.deepEqual(custom,
        { test:
          { group:
            { "": "group text"
              , "subgroup":
              { "": "subgroup text"
              , "subtext": "subsub text"
              }
            }
          }
        });
  });

  it("fallbacklanguage", async function()
  {
    let alltexts = new Map();
    let filecache = [];

    alltexts.set("webhare_testsuite", {});
    let result = await langparser.readLanguageFile('webhare_testsuite', 'de', filecache);
    langparser.parseLanguageFile(alltexts.get("webhare_testsuite"), [ "testfallback" ], result);

    assert.strictEqual(true, filecache.includes(path.resolve(__dirname, "../../../../webhare_testsuite/language/default.xml")));
    assert.strictEqual(true, filecache.includes(path.resolve(__dirname, "../../../../webhare_testsuite/language/de.xml")));

    let output = langparser.generateTexts(alltexts);
    // The output should include 'anothertext' from the German langauge file
    assert.strictEqual(true, output.includes(`"anothertext":"Ein anderer Text"`));
    // The output should also include 'text' from the English fallback language file
    assert.strictEqual(true, output.includes(`"text":"A text"`));
  });

  it("finalize", async function()
  {
    bridge.close(); //needed so mocha can terminate
  });
});
