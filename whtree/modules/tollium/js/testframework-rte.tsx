import * as domfocus from 'dompack/browserfix/focus';
import * as test from './testframework';
import * as richdebug from '@mod-tollium/web/ui/components/richeditor/internal/richdebug';
import * as domlevel from '@mod-tollium/web/ui/components/richeditor/internal/domlevel';
import * as snapshots from '@mod-tollium/web/ui/components/richeditor/internal/snapshots';
import Range from '@mod-tollium/web/ui/components/richeditor/internal/dom/range';
import RangeIterator2 from '@mod-tollium/web/ui/components/richeditor/internal/dom/rangeiterator';
import * as diff from 'diff';
import type ObjRTE from '@mod-tollium/webdesigns/webinterface/components/rte/rte.tsx';
import type StructuredEditor from '@mod-tollium/web/ui/components/richeditor/internal/structurededitor';
import type FreeEditor from '@mod-tollium/web/ui/components/richeditor/internal/free-editor';
import type { TestWaitItem } from './testframework';

//capture the next richeditor-action event
export function getNextAction() {
  return test.waitForEvent(test.getWin(), 'wh:richeditor-action', { capture: true, stop: true });
}

type WindowWithRTE = Window & { rte: StructuredEditor | FreeEditor };
type NodeWithRTE = Node & { rte: StructuredEditor | FreeEditor };

export class RTEDriver {
  rte: StructuredEditor | FreeEditor;
  editor: StructuredEditor | FreeEditor;

  constructor(rte: StructuredEditor | FreeEditor) {
    if (rte && typeof rte === 'string') {
      const comp = test.compByName(rte);
      if (comp)
        rte = comp.propTodd.rte;
    }

    if (!rte) {
      rte = (test.getWin() as WindowWithRTE | NodeWithRTE).rte;
      if (!rte)
        throw new Error("Test window has no RTE"); //TODO allow option
    }
    this.rte = rte;
    this.editor = rte.getEditor();
  }

  qS(selector: string) {
    return this.rte.qS(selector);
  }

  qSA(selector: string) {
    return this.rte.qSA(selector);
  }

  get body() {
    return this.editor.getBody();
  }

  setSelection(startContainer: Node, startOffset: number, endContainer: Node, endOffset: number) {
    if (!startOffset)
      startOffset = 0;

    if (!endContainer) {
      endContainer = startContainer;
      endOffset = startOffset;
    }
    setRTESelection(test.getWin(), this.editor, { startContainer, startOffset, endContainer, endOffset });
  }

  //execute a property action and get the result
  async executeProperties() {
    const propsbutton = test.qS("[data-button=action-properties]");
    if (!propsbutton)
      throw new Error("No properties button present!");

    if (propsbutton.classList.contains("disabled"))
      throw new Error("Properties button is disabled!");

    const result = getNextAction();
    test.click(propsbutton);
    return await result;
    //FIXME throw if properties button is not enabled

  }
}

export function getTextChild(node: Node | null) {
  while (node && node.nodeType !== 3)
    node = node.firstChild;
  return node;
}

export function RunIteratorOnRange2(win: Window, range: Range) {
  const itr = new RangeIterator2(range);
  const list = [];

  while (!itr.atEnd()) {
    const name = itr.node!.nodeType === 3 ? '#text: ' + itr.node!.nodeValue : itr.node!.nodeName.toLowerCase();
    list.push(name);
    itr.nextRecursive();
  }

  return list;
}

//get the current selection for the test window, avoiding Rangy and RTE
export function getCurrentRawSelection() {
  const sel = test.getWin().getSelection();
  if (!sel)
    throw new Error("No selection available");
  return {
    anchor: { node: sel.anchorNode, offset: sel.anchorOffset },
    focus: { node: sel.focusNode, offset: sel.focusOffset },
    isCollapsed: sel.isCollapsed,
    type: sel.type
  };

}

export function getRTESelection(win: Window, rte: StructuredEditor | FreeEditor) {
  return rte.getSelectionRange().toDOMRange();
}

export function setRTESelection(win: Window, rte: StructuredEditor | FreeEditor, domrange: { startContainer: Node; startOffset: number; endContainer: Node; endOffset: number }) {
  if (!domrange.endContainer) {
    domrange.endContainer = domrange.startContainer;
    if (!domrange.endOffset)
      domrange.endOffset = domrange.startOffset;
  }
  rte.selectRange(Range.fromDOMRange(domrange));
}

export function getCompStyle(node: HTMLElement, prop: string) {
  return getComputedStyle(node).getPropertyValue(prop);
}

