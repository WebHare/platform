import { getState } from "@mod-system/js/internal/hmrinternal";
import { registerTexts } from "@mod-tollium/js/gettid";
import { getHTMLTid, getTIDListForLanguage, getTid, getTidForLanguage, setTidLanguage } from "@webhare/gettid";
import { loadlib } from "@webhare/harescript";
import { WittyEncodingStyle, activateHMR, backendConfig, loadWittyResource } from "@webhare/services";
import { storeDiskFile } from "@webhare/system-tools/src/fs";
import * as test from "@webhare/test";

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

test.run([
  tidCompilerTest,
  setupTestModule_LanguageFiles,
  getTidTest,
  fallbackLanguageTest,
  getTidHMRTest,
]);


/*

<?wh

LOADLIB "wh::datetime.whlib";
LOADLIB "wh::files.whlib";
LOADLIB "wh::witty.whlib";

LOADLIB "mod::system/lib/configure.whlib";
LOADLIB "mod::system/lib/testframework.whlib";

LOADLIB "mod::tollium/lib/gettid.whlib";
//LOADLIB "mod::tollium/lib/gettid2.whlib"; //when debugging/developing you might want to copypaste gettid.whlib and develop on your local instance
LOADLIB "mod::tollium/lib/testframework.whlib";

MACRO TidCompilerTest()
{
  //Do as much tests as possible before we install the module...
  TestEq("Dit is bold\nvolgende\nregel", GetTid("webhare_testsuite:test.richtext"));
  TestEq("Dit is <b>bold</b><br />volgende<br />regel", GetHTMLTid("webhare_testsuite:test.richtext"));

  TestEq("param:P1", GetTid("webhare_testsuite:test.richtext_params", "P1", "P2", "P3", "P4"));
  TestEq("param:<i>P1</i>", GetHTMLTid("webhare_testsuite:test.richtext_params", "P1", "P2", "P3", "P4"));

  TestEq("", GetTid(""));
  TestEq("", GetTid(":"));
  TestEq("One", GetTid(":One"));
  TestEq("A&B", GetTid(":A&B"));
  TestEq("A&#38;B", GetHTMLTid(":A&B"));
  TestEq("One", GetTid("webhare_testsuite:aaa.limitlanguage_en.one"));
  TestEq("One", GetTid("webhare_testsuite:AAa.Limitlanguage_en.One"));
  TestEq("One", GetTid("Webhare_Testsuite:aaa.limitlanguage_en.one"));
  TestEq("One", GetTid("webhare_testsuite:aaa.limitlanguage en.one"), "spaces -> underscore");
  TestEq("(cannot find text: webhare testsuite:aaa.limitlanguage_en.one)", GetTid("webhare testsuite:aaa.limitlanguage en.one"), "but should NOT be rewriting module names to underscore");
  TestEq("(cannot find text: webhare_testsuite:aaa.limitlanguage_nl.isnlonly)", GetTIDForLanguage("en", "webhare_testsuite:aaa.limitlanguage_nl.isnlonly"));
  TestEq("IsNLOnly", GetTIDForLanguage("nl", "webhare_testsuite:aaa.limitlanguage_nl.isnlonly"));

  TestEq("Ifparam: p1!=a p2!=b", GetTID("webhare_testsuite:test.ifparam"));
  TestEq("Ifparam: p1=a p2!=b", GetTID("webhare_testsuite:test.ifparam","a"));
  TestEq("Ifparam: p1=a p2!=b", GetTID("webhare_testsuite:test.ifparam","A"));
  TestEq("Ifparam: p1=a p2=b", GetTID("webhare_testsuite:test.ifparam","A","B"));
  TestEq('Use this link to choose a new password', GetHTMLTID("webhare_testsuite:test.hrefparam"));
  TestEq('Use <a href="http://www.webhare.net/">this link</a> to choose a new password', GetHTMLTID("webhare_testsuite:test.hrefparam","http://www.webhare.net/"));
  TestEq('Use <a href="x-fallback:">this link</a> to choose a new password', GetHTMLTID("webhare_testsuite:test.hrefparam2"));
  TestEq('Use <a href="x-test:a&#38;b">this link</a> to choose a new password', GetHTMLTID("webhare_testsuite:test.hrefparam2","x-test:a&b"));

  //Builtins
  TestEq(GetLanguageDatetimeStrings("nl"), GetTidForLanguage("nl","tollium:tilde.locale.datetimestrings"));
  TestEq(GetLanguageDatetimeStrings("nl"), GetTidForLanguage("nl","~locale.datetimestrings"));

  //Common tids
  TestEq("Close", GetTid("~close"));
  TestEq("Add", GetTidForLanguage("en","~add"));
  TestEq("Toevoegen", GetTidForLanguage("nl","~add"));
  TestEq("Nederlands", GetTidForLanguage("nl","tollium:common.languages.nl")); //make sure we're not suddenly requiring nl_NL once these are bound to i18n libraries...

  TestEq(STRING[], GetTIDListForLanguage("en", "webhare_testsuite:aaa"));
  TestEq(STRING[], GetTIDListForLanguage("en", "webhare_testsuite:aaa.limitlanguage_nl"));
  TestEq(STRING['webhare_testsuite:aaa.limitlanguage_en.one', 'webhare_testsuite:aaa.limitlanguage_en.two'], GetTIDListForLanguage("en", "webhare_testsuite:aaa.limitlanguage_en"));
  TestEq(["webhare_testsuite:aaa.limitlanguage_nl.isnlonly"], GetTIDListForLanguage("nl", "webhare_testsuite:aaa.limitlanguage_nl"));
}

MACRO SetupTestModule_LanguageFiles()
{
  testfw->SetupTestModule();

  OBJECT srcwitty := LoadWittyLibrary("mod::webhare_testsuite/lib/system/testmodule.witty", "TEXT");
  StoreDiskFile(GetModuleInstallationRoot(testfw_testmodule) || "language/default.xml", srcwitty->RunComponentToBlob("language_default", RECORD[]), [ overwrite := TRUE ]);
  StoreDiskFile(GetModuleInstallationRoot(testfw_testmodule) || "language/nl.xml", srcwitty->RunComponentToBlob("language_nl", RECORD[]), [ overwrite := TRUE ]);
  StoreDiskFile(GetModuleInstallationRoot(testfw_testmodule) || "language/xx.xml", srcwitty->RunComponentToBlob("language_xx", RECORD[]), [ overwrite := TRUE ]);
  StoreDiskFile(GetModuleInstallationRoot(testfw_testmodule) || "language/xy.xml", srcwitty->RunComponentToBlob("language_xy", RECORD[]), [ overwrite := TRUE ]);
}

MACRO GetTidTest()
{
  SetTidLanguage("en");
  TestEq('(missing module name in tid \'notifications.messagefromthefuture\')', GetTid("notifications.messagefromthefuture"));
  TestEq('(missing module name in tid \'notifications.messagefromthefuture\')', GetHTMLTid("notifications.messagefromthefuture"));
  TestEq("A message with underscores", GetTid("webhare_testsuite_temp:notifications.message_from_the_future"));
  TestEq("A message with underscores", GetTid("webhare_testsuite_temp:notifications.message from the future"));
  TestEq('(cannot find text: webhare testsuite temp:notifications.message_from_the_future)', GetTid("webhare testsuite temp:notifications.message from the future"));

  TestEq("A message", GetTid("webhare_testsuite_temp:notifications.messagefromthefuture"));
  TestEq("A <i>message</i>", GetHTMLTid("webhare_testsuite_temp:notifications.messagefromthefuture"));
  TestEq("An <a href=\"http://www.example.org/\">example</a> link", GetHTMLTid("webhare_testsuite_temp:notifications.linkfromthefuture"));
  TestEq("A <a href=\"https://www.webhare.com/\">parametered</a> link", GetHTMLTid("webhare_testsuite_temp:notifications.linkparameter","https://www.webhare.com/"));
}

MACRO FallbackLanguageTest()
{
  //Create a temporary module
  TestEq("A message", GetTid("webhare_testsuite_temp:notifications.messagefromthefuture"));
  TestEq("A text", GetTid("webhare_testsuite_temp:testfallback.sub.text"));
  TestEq("Another text", GetTid("webhare_testsuite_temp:testfallback.anothertext"));
  TestEq("Can't find me from NL", GetTid("webhare_testsuite_temp:testfallbackdefaultrecursion.text"));
  SetTidLanguage("xxx");
  TestEq("A message", GetTid("webhare_testsuite_temp:notifications.messagefromthefuture"));
  TestEq("A text", GetTid("webhare_testsuite_temp:testfallback.sub.text"));
  TestEq("Another text", GetTid("webhare_testsuite_temp:testfallback.anothertext"));
  SetTidLanguage("nl");
  TestEq("(cannot find text: webhare_testsuite_temp:notifications.messagefromthefuture)", GetTid("webhare_testsuite_temp:notifications.messagefromthefuture"));
  TestEq("Can't find me from NL", GetTid("webhare_testsuite_temp:testfallbackdefaultrecursion.text"));

  SetTidLanguage("XY");
  TestEq("Changed this text!", GetTid("webhare_testsuite_temp:testfallback.anothertext"));
  SetTidLanguage("xy");
  TestEq("Changed this text!", GetTid("webhare_testsuite_temp:testfallback.anothertext"));
  TestEq("A message", GetTid("webhare_testsuite_temp:notifications.messagefromthefuture"));

  SetTidLanguage("en");
}

ASYNC MACRO ScreenTidTest()
{
  SetTidLanguage("debug");
  RECORD rec := AWAIT ExpectScreenChange(+1, PTR GetTestController()->RunScreen("mod::webhare_testsuite/screens/tests/tolliumtids.xml#screen"));

  TestEQ("{webhare_testsuite:testtids.screen.screen}", topscreen->Test());
  TestEQ("{webhare_testsuite:testtids.fragment.fragment}", TT("fragmentcomp")->Test());
  TestEQ("{webhare_testsuite:testtids.fragment.fragment}", topscreen->dynfrag->Test());

  RECORD ext := TT("tabs")->LoadTabsExtension("mod::webhare_testsuite/screens/tests/tolliumtids.xml#tabsextension");
  TestEQ("{webhare_testsuite:testtids.tabsextension.tabsextension}", ext.extension->Test());

  AWAIT ExpectScreenChange(-1, PTR topscreen->TolliumExecuteCancel());
  AWAIT rec.expectcallreturn();
}
RunTestFramework([ PTR TidCompilerTest
                 , PTR SetupTestModule_LanguageFiles
                 , PTR GetTidTest
                 , PTR FallbackLanguageTest
                 , PTR ScreenTidTest
                 ]);
//*/
