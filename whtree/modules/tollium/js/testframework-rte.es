import * as dompack from 'dompack';
import * as domfocus from 'dompack/browserfix/focus';
import * as test from './testframework.es';
import * as richdebug from '@mod-tollium/web/ui/components/richeditor/internal/richdebug';
import * as domlevel from '@mod-tollium/web/ui/components/richeditor/internal/domlevel';
import * as snapshots from '@mod-tollium/web/ui/components/richeditor/internal/snapshots';
import Range from '@mod-tollium/web/ui/components/richeditor/internal/dom/range';
import RangeIterator2 from '@mod-tollium/web/ui/components/richeditor/internal/dom/rangeiterator';
import * as diff from 'diff';

//capture the next richeditor-action event
export function getNextAction()
{
  return test.waitForEvent(test.getWin(), 'wh:richeditor-action', { capture:true, stop: true});
}

export class RTEDriver
{
  constructor(rte)
  {
    if(rte && typeof rte == 'string')
    {
      let comp = test.compByName(rte);
      if(comp)
        rte = comp.propTodd.rte;
    }

    if(!rte)
    {
      rte = test.getWin().rte;
      if(!rte)
        throw new Error("Test window has no RTE"); //TODO allow option
    }
    this.rte = rte;
    this.editor = rte.getEditor();
  }

  qS(selector)
  {
    return this.rte.qS(selector);
  }

  qSA(selector)
  {
    return this.rte.qSA(selector);
  }

  get body()
  {
    return this.editor.getContentBodyNode();
  }

  setSelection(startContainer, startOffset, endContainer, endOffset)
  {
    if(!startOffset)
      startOffset = 0;

    if(!endContainer)
    {
      endContainer = startContainer;
      endOffset = startOffset;
    }
    setRTESelection(test.getWin(), this.editor, { startContainer, startOffset, endContainer, endOffset });
  }

  //execute a property action and get the result
  async executeProperties()
  {
    let propsbutton = test.qS("[data-button=action-properties]");
    if(!propsbutton)
      throw new Error("No properties button present!");

    if(propsbutton.classList.contains("disabled"))
      throw new Error("Properties button is disabled!");

    let result = getNextAction();
    test.click(propsbutton);
    return await result;
    //FIXME throw if properties button is not enabled

  }
}

export function getTextChild(node)
{
  while(node&&node.nodeType != 3)
    node=node.firstChild;
  return node;
}

export function RunIteratorOnRange2(win,range)
{
  var itr = new RangeIterator2(range);
  var list = [];

  while (!itr.atEnd())
  {
    var name = itr.node.nodeType == 3 ? '#text: ' + itr.node.nodeValue : itr.node.nodeName.toLowerCase();
    list.push(name);
    itr.nextRecursive();
  }

  return list;
}

//get the current selection for the test window, avoiding Rangy and RTE
export function getCurrentRawSelection()
{
  let sel = test.getWin().getSelection();
  return { anchor: { node: sel.anchorNode, offset: sel.anchorOffset }
         , focus: { node: sel.focusNode, offset: sel.focusOffset }
         , isCollapsed: sel.isCollapsed
         , type: sel.type
         };

}

export function getRTESelection(win, rte)
{
  return rte.getSelectionRange().toDOMRange();
}

export function setRTESelection(win, rte, domrange)
{
  if(!domrange.endContainer)
  {
    domrange.endContainer = domrange.startContainer;
    if(!domrange.endOffset)
      domrange.endOffset = domrange.startOffset;
  }
  rte.selectRange(Range.fromDOMRange(domrange));
}

export function getCompStyle(node, prop)
{
  return getComputedStyle(node).getPropertyValue(prop);
}

export function testEqHTMLEx(unused, expect, node, locators)
{
  var actual = richdebug.cloneNodeWithTextQuotesAndMarkedLocators(node, locators || []).innerHTML;
  test.eqHTML(expect, actual);
}

export function testEqSelHTMLEx(win, expect)
{
  testEqSelHTMLEx2(null, test.getWin().rte.getEditor(), expect);
}

export function testEqSelHTMLEx2(unused, rte, expect)
{
  var range = rte.getSelectionRange();
  testEqHTMLEx(unused, expect, rte.getContentBodyNode(), [ range.start, range.end ]);
}

export function getHTML(node)
{
  let rte = rteGetForNode(node);
  if(!rte)
    throw new Error("Cannot find RTE for the node");

  let range = rte.getEditor().getSelectionRange();
  let result = richdebug.cloneNodeWithTextQuotesAndMarkedLocators(node, [ range.start, range.end ]);
  return result.nodeType == 3 ? result.textContent : result.outerHTML;
}

export function setRawStructuredContent(win, structuredhtml)
{
  setStructuredContent(win, structuredhtml, true);
}

// copied from richeditor/index.es, so we won't have to import the whole editor
function rteGetForNode(node)
{
  for(;node;node=node.parentNode)
    if(node.whRTD)
      return node.whRTD;
  return null;
}

export function setStructuredContent(win, structuredhtml, options)
{
  options = Object.assign({ raw: false, verify: true }, typeof options == "boolean" ? { raw: options } : options || {});
  let rte=null;
  if(win && win.rte)
  {
    rte=win.rte.getEditor();
  }
  else
  {
    let node = win.closest('.wh-rtd__editor');
    if(!node)
      throw new Error("Cannot find .wh-rtd__editor");
    rte = rteGetForNode(node).getEditor();
  }

  if (options.raw)
    rte.setContentsHTMLRaw(structuredhtml);
  else
    rte.setContentsHTML(structuredhtml);

  var locators = richdebug.unstructureDom(win, rte.getContentBodyNode());
  if (options.verify)
    testEqHTMLEx(win, structuredhtml, rte.getContentBodyNode(), locators);

  if (locators[0])
  {
    if (locators[1])
      rte.selectRange(new Range(locators[0], locators[1]));
    else
      rte.setCursorAtLocator(locators[0]);
  }
  else // Must set selection because of our unstructuredom manipulations
    rte.setCursorAtLocator(new domlevel.Locator(rte.getContentBodyNode()));

  return locators;
}

