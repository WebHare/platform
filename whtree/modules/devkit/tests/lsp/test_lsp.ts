import bridge from "@mod-system/js/internal/whmanager/bridge";
import { getDefinitions, getCodeActions, doExecuteCommand, doReformat, getHover, doStackTraceRequest } from "@mod-devkit/js/language-server/lsp-services";
import type { Range } from "vscode-languageserver-textdocument";
import * as test from "@webhare/test";
import { emplace, generateRandomId, sleep } from "@webhare/std";
import { logError, toFSPath } from "@webhare/services";
import { URI } from "vscode-uri";
import { readFileSync } from "node:fs";
import type { DocumentsLike, TextDocumentLike } from "@mod-devkit/js/language-server/types";
import { DiagnosticsProcessor, getDiagnostics } from "@mod-devkit/js/language-server/lsp-validation";
import type { Diagnostic, MarkupContent } from "vscode-languageserver";
import type { StackTraceResponse } from "@webhare/lsp-types";
import { loadlib } from "@webhare/harescript";

function getTextAtRange(content: string, range: Range) {
  const lines = content.split('\n').slice(range.start.line, range.end.line + 1);
  //'end' first otherwise we move the text pointed to by end
  lines[lines.length - 1] = lines[lines.length - 1].slice(0, range.end.character + 1);
  lines[0] = lines[0].slice(range.start.character);
  return lines.join('\n');

}

class MockTextDocument implements TextDocumentLike {
  content = "";
  readonly uri: string;
  readonly languageId: string;

  constructor(uri: string, languageId: string) {
    this.uri = uri;
    this.languageId = languageId;
  }

  getText(range?: Range): string {
    if (!range)
      return this.content;
    return getTextAtRange(this.content, range);
  }
}

class MockDocuments implements DocumentsLike, AsyncDisposable {
  store = new Map<string, MockTextDocument>;
  diagnostics = new Map<string, Diagnostic[]>();
  diagprocessor = new DiagnosticsProcessor(this, (uri, diagnostics) => this.updateDiagnostics(uri, diagnostics));

  get(uri: string): MockTextDocument | undefined {
    return this.store.get(uri);
  }
  async setDoc(uri: string, content: string) {
    const langid = uri.endsWith(".whlib") ? "harescript"
      : uri.match(/\/screens\/.*\.xml$/) ? "webhare-screens-xml"
        : "plaintext";

    const doc = emplace(this.store, uri, { insert: () => new MockTextDocument(uri, langid) });
    doc.content = content;

    await this.diagprocessor.update(uri);
  }
  updateDiagnostics(uri: string, diagnostics: Diagnostic[]) {
    this.diagnostics.set(uri, diagnostics);
  }
  async waitSettled() {
    //TODO don't poll, just properly integrate with the diagprocessor
    await test.wait(() => !this.diagprocessor.isProcessing());
  }

  async [Symbol.asyncDispose]() {
    await this.waitSettled();
  }
}

async function testDiagnostics() {
  await using docs = new MockDocuments;
  const testwhlib = "file://" + toFSPath("mod::devkit/lib/internal/whfeedbackapi.whlib");
  const testxml = "file://" + toFSPath("mod::devkit/screens/screen.xml");

  await docs.setDoc(testwhlib, `<?wh\nPRINT;\n`);
  await docs.setDoc(testxml, `<screens xmlns="http://www.webhare.net/xmlns/tollium/screens">\n  <screen name="test" implementation="none">\n    <body><text tid="~nosuchtext" /></body>\n  </screen>\n</screens>\n`);

  test.assert(docs.diagprocessor.isProcessing());
  await docs.waitSettled();

  test.eqPartial([{ message: /Expected opening/ }], docs.diagnostics.get(testwhlib));

  //modify doc
  await docs.setDoc(testwhlib, `<?wh\nLOADLIB "mod::publisher/lib/publisher.whlib";\n\nPRINT("yes!");\n`);
  test.assert(docs.diagprocessor.isProcessing());
  await docs.waitSettled();

  test.eqPartial([
    {
      range: { start: { line: 1, character: 8 }, end: { line: 1, character: 44 } },
      message: `No symbol from loadlib 'mod::publisher/lib/publisher.whlib' is referenced in this library`
    }
  ], docs.diagnostics.get(testwhlib));


  //libxml2 doesn't support column positions so we expect errors to mark the whole line
  test.eqPartial([
    {
      message: /Missing tid from attribute /,
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 43 } }
    }
  ], docs.diagnostics.get(testxml));
}

