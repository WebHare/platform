import * as test from "@webhare/test";
import { WittyTemplate, EncodingStyles, WittyError, WittyErrorCode } from "@webhare/witty";
import { encodeValue } from "dompack/types/text";

async function simpleTestWTE() {
  let witty: WittyTemplate;

  //Test whether WTE works at all
  witty = new WittyTemplate("Test: [test1] [test2] [[test]");
  test.eq("Test: 1 2 [test]", await witty.run({ test1: "1", test2: 2 }));

  witty = new WittyTemplate("Test: [if test1][test2][else][test3][/if]");
  test.eq("Test: a", await witty.run({ test1: true, test2: "a", test3: "b" }));
  test.eq("Test: b", await witty.run({ test1: false, test2: "a", test3: "b" }));
  test.eq("Test: a", await witty.run({ test1: 2, test2: "a", test3: "b" }));
  test.eq("Test: b", await witty.run({ test1: 0, test2: "a", test3: "b" }));

  witty = new WittyTemplate("Test: [forevery test1][test2][/forevery]:[test2]");
  test.eq("Test: :?", await witty.run({ test1: [], test2: "?" }));
  test.eq("Test: b:b", await witty.run({ test1: [{ x: "x1" }], test2: "b" }));
  test.eq("Test: bb:b", await witty.run({ test1: [{ x: "x1" }, { x: "x2" }], test2: "b" }));
  test.eq("Test: x1:b", await witty.run({ test1: [{ test2: "x1" }], test2: "b" }));
  test.eq("Test: x1x2:b", await witty.run({ test1: [{ test2: "x1" }, { test2: "x2" }], test2: "b" }));

  //Test records and their automatic opening through if
  witty = new WittyTemplate("Test: [if test1][test2][else][test3][/if]");
  test.eq("Test: x", await witty.run({ test1: { test2: "x" }, test2: "a", test3: "b" }));
  test.eq("Test: a", await witty.run({ test1: { test3: "x" }, test2: "a", test3: "b" }));
  test.eq("Test: b", await witty.run({ test1: null, test2: "a", test3: "b" }));

  //Test commenting rules
  witty = new WittyTemplate("Abc def [! ghi ] jkl !] ghi");
  test.eq("Abc def  ghi", await witty.run());
  witty = new WittyTemplate("Abc def [! ghi \n \n jkl !] ghi");
  test.eq("Abc def  ghi", await witty.run());
  witty = new WittyTemplate("Abc def [! ghi \n \n jkl [! !] !] ghi");
  test.eq("Abc def  !] ghi", await witty.run());

  await test.throws(/Witty parse error at 3:20: Unterminated comment/, () => new WittyTemplate("Abc def [! ghi \n \n jkl [! ! ] ! ] ghi"));

  //Test accessing deep records
  witty = new WittyTemplate("[sub.a] [sub.sub.a] [sub.sub.sub.a]");
  test.eq("ja nee misschien", await witty.run({ sub: { a: "ja", sub: { a: "nee", sub: { a: "misschien" } } } }));

  witty = new WittyTemplate("[forevery sub.x][y.z] [/forevery]");
  test.eq("ja nee misschien ", await witty.run({ sub: { x: [{ y: { z: "ja" } }, { y: { z: "nee" } }, { y: { z: "misschien" } }] } }));

  witty = new WittyTemplate("[forevery sub.x][test] [/forevery]");
  //TODO: test.eq("ja nee misschien ", await witty.run({ test: PTR TestPrintYZ, sub: [ x: [ [ y: [ z: "ja" ] ], [ y: [ z: "nee" ] ], [ y: [ z: "misschien" ] ] ] ] ] }));

  //Test BOM stripping
  witty = new WittyTemplate("\xEF\xBB\xBF Had a BOM, now another one: \xEF\xBB\xBF");
  test.eq(" Had a BOM, now another one: ", await witty.run());

  //Test ELSEIF
  witty = new WittyTemplate("Test: [if test1]1[elseif test2]2[elseif test3]3[else]4[/if]x");

  test.eq("Test: 1x", await witty.run({ test1: true }));
  test.eq("Test: 2x", await witty.run({ test1: false, test2: true }));
  test.eq("Test: 3x", await witty.run({ test1: false, test2: false, test3: true }));
  test.eq("Test: 4x", await witty.run({ test1: false, test2: false, test3: false }));

  //Test [] is _not_ accepted
  await test.throws(/Witty parse error at 1:8: Empty command/, () => new WittyTemplate("Test: []"));

  //if not, elseif not
  witty = new WittyTemplate("Test: [if not x]1[elseif not y]2[else]3[/if]x");
  test.eq("Test: 1x", await witty.run({ x: false, y: false }));
  test.eq("Test: 2x", await witty.run({ x: true, y: false }));
  test.eq("Test: 3x", await witty.run({ x: true, y: true }));

  witty = new WittyTemplate("Test: [forevery x][if not first]nf[/if][if not last]nl[/if][if not odd]no[/if][if not seqnr]ns[/if] [/forevery]x");
  test.eq("Test: nlnons nfnl nfnlno nf x", await witty.run({ x: [{}, null, {}, null] }));
  witty = new WittyTemplate("Test: [forevery x][if not first]nf[/if][if not last]nl[/if][if even]no[/if][if not seqnr]ns[/if] [/forevery]x");
  test.eq("Test: nlnons nfnl nfnlno nf x", await witty.run({ x: [{}, null, {}, null] }));

  // Error: record pushed into stack anyway in if not when not existing
  witty = new WittyTemplate("Test: [if not x][if x]1[else]2[/if][else][c][/if]");
  test.eq("Test: 2", await witty.run({ x: null }));
  await test.throws(/No such cell 'c'/, witty.run({ x: { c: 3 } }));

  //Test repeat. No longer supported, just verify it's no longer reserved
  witty = new WittyTemplate("Test: [repeat]");
  test.eq("Test: F0,O1,2,O3,L4,", await witty.run({ repeat: "F0,O1,2,O3,L4," }));

  witty = new WittyTemplate("Test: [test\\:2]");
  test.eq("Test: x", await witty.run({ "test:2": "x" }));

  witty = new WittyTemplate("Test: [test\\]2]");
  test.eq("Test: x", await witty.run({ "test]2": "x" }));

  witty = new WittyTemplate("Test: ['te st]\"2']");
  test.eq("Test: x", await witty.run({ "te st]\"2": "x", "'te st]\"2'": "y" }));

  witty = new WittyTemplate("Test: [test\\]2]");
  test.eq("Test: x", await witty.run({ "test]2": "x" }));

  // Parse error: keywords are case sensitive
  await test.throws(/Unknown data/, () => new WittyTemplate("Test: [IF testProp]testProp[/IF]x"));
  // Runtime error: cell names are case sensitive
  witty = new WittyTemplate("Test: [testprop]x");
  await test.throws(/No such cell/, witty.run({ testProp: "testProp" }));
}

