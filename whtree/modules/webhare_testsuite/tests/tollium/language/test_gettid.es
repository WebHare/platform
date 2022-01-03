import * as test from "@mod-tollium/js/testframework";
import getTid, { registerTexts } from "@mod-tollium/js/gettid";
import * as domdebug from "dompack/src/debug";

// Uncomment to show getTid debugging information
//domdebug.debugflags.gtd = true;

test.registerTests([
// Test language
    "Tid language"
  , function()
    {
      test.eq(getTid.tidLanguage, "");
      getTid.tidLanguage = "nl";
      test.eq(getTid.tidLanguage, "nl");
    }

// Test registration of texts

  , "Base texts"
  , function()
    {
      let base_texts =
        { "testgroup": { "testtext": "This is a test" }
        };

      registerTexts("base", "en", base_texts);

      //retrieval with wrong language"
      test.eq(getTid("base:testgroup.testtext"), "(cannot find text:base:testgroup.testtext)");

      // Test short tid's by temporarily setting the 'sut' flag
      domdebug.debugflags.sut = true;
      test.eq(getTid("base:testgroup.testtext"), ".testtext");
      domdebug.debugflags.sut = false;

      // set language
      getTid.tidLanguage = "en";
      test.eq(getTid.tidLanguage, "en");

      // retrieval
      test.eq(getTid("base:testgroup.testtext"), "This is a test");
    }

  , "Test correct merging of new texts"
  , function()
    {
      let more_base_texts =
        { "testgroup": { "moretext": "This is more test" }
        , "anothergroup": { "anothertext": "This is another test" }
        };

      registerTexts("base", "en", more_base_texts);

      //retrieval
      test.eq(getTid("base:testgroup.testtext"), "This is a test");
      test.eq(getTid("base:testgroup.moretext"), "This is more test");
      test.eq(getTid("base:anothergroup.anothertext"), "This is another test");
    }

  , "Test string substitution (param, ifparam, else)"
  , function()
    {
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

      //Substitute text
      registerTexts("substitute", "nl", substitute_texts);

      //check language
      getTid.tidLanguage = "nl";
      test.eq(getTid.tidLanguage, "nl");

      //with param
      test.eq(getTid("substitute:param.enumerate", "aap", "noot", "mies"), "aap noot mies ");
      test.eq(getTid("substitute:param.accolades", "aap", "noot", "mies"), "{p1} {p2}} {mies}} (no such parameter:5)");
      test.eq(getTid("substitute:param.order", "aap", "noot", "mies"), "mies aap  noot");
      test.eq(getTid("substitute:param.syntax", "aap", "noot", "mies"), "{ p 1 } \\noot (no such parameter:p) {p3");

      //with ifparam
      test.eq(getTid("substitute:ifparam.simple_true", "aap", "noot", "mies"), "noot");
      test.eq(getTid("substitute:ifparam.simple_false", "aap", "noot", "mies"), "");
      test.eq(getTid("substitute:ifparam.accolades", "aap", "noot", "mies"), "{i1=\"noot\"}noot{i}");
      test.eq(getTid("substitute:ifparam.nested", "aap", "noot", "mies"), "mies");

      //with else
      test.eq(getTid("substitute:else.simple_true", "aap", "noot", "mies"), "noot");
      test.eq(getTid("substitute:else.simple_false", "aap", "noot", "mies"), "mies");
      test.eq(getTid("substitute:else.accolades", "aap", "noot", "mies"), "{i1=\"noot\"}noot{ e}mies{i}");
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
      test.eq(getTid("substitute:else.nested", "aap", "noot", "mies", "wim"), "mies");
      test.eq(getTid("substitute:else.nested", "zus", "noot", "mies", "wim"), "noot");
      test.eq(getTid("substitute:else.nested", "aap", "zus", "mies", "wim"), "wim");
      test.eq(getTid("substitute:else.nested", "zus", "mies", "noot", "wim"), "zus");

      //regression
      // getTid did not correctly handle non-string parameters:
      // 'Socialite session 'TEST' in connection 'Wilmkinktheater':'Analytics' has expired' and 16 more {i1="1"}error{e}errors{i}{i}
      test.eq(getTid("substitute:regression.checks", 16, "Foutmelding"), "'Foutmelding' en nog 16 fouten");

      // getTid did not correctly handle ifparam with a value of 0:
      // 'Task 'wilminktheater:crm_factory_export' has errors' en nog fouten
      test.eq(getTid("substitute:regression.checks", 0, "Foutmelding"), "Foutmelding");
    }
  , "Test HTML tid's"
  , function()
    {
      let html_texts =
        { "tags": '<b>Vet!</b>'
        , "encoding": 'Codeer &lt;tag> als &amp;lt;tag>'
        , "params": '<a href=\"http://b-lex.nl/?quot=&quot;&amp;aap=&lt;noot&gt;\">{p1}\n</a>'
        , "noparam": 'before<b class=\"bold\">{pp}</b>after'
        };

      registerTexts("html", "nl", html_texts);
      //check language
      test.eq(getTid.tidLanguage, "nl");
      //retrieval
      test.eq(getTid.html("html:tags"), "<b>Vet!</b>");
      test.eq(getTid("html:tags"), "Vet!");
      test.eq(getTid.html("html:encoding"), "Codeer &lt;tag> als &amp;lt;tag>");
      test.eq(getTid("html:encoding"), "Codeer <tag> als &lt;tag>");
      test.eq(getTid.html("html:params", "<hr/>"), "&lt;hr/&gt;<br/>");
      test.eq(getTid("html:params", "<hr/>"), "<hr/>\n");
      test.eq(getTid.html("html:noparam"), "before<b>(no such parameter:p)</b>after");
      test.eq(getTid("html:noparam"), "before(no such parameter:p)after");
    }
  ]);
