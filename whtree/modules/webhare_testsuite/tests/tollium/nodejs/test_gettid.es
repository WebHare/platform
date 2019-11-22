/* globals describe it */

import getTid, { registerTexts } from "@mod-tollium/js/gettid";
import assert from "assert";
import * as domdebug from "dompack/src/debug";

// Uncomment to show getTid debugging information
//domdebug.debugflags.gtd = true;

// Test language

describe("Tid language", function()
{
  it("get and set", function(callback)
  {
    assert("tidLanguage" in getTid);
    assert.strictEqual(getTid.tidLanguage, "");
    getTid.tidLanguage = "nl";
    assert.strictEqual(getTid.tidLanguage, "nl");
    callback();
  });
});


// Test registration of texts

let base_texts =
  { "testgroup": { "testtext": "This is a test" }
  };

describe("Base texts", function()
{
  it("registration", function(callback)
  {
    registerTexts("base", "en", base_texts);
    callback();
  });

  it("retrieval with wrong language", function(callback)
  {
    assert.strictEqual(getTid("base:testgroup.testtext"), "(cannot find text:base:testgroup.testtext)");

    // Test short tid's by temporarily setting the 'sht' flag
    domdebug.debugflags.sht = true;
    assert.strictEqual(getTid("base:testgroup.testtext"), ".testtext");
    domdebug.debugflags.sht = false;

    callback();
  });

  it("set language", function(callback)
  {
    getTid.tidLanguage = "en";
    assert.strictEqual(getTid.tidLanguage, "en");
    callback();
  });

  it("retrieval", function(callback)
  {
    assert.strictEqual(getTid("base:testgroup.testtext"), "This is a test");
    callback();
  });
});


// Test correct merging of new texts

let more_base_texts =
  { "testgroup": { "moretext": "This is more test" }
  , "anothergroup": { "anothertext": "This is another test" }
  };

describe("More base texts", function()
{
  it("registration", function(callback)
  {
    registerTexts("base", "en", more_base_texts);
    callback();
  });

  it("retrieval", function(callback)
  {
    assert.strictEqual(getTid("base:testgroup.testtext"), "This is a test");
    assert.strictEqual(getTid("base:testgroup.moretext"), "This is more test");
    assert.strictEqual(getTid("base:anothergroup.anothertext"), "This is another test");
    callback();
  });
});


// Test string substitution (param, ifparam, else)
// NOTE: getTid expects all language texts to be well-formed as they're generated automatically from the language files and
//       it doesn't check for unexpected end-of-string of unbalanced {i}'s, so we're not going to test that

let substitute_texts =
  { "param": { "enumerate": "{p1} {p2} {p3} {p4}"
             , "accolades": "{{p1} {{p2}} {{{p3}}} {p5}"
             , "order": "{p3} {p1} {p4} {p2}"
             , "syntax": "{ p 1 } \\{p2} {pp} {{p3"
             }
  , "ifparam": { "simple_true": "{i1=\"aap\"}{p2}{i}"
               , "simple_false": "{i1=\"noot\"}{p2}{i}"
               , "accolades": "{{i1=\"noot\"}{p2}{{i}"
               , "nested": "{i1=\"aap\"}{i2=\"noot\"}{p3}{i}{i}"
               }
  , "else": { "simple_true": "{i1=\"aap\"}{p2}{e}{p3}{i}"
            , "simple_false": "{i1=\"noot\"}{p2}{e}{p3}{i}"
            , "accolades": "{{i1=\"noot\"}{p2}{ e}{p3}{{i}"
            , "nested": "{i1=\"aap\"}{i2=\"noot\"}{p3}{e}{p4}{i}{e}{i3=\"noot\"}{p1}{e}{p2}{i}{i}"
            }
  , "regression": { "checks": "{i1=\"0\"}{p2}{e}'{p2}' en nog {i1=\"1\"}1 fout{e}{p1} fouten{i}{i}" }
  };

