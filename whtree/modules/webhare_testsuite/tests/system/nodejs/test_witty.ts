import * as test from "@webhare/test";
import * as services from "@webhare/services/src/services";
import { encodeValue } from "dompack/types/text";
import { loadWittyTemplate, WittyTemplate, EncodingStyles, WittyError, WittyErrorCode, WittyCallContext } from "@webhare/witty";

function testPrintYZ(ctx: WittyCallContext) {
  return (ctx.getWittyVariable("y") as { z: string }).z;
}

async function simpleTestWTE() {
  let witty: WittyTemplate;

  //Test whether WTE works at all
  witty = new WittyTemplate("Test: [test1] [test2] [[test]");
  test.eq("Test: 1 2 [test]", await witty.run({ test1: "1", test2: 2 }));
  await test.throws(/No such cell 'test1'/, () => witty.run("test1"));

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

  // function pointer without context
  witty = new WittyTemplate("[forevery sub.x][test] [/forevery]");
  test.eq("test test test ", await witty.run({ test: () => "test", sub: { x: [{ y: { z: "ja" } }, { y: { z: "nee" } }, { y: { z: "misschien" } }] } }));

  // function pointer with context
  witty = new WittyTemplate("[forevery sub.x][test] [/forevery]");
  test.eq("ja nee misschien ", await witty.run({ test: testPrintYZ, sub: { x: [{ y: { z: "ja" } }, { y: { z: "nee" } }, { y: { z: "misschien" } }] } }));

  // Test 'this' binding and other arguments in function ptr with context
  class TestClass {
    private readonly witty: WittyTemplate;
    private readonly stuff: string;

    constructor() {
      this.witty = new WittyTemplate("([test])");
      this.stuff = "property";
    }

    async run(arg: string): Promise<string> {
      return await this.witty.run({ test: (ctx: WittyCallContext) => this.printStuff(arg, ctx), bla: "wittyvar" });
    }

    printStuff(arg: string, ctx: WittyCallContext): string {
      return [arg, this.stuff, ctx.getWittyVariable("bla")].join(", ");
    }
  }
  test.eq("(argument, property, wittyvar)", await (new TestClass).run("argument"));

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
  test.eq("<div>[[\n  <span>[test1]</span>\n</div>\n!", await witty.run({ test1: () => "yes" }));
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
  await services.ready();
  const script = await loadWittyTemplate("mod::system/whlibs/tests/test.witty");
  test.eq("Test: yes!", (await script.run({ bla: "yes!" })).trim());
  test.eq("c7a-te", await script.runComponent("c7atext"));
  test.eq("c7a-te:yes!", await script.runComponent("c7a", { bla: "no!", x: "yes!" }));

  const script2 = await loadWittyTemplate("mod::system/whlibs/tests/test2.witty");
  test.eq("", (await script2.run({ bla: "yes!" })).trim());

  test.eq("Test: compJE", (await script.run({ bla: (ctx: WittyCallContext) => ctx.embedWittyComponent("test2.witty:comp") })).trim());
  test.eq("Test: compJE", (await script.run({ bla: (ctx: WittyCallContext) => ctx.embedWittyComponent("mod::system/whlibs/tests/test2.witty:comp") })).trim());
  test.eq("Test: compJE", (await script.run({ bla: () => script.runComponent("test2.witty:comp") })).trim());
  test.eq("Test: compJE", (await script.run({ bla: () => script2.runComponent("test2.witty:comp") })).trim());

  test.eq(true, script.hasComponent("xyZ"));
  test.eq(false, script.hasComponent("xyz")); // component names are case sensitive
  test.eq(false, script.hasComponent(" xyZ"));
  test.eq(false, script.hasComponent("test.witty:xyZ"));
  test.eq(false, script.hasComponent("iets"));
  test.eq(false, script.hasComponent(""));

  await test.throws(/Missing component name/, () => script.run({ bla: (ctx: WittyCallContext) => ctx.embedWittyComponent("mod::system/whlibs/tests/test2.witty") }));
}

