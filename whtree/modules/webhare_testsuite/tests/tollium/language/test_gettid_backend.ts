import { getState, activateHMR } from "@webhare/services/src/hmrinternal";
import { registerTexts } from "@mod-tollium/js/gettid";
import { getHTMLTid, getTIDListForLanguage, getTid, getTidForLanguage, getTidLanguage, setTidLanguage } from "@webhare/gettid";
import { loadlib } from "@webhare/harescript";
import { WittyEncodingStyle, backendConfig, loadWittyResource } from "@webhare/services";
import { storeDiskFile } from "@webhare/system-tools/src/fs";
import * as test from "@webhare/test";
import { CodeContext } from "@webhare/services/src/codecontexts";

async function tidCompilerTest() {
  // Do as much tests as possible before we install the module...
  test.eq("Dit is bold\nvolgende\nregel", getTid("webhare_testsuite:test.richtext"));
  test.eq("Dit is <b>bold</b><br>volgende<br>regel", getHTMLTid("webhare_testsuite:test.richtext"));

  test.eq("param:P1", getTid("webhare_testsuite:test.richtext_params", "P1", "P2", "P3", "P4"));
  test.eq("param:<i>P1</i>", getHTMLTid("webhare_testsuite:test.richtext_params", "P1", "P2", "P3", "P4"));

  test.eq("", getTid(""));
  test.eq("", getTid(":"));
  test.eq("One", getTid(":One"));
  test.eq("A&B", getTid(":A&B"));
  test.eq("A&amp;B", getHTMLTid(":A&B"));
  test.eq("One", getTid("webhare_testsuite:aaa.limitlanguage_en.one"));
  test.eq("One", getTid("webhare_testsuite:AAa.Limitlanguage_en.One"));
  test.eq("One", getTid("Webhare_Testsuite:aaa.limitlanguage_en.one"));
  test.eq("One", getTid("webhare_testsuite:aaa.limitlanguage en.one"), "spaces -> underscore");
  test.eq("(cannot find text: webhare testsuite:aaa.limitlanguage_en.one)", getTid("webhare testsuite:aaa.limitlanguage en.one"), "but should NOT be rewriting module names to underscore");
  test.eq("(cannot find text: webhare_testsuite:aaa.limitlanguage_nl.isnlonly)", getTidForLanguage("en", "webhare_testsuite:aaa.limitlanguage_nl.isnlonly"));
  test.eq("IsNLOnly", getTidForLanguage("nl", "webhare_testsuite:aaa.limitlanguage_nl.isnlonly"));

  test.eq("Ifparam: p1!=a p2!=b", getTid("webhare_testsuite:test.ifparam"));
  test.eq("Ifparam: p1=a p2!=b", getTid("webhare_testsuite:test.ifparam", "a"));
  test.eq("Ifparam: p1=a p2!=b", getTid("webhare_testsuite:test.ifparam", "A"));
  test.eq("Ifparam: p1=a p2=b", getTid("webhare_testsuite:test.ifparam", "A", "B"));
  test.eq('Use this link to choose a new password', getHTMLTid("webhare_testsuite:test.hrefparam"));
  test.eq('Use <a href="http://www.webhare.net/">this link</a> to choose a new password', getHTMLTid("webhare_testsuite:test.hrefparam", "http://www.webhare.net/"));
  test.eq('Use <a href="x-fallback:">this link</a> to choose a new password', getHTMLTid("webhare_testsuite:test.hrefparam2"));
  test.eq('Use <a href="x-fallback:">this link</a> to choose a new password', getHTMLTid("webhare_testsuite:test.hrefparam2", "", "unused"));
  test.eq('Use <a href="x-test:a&amp;b">this link</a> to choose a new password', getHTMLTid("webhare_testsuite:test.hrefparam2", "x-test:a&b"));

  test.eq(["Dit is ", ["b", { children: ["bold"] }], ["br", {}], "volgende", ["br", {}], "regel"], getTid("webhare_testsuite:test.richtext", { render: (t, o) => [t, o] }));
  //links are copied verbatim, no corrections:
  test.eq(["Use ", ["a", { href: "x-test:a&b", children: ["this link"] }], " to choose a new password"], getTid("webhare_testsuite:test.hrefparam2", ["x-test:a&b"], { render: (tag: string, props: object) => [tag, props] }));
  test.eq(["Use ", ["a", { href: "x-test:a b", children: ["this link"] }], " to choose a new password"], getTid("webhare_testsuite:test.hrefparam2", ["x-test:a b"], { render: (tag: string, props: object) => [tag, props] }));
  test.eq(["Use ", ["a", { href: "https://beta.webhare.net/a b%20c", children: ["this link"] }], " to choose a new password"], getTid("webhare_testsuite:test.hrefparam2", ["https://beta.webhare.net/a b%20c"], { render: (tag: string, props: object) => [tag, props] }));

  // Builtins
  test.eq(await loadlib("wh::datetime.whlib").getLanguageDatetimeStrings("nl"), getTidForLanguage("nl", "tollium:tilde.locale.datetimestrings"));
  test.eq(await loadlib("wh::datetime.whlib").getLanguageDatetimeStrings("nl"), getTidForLanguage("nl", "~locale.datetimestrings"));

  // Common tids
  test.eq("Close", getTid("~close"));
  test.eq("Add", getTidForLanguage("en", "~add"));
  test.eq("Toevoegen", getTidForLanguage("nl", "~add"));
  test.eq("Nederlands", getTidForLanguage("nl", "tollium:common.languages.nl")); // make sure we're not suddenly requiring nl_NL once these are bound to i18n libraries...

  test.eq([], getTIDListForLanguage("en", "webhare_testsuite:aaa"));
  test.eq([], getTIDListForLanguage("en", "webhare_testsuite:aaa.limitlanguage_nl"));
  test.eq(['webhare_testsuite:aaa.limitlanguage_en.one', 'webhare_testsuite:aaa.limitlanguage_en.two'], getTIDListForLanguage("en", "webhare_testsuite:aaa.limitlanguage_en"));
  test.eq(["webhare_testsuite:aaa.limitlanguage_nl.isnlonly"], getTIDListForLanguage("nl", "webhare_testsuite:aaa.limitlanguage_nl"));

  // register texts
  registerTexts("__testmodule", "en", { testtext: "v1" });
  test.eq("v1", getTid("__testmodule:testtext"));
  registerTexts("__testmodule", "en", { testtext: "v2" });
  test.eq("v2", getTid("__testmodule:testtext"));

}