describe("Substitute texts", function()
{
  it("registration", function(callback)
  {
    registerTexts("substitute", "nl", substitute_texts);
    callback();
  });

  it("check language", function(callback)
  {
    getTid.tidLanguage = "nl";
    assert.strictEqual(getTid.tidLanguage, "nl");
    callback();
  });

  it("with param", function(callback)
  {
    assert.strictEqual(getTid("substitute:param.enumerate", "aap", "noot", "mies"), "aap noot mies ");
    assert.strictEqual(getTid("substitute:param.accolades", "aap", "noot", "mies"), "{p1} {p2}} {mies}} (no such parameter:5)");
    assert.strictEqual(getTid("substitute:param.order", "aap", "noot", "mies"), "mies aap  noot");
    assert.strictEqual(getTid("substitute:param.syntax", "aap", "noot", "mies"), "{ p 1 } \\noot (no such parameter:p) {p3");
    callback();
  });

  it("with ifparam", function(callback)
  {
    assert.strictEqual(getTid("substitute:ifparam.simple_true", "aap", "noot", "mies"), "noot");
    assert.strictEqual(getTid("substitute:ifparam.simple_false", "aap", "noot", "mies"), "");
    assert.strictEqual(getTid("substitute:ifparam.accolades", "aap", "noot", "mies"), "{i1=\"noot\"}noot{i}");
    assert.strictEqual(getTid("substitute:ifparam.nested", "aap", "noot", "mies"), "mies");
    callback();
  });

  it("with else", function(callback)
  {
    assert.strictEqual(getTid("substitute:else.simple_true", "aap", "noot", "mies"), "noot");
    assert.strictEqual(getTid("substitute:else.simple_false", "aap", "noot", "mies"), "mies");
    assert.strictEqual(getTid("substitute:else.accolades", "aap", "noot", "mies"), "{i1=\"noot\"}noot{ e}mies{i}");
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
    assert.strictEqual(getTid("substitute:else.nested", "aap", "noot", "mies", "wim"), "mies");
    assert.strictEqual(getTid("substitute:else.nested", "zus", "noot", "mies", "wim"), "noot");
    assert.strictEqual(getTid("substitute:else.nested", "aap", "zus", "mies", "wim"), "wim");
    assert.strictEqual(getTid("substitute:else.nested", "zus", "mies", "noot", "wim"), "zus");
    callback();
  });

  it("regression", function(callback)
  {
    // getTid did not correctly handle non-string parameters:
    // 'Socialite session 'TEST' in connection 'Wilmkinktheater':'Analytics' has expired' and 16 more {i1="1"}error{e}errors{i}{i}
    assert.strictEqual(getTid("substitute:regression.checks", 16, "Foutmelding"), "'Foutmelding' en nog 16 fouten");

    // getTid did not correctly handle ifparam with a value of 0:
    // 'Task 'wilminktheater:crm_factory_export' has errors' en nog fouten
    assert.strictEqual(getTid("substitute:regression.checks", 0, "Foutmelding"), "Foutmelding");
    callback();
  });
});


// Test HTML tid's

let html_texts =
  { "tags": '<b>Vet!</b>'
  , "encoding": 'Codeer &lt;tag> als &amp;lt;tag>'
  , "params": '<a href=\"http://b-lex.nl/?quot=&quot;&amp;aap=&lt;noot&gt;\">{p1}\n</a>'
  , "noparam": 'before<b class=\"bold\">{pp}</b>after'
  };

describe("HTML texts", function()
{
  it("registration", function(callback)
  {
    registerTexts("html", "nl", html_texts);
    callback();
  });

  it("check language", function(callback)
  {
    assert.strictEqual(getTid.tidLanguage, "nl");
    callback();
  });

  it("retrieval", function(callback)
  {
    assert.strictEqual(getTid.html("html:tags"), "<b>Vet!</b>");
    assert.strictEqual(getTid("html:tags"), "Vet!");
    assert.strictEqual(getTid.html("html:encoding"), "Codeer &lt;tag> als &amp;lt;tag>");
    assert.strictEqual(getTid("html:encoding"), "Codeer <tag> als &lt;tag>");
    assert.strictEqual(getTid.html("html:params", "<hr/>"), "&lt;hr/&gt;<br/>");
    assert.strictEqual(getTid("html:params", "<hr/>"), "<hr/>\n");
    assert.strictEqual(getTid.html("html:noparam"), "before<b>(no such parameter:p)</b>after");
    assert.strictEqual(getTid("html:noparam"), "before(no such parameter:p)after");
    callback();
  });
});