async function testSymbolLookupAndHover() {
  await using docs = new MockDocuments;
  const testfileurl = "file://" + toFSPath("mod::devkit/lib/internal/whfeedbackapi.whlib");

  for (const totest of [
    { code: "OpenPrimary();", match: /database.whlib$/, matchText: "OpenPrimary", matchHover: /OBJECT FUNCTION OpenPrimary/ },
    { code: "__INTERNAL_GetSystemSchemaBinding();", match: /database.whlib$/, matchText: "__INTERNAL_GetSystemSchemaBinding", matchHover: /OBJECT FUNCTION __INTERNAL_GetSystemSchemaBinding/ },
    { code: "jsonobject", match: /system.whlib$/, matchText: "JSONObject", matchHover: /OBJECTTYPE JSONObject/ },
  ]) {
    await docs.setDoc(testfileurl, `<?wh\n${totest.code}\n`);
    const defs = await getDefinitions(docs, {
      textDocument: { uri: testfileurl }, position: { line: 1, character: 6 }
    });
    test.assert(!Array.isArray(defs)); //should only return the exact match
    test.eqPartial({ uri: totest.match }, defs);

    //verify location
    const textatloc = getTextAtRange(readFileSync(URI.parse(defs.uri).fsPath, 'utf8'), defs.range);
    test.eq(totest.matchText, textatloc); //TODO add a test but the locations seem off?

    const hover = await getHover(docs, {
      textDocument: { uri: testfileurl }, position: { line: 1, character: 6 }
    }, false);

    test.eq(totest.matchHover, (hover?.contents as MarkupContent).value);
  }
}

async function testFormatting() {
  await using docs = new MockDocuments;
  const testfileurl = "file://" + toFSPath("mod::devkit/moduledefinition.xml");
  await docs.setDoc(testfileurl, `<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition"><meta/></module>\n`);
  const rewrite = await doReformat(docs.get(testfileurl)!, { insertSpaces: true, tabSize: 2 });
  test.eq('<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">\n' +
    '\n' +
    '  <meta />\n' +
    '\n' +
    '</module>\n', rewrite![0].newText);
}

