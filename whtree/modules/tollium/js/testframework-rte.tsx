/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import * as domfocus from 'dompack/browserfix/focus';
import * as test from './testframework';
import * as richdebug from '@mod-tollium/web/ui/components/richeditor/internal/richdebug';
import * as domlevel from '@mod-tollium/web/ui/components/richeditor/internal/domlevel';
import * as snapshots from '@mod-tollium/web/ui/components/richeditor/internal/snapshots';
import Range from '@mod-tollium/web/ui/components/richeditor/internal/dom/range';
import RangeIterator2 from '@mod-tollium/web/ui/components/richeditor/internal/dom/rangeiterator';
import * as diff from 'diff';

//capture the next richeditor-action event
export function getNextAction() {
  return test.waitForEvent(test.getWin(), 'wh:richeditor-action', { capture: true, stop: true });
}

export class RTEDriver {
  constructor(rte) {
    if (rte && typeof rte === 'string') {
      const comp = test.compByName(rte);
      if (comp)
        rte = comp.propTodd.rte;
    }

    if (!rte) {
      rte = test.getWin().rte;
      if (!rte)
        throw new Error("Test window has no RTE"); //TODO allow option
    }
    this.rte = rte;
    this.editor = rte.getEditor();
  }

  qS(selector) {
    return this.rte.qS(selector);
  }

  qSA(selector) {
    return this.rte.qSA(selector);
  }

  get body() {
    return this.editor.getBody();
  }

  setSelection(startContainer, startOffset, endContainer, endOffset) {
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

export function getTextChild(node) {
  while (node && node.nodeType !== 3)
    node = node.firstChild;
  return node;
}

export function RunIteratorOnRange2(win, range) {
  const itr = new RangeIterator2(range);
  const list = [];

  while (!itr.atEnd()) {
    const name = itr.node.nodeType === 3 ? '#text: ' + itr.node.nodeValue : itr.node.nodeName.toLowerCase();
    list.push(name);
    itr.nextRecursive();
  }

  return list;
}

//get the current selection for the test window, avoiding Rangy and RTE
export function getCurrentRawSelection() {
  const sel = test.getWin().getSelection();
  return {
    anchor: { node: sel.anchorNode, offset: sel.anchorOffset },
    focus: { node: sel.focusNode, offset: sel.focusOffset },
    isCollapsed: sel.isCollapsed,
    type: sel.type
  };

}

export function getRTESelection(win, rte) {
  return rte.getSelectionRange().toDOMRange();
}

export function setRTESelection(win, rte, domrange) {
  if (!domrange.endContainer) {
    domrange.endContainer = domrange.startContainer;
    if (!domrange.endOffset)
      domrange.endOffset = domrange.startOffset;
  }
  rte.selectRange(Range.fromDOMRange(domrange));
}

export function getCompStyle(node, prop) {
  return getComputedStyle(node).getPropertyValue(prop);
}

export function testEqHTMLEx(unused, expect, node, locators) {
  const actual = richdebug.cloneNodeWithTextQuotesAndMarkedLocators(node, locators || []).innerHTML;
  test.eqHTML(expect, actual);
}

export function testEqSelHTMLEx(unused, expect) {
  const rte = test.getWin().rte.getEditor();
  const range = rte.getSelectionRange();
  testEqHTMLEx(undefined, expect, rte.getBody(), [range.start, range.end]);
}

export function setRawStructuredContent(win, structuredhtml) {
  setStructuredContent(win, structuredhtml, true);
}

export function setStructuredContent(rte, structuredhtml, options) {
  options = { raw: false, verify: true, ...(typeof options === "boolean" ? { raw: options } : options || {}) };

  if (!rte) {
    rte = test.getWin().rte;
    if (!rte)
      throw new Error(`test.getWin() has no rte`);
  } else if (rte && !rte.bodydiv) //doesn't look like a RTE...
  {
    rte = rte.rte;
    if (!rte)
      throw new Error(`Window passed as first argument has no rte`);
  }

  if (!rte.setContentsHTML && rte.editrte)
    rte = rte.editrte; //needed until the RTE is 'flattened', ie no editmodes

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

export function getRawHTMLTextArea(win) {
  const ta = test.compByName('code').querySelector('textarea');
  return ta;
}

export function getRawHTMLCode(win) {
  let code = getRawHTMLTextArea(win).value;
  code = code.split('\n').join('').split('</html>')[0]; //strip comments behind the </html>
  return code;
}

export function getRTE(win, toddname) {
  const comp = test.compByName(toddname);
  if (!comp)
    throw new Error("No such component with name '" + toddname + "'");
  return comp.propTodd.rte;
}

export function getPreActionState(rte) {
  const snapshot = snapshots.generateSnapshot(rte.getBody(), rte.getSelectionRange());
  return { __snapshot: snapshot, __undopos: rte.undopos };
}

function getStack(message) {
  try { throw new Error(message); } catch (e) { return e.stack; }
}

export async function testUndoRedo(rte, preactionstate, { stack } = {}) {
  // console.log(`testUndoRedo prestate`, "\n" + snapshots.dumpSnapShot(preactionstate.__snapshot), preactionstate.__snapshot);
  stack = stack || getStack(`trace`);

  if (!rte.options.allowundo)
    throw new Error(`Undo is not enabled in the RTE\n` + stack);

  if (rte.undopos === preactionstate.__undopos)
    throw new Error(`Expected an action that recorded an undo event\n` + stack);

  const last = rte.undostack.length && rte.undostack[rte.undostack.length - 1];
  if (!last.finished)
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

export async function runWithUndo(rte, func, options = {}) {
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
  constructor(props) {
    this.files = props.files;
    this.items = props.items;
    this.types = props.types;
    this._typesdata = props.typesdata;
  }

  getData(type) {
    return this._typesdata[type];
  }
}

export async function paste(rte, props) {
  const target = domfocus.getCurrentlyFocusedElement();

  /* event spec: https://w3c.github.io/clipboard-apis/#clipboard-event-interfaces
     only firefox is said to implement clipboard currently so we'll create a plain event */
  const evt = target.ownerDocument.createEvent('Event');

  const types = Object.keys(props.typesdata);
  types.contains = key => types.includes(key);

  props = { types, ...props };
  const cpdata = new ClipBoardEmul(props);

  evt.initEvent('paste', true, true);
  Object.defineProperty(evt, 'clipboardData', { get: () => cpdata });

  const dodefault = target.dispatchEvent(evt);
  return dodefault;
}