async function foreveryMembersWTE() {
  let witty: WittyTemplate;

  //Test whether WTE works at all
  witty = new WittyTemplate("Test: [if test][forevery test][if first]F[/if][if last]L[/if][if odd]O[/if][seqnr],[/forevery][/if]");
  test.eq("Test: F0,O1,2,O3,L4,", await witty.run({ test: [{ x: 0 }, { x: 0 }, { x: 0 }, { x: 0 }, { x: 0 }] }));

  //Test foreverys through non-record arrays
  witty = new WittyTemplate("Test: [if test][forevery test][if first]F[/if][if last]L[/if][if odd]O[/if][seqnr][test],[/forevery][/if]");
  test.eq("Test: F0a,O1b,2c,O3d,L4e,", await witty.run({ test: ["a", "b", "c", "d", "e"] }));
  witty = new WittyTemplate("Test: [if test.xyz][forevery test.xyz][if first]F[/if][if last]L[/if][if odd]O[/if][seqnr][xyz],[/forevery][/if]");
  test.eq("Test: F0a,O1b,2c,O3d,L4e,", await witty.run({ test: { xyz: ["a", "b", "c", "d", "e"] } }));
}

async function encodingSensitivity() {
  let witty: WittyTemplate;

  //Test HTML encoding..
  witty = new WittyTemplate("[test1]");
  test.eq("&lt;", await witty.run({ test1: "<" }));
  test.eq("<br />", await witty.run({ test1: "\n" }));

  //Test whether the href is properly recognized
  witty = new WittyTemplate("<a href=[test1]>");
  test.eq("<a href=&lt;>", await witty.run({ test1: "<" }));
  test.eq("<a href=&#10;>", await witty.run({ test1: "\n" }));

  //Test whether we properly recognize when a '>' falls inside our outside a tag
  witty = new WittyTemplate("<a href=>[test1]");
  test.eq("<a href=><br />", await witty.run({ test1: "\n" }));
  witty = new WittyTemplate("<a href='>'[test1]");
  test.eq("<a href='>'&#10;", await witty.run({ test1: "\n" }));
  witty = new WittyTemplate("<a href='>\"[test1]");
  test.eq("<a href='>\"&#10;", await witty.run({ test1: "\n" }));
  witty = new WittyTemplate("<a href=\">\'[test1]");
  test.eq("<a href=\">'&#10;", await witty.run({ test1: "\n" }));
  witty = new WittyTemplate("<a href=\">\"[test1]");
  test.eq("<a href=\">\"&#10;", await witty.run({ test1: "\n" }));
  witty = new WittyTemplate("<a href=\">\">[test1]");
  test.eq("<a href=\">\"><br />", await witty.run({ test1: "\n" }));
  witty = new WittyTemplate("<a href=\">\'>[test1]");
  test.eq("<a href=\">\'>&#10;", await witty.run({ test1: "\n" }));

  //Test other encodings
  witty = new WittyTemplate("[test1]", { encoding: EncodingStyles.XML });
  test.eq("&lt;", await witty.run({ test1: "<" }));
  test.eq("&#10;", await witty.run({ test1: "\n" }));

  witty = new WittyTemplate("[test1]", { encoding: EncodingStyles.Text });
  test.eq("<", await witty.run({ test1: "<" }));
  test.eq("\n", await witty.run({ test1: "\n" }));
}

