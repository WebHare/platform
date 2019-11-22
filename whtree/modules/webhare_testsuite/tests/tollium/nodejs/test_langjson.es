/* globals describe it */
const path = require("path");

const assert = require("assert");
var langparser = require("@mod-tollium/js/internal/lang");

let filecache = new Map();

const tolliumroot = path.normalize(process.env.WEBHARE_CHECKEDOUT_TO + "/whtree/modules/tollium/");

// Test the lang.json parser
describe("lang.json parser", function()
{
  it("parser", async function()
  {
    let alltexts = new Map();
    alltexts.set("webhare_testsuite", {});
    let result = langparser.readLanguageFile(__dirname + '/../../..', 'default', filecache);
    langparser.parseLanguageFile(alltexts.get("webhare_testsuite"), [ "test" ], result);

    let output = langparser.generateTexts(alltexts);
    //we can't compile code that will contain 2028 or 2029 linefeeds
    assert.strictEqual(false, output.includes("\u2028"));
    assert.strictEqual(false, output.includes("\u2029"));
  });

  it("fallbacklanguage", async function()
  {
    let alltexts = new Map();
    alltexts.set("webhare_testsuite", {});
    let result = langparser.readLanguageFile(__dirname + '/../../..', 'de', filecache);
    langparser.parseLanguageFile(alltexts.get("webhare_testsuite"), [ "testfallback" ], result);

    let output = langparser.generateTexts(alltexts);
    // The output should include 'anothertext' from the German langauge file
    assert.strictEqual(true, output.includes(`"anothertext":"Ein anderer Text"`));
    // The output should also include 'text' from the English fallback language file
    assert.strictEqual(true, output.includes(`"text":"A text"`));
  });

  it("loadertest", async function()
  {
    let langconfig = { modules: [ { name: "tollium", root: tolliumroot } ]
                     , languages: [ "en", "nl" ]
                     };

    let resolve;
    let promise = new Promise(r => resolve = r);

    let dependencies = [];
    let errors = [];
    let warnings = [];

    const resourcePath = tolliumroot + "web/ui/components/imageeditor/imageeditor.lang.json";
    let webpackmockloader =
      { query:          "?" + JSON.stringify(langconfig)
      , async:          () => ((error, output) => resolve({ error, output }))
      , cacheable:      () => true
      , context:        path.dirname(resourcePath)
      , resourcePath
      , emitWarning:    text => { console.log("warning: ", text); warnings.push(text); }
      , emitError:      text => { console.log("error: ", text); errors.push(text); }
      , addDependency:  resource => { dependencies.push(resource); }
      , resolve:        (basepath, relpath, callback) =>
                        {
                          let retval = path.normalize(path.join(basepath, relpath));
                          callback(null, retval);
                        }
      };

    let source =
`{ "imports": { "tollium": [ "components.imgedit" ] }
, "requires": [ "../../common.lang.json" ]
}`;

    let langloader = require("@mod-tollium/js/internal/lang");
    langloader.call(webpackmockloader, [ source ]);

    let loaderresult = await promise;

    assert.deepEqual([], warnings);
    assert.deepEqual([], errors);
    assert.deepEqual([ tolliumroot + 'language/default.xml', tolliumroot + 'language/nl.xml' ], dependencies);

    // Make sure both en and nl texts are present
    assert.strictEqual(true, loaderresult.output.includes(`require("${tolliumroot}web/ui/common.lang.json");`));
    assert.strictEqual(true, loaderresult.output.includes(`"dominantcolor":"Dominant color"`));
    assert.strictEqual(true, loaderresult.output.includes(`"dominantcolor":"Dominante kleur"`));
  });

  it("parseerrors", async function()
  {
    const defaultlangpath = path.normalize(__dirname + '/../../../language/default.xml');

    langparser.overrideFile(defaultlangpath, '<text>yeey</text>');
    assert.throws(() => langparser.readLanguageFile(__dirname + '/../../..', 'default', new Map()), { message: "Expected <language> tag" });

    // two errors, report only the first
    langparser.overrideFile(defaultlangpath, '<language><text>yeey</text><br /><ifparam /></language>');
    assert.throws(() => langparser.readLanguageFile(__dirname + '/../../..', 'default', new Map()), { message: "Unexpected <br> tag" });

  });
});