export function testEqHTMLEx(unused: unknown, expect: string, node: Node, locators?: domlevel.Locator[]) {
  const actual = richdebug.cloneNodeWithTextQuotesAndMarkedLocators(node, locators || []).innerHTML;
  test.eqHTML(expect, actual);
}

export function testEqSelHTMLEx(unused: unknown, expect: string) {
  const rte = (test.getWin() as WindowWithRTE).rte.getEditor();
  const range = rte.getSelectionRange();
  testEqHTMLEx(undefined, expect, rte.getBody(), [range.start, range.end]);
}

export function setRawStructuredContent(win: Window, structuredhtml: string) {
  setStructuredContent(win, structuredhtml, true);
}

export function setStructuredContent(rte: StructuredEditor | Window | WindowWithRTE | NodeWithRTE | Node | null, structuredhtml: string, options?: boolean | { raw?: boolean; verify?: boolean }) {
  options = { raw: false, verify: true, ...(typeof options === "boolean" ? { raw: options } : options || {}) };

  if (!rte) {
    rte = (test.getWin() as WindowWithRTE).rte as StructuredEditor;
    if (!rte)
      throw new Error(`test.getWin() has no rte`);
  } else if (rte && (("document" in rte || "nodeType" in rte))) {//doesn't look like a RTE...
    rte = (rte as WindowWithRTE).rte as StructuredEditor;
    if (!rte)
      throw new Error(`Window passed as first argument has no rte`);
  }

  if (options.raw)
    rte.setContentsHTMLRaw(structuredhtml);
  else
    rte.setContentsHTML(structuredhtml);

  const locators = richdebug.unstructureDom(rte.getBody());
  if (options.verify)
    testEqHTMLEx(undefined, structuredhtml, rte.getBody(), locators);

  if (locators[0]) {
    if (locators[1])
      rte.selectRange(new Range(locators[0], locators[1]));
    else
      rte.setCursorAtLocator(locators[0]);
  } else // Must set selection because of our unstructuredom manipulations
    rte.setCursorAtLocator(new domlevel.Locator(rte.getBody()));

  return locators;
}

export function getRawHTMLTextArea(win: Window) {
  const ta = test.compByName('code').querySelector('textarea');
  return ta;
}

export function getRawHTMLCode(win: Window) {
  let code = getRawHTMLTextArea(win).value;
  code = code.split('\n').join('').split('</html>')[0]; //strip comments behind the </html>
  return code;
}

export function getRTE(win: Window, toddname: string) {
  const comp = test.compByName(toddname);
  if (!comp)
    throw new Error("No such component with name '" + toddname + "'");
  return (comp.propTodd as ObjRTE).rte;
}

export function getPreActionState(rte: StructuredEditor | FreeEditor) {
  const snapshot = snapshots.generateSnapshot(rte.getBody(), rte.getSelectionRange());
  return { __snapshot: snapshot, __undopos: rte.undopos };
}

function getStack(message: string) {
  try { throw new Error(message); } catch (e) { return (e as Error).stack!; }
}

export async function testUndoRedo(rte: StructuredEditor | FreeEditor, preactionstate: ReturnType<typeof getPreActionState>, { stack }: { stack?: string } = {}) {
  // console.log(`testUndoRedo prestate`, "\n" + snapshots.dumpSnapShot(preactionstate.__snapshot), preactionstate.__snapshot);
  stack = stack || getStack(`trace`);

  if (!rte.options.allowundo)
    throw new Error(`Undo is not enabled in the RTE\n` + stack);

  if (rte.undopos === preactionstate.__undopos)
    throw new Error(`Expected an action that recorded an undo event\n` + stack);

  const last = rte.undostack.length && rte.undostack[rte.undostack.length - 1];
  if (!last || !last.finished)
    throw new Error(`Last undo item wasn't finished\n` + stack);

  //console.log("wait for undo stack to update");
  await test.sleep(1);

  const currentsnapshot = snapshots.generateSnapshot(rte.getBody(), rte.getSelectionRange());
  // console.log(`testUndoRedo current`, "\n" + snapshots.dumpSnapShot(currentsnapshot));

  // console.log('undo supported: ', document.queryCommandSupported("undo"), rte.undonode);
  // rte.undonode.focus();
  // await test.sleep(1);

  test.getDoc().execCommand("undo");
  //console.log("executed undo, waiting for effects");

  await test.sleep(1);

  // console.log(`testUndoRedo after undo`, "\n" + snapshots.dumpSnapShot(currentsnapshot));

  const undosnapshot = snapshots.generateSnapshot(rte.getBody(), rte.getSelectionRange());
  if (!snapshots.snapshotsEqual(preactionstate.__snapshot, undosnapshot)) {
    console.log(`State after undo doesn't match pre-action state.`);
    console.log(`Expected:\n`, snapshots.dumpSnapShot(preactionstate.__snapshot));
    console.log(`Got:\n` + snapshots.dumpSnapShot(undosnapshot));

    let str = "diff:\n";
    const colors = [];
    for (const change of diff.diffChars(snapshots.dumpSnapShot(preactionstate.__snapshot), snapshots.dumpSnapShot(undosnapshot))) {
      str += `%c${change.value}`;
      colors.push(change.added ? "background-color:red; color: white" : change.removed ? "background-color:green; color: white" : "");
    }
    console.log(str, ...colors);

    throw new Error(`Undo failed\n` + stack);
  }

  //console.log('redo supported: ', document.queryCommandSupported("undo"));
  test.getDoc().execCommand("redo");

  await test.sleep(5);

  //console.log(`testUndoRedo after redo`, "\n" + dumpSnapShot(currentsnapshot));

  const redosnapshot = snapshots.generateSnapshot(rte.getBody(), rte.getSelectionRange());
  if (!snapshots.snapshotsEqual(currentsnapshot, redosnapshot)) {
    console.log(`State after redo doesn't match original state. Expected:`);
    console.log(snapshots.dumpSnapShot(currentsnapshot), `Got:`);
    console.log(snapshots.dumpSnapShot(redosnapshot));

    let str = "diff: ";
    const colors = [];
    for (const change of diff.diffChars(snapshots.dumpSnapShot(currentsnapshot), snapshots.dumpSnapShot(redosnapshot))) {
      str += `%c${change.value}`;
      colors.push(change.added ? "background-color:red; color: white" : change.removed ? "background-color:green; color: white" : "");
    }
    console.log(str, ...colors);

    throw new Error(`Redo failed\n` + stack);
  }
}