export function getRawHTMLTextArea(win)
{
  var ta = test.compByName('code').querySelector('textarea');
  return ta;
}

export function getRawHTMLCode(win)
{
  var code = getRawHTMLTextArea(win).value;
  code=code.split('\n').join('').split('</html>')[0]; //strip comments behind the </html>
  return code;
}

export function getRTE(win,toddname)
{
  var comp = test.compByName(toddname);
  if (!comp)
    throw new Error("No such component with name '" + toddname + "'");
  return comp.propTodd.rte;
}

export function getPreActionState(rte)
{
  let snapshot = snapshots.generateSnapshot(rte.getContentBodyNode(), rte.getSelectionRange());
  return { __snapshot: snapshot, __undopos: rte.undopos };
}

function getStack(message)
{
  try { throw new Error(message); } catch(e) { return e.stack; }
}

export async function testUndoRedo(rte, preactionstate, { stack } = {})
{
  // console.log(`testUndoRedo prestate`, "\n" + snapshots.dumpSnapShot(preactionstate.__snapshot), preactionstate.__snapshot);
  stack = stack || getStack(`trace`);

  if (!rte.options.allowundo)
    throw new Error(`Undo is not enabled in the RTE\n` + stack);

  if (rte.undopos === preactionstate.__undopos)
    throw new Error(`Expected an action that recorded an undo event\n` + stack);

  let last = rte.undostack.length && rte.undostack[rte.undostack.length - 1];
  if (!last.finished)
    throw new Error(`Last undo item wasn't finished\n` + stack);

  //console.log("wait for undo stack to update");
  await test.sleep(1);

  let currentsnapshot = snapshots.generateSnapshot(rte.getContentBodyNode(), rte.getSelectionRange());
  // console.log(`testUndoRedo current`, "\n" + snapshots.dumpSnapShot(currentsnapshot));

  // console.log('undo supported: ', document.queryCommandSupported("undo"), rte.undonode);
  // rte.undonode.focus();
  // await test.sleep(1);

  test.getDoc().execCommand("undo");
  //console.log("executed undo, waiting for effects");

  await test.sleep(1);

  // console.log(`testUndoRedo after undo`, "\n" + snapshots.dumpSnapShot(currentsnapshot));

  let undosnapshot = snapshots.generateSnapshot(rte.getContentBodyNode(), rte.getSelectionRange());
  if (!snapshots.snapshotsEqual(preactionstate.__snapshot, undosnapshot))
  {
    console.log(`State after undo doesn't match pre-action state.`);
    console.log(`Expected:\n`, snapshots.dumpSnapShot(preactionstate.__snapshot));
    console.log(`Got:\n` + snapshots.dumpSnapShot(undosnapshot));

    let str = "diff:\n";
    let colors = [];
    for (const change of diff.diffChars(snapshots.dumpSnapShot(preactionstate.__snapshot), snapshots.dumpSnapShot(undosnapshot)))
    {
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

  let redosnapshot = snapshots.generateSnapshot(rte.getContentBodyNode(), rte.getSelectionRange());
  if (!snapshots.snapshotsEqual(currentsnapshot, redosnapshot))
  {
    console.log(`State after redo doesn't match original state. Expected:`);
    console.log(snapshots.dumpSnapShot(currentsnapshot), `Got:`);
    console.log(snapshots.dumpSnapShot(redosnapshot));

    let str = "diff: ";
    let colors = [];
    for (const change of diff.diffChars(snapshots.dumpSnapShot(currentsnapshot), snapshots.dumpSnapShot(redosnapshot)))
    {
      str += `%c${change.value}`;
      colors.push(change.added ? "background-color:red; color: white" : change.removed ? "background-color:green; color: white" : "");
    }
    console.log(str, ...colors);

    throw new Error(`Redo failed\n` + stack);
  }
}

export async function runWithUndo(rte, func, options = {})
{
  let prestate = getPreActionState(rte);
  let stack = getStack(`stack`);

  await func();

  if (options.waits)
    await test.wait(options.waits);

  await testUndoRedo(rte, prestate, { stack });
}


class ClipBoardEmul
{
  constructor(props)
  {
    this.files = props.files;
    this.items = props.items;
    this.types = props.types;
    this._typesdata = props.typesdata;
  }

  getData(type)
  {
    return this._typesdata[type];
  }
}

export async function paste(rte, props)
{
  let target = domfocus.getCurrentlyFocusedElement();

  /* event spec: https://w3c.github.io/clipboard-apis/#clipboard-event-interfaces
     only firefox is said to implement clipboard currently so we'll create a plain event */
  let evt = target.ownerDocument.createEvent('Event');

  let types = Object.keys(props.typesdata);
  types.contains = key => types.includes(key);

  props = Object.assign({ types }, props);
  let cpdata = new ClipBoardEmul(props);

  evt.initEvent('paste', true, true);
  Object.defineProperty(evt, 'clipboardData', { get: () => cpdata });

  let dodefault = target.dispatchEvent(evt);
  return dodefault;
}