async function testSourceFixing() {
  await using docs = new MockDocuments;
  const testfileurl = "file://" + toFSPath("mod::devkit/lib/internal/whfeedbackapi.whlib");

  const sourcecodeindexCatalog = await loadlib("mod::consilio/lib/api.whlib").OpenConsilioCatalog("devkit:sourcecode");
  const sourcecodeindexContentSource = await sourcecodeindexCatalog.OpenContentSource("devkit:moduleresources");

  for (const res of ["mod::system/lib/testframework.whlib", "mod::tollium/lib/gettid.whlib"])
    await sourcecodeindexContentSource.ReindexGroup(res);


  //Test add missing loadlib
  for (const totest of [
    { code: "OpenPrimary();", error: /Undefined function 'OPENPRIMARY'/, fix: /.*LOADLIB.*database.whlib/ },
    { code: `NONE_${generateRandomId("hex", 16)} := 42;`, error: /Undefined variable 'NONE_/, fix: null, fixerror: /not found/ },
    { code: `testfw;`, error: /Undefined variable 'TESTFW/, fix: /LOADLIB.*testframework.whlib/, fixerror: /not found/ },
    { code: `GetTid("~yes");`, error: /Undefined function 'GETTID'/, fix: /LOADLIB.*gettid.whlib/, fixerror: /not found/ },
  ]) {
    await docs.setDoc(testfileurl, `<?wh\n${totest.code}\n`);

    const diag = await getDiagnostics(docs.get(testfileurl)!);
    test.assert(diag.find(_ => _.message.match(totest.error)), `Expected error ${totest.error} not found`);

    const codeactions = await getCodeActions({
      context: { diagnostics: diag },
      textDocument: { uri: testfileurl },
      range: { start: { line: 1, character: 4 }, end: { line: 1, character: 4 } }
    });

    test.assert(Array.isArray(codeactions));
    test.eqPartial([{ "kind": "quickfix", "title": "Add missing loadlib", command: {} }], codeactions);

    const commandrequest = await doExecuteCommand(docs, codeactions[0].command!);
    if (totest.fix) {
      test.assert(!("error" in commandrequest), `commandrequest for '${totest.code}' should not have an error, but this test is inherently racy as we're not waiting for system/lib/testframework.whlib to be indexed`);
      test.eqPartial([{ newText: totest.fix }], commandrequest?.changes?.[testfileurl]);
    } else {
      test.assert(("error" in commandrequest), `commandrequest for '${totest.code}' should have an error`);
      test.eq(totest.fixerror, commandrequest.error);
    }
  }

  //Test remove unused loadlib
  await docs.setDoc(testfileurl, `<?wh\nLOADLIB "mod::system/lib/database.whlib";\n\nPrint("Hello, World\\n");\n`);
  const diag = await getDiagnostics(docs.get(testfileurl)!);
  test.eqPartial([{ message: /No symbol from.*database.whlib/ }], diag);

  const codeactions = await getCodeActions({
    context: { diagnostics: diag },
    textDocument: { uri: testfileurl },
    range: diag[0].range
  });

  test.assert(Array.isArray(codeactions));
  test.eqPartial([{ "kind": "quickfix", "title": "Remove unused loadlib", command: {} }], codeactions);

  const commandrequest = await doExecuteCommand(docs, codeactions[0].command!);
  test.assert(!("error" in commandrequest), `commandrequest should not have an error`);
  test.eqPartial([{ newText: "" }], commandrequest?.changes?.[testfileurl]);
  const removedText = getTextAtRange(docs.get(testfileurl)!.content, commandrequest?.changes?.[testfileurl][0].range as Range);
  test.eq('LOADLIB "mod::system/lib/database.whlib";\n', removedText);
}

function checkStackTraces(response: StackTraceResponse) {
  for (const error of response.errors)
    for (const stack of error.stack)
      if (stack.filename)
        test.eq(/^(\/|node)/, stack.filename, "We want absolute path names in traces, no resources");
}

async function testStackTrace() {
  const traces1 = await doStackTraceRequest(null);
  const lastguid = traces1.errors[0]?.guid || null;
  checkStackTraces(traces1);

  logError(new Error("test log message for testStackTrace"));
  await bridge.ensureDataSent();
  await bridge.flushLog("system:notice"); //TODO we might not need to explicitly log if doStackTraceRequest switches to readLogLines which implies a flush? (but wem ight)

  //wait for our trace to appear
  let traces2, mylog;
  do {
    await sleep(50);
    traces2 = await doStackTraceRequest(lastguid);
    mylog = traces2.errors.find(_ => _.stack.find(trace => trace.message === "test log message for testStackTrace"));
  } while (!mylog);

  if (lastguid)
    test.assert(!traces2.errors.find(_ => _.guid === lastguid), "shouldn't find the previous guid in the new trace list");
  checkStackTraces(traces2);
}

test.run([
  testDiagnostics,
  testSymbolLookupAndHover,
  testFormatting,
  testSourceFixing,
  testStackTrace,
]);