async function wittyFuncPtrsComponents() {
  let witty: WittyTemplate;

  //Why the exclamation points at the end? To make sure Witty didn't just 'stop' execution after the macro/embedcall.

  witty = new WittyTemplate("Test: [test1]!");
  test.eq("Test: yes!", await witty.run({ test1: () => "yes" }));

  witty = new WittyTemplate("[component repeatable][test1]![/component]Test: [embed repeatable][embed repeatable][embed repeatable]");
  test.eq("Test: yes!yes!yes!", await witty.run({ test1: () => "yes" }));

  witty = new WittyTemplate("[component repeatable][test1]![/component]Test: [embed repeatable][embed repeatable][embed repeatable]");
  test.eq("yes!", await witty.runComponent("repeatable", { test1: () => "yes" }));

  witty = new WittyTemplate("[component repeatable][test1]![/component]Test: [body]");
  test.eq("Test: yes!", await witty.run({ body: (ctx: WittyCallContext) => ctx.embedWittyComponent("repeatable", { test1: () => "yes" }) }));

  //Test IF and execution on function pointers
  witty = new WittyTemplate("Test: [if test1][test1]![else]nope[/if]");
  test.eq("Test: yes!", await witty.run({ test1: () => "yes" }));
  test.eq("Test: nope", await witty.run({ test1: null }));

  witty = new WittyTemplate("Test: [test1]!");
  test.eq("Test: yes!", await witty.run({ test1: () => "yes" }));
  test.eq("Test: !", await witty.run({ test1: null }));
}

async function wittyErrorHandling() {
  let witty: WittyTemplate;

  witty = new WittyTemplate("");
  test.eq("", await witty.run());

  try {
    new WittyTemplate("Test: [first]!");
    test.eq(true, false, "Shouldn't reach this point #1");
  } catch (e) {
    test.assert(e instanceof WittyError);
    test.eq(1, e.errors.length);
    test.eq("", e.errors[0].resource);
    test.eq(1, e.errors[0].line);
    test.eq(8, e.errors[0].column);
    test.eq(WittyErrorCode.ReservedWordAsCell, e.errors[0].code);
    test.eq("first", e.errors[0].arg);
  }

  witty = new WittyTemplate("Test: [test]");
  try {
    await witty.run({ test1: () => "yes" });
    test.eq(true, false, "Shouldn't reach this point #2");
  } catch (e) {
    test.assert(e instanceof WittyError);
    test.eq(1, e.errors.length);
    test.eq("", e.errors[0].resource);
    test.eq(1, e.errors[0].line);
    test.eq(8, e.errors[0].column);
    test.eq("test", e.errors[0].arg);
    test.eq(WittyErrorCode.NoSuchCell, e.errors[0].code);
  }

  await test.throws(/Invalid closing tag/, () => new WittyTemplate("[/unknown]"));

  await test.throws(/Cannot load library/, () => loadWittyTemplate("mod::system/whlibs/tests/bestaatniet.witty"));

  await test.throws(/Missing.*parameter/, () => new WittyTemplate("[:html]"));
  await test.throws(/Unknown encoding/, () => new WittyTemplate("[data:]"));
  await test.throws(/Unknown encoding/, () => new WittyTemplate("[data : boem]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[data:html java]"));
  await test.throws(/Missing.*parameter/, () => new WittyTemplate("[gettid]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[gettid data:html java]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[if test test][/if]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[if test][elseif test test][/if]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[if test][/if test]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[seqnr test]"));
  await test.throws(/Missing.*parameter/, () => new WittyTemplate("[embed]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[embed test test]"));
  await test.throws(/Missing.*parameter/, () => new WittyTemplate("[component]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[component test test]"));
  await test.throws(/Missing.*parameter/, () => new WittyTemplate("[forevery]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[forevery test test]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[seqnr test]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[if odd test]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[if even test]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[if first test]"));
  await test.throws(/Unknown data/, () => new WittyTemplate("[if list test]"));
}

async function wittyCallComponent() {
  await services.ready();

  const witty = new WittyTemplate("Test: [invoke][component comp](bla)[/component]");
  await test.throws(/No such component 'bla'/, () => witty.run({ invoke: (ctx: WittyCallContext) => ctx.embedWittyComponent("bla") }));
  test.eq("Test: (bla)", await witty.run({ invoke: (ctx: WittyCallContext) => ctx.embedWittyComponent("comp") }));

  const script = await loadWittyTemplate("mod::system/whlibs/tests/testsuite.witty");
  test.eq("Simple", await script.runComponent("simpleembed", { bla: "yes!" }));
  test.eq("subdir", await script.runComponent("subdirembed", { bla: "yes!" }));
  test.eq("reverse", await script.runComponent("subdirreverseembed", { bla: "yes!" }));

  test.eq("yes!", await script.runComponent("blatest", { bla: "yes!" }));
  test.eq("yn", await script.runComponent("firsttest", { ra: [{ x: 1 }, { x: 2 }] }));
  test.eq("01", await script.runComponent("seqnrtest", { ra: [{ x: 1 }, { x: 2 }] }));

  //TODO: test.eq("(module.appgroups.apps)", await witty.run([ gettid: PTR MyGetTid }, "gettidtest"));

  test.eq("yes!", await script.runComponent("wittyvar", { bla: "yes!", invokewittyvar: (ctx: WittyCallContext) => ctx.encodeWittyVariable(ctx.getWittyVariable("bla")) }));
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