function getTidTest() {
  setTidLanguage("en");
  test.eq('(missing module name in tid: notifications.messagefromthefuture)', getTid("notifications.messagefromthefuture"));
  test.eq('(missing module name in tid: notifications.messagefromthefuture)', getHTMLTid("notifications.messagefromthefuture"));
  test.eq("A message with underscores", getTid("webhare_testsuite_temp:notifications.message_from_the_future"));
  test.eq("A message with underscores", getTid("webhare_testsuite_temp:notifications.message from the future"));
  test.eq('(cannot find text: webhare testsuite temp:notifications.message_from_the_future)', getTid("webhare testsuite temp:notifications.message from the future"));

  test.eq("A message", getTid("webhare_testsuite_temp:notifications.messagefromthefuture"));
  test.eq("A <i>message</i>", getHTMLTid("webhare_testsuite_temp:notifications.messagefromthefuture"));
  test.eq("An <a href=\"http://www.example.org/\">example</a> link", getHTMLTid("webhare_testsuite_temp:notifications.linkfromthefuture"));
  test.eq("A <a href=\"https://www.webhare.com/\">parametered</a> link", getHTMLTid("webhare_testsuite_temp:notifications.linkparameter", "https://www.webhare.com/"));
}

async function setupTestModule_LanguageFiles() {
  activateHMR();

  // Create a temporary module
  if (backendConfig.module.webhare_testsuite_temp) {
    console.log(`Deleting module "webhare_testsuite_temp"`);
    await loadlib("mod::system/lib/internal/moduleimexport.whlib").DeleteModule("webhare_testsuite_temp");
    console.log(`Waiting for backendconfig update`);
    await test.wait(() => !backendConfig.module.webhare_testsuite_temp);
  }

  console.log(`Creating temp module "webhare_testsuite_temp"`);
  await loadlib("mod::system/lib/internal/modules/support.whlib").SetupModule(
    "webhare_testsuite_temp",
    "webhare_testsuite_temp");

  console.log(`Waiting for backendconfig update`);
  await test.wait(() => backendConfig.module.webhare_testsuite_temp);

  const start = Date.now();

  console.log(`Installing language files`);
  const srcWitty = await loadWittyResource("mod::webhare_testsuite/lib/system/testmodule.witty", { encoding: WittyEncodingStyle.Text });
  await storeDiskFile(backendConfig.module.webhare_testsuite_temp.root + "language/default.xml", await srcWitty.runComponent("language_default", {}), { overwrite: true });
  await storeDiskFile(backendConfig.module.webhare_testsuite_temp.root + "language/nl.xml", await srcWitty.runComponent("language_nl", {}), { overwrite: true });
  await storeDiskFile(backendConfig.module.webhare_testsuite_temp.root + "language/xx.xml", await srcWitty.runComponent("language_xx", {}), { overwrite: true });
  await storeDiskFile(backendConfig.module.webhare_testsuite_temp.root + "language/xy.xml", await srcWitty.runComponent("language_xy", { modifiedtext: "v1" }), { overwrite: true });

  // wait for the invalidation of language/xy.xml
  await test.wait(() => getState().events.some(event => event.when.getTime() > start && event.path.endsWith("language/xy.xml")));
}