/** Undo barrier to make sure multiple items aren't coalesced */
export async function undoBarrier() {
  // Wait for undo stack to update
  await test.sleep(1);
  test.getDoc().execCommand("undo");
  await test.sleep(1);
  test.getDoc().execCommand("redo");
  await test.sleep(1);
}

export async function runWithUndo(rte: StructuredEditor | FreeEditor, func: () => Promise<void> | void, options: { waits?: TestWaitItem } = {}) {
  const prestate = getPreActionState(rte);
  const stack = getStack(`stack`);

  await func();

  //wait for all uploads to complete
  await test.wait(() => !rte.getBody().querySelector(".wh-rtd__img--uploading"));

  if (options.waits)
    await test.wait(options.waits);

  await testUndoRedo(rte, prestate, { stack });
}

class ClipBoardEmul {
  files: File[];
  items: DataTransferItem[];
  types: string[];
  _typesdata: Record<string, unknown>;

  constructor(props: { files?: File[]; items?: DataTransferItem[]; types?: string[]; typesdata: Record<string, unknown> }) {
    this.files = props.files || [];
    this.items = props.items || [];
    this.types = props.types || [];
    this._typesdata = props.typesdata;
  }

  getData(type: string) {
    return this._typesdata[type];
  }
}

export async function paste(rte: StructuredEditor, props: {
  typesdata: Record<string, unknown>;
  files?: File[];
  items?: DataTransferItem[];
  types?: string[];
} | DataTransfer) {
  const target = domfocus.getCurrentlyFocusedElement()!;

  if (props instanceof DataTransfer) {
    const evt = new target.ownerDocument.defaultView!.ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: props,
    });

    const dodefault = target.dispatchEvent(evt);
    return dodefault;
  } else {
    /* event spec: https://w3c.github.io/clipboard-apis/#clipboard-event-interfaces
       only firefox is said to implement clipboard currently so we'll create a plain event */
    const evt = target.ownerDocument.createEvent('Event');

    const types = Object.keys(props.typesdata);
    (types as string[] & { contains: unknown }).contains = (key: string) => types.includes(key);

    props = { types, ...props };
    const cpdata = new ClipBoardEmul(props);

    evt.initEvent('paste', true, true);
    Object.defineProperty(evt, 'clipboardData', { get: () => cpdata });

    const dodefault = target.dispatchEvent(evt);
    return dodefault;
  }

}

export function copy(rte: StructuredEditor) {
  const target = domfocus.getCurrentlyFocusedElement()!;

  const clipboardData = new DataTransfer();

  // 3. Dispatch the synthetic copy event for your event listeners
  const copyEvent = new target.ownerDocument.defaultView!.ClipboardEvent("copy", {
    bubbles: true,
    cancelable: true,
    clipboardData,
  });

  // Just set some data to the clipboardData object, for example:
  clipboardData.setData("text/plain", target.innerText);
  target.dispatchEvent(copyEvent);
  return clipboardData;
}