async function wittyRawComponent() {
  let witty: WittyTemplate;
  witty = new WittyTemplate("[rawcomponent x]<div>[[\n  <span>[test1]</span>\n</div>\n![/rawcomponent][embed x]");
  //TODO: test.eq("<div>[[\n  <span>[test1]</span>\n</div>\n!", await witty.run({ test1: PTR Print("yes") }));
}

async function wittyGetTid() {
  let witty: WittyTemplate;

  witty = new WittyTemplate("Test: [gettid bla]");
  //TODO: test.eq("Test: (bla)", await witty.run({ gettid: PTR MyGetTid }));

  witty = new WittyTemplate("Test: [gettid html]");
  //TODO: test.eq("Test: (h&#38;l)", await witty.run({ gettid: PTR MyGetTid }));

  witty = new WittyTemplate("Test: [gethtmltid html]");
  //TODO: test.eq("Test: (h&l)", await witty.run({ gethtmltid: PTR MyGetTid }));

  witty = new WittyTemplate("Test: [gethtmltid html:html]");
  //TODO: test.eq("Test: (h&#38;l)", await witty.run({ gethtmltid: PTR MyGetTid }));

  witty = new WittyTemplate("Test: [gettid bla test]!");
  //TODO: test.eq("Test: (bla:test123)!", await witty.run({ gettid: PTR MyGetTid, test: "test123" }));

  witty = new WittyTemplate("Test: [gettid bla test test2]!");
  //TODO: test.eq("Test: (bla:test123test456)!", await witty.run({ gettid: PTR MyGetTid, test: "test123", test2: "test456" }));

  witty = new WittyTemplate("Test: [gettid bla.bla test.test]!");
  //TODO: test.eq("Test: (bla.bla:test123)!", await witty.run({ gettid: PTR MyGetTid, test: [ test: "test123" ] }));

  witty = new WittyTemplate("Test: [gettid a\\:bla]");
  //TODO: test.eq("Test: (a:bla)", await witty.run({ gettid: PTR MyGetTid }));

  //TODO? __SETWITTYGETTIDFALLBACK(PTR GlobalGetTid, PTR GlobalGetHTMLTid);

  witty = new WittyTemplate("Test: [gettid test]");
  //TODO: test.eq("Test: globalgettid:test", await witty.run({}));
  //TODO: test.eq("Test: (test)", await witty.run( [ gettid: PTR MyGetTid ]));

  witty = new WittyTemplate("Test: [embed testcomp][component testcomp][gettid test][/component]");
  //TODO: test.eq("Test: globalgettid:test", await witty.run({}));
  //TODO: test.eq("Test: (test)", await witty.run( [ gettid: PTR MyGetTid ]));
}

