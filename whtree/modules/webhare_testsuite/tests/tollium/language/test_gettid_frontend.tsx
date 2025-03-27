import * as test from "@mod-tollium/js/testframework";
import { getTid } from "@webhare/gettid";
import { getHTMLTid, getTidLanguage, registerTexts, setTidLanguage } from "@webhare/gettid/src/internal";
import * as domdebug from "dompack/src/debug";
import { jsxcreate } from "@webhare/dompack";
import type { RecursiveLanguageTexts } from "@webhare/gettid/src/types";
import * as dompack from "@webhare/dompack";

//To enable gettid debugging, enable 'gtd' in the debug flags

test.runTests([
  // Test language
  "Tid language",
  function () {
    test.eq("en", getTidLanguage());
    setTidLanguage("nl");
    test.eq("nl", getTidLanguage());
  },

  // Test registration of texts

  "Base texts",
  function () {
    const base_texts =
      { "testgroup": { "testtext": "This is a test" } };

    registerTexts("base", "en", base_texts);

    // retrieval with wrong language (set to 'nl' above)
    test.eq("(cannot find text: base:testgroup.testtext)", getTid("base:testgroup.testtext"));

    // Test short tid's by temporarily setting the 'sut' flag
    domdebug.debugflags.sut = true;
    test.eq(".testtext", getTid("base:testgroup.testtext"));
    test.eq(".unknown", getTid("base:testgroup.unknown"));
    domdebug.debugflags.sut = false;

    // set language
    setTidLanguage("en");
    test.eq("en", getTidLanguage());

    // retrieval
    test.eq("This is a test", getTid("base:testgroup.testtext"));

    // retrieve a group node
    test.eq("(cannot find text: base:testgroup)", getTid("base:testgroup"));

    // retest short tids
    domdebug.debugflags.sut = true;
    test.eq("This is a test", getTid("base:testgroup.testtext"));
    test.eq(".unknown", getTid("base:testgroup.unknown"));
    domdebug.debugflags.sut = false;

  },

  "Test string substitution (param, ifparam, else)",
  function () {
    // NOTE: getTid expects all language texts to be well-formed as they're generated automatically from the language files and
    //       it doesn't check for unexpected end-of-string of unbalanced {i}'s, so we're not going to test that

    const substitute_texts: RecursiveLanguageTexts = {
      "param": {
        "enumerate": [1, ' ', 2, ' ', 3, ' ', 4],
        "order": [3, ' ', 1, ' ', 4, ' ', 2]
      },
      "ifparam": {
        "simple_true": [{ t: "ifparam", p: 1, value: "aap", subs: [2], subselse: [] }],
        "simple_false": [{ t: "ifparam", p: 1, value: "noot", subs: [2], subselse: [] }],
        "nested": [{ t: "ifparam", p: 1, value: "aap", subs: [{ t: "ifparam", p: 2, value: "noot", subs: [3], subselse: [] }], subselse: [] }]
      },
      "else": {
        "simple_true": [{ t: "ifparam", p: 1, value: "aap", subs: [2], subselse: [3] }],
        "simple_false": [{ t: "ifparam", p: 1, value: "noot", subs: [2], subselse: [3] }],
        "nested": [{ t: "ifparam", p: 1, value: "aap", subs: [{ t: "ifparam", p: 2, value: "noot", subs: [3], subselse: [4] }], subselse: [{ t: "ifparam", p: 3, value: "noot", subs: [1], subselse: [2] }] }]
      },
      "regression": { "checks": [{ t: "ifparam", p: 1, value: "0", subs: [2], subselse: ["'", 2, "' en nog ", { t: "ifparam", p: 1, value: "1", subs: ["1 fout"], subselse: [1, " fouten"] }] }] }
    };

    //Substitute text
    registerTexts("substitute", "nl", substitute_texts);

    //check language
    setTidLanguage("nl");
    test.eq("nl", getTidLanguage());

    //with param
    test.eq("aap noot mies ", getTid("substitute:param.enumerate", "aap", "noot", "mies"));
    test.eq("mies aap  noot", getTid("substitute:param.order", "aap", "noot", "mies"));

    //with ifparam
    test.eq("noot", getTid("substitute:ifparam.simple_true", "aap", "noot", "mies"));
    test.eq("", getTid("substitute:ifparam.simple_false", "aap", "noot", "mies"));
    test.eq("mies", getTid("substitute:ifparam.nested", "aap", "noot", "mies"));

    //with else
    test.eq("noot", getTid("substitute:else.simple_true", "aap", "noot", "mies"));
    test.eq("mies", getTid("substitute:else.simple_false", "aap", "noot", "mies"));
    /*
    {i1=\"aap\"}
      {i2=\"noot\"}
        {p3}
      {e}
        {p4}
      {i}
    {e}
      {i3=\"noot\"}
        {p1}
      {e}
        {p2}
      {i}
    {i}
    */
    test.eq("mies", getTid("substitute:else.nested", "aap", "noot", "mies", "wim"));
    test.eq("noot", getTid("substitute:else.nested", "zus", "noot", "mies", "wim"));
    test.eq("wim", getTid("substitute:else.nested", "aap", "zus", "mies", "wim"));
    test.eq("zus", getTid("substitute:else.nested", "zus", "mies", "noot", "wim"));

    //regression
    // getTid did not correctly handle non-string parameters:
    // 'Socialite session 'TEST' in connection 'Wilmkinktheater':'Analytics' has expired' and 16 more {i1="1"}error{e}errors{i}{i}
    test.eq("'Foutmelding' en nog 16 fouten", getTid("substitute:regression.checks", 16, "Foutmelding"));

    // getTid did not correctly handle ifparam with a value of 0:
    // 'Task 'wilminktheater:crm_factory_export' has errors' en nog fouten
    test.eq("Foutmelding", getTid("substitute:regression.checks", 0, "Foutmelding"));
  },

  "Test correct merging of new texts",
  function () {
    setTidLanguage("en");

    const more_base_texts =
    {
      "testgroup": {
        "moretext": "This is more test",
        //test merging new texts into existing groups. this broke earlier
        "simple_param": ["text: ", 1]
      },
      "anothergroup": { "": "Group test", "anothertext": "This is another test" }
    };

    registerTexts("base", "en", more_base_texts);
    test.eq("text: noot", getTid("base:testgroup.simple_param", "noot"));

    //retrieval
    test.eq(getTid("base:testgroup.testtext"), "This is a test");
    test.eq(getTid("base:testgroup.moretext"), "This is more test");
    test.eq(getTid("base:anothergroup.anothertext"), "This is another test");
    test.eq(getTid("base:anothergroup"), "Group test");
  },

  "Test HTML tid's",
  function () {
    setTidLanguage("nl");

    const html_texts: RecursiveLanguageTexts = {
      "tags": [{ t: "tag", tag: "b", subs: ["Vet!"] }],
      "encoding": `Codeer <tag> en &lt;`,
      "params": [{ t: "a", link: "http://b-lex.nl/?quot=&quot;&amp;aap=&lt;noot&gt;", subs: [1], linkparam: 0, target: "_blank" }],
      "regression": {
        "tag_param_string": [{ t: "tag", tag: "b", subs: [1, " suffix"] }]
      }
    };

    registerTexts("html", "nl", html_texts);
    //check language
    test.eq("nl", getTidLanguage());
    //retrieval
    test.eq("<b>Vet!</b>", getHTMLTid("html:tags"));
    test.eq("Vet!", getTid("html:tags"));
    test.eq("Codeer &lt;tag&gt; en &amp;lt;", getHTMLTid("html:encoding"));
    test.eq("Codeer <tag> en &lt;", getTid("html:encoding"));
    test.eq(`<a href="http://b-lex.nl/?quot=&amp;quot;&amp;amp;aap=&amp;lt;noot&amp;gt;">&lt;hr/&gt;<br></a>`, getHTMLTid("html:params", "<hr/>\n"));
    test.eq("<hr/>\n", getTid("html:params", "<hr/>\n"));

    console.log(`render with jsxcreate`, getTid("html:params", ["<hr/>\n"], { render: jsxcreate }));
    console.log(`render with fragment`, getTid("html:params", ["<hr/>\n"], { render: "fragment" }));


    test.eq(`<a href="http://b-lex.nl/?quot=&amp;quot;&amp;amp;aap=&amp;lt;noot&amp;gt;">&lt;hr/&gt;<br></a>`, (<div>{getTid("html:params", ["<hr/>\n"], { render: jsxcreate })}</div>).innerHTML);
    test.eq(`<a href="http://b-lex.nl/?quot=&amp;quot;&amp;amp;aap=&amp;lt;noot&amp;gt;">&lt;hr/&gt;<br></a>`, (<div>{getTid("html:params", ["<hr/>\n"], { render: "fragment" })}</div>).innerHTML);

    // Regression: A comma would get placed between param and string within a tag
    test.eq("param suffix", getTid("html:regression.tag_param_string", "param"));
    test.eq("<b>param suffix</b>", getHTMLTid("html:regression.tag_param_string", "param"));
  }
]);
