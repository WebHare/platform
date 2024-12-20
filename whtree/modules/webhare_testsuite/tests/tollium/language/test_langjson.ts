import * as test from '@webhare/test';

import * as path from "node:path";
import * as langparser from '@mod-platform/js/assetpacks/lang';

// Test the lang.json parser
async function testLangJsonParser() {
  //it("parser", async function ()
  {
    const alltexts = new Map();
    alltexts.set("webhare_testsuite", {});

    const filecache: string[] = [];
    const result = await langparser.readLanguageFile('webhare_testsuite', 'en', filecache);
    test.eq(true, filecache.includes(path.resolve(__dirname, "../../../../webhare_testsuite/language/default.xml")));

    langparser.parseLanguageFile(alltexts.get("webhare_testsuite"), ["test", "module"], result);

    //we need to test that a subgroup does not include deeper groups
    test.eq("Test action", alltexts.get("webhare_testsuite").module.testaction);
    test.eq(true, "testsite" in alltexts.get("webhare_testsuite").module);
    test.eq(false, "testsite.title" in alltexts.get("webhare_testsuite").module);
    test.eq(true, "title" in alltexts.get("webhare_testsuite").module.testsite);

    // also test that groups and texts with the same name are handled correctly
    test.eq(true, "node" in alltexts.get("webhare_testsuite").test.testgroup);
    test.eq(true, "" in alltexts.get("webhare_testsuite").test.testgroup.node);
    test.eq(true, "text" in alltexts.get("webhare_testsuite").test.testgroup.node);

    // groups and texts with the same name, group after first text and text after group
    const custom = {};
    langparser.parseLanguageFile(custom, ["test"],
      [
        { tid: "test.group", text: "group text" },
        { tid: "test.group.subgroup.subtext", text: "subsub text" },
        { tid: "test.group.subgroup", text: "subgroup text" }
      ]);
    test.eq(custom as any,
      {
        test:
        {
          group:
          {
            "": "group text",
            "subgroup":
            {
              "": "subgroup text",
              "subtext": "subsub text"
            }
          }
        }
      });
  }

  //it("fallbacklanguage", async function ()
  {
    const alltexts = new Map();
    const filecache: string[] = [];

    alltexts.set("webhare_testsuite", {});
    const result = await langparser.readLanguageFile('webhare_testsuite', 'de', filecache);
    langparser.parseLanguageFile(alltexts.get("webhare_testsuite"), ["testfallback"], result);

    test.eq(true, filecache.includes(path.resolve(__dirname, "../../../../webhare_testsuite/language/default.xml")));
    test.eq(true, filecache.includes(path.resolve(__dirname, "../../../../webhare_testsuite/language/de.xml")));

    const output = langparser.generateTexts(alltexts);
    // The output should include 'anothertext' from the German langauge file
    test.eq(true, output.includes(`"anothertext":"Ein anderer Text"`));
    // The output should also include 'text' from the English fallback language file
    test.eq(true, output.includes(`"text":"A text"`));
  }
}

test.runTests([testLangJsonParser]);