async function wittyLibrarys() {
  /*TODO
  INTEGER scriptid := ParseWittyLibrary("wh::tests/test.witty");
  TEstEq(FALSE, scriptid<=0);
  TestEq("Test: yes!", TrimWhitespace(CaptureWTE(scriptid,[ bla := "yes!" ])));

  OBJECT script, script2;

  script2 := LoadWittyLibrary("wh::tests/test2.witty");
  TestEq("", TrimWhitespace(CaptureRun(script2, [ bla := "yes!" ])));

  script := LoadWittyLibrary("wh::tests/test.witty");
  TestEq("Test: yes!", TrimWhitespace(CaptureRun(script, [ bla := "yes!" ])));
  TestEq("Test: compJE", TrimWhitespace(CaptureRun(script, [ bla := PTR EmbedWittyComponent("test2.witty:comp") ])));
  TestEq("Test: compJE", TrimWhitespace(CaptureRun(script, [ bla := PTR EmbedWittyComponent("wh::tests/test2.witty:comp") ])));
  TestEq("Test: compJE", TrimWhitespace(CaptureRun(script, [ bla := PTR script->RunComponent("test2.witty:comp", DEFAULT RECORD) ])));
  TestEq("Test: compJE", TrimWhitespace(CaptureRun(script, [ bla := PTR script2->RunComponent("test2.witty:comp", DEFAULT RECORD) ])));

  TestEq(TRUE, script->HasComponent("xyz"));
  TestEq(TRUE, script->HasComponent("XYZ"));
  TestEq(TRUE, script->HasComponent("Xyz"));
  TestEq(FALSE, script->HasComponent(" Xyz"));
  TestEq(FALSE, script->HasComponent("test.witty:Xyz"));
  TestEq(FALSE, script->HasComponent("iets"));
  TestEq(FALSE, script->HasComponent(""));

  TestThrowsLike("*Missing component name*", PTR CaptureRun(script, [ bla := PTR EmbedWittyComponent("wh::tests/test2.witty") ]));
  */
}

async function wittyFuncPtrsComponents() {
  let witty: WittyTemplate;

  //Why the exclamation points at the end? To make sure Witty didn't just 'stop' execution after the macro/embedcall.

  witty = new WittyTemplate("Test: [test1]!");
  //TODO: test.eq("Test: yes!", await witty.run({ test1: PTR Print("yes") }));

  witty = new WittyTemplate("[component repeatable][test1]![/component]Test: [embed repeatable][embed repeatable][embed repeatable]");
  //TODO: test.eq("Test: yes!yes!yes!", await witty.run({ test1: PTR Print("yes") }));

  witty = new WittyTemplate("[component repeatable][test1]![/component]Test: [embed repeatable][embed repeatable][embed repeatable]");
  //TODO: test.eq("yes!", await witty.run({ test1: PTR Print("yes") }, "repeatable"));

  witty = new WittyTemplate("[component repeatable][test1]![/component]Test: [body]");
  //TODO: test.eq("Test: yes!", await witty.run({ body: PTR CallWittyComponent("repeatable", { test1: PTR Print("yes") }) }));

  //Test IF and execution on function pointers
  witty = new WittyTemplate("Test: [if test1][test1]![else]nope[/if]");
  //TODO: test.eq("Test: yes!", await witty.run({ test1: PTR Print("yes") }));
  //TODO: test.eq("Test: nope", await witty.run({ test1: DEFAULT FUNCTION PTR }));

  witty = new WittyTemplate("Test: [test1]!");
  //TODO: test.eq("Test: yes!", await witty.run({ test1: PTR Print("yes") }));
  //TODO: test.eq("Test: !", await witty.run({ test1: DEFAULT FUNCTION PTR }));
}