async function fallbackLanguageTest() {
  test.eq("A message", getTid("webhare_testsuite_temp:notifications.messagefromthefuture"));
  test.eq("A text", getTid("webhare_testsuite_temp:testfallback.sub.text"));
  test.eq("Another text", getTid("webhare_testsuite_temp:testfallback.anothertext"));
  test.eq("Can't find me from NL", getTid("webhare_testsuite_temp:testfallbackdefaultrecursion.text"));
  setTidLanguage("xxx");
  test.eq("A message", getTid("webhare_testsuite_temp:notifications.messagefromthefuture"));
  test.eq("A text", getTid("webhare_testsuite_temp:testfallback.sub.text"));
  test.eq("Another text", getTid("webhare_testsuite_temp:testfallback.anothertext"));
  setTidLanguage("nl");
  test.eq("(cannot find text: webhare_testsuite_temp:notifications.messagefromthefuture)", getTid("webhare_testsuite_temp:notifications.messagefromthefuture"));
  test.eq("Can't find me from NL", getTid("webhare_testsuite_temp:testfallbackdefaultrecursion.text"));

  setTidLanguage("XY");
  test.eq("Changed this text!", getTid("webhare_testsuite_temp:testfallback.anothertext"));
  setTidLanguage("xy");
  test.eq("Changed this text!", getTid("webhare_testsuite_temp:testfallback.anothertext"));
  test.eq("A message", getTid("webhare_testsuite_temp:notifications.messagefromthefuture"));

  setTidLanguage("en");
}

async function getTidHMRTest() {
  setTidLanguage("xy");
  test.eq("v1", getTid("webhare_testsuite_temp:testhmr.modifiedtext"));

  registerTexts("webhare_testsuite_temp", "xy", { testhmrregister: "v1" });
  test.eq("v1", getTid("webhare_testsuite_temp:testhmrregister"));

  console.log(`replacing language/xy.xml`);
  const start = Date.now();
  const srcWitty = await loadWittyResource("mod::webhare_testsuite/lib/system/testmodule.witty", { encoding: WittyEncodingStyle.Text });
  await storeDiskFile(backendConfig.module.webhare_testsuite_temp.root + "language/xy.xml", await srcWitty.runComponent("language_xy", { modifiedtext: "v2" }), { overwrite: true });

  // wait for the invalidation of language/xy.xml
  await test.wait(() => getState().events.some(event => event.when.getTime() > start && event.path.endsWith("language/xy.xml")));

  test.eq("v2", getTid("webhare_testsuite_temp:testhmr.modifiedtext"));

  // ensure registered texts are still available
  registerTexts("webhare_testsuite_temp", "xy", { testhmrregister: "v1" });
  test.eq("v1", getTid("webhare_testsuite_temp:testhmrregister"));
}

async function testCodeContextTids() {
  setTidLanguage("nl");
  test.eq("nl", getTidLanguage());

  const cc = new CodeContext("gettid1");
  test.eq("en", cc.run(getTidLanguage));
  const cc2 = new CodeContext("gettid2");
  test.eq("en", cc2.run(getTidLanguage));
  cc2.run(() => setTidLanguage("de"));

  test.eq("nl", getTidLanguage());
  test.eq("en", cc.run(getTidLanguage));
  test.eq("de", cc2.run(getTidLanguage));
}

test.runTests([
  tidCompilerTest,
  setupTestModule_LanguageFiles,
  getTidTest,
  fallbackLanguageTest,
  getTidHMRTest,
  testCodeContextTids
]);