async function wittyErrorHandling() {
  let witty: WittyTemplate;

  witty = new WittyTemplate("Test: [test]");
  /*TODO
  test.eq("Test: ", await witty.run({ test1: PTR Print("yes") }));
  test.eq("TEST", last_witty_error.arg);
  test.eq(15, last_witty_error.code);
  */

  witty = new WittyTemplate("");
  test.eq("", await witty.run());

  try {
    new WittyTemplate("Test: [first]!");
    test.eq(true, false, "Shouldn't reach this point #1");
  } catch (e) {
    if (e instanceof WittyError) {
      //test.eq(script, e->script);
      //test.eq("", e->library);
      test.eq(1, e.errors.length);
      test.eq(1, e.errors[0].line);
      test.eq(WittyErrorCode.ReservedWordAsCell, e.errors[0].code);
      test.eq("first", e.errors[0].arg);
    }
  }

  /*TODO
  script := NEW WittyTemplate("HTML");
  script->LoadCodeDirect("Test: [test]");
  TRY
  {
    CaptureRun(script, [ test1 := PTR Print("yes") ]);
    ABORT("Shouldn't reach this point #2");
  }
  CATCH(OBJECT<WittyRuntimeException> e)
  {
    test.eq("TEST", e->error.arg);
    test.eq(15, e->error.code);
  }
  */

  await test.throws(/.*Invalid closing tag.*/, () => new WittyTemplate("[/unknown]"));

  //TODO: await test.throws(/.*Cannot load library.*/, PTR LoadWittyLibrary("wh::tests/bestaatniet.witty"));

  await test.throws(/.*Missing.*parameter.*/, () => new WittyTemplate("[:html]"));
  await test.throws(/.*Unknown encoding.*/, () => new WittyTemplate("[data:]"));
  await test.throws(/.*Unknown encoding.*/, () => new WittyTemplate("[data : boem]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[data:html java]"));
  await test.throws(/.*Missing.*parameter.*/, () => new WittyTemplate("[gettid]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[gettid data:html java]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[if test test][/if]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[if test][elseif test test][/if]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[if test][/if test]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[seqnr test]"));
  await test.throws(/.*Missing.*parameter.*/, () => new WittyTemplate("[embed]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[embed test test]"));
  await test.throws(/.*Missing.*parameter.*/, () => new WittyTemplate("[component]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[component test test]"));
  await test.throws(/.*Missing.*parameter.*/, () => new WittyTemplate("[forevery]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[forevery test test]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[seqnr test]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[if odd test]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[if even test]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[if first test]"));
  await test.throws(/.*Unknown data.*/, () => new WittyTemplate("[if list test]"));
}

async function wittyCallComponent() {
  /*TODO:
  let witty = new WittyTemplate("Test: [invoke][component comp](bla)[/component]");
  test.eq("Test: ", await witty.run({ invoke: PTR CallWittyComponent("bla", DEFAULT RECORD) }));

  test.eq("Test: (bla)", await witty.run({ invoke: PTR CallWittyComponent("comp", DEFAULT RECORD) }));

  let script := LoadWittyLibrary("wh::tests/testsuite.witty");
  test.eq("Simple", await witty.run({ bla: "yes!" }, "simpleembed"));
  test.eq("subdir", await witty.run({ bla: "yes!" }, "subdirembed"));
  test.eq("reverse", await witty.run({ bla: "yes!" }, "subdirreverseembed"));

  test.eq("yes!", await witty.run({ bla: "yes!" }, "blatest"));
  test.eq("yn", await witty.run({ ra: [ { x: 1 }, { x: 2 } ] }, "firsttest"));
  test.eq("01", await witty.run({ ra: [ { x: 1 }, { x: 2 } ] }, "seqnrtest"));

  test.eq("(module.appgroups.apps)", await witty.run([ gettid: PTR MyGetTid }, "gettidtest"));

  test.eq("yes!", await witty.run({ bla: "yes!", invokewittyvar: PTR PrintWittyVariable("bla") }, "wittyvar"));
  */
}

async function wittyResolving() {
  const witty = new WittyTemplate("Test: [forevery x][forevery x][x][/forevery][/forevery]");
  test.eq("Test: testtest2", await witty.run({ x: [{ x: [{ x: "test" }, { x: "test2" }] }] }));

  /*ADDME: If evaluating [if x.y], both x and y should be pushed to the variable stack, instead of just y
  scriptid := ParseWitty("Test: [if x.y][forevery y][z][/forevery][/if]");
  TestEq(FALSE, scriptid=0);
  output := CaptureWTE(scriptid, [ x := [ y := [[ z := "test" ], [ z := "test2" ] ]] ]);
  TestEq(DEFAULT RECORD, last_witty_error);
  TestEq("Test: testtest2", output);

  scriptid := ParseWitty("Test: [if x.y][embed a][/if][component a][forevery y][z][/forevery][/component]");
  TestEq(FALSE, scriptid=0);
  output := CaptureWTE(scriptid, [ x := [ y := [[ z := "test" ], [ z := "test2" ] ]] ]);
  TestEq(DEFAULT RECORD, last_witty_error);
  TestEq("Test: testtest2", output);
  */
}

async function wittyEncoding() {
  let witty: WittyTemplate;

  witty = new WittyTemplate("Test: [bla]");
  test.eq("Test: yeey", await witty.run({ bla: "yeey" }));
  test.eq('Test: 999999999999999', await witty.run({ bla: 999999999999999 }));

  witty = new WittyTemplate("Test: [bla:none]");
  test.eq("Test: <>java\'\"&code; </script>", await witty.run({ bla: "<>java\'\"&code; </script>" }));

  witty = new WittyTemplate("Test: [bla:cdata]");
  test.eq("Test: <![CDATA[yeey]]>", await witty.run({ bla: "yeey" }));

  witty = new WittyTemplate("Test: [bla:cdata]");
  test.eq("Test: <![CDATA[yeey]]]]><![CDATA[>yeey]]>", await witty.run({ bla: "yeey]]>yeey" }));

  witty = new WittyTemplate("Test: [test:json]");
  test.eq('Test: 42', await witty.run({ test: 42 }));
  test.eq('Test: 42.123', await witty.run({ test: 42.123 }));
  test.eq('Test: 999999999999999', await witty.run({ test: 999999999999999 }));
  test.eq('Test: "42"', await witty.run({ test: "42" }));
  test.eq('Test: {"x":42}', await witty.run({ test: { x: 42 } }));
  test.eq('Test: {"x":"42"}', await witty.run({ test: { x: "42" } }));
  //TODO: TestThrowsLike("Cannot encode*", PTR await witty.run({ test: { x: DEFAULT FUNCTION PTR } }));
  test.eq('Test: {"x":null}', await witty.run({ test: { x: null } }));

  witty = new WittyTemplate("Test: [test:jsonvalue]");
  test.eq(encodeValue('Test: 42'), await witty.run({ test: 42 }));
  test.eq(encodeValue('Test: 42.123'), await witty.run({ test: 42.123 }));
  test.eq(encodeValue('Test: "42"'), await witty.run({ test: "42" }));
  test.eq(encodeValue('Test: {"x":42}'), await witty.run({ test: { x: 42 } }));
  test.eq(encodeValue('Test: {"x":"42"}'), await witty.run({ test: { x: "42" } }));

  // JavaScript wittys don't support url, java, base16 and base64 encodings
  await test.throws(/Witty parse error at 1:8: Unknown encoding 'url' requested/, () => new WittyTemplate("Test: [gettid bla test:url]"));
  await test.throws(/Witty parse error at 1:8: Unknown encoding 'java' requested/, () => new WittyTemplate("Test: [gettid bla test:java]"));
  await test.throws(/Witty parse error at 1:8: Unknown encoding 'base16' requested/, () => new WittyTemplate("Test: [gettid bla test:base16]"));
  await test.throws(/Witty parse error at 1:8: Unknown encoding 'base64' requested/, () => new WittyTemplate("Test: [gettid bla test:base64]"));
}

test.run([
  simpleTestWTE,
  foreveryMembersWTE,
  encodingSensitivity,
  wittyRawComponent,
  wittyGetTid,
  wittyLibrarys,
  wittyFuncPtrsComponents,
  wittyErrorHandling,
  wittyCallComponent,
  wittyResolving,
  wittyEncoding,
]);
