/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

require('./editorbase');
import { debugFlags } from "@webhare/env";
import * as rtesupport from "./support";
import * as richdebug from "./richdebug";
import { getFormService } from "@webhare/forms/src/formservice";
import * as dompack from "dompack";
import * as browser from "dompack/extra/browser";
import * as lists from './structured/lists';
import ParsedStructure from "./parsedstructure";
import Range from './dom/range';
import * as tableeditor from "./tableeditor";
import * as domlevel from "./domlevel";
import EditorBase, { type TextFormattingState } from './editorbase';
import PasteCleanup from './pastecleanup';
import type { RTEWidget } from "./types";
import { parseEmbeddedObjectNode } from "./support";
import { copySelectionToClipboard } from "./clipboard";

//debug flags
const debugicc = debugFlags["rte-icc"]; //debug insert container contents. needed to figure out rewriting errors eg on fill

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  The structured editor
//

function explainIntoLines(parsed) {
  const lines = [];
  let curinlineitems = [];
  for (const node of parsed) {
    if (['block', 'table', 'list', 'br'].includes(node.type) || (node.type === "embeddedobject" && node.embedtype !== 'inline')) //a block starts
    {
      if (curinlineitems.length) {
        lines.push({ inline: curinlineitems });
        curinlineitems = [];
      }
      lines.push({ block: node });
    } else {
      curinlineitems.push(node);
    }
  }

  if (curinlineitems.length)
    lines.push({ inline: curinlineitems });

  return lines;
}
function fixIntralineSpaves(items) {
  //Remove any initial space
  while (items.length && items[0].type === 'text' && items[0].value[0] === ' ') {
    items[0].value = items[0].value.substr(1);
    if (!items[0].value) //that was all the data we had?
      items.shift(); //remove first element
  }

  //Remove any final space
  while (items.length && items[items.length - 1].type === 'text' && items[items.length - 1].value.endsWith(' ')) {
    items[items.length - 1].value = items[items.length - 1].value.substr(0, items[items.length - 1].value.length - 1);
    if (!items[items.length - 1].value) //that was all the data we had?
      items.pop(); //remove last element
  }

  //If two consecutive text nodes both have a space on their shared edge, remove it from the second node
  for (let i = 1; i < items.length; ++i) {
    if (items[i].type === 'text' && items[i].value[0] === ' ' && items[i - 1].type === 'text' && items[i - 1].value.endsWith(' '))
      items[i].value = items[i].value.substr(1); //strip the starting space
  }

  //Remove any fully empty textnodes
  items = items.filter(_ => !(_.type === 'text' && !_.value));
  return items;
}

export default class StructuredEditor extends EditorBase {
  structure: ParsedStructure;

  constructor(element, options) {
    options =
    {
      structure: null,
      editembeddedobjects: true,
      ...options,
      allowundo: true
    };

    super(element, options);

    this.properties_selector += ", div.wh-rtd-embeddedobject, span.wh-rtd-embeddedobject, .wh-rtd__tablecell, table.wh-rtd__table caption";
    this.textstyletags = ['a-href', 'i', 'b', 'u', 'strike', 'span', 'sub', 'sup'];

    this.textstylewhitelistedattributes =
    {
      'a-href': ['href', 'target']
    };

    //structure should be parsed/maintained at the RTE level if we're going to provide Pagelevel editing
    this.structure = new ParsedStructure(this.options.structure!); //structure HAS to be set if this class is Constructed
    this.reprocessAfterExternalSet();
    this._constructorTail();
  }

  _onStyleSwitch(event, style) {
    const findcontainertag = ["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "CODE"][style]; //0 = normal, 1to6 = headings, 7/8 = lists, 9 = code
    const selstate = this.getSelectionState();
    const currentstyle = selstate.blockstyle;
    const availablestyles = this.getAvailableBlockStyles(selstate).filter(fstyle => fstyle.def.containertag.toUpperCase() === findcontainertag);
    const currentindex = currentstyle ? availablestyles.findIndex(checkstyle => checkstyle.classname === currentstyle.classname) : -1;
    if (availablestyles.length === 0)
      return;

    dompack.stop(event);
    this.setSelectionBlockStyle(availablestyles[(currentindex + 1) % availablestyles.length].classname); //switch to next style, if already in same category
  }


  reprocessAfterExternalSet() {
    this.refilterContent(true);
    super.reprocessAfterExternalSet();
  }

  getAvailableBlockStyles(selstate?: TextFormattingState) {
    const stylelist = selstate?.tablestyle?.allowstyles.length ? selstate.tablestyle?.allowstyles : this.structure.blockstyles;
    return stylelist.filter(style => !style.istable);
  }
  getAvailableCellStyles(selstate) {
    return this.structure.cellstyles;
  }

  // ---------------------------------------------------------------------------
  //
  // Callback handlers
  //

  async _gotCopy(event) {
    dompack.stop(event);
    await copySelectionToClipboard(this);
  }

  async _gotCut(event) {
    dompack.stop(event);
    const undolock = this.getUndoLock();
    await copySelectionToClipboard(this);
    this.removeSelection();
    this.checkDomStructure();
    undolock.close();
  }

  gotPaste(event) {
    /* Paste event:
       - if we have event.clipboardData & it supports getting type text/html we use that
         (webkit)
       - else we clear the iframe (saving the contents), let the paste flow into the iframe,
         then put the old content back and insert the pasted data (ie, firefox, opera)
     */

    const clipboardData = event.clipboardData;

    if (clipboardData && clipboardData.getData) {
      const types = Array.from(clipboardData.types); //Edge compatibility - it's a DOMStringList there

      if (dompack.debugflags.rte) {
        console.log('[rte] paste', clipboardData, "types", types);
        if (clipboardData.files)
          console.log('[rte] Files', clipboardData.files, "length", clipboardData.files && clipboardData.files.length);
        if (clipboardData.items)
          console.log('[rte] Items', clipboardData.items, "length", clipboardData.items && clipboardData.items.length);

        for (let i = 0; i < types.length; ++i) {
          const type = types[i];
          const data = clipboardData.getData(type);
          console.log("[rte] type ", type, "data(" + (typeof data) + "):", "<", data, ">");
        }
      }

      if (types.includes('text/html')) {
        const htmltext = clipboardData.getData('text/html');
        if (dompack.debugflags.rte) {
          console.log("[rte] Received clipboardData text/html:");
          console.log("[rte] [" + htmltext + "]");
          console.log("[rte] end of clipboardData");
        }
        event.preventDefault();

        const pastecontent = document.createElement('div');
        pastecontent.innerHTML = htmltext;

        this._pasteContent(pastecontent);
        return;
      } else if (types.includes("Files")) {
        for (let idx = 0; idx < clipboardData.items.length; ++idx) {
          const item = clipboardData.items[idx];

          // Only seen png pastes for now
          if (["image/png"].includes(item.type)) {
            if (dompack.debugflags.rte)
              console.log("[rte] Got image file of type " + item.type);

            const pastecontent = document.createElement('div');
            const repl = this._createImageDownloadNode();
            pastecontent.appendChild(repl);

            const promise = this.uploadImageToServer(item.getAsFile(), repl);
            if (promise) // Upload didn't fail early?
            {
              promise.then(function () {
                this._pasteContent(pastecontent);
              }.bind(this));

              event.preventDefault();
              return;
            }
          }
        }
      } else if (browser.getName() === "safari" && types.includes("image/tiff") && types.includes("text/uri-list")) {
        // Safari doesn't handle pastes of images well, it does pastes a 'webkit-fake-url://..../<urlpath>' url.
        // We can try to get the URL ourselves

        if (dompack.debugflags.rte)
          console.log("[rte] Got a safari image paste");

        const url = clipboardData.getData('text/uri-list');

        const pastecontent = document.createElement('div');
        pastecontent.appendChild(dompack.create("img", { src: url }));
        this._pasteContent(pastecontent);

        event.preventDefault();
        return;
      } else if (types.includes('text/plain')) {
        const text = clipboardData.getData('text/plain');
        if (dompack.debugflags.rte) {
          console.log("[rte] Received clipboardData text/plain:");
          console.log("[rte] [" + text + "]");
          console.log("[rte] end of clipboardData");
        }

        event.preventDefault();

        const pastecontent = document.createElement('div');

        // Convert \n to <br>, keep rest as normal html (will be converted to paragraphs in parsing code)
        const lines = text.split('\n');
        lines.forEach((line) => {
          pastecontent.appendChild(document.createTextNode(line));

          // Always add br (br at end of DIV will be ignored)
          pastecontent.appendChild(document.createElement('br'));
        });

        if (dompack.debugflags.rte) {
          console.log("[rte] html to insert");
          console.log(pastecontent.innerHTML);
        }

        this._pasteContent(pastecontent);
        return;
      }
    }

    event.preventDefault(); //block it, we don't know what's coming in and we'd rather get user error reports
    throw new Error(`Paste detected, but no usable clipboardData (${JSON.stringify(Array.from(clipboardData?.types ?? ["no clipboardData"]))})`);
  }

  async _pasteContent(pastecontent: HTMLDivElement) {
    const undolock = this.getUndoLock();

    //console.log('pasteContent preremove', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }));

    const locator = this.removeSelection();

    //console.log('pasteContent postremove', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }));

    await this._pasteContentAt(pastecontent, locator);

    undolock.close();
  }

  //validate all our embedded objects on the server, make sure none are broken (eg by bad pastes)
  async _validateEmbeddedObjects() {
    //FIXME also handle duplicates? but not sure yet how to reproduce/test those
    let embobjs = domlevel.queryEmbeddedObjects(this.getBody());
    if (embobjs.length === 0)
      return;

    // Remove all nested embedded objects (keep those that aren't a child of the previously kept object)
    embobjs = embobjs.reduce((acc, value) => {
      if (!acc.length || !acc[acc.length - 1].contains(value))
        acc.push(value);
      return acc;
    }, []);

    const lock = dompack.flagUIBusy();
    try {
      const ids = embobjs.map(node => node.dataset.instanceref || "");
      const res = await getFormService().validateEmbeddedObjects(ids);
      if (res.tokill.length) //there are broken embedded objects!
      {
        console.warn(`removing embedded objects`, res.tokill);
        embobjs.filter(node => !node.dataset.instanceref || res.tokill.includes(node.dataset.instanceref)).forEach(el => el.remove());
      }
    } catch (e) {
      console.log(`Error validating embedded objects`, e);
    }
    lock.release();
  }

  _gotSelectionChange(event) {
    if (this.selectingrange) // Currently within our own selection calls, ignore
      return;

    // This event will be triggered by backspace key, delete key, ctrl-x & delete command in IE 9+. Docs say so.
    // We'll use it to change the selection when it totally includes the first paragraph
    //console.log('onselectionchange');
    const rawselection = this.getSelectionRange();
    rawselection.limitToNode(this.getBody());

    const up = new domlevel.Locator(this.getBody());
    const upres = up.scanForward(this.getBody(), { whitespace: true, blocks: true });

    // We're before the first content block?
    if ((upres.type !== 'outerblock' || upres.data !== this.getBody()) && rawselection.start.compare(up) < 0) {
      //console.log('need to fix selection');
      rawselection.start.assign(up);
      if (up.compare(rawselection.end) > 0)
        rawselection.end.assign(up);

      this.selectRange(rawselection);
    } else //we're leaving the selection alone, we just need to inform ourselves of it (selectRange would otherwise invoke selectionHasChanged)
    {
      //TODO our base version probably needs to invoke this one as well, but if we just put it there it'll double-execute if the above selectRange runs
      this.selectionHasChanged(rawselection);
    }

    super._gotSelectionChange(event);
  }

  //apply wh-rtd-embeddedobject--selected in all the right places
  selectionHasChanged(selection) {
    //select all wh-rtd-embeddedobject unless they're in another wh-rtd-embeddedobject
    const embeddedobjects_to_select = Array.from(selection.querySelectorAll(".wh-rtd-embeddedobject")).filter(_ => !_.parentNode.closest(".wh-rtd-embeddedobject"));
    const currently_selected = Array.from(this.getBody().querySelectorAll(".wh-rtd-embeddedobject--selected"));
    embeddedobjects_to_select.forEach(node => node.classList.add("wh-rtd-embeddedobject--selected"));
    currently_selected.filter(node => !embeddedobjects_to_select.includes(node)).forEach(node => node.classList.remove("wh-rtd-embeddedobject--selected"));
  }

  // Create an paragraph above/below the sibling and send the cursor there
  insertEmptyParagraph(sibling, below) {
    const undolock = this.getUndoLock();

    const loc = below ? domlevel.Locator.newPointingAfter(sibling) : domlevel.Locator.newPointingTo(sibling);
    const res = this.insertBlockNode(loc, this.structure.defaultblockstyle, false, null, null, null);
    this.requireVisibleContentInBlockAfterLocator(new domlevel.Locator(res.node), null, null);
    this.selectRange(Range.fromLocator(res.contentlocator));

    undolock.close();
  }

  _gotMouseClick(event) {
    if (!event.target || !this.isEditable())
      return;

    let button;
    if (event.target.getAttribute("data-rte-subaction"))
      button = event.target;
    else
      button = event.target.closest("*[data-rte-subaction]");

    if (button) {
      event.preventDefault();
      event.stopPropagation();

      //find the focus of the button
      const buttonfocus = button.closest('.wh-rtd-embeddedobject');
      if (buttonfocus) {
        const subaction = button.getAttribute("data-rte-subaction");
        switch (subaction) {
          case "navabove":
            {
              this.insertEmptyParagraph(buttonfocus, false);
            } break;
          case "navunder":
            {
              this.insertEmptyParagraph(buttonfocus, true);
            } break;
          default:
            {
              this.launchActionPropertiesForNode(buttonfocus, button.getAttribute("data-rte-subaction"));
            } break;
        }
      }
      return;
    }
    super._gotMouseClick(event);
  }

  _gotDoubleClick(event) {
    if (!event.target || !this.isEditable())
      return;

    if (event.target) {
      // Find outer embedded object
      let embobj = event.target.closest('.wh-rtd-embeddedobject');
      if (embobj) {
        for (; ;) {
          const parentembobj = embobj.parentNode.closest('.wh-rtd-embeddedobject');
          if (!parentembobj)
            break;
          embobj = parentembobj;
        }

        event.preventDefault();
        event.stopPropagation();
        this.launchActionPropertiesForNode(embobj, 'edit');
        return;
      }
    }
    super._gotDoubleClick(event);
  }

  executeDefaultPropertiesAction(event) {
    if (event.target.nodeName.toLowerCase() === 'div' && event.detail.subaction === "delete") {
      this.removeEmbeddedObject(event.target);
      return;
    }
    super.executeDefaultPropertiesAction(event);
  }

  // ---------------------------------------------------------------------------
  //
  // Helper stuff
  //

  /** Returns whether 2 nodes can be combined together without unintented consequenses (list concatenation
      of adjacent nodes is an intented consequense)
      @param node -
      @param toright -
  */
  canCombineNodes(denylist, left, right) {
    let res;
    if (left.nodeName.toLowerCase() !== right.nodeName.toLowerCase())
      res = false;
    else {
      if (denylist.includes(left) || denylist.includes(right))
        res = false;
      else if (['ol', 'ul'].includes(left.nodeName.toLowerCase()) && left.className === right.className)
        res = true; // ol and ul: need classname match
      else if (!this.textstyletags.includes(left.nodeName.toLowerCase()))
        res = false;
      else
        res = this.isNodeTextStyleMatch(left, this.getTextStyleRecordFromNode(right));
    }
    return res;
  }

  /** Combines <b>s, <ol>s and the likes together while possible
      @param ancestor -
      @param locator -
      @param keeplocators - Locators to keep at valid locations
      @returns locator, adjusted
  */
  combineAtLocator(ancestor, locator, towardsend, denylist, preservelocators, undoitem) {
    domlevel.combineWithPreviousNodesAtLocator(locator, ancestor, towardsend, this.canCombineNodes.bind(this, denylist || []), preservelocators || [], undoitem);
    return locator;
  }

  /// Removes a range, does not try to stitch everything together
  removeRange(from, to, ancestor) {
    if (from.element === to.element && from.offset === to.offset)
      return from.clone();

    ancestor = ancestor || domlevel.Locator.findCommonAncestorElement(from, to);

    const splitlocators = [{ locator: from, toward: 'start' }, { locator: to, toward: 'end' }];
    // console.log('rs presplit: ', richdebug.getStructuredOuterHTML(ancestor, splitlocators));
    const parts = domlevel.splitDom(ancestor, splitlocators);
    // console.log('rs postsplit: ', richdebug.getStructuredOuterHTML(ancestor, parts));

    const removestart = parts[1].start;
    const removeend = parts[1].end;

    removestart.ascend(ancestor, true);
    removeend.ascend(ancestor, false);

    // console.log('rs removerange: ', richdebug.getStructuredOuterHTML(ancestor, { removestart: removestart, removeend: removeend }));

    for (let i = removeend.offset; i > removestart.offset; --i)
      ancestor.removeChild(removestart.getPointedNode());

    // console.log('rs removerange after remove: ', richdebug.getStructuredOuterHTML(ancestor, { locator: removestart }));

    return removestart;
  }

  /// Removes the current selection, returns locator at insert point
  removeSelection() {
    const range = this.getSelectionRange();
    return this.removeRange(range.start, range.end);
  }

  /** Inserts a node into the DOM, auto-splitting textnodes if inserting within them
      @param locator - Place to insert the node
      @param node - Node to insert
      @returns
      \@cell return.locator Locator pointing to new inserted node
      \@cell return.next Locator point to node after the newly inserted node
  */
  insertNodeAutoSplit(locator, node, preservelocators, undoitem) {
    // Within the middle of a text node?
    if (!locator.parentIsElementOrFragmentNode() && !locator.moveToParent())
      locator = domlevel.splitDataNode(locator, preservelocators, 'end', undoitem);

    const next = locator.insertNode(node, preservelocators, undoitem);

    return (
      {
        locator: locator,
        next: next
      });
  }

  /** See if the locator points to the last segmentbreak of a block. If so, returns the range of the
      br (always a simple range)
  */
  pointsToLastBlockBR(locator) {
    //var block = this.getBlockAtNode(locator.getNearestNode());

    locator = locator.clone();
    const res = locator.scanForward(this.getBody(), {});
    if (res.type !== 'br')
      return null;
    //    if ((!res.segmentbreak && !res.zerowidthspace) || res.blockboundary) // Segment break that is not a block boundary is a <br> or (not implemented) a visible '\n'
    //      return null;

    const x = domlevel.getInvisibleSegmentBreakRange(locator, this.getBody());
    return x;
  }

  /** Inserts a block node into a specific position, modifies DOM to maintain correct structure. Breaks out
      of existing blocks when inserting new (non-list) blocks
      @param locator -
      @param blockstyle -
      @returns
      \@cell return.node
      \@cell return.contentlocator
  */
  insertBlockNode(locator, blockstyle, insertli, preservelocators, undoitem, anchor) {
    //    console.log('insertBlockNode: ', blockstyle, insertli, richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }));
    //    console.log(locator);

    // Get info about the current block & block root
    const block = this.getBlockAtNode(locator.element);

    // Only search for last br when we're actually in a block
    let segmentbreakrange = null;
    if (block.blockroot !== block.node)
      segmentbreakrange = this.pointsToLastBlockBR(locator);

    //console.log('insertBlockNode albr: ', blockstyle, insertli, richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator, segmentbreakrange: segmentbreakrange }));
    //console.log(lastbr);

    if (block.blockstyle && block.blockstyle.islist && blockstyle.islist) {
      /* Special case: insert list into list

         Possible situations: (a&b are existing content)
         1: * (*here) (<br>)?
         2: * (*here)a
         3: * a(*here)b
         4: * a(*here) (<br>)?

         Wanted outcomes:
         1: * * new list
         2: * * new list
            * a
         3: * a
              * new list
            * b
         4: * a
              * new list

         Done by insert a new textnode ('#'), then splitting the dom after that new textnode. The textnode
         guarantees that the current LI is kept (in scenario 1 & 2). It is removed after the split, at its
         location the new list is inserted. If the locator points to the last block <br>, use that as temporary
         node instead.
      */

      // If the locator points to the last br of the node. That node needs to be removed!
      if (segmentbreakrange) {
        //        tempnode = lastbr.node;
        //        locator = lastbr.next;

        //console.log('listinsert, last br: ', richdebug.getStructuredOuterHTML(block.blockroot, { node: block.node, locator: locator }));
      } else // Need a temporary node to keep block alive through splitdom
      {
        // Create img node, doesn't merge with stuff
        const tempnode = document.createElement("img");
        this.insertNodeAutoSplit(locator, tempnode, preservelocators, undoitem); // Auto-splits textnodes
        segmentbreakrange = Range.fromNodeOuter(tempnode);
        //console.log('listinsert, tempnode: ', richdebug.getStructuredOuterHTML(block.blockroot, { node: block.node, locator: locator }));
      }

      //console.log(block, locator);
      //console.log('listinsert: ', richdebug.getStructuredOuterHTML(block.blockroot, { node: block.node, locator: locator }));

      // Split the LI (makes sure content after the insert-position is put into a new LI
      domlevel.splitDom(block.node, [{ locator: segmentbreakrange.end, toward: 'end', preservetoward: 'start' }], preservelocators, undoitem);

      // Set locator to point to tempnode, then remove it
      locator = segmentbreakrange.start;
      domlevel.removeSimpleRange(segmentbreakrange, [locator, ...(preservelocators || [])], undoitem);

      // Proceed to shared blocknode insert
    } else {
      /* Scenarios

         1: insert non-list into list : forbidden!
         2: insert non-list into non-list
         3: insert list into non-list
         4: insert (non-)list between blocks

         2&3:
         - split dom from blockroot to locator
         - insert new blocknode at splitpoint
         4: make sure search lastbr doesn't go past blocks

         For lists, if at the splitpoint there exists a list of the same type,
         we can re-use that list (if it has the same type)
      */

      // Move past last br
      if (segmentbreakrange)
        locator = segmentbreakrange.end;

      if (block.blockstyle && block.blockstyle.islist) {
        // Cannot insert non-list into list, just use the list blockstyle
        blockstyle = block.blockstyle;
      }

      //console.log('insertblock presplit', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator, block: block }, true));
      const parts = domlevel.splitDom(block.blockroot, [{ locator: locator, toward: 'end' }], preservelocators, undoitem);

      // Get the locator at the insertpoint
      locator = parts[1].start.clone();
      locator.ascend(block.blockroot);
    }

    //console.log('going insert node: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }));

    // Insert the new blocknode at the locator
    const bres = this.createBlockStyleElement(blockstyle, true, anchor);
    if (anchor)
      bres.insertnode.setAttribute('data-rtd-anchor', anchor);

    locator.insertNode(bres.node, preservelocators, undoitem);

    //console.log('post insert node: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }));

    const contentlocator = new domlevel.Locator(bres.node, 0);
    if (blockstyle.islist) {
      // Stitch lists on both sides
      this.combineAtLocator(block.blockroot, contentlocator, false, [], preservelocators, undoitem);
      this.combineAtLocator(block.blockroot, contentlocator, true, [], preservelocators, undoitem);
    }

    const blocknode = contentlocator.element;
    let contentnode = blocknode;

    if (blockstyle.islist && insertli) {
      contentnode = document.createElement('li');
      contentlocator.insertNode(contentnode, preservelocators, undoitem);
      contentlocator.descendToLeafNode(this.getBody());
    }

    const afternodelocator = new domlevel.Locator(blocknode, "end");
    afternodelocator.moveToParent(true);

    // console.log('post normal insert: ', richdebug.getStructuredOuterHTML(this.getBody(), { node: bres.node, contentlocator: contentlocator }));

    return (
      {
        node: blocknode,
        afternodelocator: afternodelocator,
        contentlocator: contentlocator,
        contentnode: contentnode
      });
  }

  _insertEmbeddedObjectNode(locator, embobjnode, preservelocators, undoitem) {
    // Get info about the current block & block root
    if (embobjnode.nodeName === 'SPAN') {
      const res = this.insertNodeAutoSplit(locator, embobjnode, preservelocators, undoitem);
      const afternodelocator = res.next;
      // don't want the afternode locator to be corrected to after a newly inserted br
      this.requireVisibleContentInBlockAfterLocator(afternodelocator, [locator, ...(preservelocators || [])], undoitem);
      return {
        node: embobjnode,
        afternodelocator
      };

    } else //FIXME can't we just invoke insertBlockNode ? basically the same code!
    {
      const block = this.getBlockAtNode(locator.element);

      // Only search for last br when we're actually in a block
      let segmentbreakrange = null;
      if (block.blockroot !== block.node)
        segmentbreakrange = this.pointsToLastBlockBR(locator);

      // Move past last br
      if (segmentbreakrange)
        locator = segmentbreakrange.end;

      const parts = domlevel.splitDom(block.blockroot, [{ locator: locator, toward: 'end' }], preservelocators, undoitem);

      // Get the locator at the insertpoint
      locator = parts[1].start.clone();
      locator.ascend(block.blockroot);

      // Insert the new blocknode at the locator
      locator.insertNode(embobjnode, preservelocators, undoitem);

      const contentlocator = new domlevel.Locator(embobjnode, 0);
      const blocknode = contentlocator.element;
      const contentnode = blocknode;

      const afternodelocator = new domlevel.Locator(blocknode, "end");
      afternodelocator.moveToParent(true);

      // console.log('post normal insert: ', richdebug.getStructuredOuterHTML(this.getBody(), { node: bres.node, contentlocator: contentlocator }));

      return (
        {
          node: blocknode,
          afternodelocator: afternodelocator,
          contentlocator: contentlocator,
          contentnode: contentnode
        });
    }
  }

  // insert a new table with the given dimensions
  insertTable(cols, rows) {
    const undolock = this.getUndoLock();

    // Find the first table block style and default table cell block style
    const tablestyle = this.structure.blockstyles.filter(style => style.istable)[0];
    if (!tablestyle)
      throw new Error("no table block style available");

    const cellstyle = tablestyle.tabledefaultblockstyle || this.structure.defaultblockstyle;

    // Create a table block
    const block = { type: 'table', style: tablestyle, nodes: [], colwidths: [], firstdatacell: { row: 0, col: 0 } };

    // Create a rowitem for each row
    for (let i = 0; i < rows; ++i) {
      const rowitem = { type: 'rowitem', nodes: [], height: null };
      block.nodes.push(rowitem);

      // Create a cellitem for each cell in the row
      for (let j = 0; j < cols; ++j) {
        // The cellitem contains a content block containing a br
        const cellitem = {
          type: 'cellitem',
          defaultstyle: cellstyle,
          nodes: [{ type: 'block', style: cellstyle, nodes: [{ type: 'br' }], temporary: true, surrogate: true }],
          colspan: 1,
          rowspan: 1
        };
        rowitem.nodes.push(cellitem);
      }
    }

    // Set default column width. FIXME don't assume 1px border width
    const colwidth = Math.floor((parseInt(window.getComputedStyle(this.getBody()).width) - cols) / cols);
    for (let i = 0; i < cols; ++i)
      block.colwidths.push(colwidth);

    // Insert the table at the current location, replacing the current selection
    const locator = this.removeSelection();
    this._insertParsed(locator, [block]);

    undolock.close();
  }

  _insertTableNode(locator, tablenode, preservelocators, undoitem) {
    //This is based on _insertEmbeddedObjectNode. perhaps stuff can be merged ?

    // Get info about the current block & block root
    const block = this.getBlockAtNode(locator.element);

    // Only search for last br when we're actually in a block
    let segmentbreakrange = null;
    if (block.blockroot !== block.node)
      segmentbreakrange = this.pointsToLastBlockBR(locator);

    // Move past last br
    if (segmentbreakrange)
      locator = segmentbreakrange.end;

    const parts = domlevel.splitDom(block.blockroot, [{ locator: locator, toward: 'end' }], preservelocators, undoitem);

    // Get the locator at the insertpoint
    locator = parts[1].start.clone();
    locator.ascend(block.blockroot);

    // Insert the new blocknode at the locator
    locator.insertNode(tablenode, preservelocators, undoitem);

    // Insert the table cell contents
    tableeditor.getCells(tablenode).forEach(td => {
      const cellitem = td.propWhRtdCellitem; //FIXME don't rely on this, as cells created through add-row-after don't have a cellitem either
      if (!cellitem)
        return;

      const celllocator = new domlevel.Locator(td, 0);
      this._insertParsed(celllocator, cellitem.nodes, false, false, true, preservelocators, undoitem);
    });

    //ADDME: Don't know how this should work for tables
    const contentlocator = new domlevel.Locator(tablenode, 0);
    const blocknode = contentlocator.element;
    const contentnode = blocknode;

    const afternodelocator = new domlevel.Locator(blocknode, "end");
    afternodelocator.moveToParent(true);

    // console.log('post normal insert: ', richdebug.getStructuredOuterHTML(this.getBody(), { node: bres.node, contentlocator: contentlocator }));

    return (
      {
        node: blocknode,
        afternodelocator: afternodelocator,
        contentlocator: contentlocator,
        contentnode: contentnode
      });
  }

  _initNewTableCell(cellnode) {
    cellnode.classList.add("wh-rtd__tablecell");
    const tablenode = cellnode.closest("table");

    // Get default cell style
    const style = this.structure.getBlockStyleByTag(tablenode.className.split(' ')[0]);
    const cellstyle = style && style.istable && style.tabledefaultblockstyle || this.structure.defaultblockstyle;

    // Insert new nodes
    const nodes = [{ type: 'block', style: cellstyle, nodes: [{ type: 'br' }], temporary: true, surrogate: true }];
    const locator = new domlevel.Locator(cellnode, 0);
    this._insertParsed(locator, nodes);
  }

  /// Pastes the content of a node at a specific locator
  async _pasteContentAt(pastecontent: HTMLDivElement, insertlocator: domlevel.Locator) {
    const undolock = this.getUndoLock();

    if (dompack.debugflags.rte)
      console.log('[rte] parseContentAt, raw', pastecontent.innerHTML);

    // If we're at the start of a block, don't pass inblock so the first pasted block will replace the current block
    const down = insertlocator.clone();
    const downres = down.scanBackward(this.getBody(), { whitespace: true });
    const atblockstart = ['innerblock', 'outerblock'].includes(downres.type);

    if (dompack.debugflags.rte)
      console.log('[rte] paste at block start: ', atblockstart ? 'yes' : 'no', downres, richdebug.getStructuredOuterHTML(this.getBody(), { down: down, insertlocator: insertlocator }));

    const cleanupper = new PasteCleanup;
    const res = cleanupper.applyCleanup(pastecontent);

    if (dompack.debugflags.rte)
      console.log('[rte] parseContentAt, cleaned', pastecontent.innerHTML);

    const preexistingstylenodes = this.qSA("style");

    //console.log('pasting', pastecontent, pastecontent.innerHTML);
    const locator = this.insertContainerContents(insertlocator, pastecontent, { externalcontent: true, breakafter: res.breakafter });

    // Set cursor after the pasted stuff
    this.setCursorAtLocator(locator);
    this.stateHasChanged();

    this.handlePasteDone(preexistingstylenodes);
    await this._validateEmbeddedObjects();

    if (undolock)
      undolock.close();

    this._reprocessEmbeddedAutoElements();
  }

  compareTextStyleOrder(tagleft, tagright) {
    return this.textstyletags.indexOf(tagleft) - this.textstyletags.indexOf(tagright);
  }

  /** Creates a textstyle-record from a node
      Update: adds whitelisted attributes to the record
  */
  getTextStyleRecordFromNode(curnode) {
    if (curnode.nodeName.toLowerCase() === 'span')
      return null;

    let rec = super.getTextStyleRecordFromNode(curnode);
    if (!rec)
      return null;

    const list = this.textstylewhitelistedattributes[rec.nodeName];
    if (list) {
      // Merge in the attributes from curnode
      rec = { ...rec, ...domlevel.getAttributes(curnode, list) };
    }

    return rec;
  }

  getImageStyleRecordFromNode(curnode) {
    //figure out the alignment. we prefer wh-rtd__img--floatleft/right, but accept legacy classes and float:left/right
    let node = {
      nodeName: "img",
      "class": "wh-rtd__img"
    };
    const align = curnode.align ? curnode.align.toLowerCase() : "";

    if (curnode.classList.contains("wh-rtd__img--uploading")) //don't lose this status during upload
      node["class"] += " wh-rtd__img--uploading";

    if (curnode.classList.contains("wh-rtd__img--floatleft") || curnode.classList.contains("-wh-rtd-floatleft") || curnode.classList.contains("wh-rtd-floatleft") || align === "left")
      node["class"] += " wh-rtd__img--floatleft";
    else if (curnode.classList.contains("wh-rtd__img--floatright") || curnode.classList.contains("-wh-rtd-floatright") || curnode.classList.contains("wh-rtd-floatright") || align === "right")
      node["class"] += " wh-rtd__img--floatright";

    node = { ...node, ...domlevel.getAttributes(curnode, ['width', 'height', 'alt', 'src']) };

    return node;
  }

  isNodeTextStyleMatch(node, textstyle) {
    const nodestyle = this.getTextStyleRecordFromNode(node);
    if (!nodestyle || nodestyle.nodeName !== textstyle.nodeName)
      return false;

    const list = this.textstylewhitelistedattributes[nodestyle.nodeName];
    if (list) {
      for (let i = 0; i < list.length; ++i) {
        const attrname = list[i];
        if (nodestyle[attrname] !== textstyle[attrname])
          return false;
      }
    }

    return true;
  }

  createTextStyleNode(textstyle) {
    const node = textstyle.nodeName === "a-href" ? "a" : textstyle.nodeName;

    const stylenode = document.createElement(node);

    // Remove nodeName from textstyle
    const copy = { ...textstyle };
    delete copy.nodeName;

    domlevel.setAttributes(stylenode, copy);

    return stylenode;
  }

  insertTextStyleNode(locator, textstyle, preservelocators, undoitem) {
    const stylenode = this.createTextStyleNode(textstyle);
    locator.insertNode(stylenode, preservelocators, undoitem);
    return new domlevel.Locator(stylenode);
  }

  insertInlineFormattedNode(locator, node, formatting, preservelocators, undoitem) {
    //console.log('IIFN pre descend: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }));

    // Go to leaf node. FIXME: detect and do not descend into img/other stuff
    // console.log('IIFN pre descend: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }));
    locator.descendToLeafNode(this.getBody());

    //console.log('IIFN post descend: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }));

    //console.log('IIFN post ascend: ', richdebug.getStructuredOuterHTML(this.getBody(), { plocator: plocator, cn: block.contentnode }));

    // Get path from the block level to the locator
    const block = this.getBlockAtNode(locator.getNearestNode());
    const path = locator.getPathFromAncestor(block.contentnode);

    // FIXME: take allowed styles in current block node into account!

    // Walk through styles in order, only handle those that are mentioned in formatting.textstyles
    let i;
    for (i = 0; i < this.textstyletags.length; ++i) {
      const textstyletag = this.textstyletags[i];
      if (!formatting.hasTextStyle(textstyletag))
        continue;

      // FIXME: support for SPAN with custom formatting

      // See if the current path element has the correct tag
      const curelt = path.length && path[0];
      if (!curelt || !this.isNodeTextStyleMatch(curelt, formatting.getTextStyleByNodeName(textstyletag)))
        break;

      // Yes, see next element in path
      path.splice(0, 1);
    }

    //console.log('IIFN post stylematching: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }));

    if (path.length || !locator.parentIsElementOrFragmentNode()) {
      const breaknode = path.length ? path[0].parentNode : locator.element.parentNode;

      // console.log('IIFN pre ascend html: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator, breaknode: breaknode }));
      locator.ascend(breaknode, true);

      if (locator.element !== breaknode) {
        // Got an element in our path we do not want in the final style
        // Calculate until which element (how deep) we need to split, then do the split
        //        var splitparent = path.length ? path[0] : locator.element;
        //        if (splitparent.nodeType !== 1)
        //          splitparent = splitparent.parentNode;

        // console.log('IIFN pre split html: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }));
        const parts = domlevel.splitDom(breaknode, [{ locator: locator, toward: 'start' }], preservelocators, undoitem);
        // console.log('IIFN post split html: ', richdebug.getStructuredOuterHTML(this.getBody(), parts));

        locator = parts[0].end.clone();
      }
    }

    //console.log('IIFN post split: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }));


    // Create the missing textstyle tags
    for (; i < this.textstyletags.length; ++i) {
      const textstyletag = this.textstyletags[i];
      if (!formatting.hasTextStyle(textstyletag))
        continue;

      const textstyle = formatting.getTextStyleByNodeName(textstyletag);
      locator = this.insertTextStyleNode(locator, textstyle, preservelocators, undoitem);
    }

    // Insert the new element (first make sure the locator's parent element is an element)
    if (!locator.parentIsElementOrFragmentNode())
      locator.ascend(locator.element.parentNode, false);

    locator.insertNode(node, preservelocators, undoitem);
    const next = locator.clone();
    ++next.offset;

    const res =
    {
      node: node,
      inserted: locator,
      after: next
    };
    return res;
  }

  DelayedSurroundSelection(elementinfo) {
    const pos = this.textstyletags.indexOf(elementinfo.element);
    if (pos)
      elementinfo.subtags = this.textstyletags.slice(pos + 1);

    super.DelayedSurroundSelection(elementinfo);
  }

  /** Describes the first ancestor blocknode of a block. If no block is found, the block section node is returned
      in all values.
      @param node - Block node (or child thereof)
      @returns
      \@cell return.blockstyle Determined style of the block node
      \@cell return.node Block top node (p/h1..h6/ol/ul)
      \@cell return.contentnode Block content node (li if node is the li node of a list or inside of it, otherwise equal to the block top node)
      \@cell return.blockparent Parent of the block node
      \@cell return.blockroot Root ancestor of the blocks (body, td, th or content body)
  */
  getBlockAtNode(node) {
    const res = super.getBlockAtNode(node);
    if (res.blockparent !== res.node)
      res.blockstyle = this.structure.getBlockStyleByTag(res.node.className.split(' ')[0]);
    else
      res.blockstyle = null;

    return res;
  }

  /** Returns all the blocks in a range
      @param range -
      @returns
      \@cell type 'block'/'range'
      \@cell range
      \@cell block
  */
  getBlocksInRange(range, withinnerlists) {
    range = range.clone();
    //var orgrange = range.clone();

    /* minimize the range, so we're inside a block (when outside a block, the following code
       range moving can go into embedded objects) */
    range.descendToLeafNodes(this.getBody());

    // Move range to include the whole block (including sublists)
    range.start.moveToPreviousBlockBoundary(this.getBody(), true);

    // If end is placed before all visible content in a block, need to place it before the its block (but after range.start!)
    if (range.end.movePastLastVisible(this.getBody()).type === 'outerblock') {
      // When <p>...</p><p>(*end*), place the end in the previous block
      range.end.ascend(this.getBody(), false);
      // Now: <p>...</p>(*end*)<p> or <body>(*end*)<p>
      // Make sure no content is left between the left block and the end locator
      range.end.moveToPreviousBlockBoundary(this.getBody(), false);
      // And keep the range valid
      if (range.end.compare(range.start) < 0)
        range.end.assign(range.start);
    } else {
      range.end.moveToNextBlockBoundary(this.getBody(), !withinnerlists);
    }

    const blocknodes = [];

    // FIXME: use something to limit maxancestor to nearest <body><td><th>
    //var startblocknode = range.start.element;
    //var endblocknode = range.end.element;

    const elts = range.querySelectorAll('*');
    for (let i = 0; i < elts.length; ++i) {
      if (!elts[i].isContentEditable || !domlevel.isNodeBlockElement(elts[i]))
        continue;
      blocknodes.push(elts[i]);
    }

    const blocks = [];
    for (let i = 0; i < blocknodes.length; ++i) {
      const block = this.getBlockAtNode(blocknodes[i]);
      if (block.islist && block.contentnode === block.node)
        continue;

      blocks.push({ type: 'block', block: block });
    }

    if (range.start.element === range.end.element) {
      const block = this.getBlockAtNode(range.start.element);
      if (block.contentnode === block.blockparent) // Non-block enclosed text
      {
        if (blocknodes.length === 0) {
          blocks.push({ type: 'range', range: range });
        } else {
          const startrange = range.clone();
          startrange.end.assign(startrange.start);
          startrange.end.moveToNextBlockBoundary(this.getBody());

          if (!startrange.isCollapsed())
            blocks.unshift({ type: 'range', range: startrange });

          const endrange = range.clone();
          endrange.start.assign(startrange.start);
          endrange.start.moveToPreviousBlockBoundary(this.getBody());

          if (!endrange.isCollapsed())
            blocks.push({ type: 'range', range: endrange });
        }
      } else
        blocks.push({ type: 'block', block: block });
    }

    return blocks;
  }

  getFormattingStateForRange(range) {
    const state = super.getFormattingStateForRange(range);

    // Preinit added fields
    state.blockstyle = null;
    state.limited = { textstyles: this.textstyletags.slice().concat("img") };

    // Gather all the blockstyles in range
    const blockranges = this.getBlocksInRange(range, false);
    const blockstyles = [], blockstyletags = [];

    for (let i = 0; i < blockranges.length; ++i) {
      if (blockranges[i].type !== 'block' || !blockranges[i].block.blockstyle)
        continue;

      const blockstyle = blockranges[i].block.blockstyle;
      if (!blockstyletags.includes(blockstyle.tag)) {
        blockstyles.push(blockstyle);
        blockstyletags.push(blockstyle.tag);
      }
    }

    if (blockstyles.length) {
      // Gather the textstyles that are available for all block types
      for (let i = 0; i < blockstyles.length; ++i) {
        if (blockstyles[i].istable) // tables don't have textstyles
          continue;

        const newtextstyles = [];
        const btextstyles = blockstyles[i].def.textstyles;
        for (let a = 0; a < btextstyles.length; ++a)
          if (state.limited.textstyles.includes(btextstyles[a])) {
            newtextstyles.push(btextstyles[a]);
          }
        state.limited.textstyles = newtextstyles;
      }

      state.blockstyle = blockstyles.length > 1 ? null : blockstyles[0];
    } else
      state.blockstyle = this.structure.defaultblockstyle;

    // Also apply the selections to the actionstates
    for (let i = 0; i < this.textstyletags.length; ++i) {
      const styletag = this.textstyletags[i];
      if (state.actionstate[styletag] && (!state.limited.textstyles.includes(styletag) || state.isblockwidget))
        state.actionstate[styletag].available = false;
    }

    // Enable list toggles only when corresponding list style is available
    const stylelisttypes = [];
    this.structure.blockstyles.forEach(item => { stylelisttypes.push(item.listtype); });

    if (!stylelisttypes.includes('unordered') || state.isblockwidget)
      state.actionstate.ul.available = false;
    if (!stylelisttypes.includes('ordered') || state.isblockwidget)
      state.actionstate.ol.available = false;
    if (!state.limited.textstyles.includes("img") || state.isblockwidget)
      state.actionstate.img.available = false;

    return state;
  }

  /** Node that parses an incoming (paste, initial set) node and tries to recognize it
      based on the configuration of this editor
      @returns
      \@cell return.type
      \@cell return.style
  */
  parseNode(node) {
    // text nodes?
    if ([3, 4].includes(node.nodeType))
      return node.nodeValue === '' ? { type: 'ignore' } : { type: 'text', data: node.nodeValue };

    // Not an element or fragment?
    if (![1, 11].includes(node.nodeType))
      return null;

    if (domlevel.isEmbeddedObject(node))
      return parseEmbeddedObjectNode(node);

    let tagmatch = null;
    let classmatch = null;
    let importfrommatch = null;

    const nodename = node.nodeName.toLowerCase();
    const islist = ['ul', 'ol'].includes(nodename);
    const istable = ['table'].includes(nodename);
    let hastables = false;
    for (let i = 0; i < this.structure.blockstyles.length; ++i) {
      const blockstyle = this.structure.blockstyles[i];
      hastables = hastables || Boolean(blockstyle.istable);

      // importfrom has highest priority. Also overrides list vs nonlist stuff
      if (!importfrommatch && blockstyle.importfrom.find(style => node.matches(style)))
        importfrommatch = blockstyle;

      // Match on classname (but don't change list to non-list or table to non-table & vv).
      if (!classmatch
        && (blockstyle.islist === islist)
        && (Boolean(blockstyle.istable) === Boolean(istable))
        && node.classList.contains(blockstyle.classname)) {
        classmatch = blockstyle;
      }

      // Match h1-h6 on tag name too
      if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(nodename)
        && nodename === blockstyle.def.containertag.toLowerCase()
        && !tagmatch)
        tagmatch = blockstyle;
    }

    // Any match yet?
    const match = importfrommatch || classmatch || tagmatch;
    if (match) {
      if (match.istable)
        return { type: 'tablestyle', style: match };
      return { type: 'blockstyle', style: match };
    }

    // If the structure doesn't support tables, and we're parsing a td or th, make it a default style block
    if (!hastables && ['td', 'th'].includes(nodename))
      return { type: 'cellitem' };

    // Recognized text style?
    const style = this.getTextStyleRecordFromNode(node);
    if (style && this.textstyletags.includes(style.nodeName))
      return { type: 'textstyle', style: style, displayblock: node.style.display === "block" };

    if (node.nodeName.toLowerCase() === 'br')
      return { type: 'br', isinterchange: node.classList.contains("Apple-interchange-newline") };
    if (node.nodeName.toLowerCase() === "img")
      return { type: "img" };

    // Ignore style, script, meta nodes
    const ignores = ['style', 'script', 'meta'];
    if (ignores.includes(node.nodeName.toLowerCase()))
      return { type: 'ignore' };

    //do fallbacks
    if (node.nodeName.toLowerCase() === 'ol' && (this.structure.defaultorderedliststyle || this.structure.defaultunorderedliststyle))
      return { type: 'blockstyle', style: this.structure.defaultorderedliststyle || this.structure.defaultunorderedliststyle };
    if (node.nodeName.toLowerCase() === 'ul' && (this.structure.defaultunorderedliststyle || this.structure.defaultorderedliststyle))
      return { type: 'blockstyle', style: this.structure.defaultunorderedliststyle || this.structure.defaultorderedliststyle };
    if (node.nodeName.toLowerCase() === 'table' && this.structure.defaulttablestyle)
      return { type: 'tablestyle', style: this.structure.defaulttablestyle };

    // Return all unrecognized inline nodes as 'unknown', which triggers a recursive parse while ignoring the nodes themselves
    const inlines =
      [
        "abbr", "acronym", "b", "big", "cite", "code", "dfn", "em", "font",
        "i", "kbd", "samp", "small", "strong", "sub", "sup",
        "tt", "var", "a", "bdo", "label", "q", "span"
      ];
    if (inlines.includes(node.nodeName.toLowerCase()))
      return { type: 'unknown', displayblock: node.style.display === "block" }; // triggers recursive parse

    // All other (block) nodes: return as default block style
    return { type: 'blockstyle', style: this.structure.defaultblockstyle };
  }

  parseContainerContents(node, { inblock, externalcontent, initialblockstyle }) {
    //console.log('parsing\n', richdebug.getStructuredOuterHTML(node, {}, true));

    const topblocklist = [];
    //no_br_to_p: we don't want to convert leftover BRs to blocks (eg from insertContainerContents)
    this.parseContainerContentsRecursive(node, null, topblocklist, [], initialblockstyle, { externalcontent: externalcontent });

    if (topblocklist.length !== 0 && inblock)
      topblocklist[0].temporary = true;

    return topblocklist;
  }

  _addItemToBlockNodes(block, item) {
    if (block.deferredbr) {
      // ignore whitespace just after a br if it is the last in a block
      if (item.type === "text" && item.value.match(/^[ \t\r\n]*$/)) {
        block.deferredbr.push(item);
        return;
      }
      block.nodes.push(...block.deferredbr);
    }
    if (item.type === "br") {
      block.deferredbr = [item];
      block.forcevisible = true;
    } else {
      block.deferredbr = null;
      block.nodes.push(item);
    }
  }

  parseContainerContentsRecursive(node, block, topblocklist, textstyles, initialblockstyle, options) {
    // Copy the children array
    const children = Array.from(node.childNodes);

    for (let ci = 0; ci < children.length; ++ci) {
      const child = children[ci];
      const type = this.parseNode(child);
      //console.log("Parsed", child, type);
      if (!type || type.type === 'ignore')
        continue;

      if ((!block || block.type === "cellitem") && ['text', 'textstyle', 'br', "img"].includes(type.type)) {
        // Ignore text nodes with only whitespace in block-less nodes or cellitems
        if (type.type === 'text') {
          while (type.data && ' \t\r\n'.indexOf(type.data.substr(0, 1)) !== -1)
            type.data = type.data.substr(1);
          if (!type.data) {
            //console.log('ignore empty text');
            continue;
          }
        }

        // If this is an inline node within a cellitem block, create a block with the default (table) style
        const style = block && block.type === "cellitem" && block.defaultstyle ? block.defaultstyle : initialblockstyle || this.structure.defaultblockstyle;
        initialblockstyle = null;
        block = { type: 'block', style: style, nodes: [], surrogate: true };
        topblocklist.push(block);
      }

      if (block && block.gotlist) {
        // No content allowed after nested list - insert a new list item for it
        block = { type: 'listitem', nodes: [], listitems: block.listitems, style: block.style };
        block.listitems.push(block);
      }

      switch (type.type) {
        case 'unknown':
          {
            let displayblockblock;
            if (type.displayblock && block && block.nodes.length && block.nodes[block.nodes.length - 1].type !== 'br' && !block.deferredbr) {
              displayblockblock = block;
              this._addItemToBlockNodes(block, { type: 'br' });
            }

            block = this.parseContainerContentsRecursive(child, block, topblocklist, textstyles, null, options);

            if (displayblockblock && displayblockblock === block && block.nodes[block.nodes.length - 1].type !== 'br' && !block.deferredbr)
              this._addItemToBlockNodes(block, { type: 'br' });
          } break;
        case 'textstyle':
          {
            let displayblockblock;
            if (type.displayblock && block.nodes.length && block.nodes[block.nodes.length - 1].type !== 'br' && !block.deferredbr) {
              displayblockblock = block;
              this._addItemToBlockNodes(block, { type: 'br' });
            }

            const subtextstyles = textstyles.slice();
            if (block.style.def.textstyles.includes(type.style.nodeName))
              subtextstyles.push(type.style);

            block = this.parseContainerContentsRecursive(child, block, topblocklist, subtextstyles, null, options);

            if (displayblockblock && displayblockblock === block && block.nodes[block.nodes.length - 1].type !== 'br' && !block.deferredbr)
              this._addItemToBlockNodes(block, { type: 'br' });
          } break;
        case 'text':
          {
            let text = type.data;
            //remove stray undisplayed charactesr
            text = text.replaceAll('\u200b', '');

            //convert linefeeds to spaces, remove double spaces
            text = text.replaceAll('\r', ' ');
            text = text.replaceAll('\n', ' ');
            while (text.includes("  "))
              text = text.replaceAll("  ", " ");

            if (text !== type.data)
              block.forcevisible = true;
            if (text !== '')
              this._addItemToBlockNodes(block, { type: 'text', value: text, textstyles: textstyles });
          } break;
        case "img":
          {
            // Image allowed in the current style?
            if (!block.style.def.textstyles.includes("img")) {
              // nope, see if the defaultblockstyle supports images, use that block style if it does
              // also, can't handle images in lists (should the list be broken up?)
              if (!this.structure.defaultblockstyle.def.textstyles.includes("img") || block.style.islist)
                break;

              block = { type: 'block', style: this.structure.defaultblockstyle, nodes: [], surrogate: true };
              topblocklist.push(block);
            }
            this._addItemToBlockNodes(block, { type: "img", value: this.getImageStyleRecordFromNode(child), textstyles: textstyles });
          } break;
        case 'br':
          {
            // Ignore chrome interchange br's if followed by one of our bogus br's
            if (!type.isinterchange || !child.nextSibling || child.nextSibling.nodeName.toLowerCase() !== "br") {
              this._addItemToBlockNodes(block, { type: type.type, value: this.getTextStyleRecordFromNode(child) });

              // Don't converts BR's at root level to paragraphs, disabled for utwente/utwente_base#2029 (and complaints from Herman)
            }
          } break;
        case 'embeddedobject':
          {
            if (type.embedtype === "block") {
              block = null;
              topblocklist.push(type);
            } else {
              this._addItemToBlockNodes(block, type);
            }
            break;
          }
        case 'blockstyle':
          {
            if (block && block.surrogate)
              block = null;

            const isreallist = type.style.islist;
            if (initialblockstyle) {
              if (!type.style.islist)
                type.style = initialblockstyle;
              initialblockstyle = null;
            }

            if (block && (block.type === 'listitem' && !type.style.islist)) {
              // Non-list in list block. Just parse the contents
              this.parseContainerContentsRecursive(child, block, topblocklist, textstyles, null, options);
            } else if (type.style.islist && !isreallist) // initial blockstyle is a list
            {
              const subblock = { type: 'list', style: type.style, nodes: [], surrogate: true };
              topblocklist.push(subblock);

              const listitem = { type: 'listitem', nodes: [], listitems: subblock.nodes, style: type.style };
              subblock.nodes.push(listitem);

              this.parseContainerContentsRecursive(child, listitem, topblocklist, textstyles, null, options);
            } else if (type.style.islist) {
              // Got an ol/ul node
              const subblock = { type: 'list', style: type.style, nodes: [] };
              if (block && block.type === 'listitem') {
                this._addItemToBlockNodes(block, subblock);
                block.gotlist = true;
              } else {
                topblocklist.push(subblock);
                block = null;
              }

              for (let i = 0; i < child.childNodes.length; ++i)
                if (['li', 'ol', 'ul'].includes(child.childNodes[i].nodeName.toLowerCase())) {
                  const listitem = { type: 'listitem', nodes: [], listitems: subblock.nodes, style: type.style };
                  subblock.nodes.push(listitem);

                  const subchild = child.childNodes[i];
                  this.parseContainerContentsRecursive(subchild, listitem, topblocklist, textstyles, null, options);
                }
            } else {
              block = { type: 'block', style: type.style, nodes: [], anchor: child.getAttribute('data-rtd-anchor') };
              topblocklist.push(block);

              this.parseContainerContentsRecursive(child, block, topblocklist, textstyles, null, options);
              block = null;
            }
          } break;
        case 'tablestyle':
          {
            const dims = tableeditor.getTableDimensions(child);
            const firstdatacell = tableeditor.locateFirstDataCell(child);

            // Skip empty tables
            if (dims.rows === 0 || dims.cols === 0)
              continue;

            // If the table has any content, it should *always* close whatever block we're currently in

            block = {
              type: 'table',
              style: type.style,
              nodes: [],
              colwidths: [],
              firstdatacell: firstdatacell,
              caption: child.querySelector('caption')?.textContent ?? ""
            };
            topblocklist.push(block);

            // Make head rows as non-data
            const head_rows = child.tHead ? Array.from(child.tHead.rows) : [];
            firstdatacell.row += head_rows.length;

            // Make sure to first handle thead, then tbody and finally tfoot
            const rows = Array.from(child.rows);
            const rowspans = Array(dims.cols).fill(0);

            for (let i = 0; i < rows.length; ++i) {
              const cells = Array.from(rows[i].cells);
              const rowitem = { type: 'rowitem', nodes: [], height: parseInt(rows[i].style.height) };

              block.nodes.push(rowitem);

              let col = 0; // track start column of cell
              let currentcellidx = 0;

              while (col < dims.cols) {
                if (rowspans[col] > i) // skip over previous rowspanned cols
                {
                  ++col;
                  continue;
                }

                const currentcell = cells[currentcellidx++]; //currentcellidx out of range? add missing cells
                const cellitem = {
                  type: 'cellitem',
                  defaultstyle: type.style.tabledefaultblockstyle,
                  nodes: [],
                  colspan: currentcell ? currentcell.colSpan : 1,
                  rowspan: currentcell ? currentcell.rowSpan : 1,
                  styletag: currentcell ? this.structure.getClassStyleForCell(currentcell) : ''
                };

                rowitem.nodes.push(cellitem);
                if (currentcell)
                  this.parseContainerContentsRecursive(currentcell, cellitem, cellitem.nodes, textstyles, null, options);

                for (let colspan = 0; colspan < cellitem.colspan; ++colspan)
                  rowspans[col++] = i + cellitem.rowspan;
              }
            }

            // Retrieve the sizing cell sizes
            const sizetr = document.createElement("tr"); // Row to hold the sizing cells
            child.appendChild(sizetr);
            const cols = tableeditor.getCols(child);

            for (let i = 0; i < dims.cols; ++i)
              sizetr.appendChild(document.createElement("td"));

            for (let i = 0; i < dims.cols; ++i) {
              let size = null;
              if (i < cols.length)
                size = parseInt(cols[i].style.width);
              if (!size)
                size = sizetr.childNodes[i].offsetWidth;

              block.colwidths.push(size);
            }
            sizetr.remove();
            block = null;
          } break;
        case 'cellitem':
          {
            // This is the block for the contents of a cell when there is no table style defined in the structure
            block = { type: 'block', style: this.structure.defaultblockstyle, nodes: [] };
            topblocklist.push(block);

            this.parseContainerContentsRecursive(child, block, topblocklist, textstyles, null, options);
            block = null;
          } break;
      }
    }
    return block;
  }

  showParsed(parsed, indent) {
    let istr = ' ';
    while (istr.length < indent)
      istr += istr;
    istr = istr.substr(0, indent);

    for (let i = 0; i < parsed.length; ++i) {
      console.log(istr + 'b ' + i + ': ' + parsed[i].type
        + (parsed[i].type === 'text' ? ' "' + parsed[i].value + '"' : '')
        + (parsed[i].type === "img" ? ' ' + JSON.stringify(parsed[i].value) : '')
        + (['list', 'block'].includes(parsed[i].type) ? ' ' + parsed[i].style.def.containertag + '.' + parsed[i].style.tag : '')
        + (parsed[i].forcevisible ? ' forcevisible' : '')
        + (parsed[i].temporary ? ' temporary' : '')
        + (parsed[i].surrogate ? ' surrogate' : '')
        + (parsed[i].deferred ? " (deferred)" : "")
        + (parsed[i].textstyles ? " [" + parsed[i].textstyles.map(s => s.nodeName).join(", ") + "]" : "")
      );
      if (['list', 'listitem', 'block', 'table', 'rowitem', 'cellitem'].includes(parsed[i].type)) {
        const nodes = [...parsed[i].nodes, ...(parsed[i].deferredbr || []).map(e => ({ ...e, deferred: true }))];
        this.showParsed(nodes, indent + 2);
      }
    }
  }

  exitTextStyles(locator: domlevel.Locator) {
    locator = locator.clone();
    const nearestnode: Node = locator.getNearestNode();
    const block = this.getBlockAtNode(nearestnode);
    if (block.contentnode !== nearestnode)
      locator.ascend(block.contentnode, true);
    return locator;
  }

  _insertParsed(locator: domlevel.Locator, nodes, inblock: boolean, inlist: boolean, intable: boolean, preservelocators, undoitem) {
    preservelocators = preservelocators || [];
    for (const line of explainIntoLines(nodes)) {
      if (line.block) {
        // Exit any textstyles
        locator.assign(this.exitTextStyles(locator));

        const node = line.block;
        switch (node.type) {
          case 'block':
            {
              if (inblock && node.temporary) {
                locator = this._insertParsed(locator, node.nodes, inblock, inlist, intable, preservelocators, undoitem);
                //console.log('temporary',locator);
                if (node.forcevisible)
                  this.requireVisibleContentInBlockAfterLocator(locator, [locator, ...(preservelocators || [])], undoitem);
              } else {
                // Insert block node (allow li inserts)
                const res = this.insertBlockNode(locator, node.style, true, preservelocators, undoitem, node.anchor);

                //console.log(' inserted blocknode, now', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }))

                locator = this._insertParsed(res.contentlocator, node.nodes, true, false, intable, preservelocators, undoitem);
                //console.log(' inserted blocknode, prs', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }))

                if (node.forcevisible)
                  this.requireVisibleContentInBlockAfterLocator(locator, [locator, ...(preservelocators || [])], undoitem);
                else if (!domlevel.hasNodeVisibleContent(res.node)) {
                  domlevel.Locator.newPointingTo(res.node).removeNode([res.contentlocator, locator, ...(preservelocators || [])], undoitem);
                }
                //console.log(' inserted blocknode, fnl', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }))
              }
            } break;
          case 'embeddedobject':
            {
              const embobjnode = this._createEmbeddedObjectNode(node);
              locator = this._insertEmbeddedObjectNode(locator, embobjnode, preservelocators, undoitem).afternodelocator;
              break;
            }
          case 'table':
            {
              if (intable || inblock || inlist) { //squash the unexpected table
                for (const rownode of node.nodes) {
                  for (const cellitemnode of rownode.nodes) {
                    locator = this._insertParsed(locator, cellitemnode.nodes, inblock, inlist, intable, preservelocators, undoitem);
                  }
                }
              } else {
                const tablenode = this._createTableNode(node);
                locator = this._insertTableNode(locator, tablenode, preservelocators, undoitem).afternodelocator;
                this.initializeTableEditor(tablenode, node.style.tableresizing);
              }
              break;
            }
          case 'list':
            {
              if (!node.nodes.length)
                continue;

              if (inlist && node.temporary && node.nodes.length === 1) {
                locator = this._insertParsed(locator, node.nodes[0].nodes, inblock, inlist, intable, preservelocators, undoitem);
                continue;
              }

              const res = this.insertBlockNode(locator, node.style, false, preservelocators, undoitem, node.anchor);
              for (let j = 0; j < node.nodes.length; ++j) {
                const newli = document.createElement('li');
                res.contentlocator.insertNode(newli, preservelocators, undoitem);
                ++res.contentlocator.offset;

                locator = new domlevel.Locator(newli);
                locator = this._insertParsed(locator, node.nodes[j].nodes, true, true, intable, preservelocators, undoitem);

                this.requireVisibleContentInBlockAfterLocator(locator, [locator], undoitem);
              }

              if (res.node.childNodes.length === 0) {
                locator = domlevel.Locator.newPointingTo(res.node);
                locator.removeNode(preservelocators, undoitem);
              } else
                locator = domlevel.Locator.newPointingAfter(res.node);
            } break;
          case 'br':
            {
              const formatting = new EditorBase.TextFormattingState();
              const newnode = document.createElement("br");
              formatting.textstyles = [];
              locator = this.insertInlineFormattedNode(locator, newnode, formatting, preservelocators, undoitem).after;
            } break;
        }
      } else {
        for (const node of fixIntralineSpaves(line.inline)) {
          switch (node.type) {
            case 'text':
              {
                const formatting = new EditorBase.TextFormattingState();
                formatting.textstyles = node.textstyles;

                const textnode = document.createTextNode(node.value);
                locator = this.insertInlineFormattedNode(locator, textnode, formatting, preservelocators, undoitem).after;
              } break;

            case "img":
              {
                const newnode = this.createTextStyleNode(node.value);
                const formatting = new EditorBase.TextFormattingState();
                formatting.textstyles = node.textstyles;
                locator = this.insertInlineFormattedNode(locator, newnode, formatting, preservelocators, undoitem).after;
              } break;

            case 'embeddedobject':
              {
                locator.assign(this.exitTextStyles(locator));

                const embobjnode = this._createEmbeddedObjectNode(node);
                locator = this._insertEmbeddedObjectNode(locator, embobjnode, preservelocators, undoitem).afternodelocator;
                break;
              }

            default:
              {
                console.error("Unexpected nodetype '" + node.type + "'", node);
                break;
              }
          }
        }
      }
      //console.log('post-insert parsed node ', node.type, 'at', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }))
    }
    return locator;
  }

  cleanupParsedExternalContent(nodes) {
    let firstnode = true;
    for (let i = 0; i < nodes.length; ++i) {
      const node = nodes[i];
      switch (node.type) {
        case 'block':
          {
            if (firstnode)
              node.temporary = true;
          } // fallthrough
        case 'listitem':
          {
            const subnodes = node.nodes;
            /*            let j;
                        for (j = subnodes.length - 1; j >= 0; --j)
                        {
                          if (subnodes[j].type === 'br') // bogus BR!
                          {
                            subnodes.pop();
                            node.forcevisible = true;
                            break;
                          }
                          else if (subnodes[j].type !== 'text' || !subnodes[j].value.match(/^[ \t\r\n]*$/))
                            break;
                        }
            */
            if (subnodes.length)
              this.cleanupParsedExternalContent(subnodes);

            // No subnodes left? Remove block (listitem is mostly visible) FIXME: better determination
            if (node.type === 'block' && !subnodes.length && !node.forcevisible)
              nodes.splice(i--, 1);
          } break;

        case 'list':
          {
            this.cleanupParsedExternalContent(node.nodes);

            // No list items left? Remove list.
            if (node.nodes.length === 0)
              nodes.splice(i--, 1);
          } break;
      }
      firstnode = false;
    }
  }

  /** @param locator -
      @param node - Container whose contents will be parsed and inserted
      @param options -
      \@cell options.externalcontent External content (remove trailing br, empty paragraphs)
      \@cell options.inblock
      \@cell options.breakafter Add a new (default) paragraph after the inserted content (ADDME list?)
      @param undoitem -
      @returns Locator pointing to node just after inserted content
  */
  insertContainerContents(locator, node, options, preservelocators, undoitem) {
    preservelocators = preservelocators || [];

    locator = locator.clone();
    const block = this.getBlockAtNode(locator.getNearestNode());
    const inlist = block.islist;

    let breakblock = false;
    if (typeof options.inblock === "undefined") {
      //      console.warn("inblock not specified, checking if at start of block");
      const downres = locator.clone().scanBackward(this.getBody(), { whitespace: true });
      if (downres.type === 'outerblock') {
        options.inblock = block.islist;
        breakblock = true;
      } else
        options.inblock = true;
    }

    // When pasting inside a block, overwrite the first blockstyle of the parsed contents, so the textstyle correction algorithm
    // in the parser will evict disallowed styles
    const initialblockstyle = options.inblock && block && block.blockstyle || null;
    const parsed = this.parseContainerContents(node, { ...options, initialblockstyle });

    if (dompack.debugflags.rte)
      console.log('[rte] parsed container contents', parsed, { breakblock });

    if (breakblock) {
      const upres = locator.clone().scanForward(this.getBody(), { whitespace: true });
      let blockisempty = false;
      if (upres.bogussegmentbreak) {
        const downres = locator.clone().scanBackward(this.getBody(), { whitespace: true });
        if (downres.type === "outerblock")
          blockisempty = true;
      }

      if (blockisempty && parsed.length) {
        if (!block.islist) {
          // paragraph is empty, just delete it
          locator = domlevel.Locator.newPointingTo(block.contentnode);
          locator.removeNode(preservelocators);
        }
      } else {
        // break block at insert position into two, append at the end of the first part
        if (block.contentnode !== block.blockroot) {
          const down = locator.clone();
          down.scanBackward(this.getBody(), { whitespace: true });

          const splitres = domlevel.splitDom(block.blockparent, [{ locator: down, toward: 'start', preservetoward: 'end' }], null);
          locator = splitres[0].end;
        }
      }
    }

    if (debugicc) {
      console.log('parsed (pre clean) ', options.externalcontent);
      this.showParsed(parsed, 1);
    }

    if (options.externalcontent)
      this.cleanupParsedExternalContent(parsed);

    //    console.log(options);

    // If the copied selection contains a trailing segment break, make sure a segment break is inserted only
    // if the insert locator doesn't point to a segment break (ignoring whitespace).
    if (options.breakafter) {
      const upres = locator.clone().scanForward(this.getBody(), { whitespace: true });
      if ((upres.type === "node" || upres.type === "char") && !upres.segmentbreak)
        parsed.push({ type: 'block', style: this.structure.defaultblockstyle, nodes: [] });
    }

    if (debugicc) {
      console.log('parsed (' + (options.externalcontent ? 'post' : 'no') + ' clean)');
      this.showParsed(parsed, 1);
      console.log('pre insertParsed: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator }));
    }

    let res = this._insertParsed(locator, parsed, options.inblock, inlist, options.isintable, preservelocators, undoitem);
    if (debugicc)
      console.log('post insert: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator, res: res }));

    // Combine text nodes around parsed stuff
    locator = this.combineAtLocator(this.getBody(), locator, true, [], [res, ...preservelocators], undoitem);
    res = this.combineAtLocator(this.getBody(), res, true, [], [locator, ...preservelocators], undoitem);
    if (debugicc)
      console.log('post combine: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator, res }));

    if (debugicc)
      console.log('ICC postinsert, html: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator, res: res }));
    const range = new Range(res, res);
    this.checkDomStructure(range, [locator, res, ...(preservelocators || [])], undoitem);
    if (debugicc)
      console.log('ICC postcheck, html: ', richdebug.getStructuredOuterHTML(this.getBody(), { locator: locator, res: res }));

    domlevel.cleanupBogusBreaks(range.getAncestorElement(), [locator, res, ...(preservelocators || [])], undoitem);

    return res;
  }

  setContentsHTML(text, options) {
    if (options && options.raw)
      return super.setContentsHTML(text);

    super.setContentsHTML('');

    const content = document.createElement('div');
    content.innerHTML = text;

    const insertlocator = new domlevel.Locator(this.getBody());

    // console.log('setContentsHTML, html: ', richdebug.getStructuredOuterHTML(content, {}));

    this.insertContainerContents(insertlocator, content, { externalcontent: true });

    //console.log('post setContentsHTML: ', richdebug.getStructuredOuterHTML(this.getBody(), { insertlocator: insertlocator }));

    const cursorpos = new domlevel.Locator(this.getBody());
    this.setCursorAtLocator(cursorpos);
    this.stateHasChanged();

    //console.log('post setContentsHTML: ', richdebug.getStructuredOuterHTML(this.getBody(), this.getSelectionRange()));
    this._reprocessEmbeddedAutoElements();
  }

  createBlockStyleElement(blockstyle, noli) {
    const newel = document.createElement(blockstyle.def.containertag);
    newel.className = blockstyle.classname;
    let subnode = newel;
    if (!noli && ['ul', 'ol'].includes(blockstyle.def.containertag.toLowerCase())) {
      subnode = document.createElement('li');
      newel.appendChild(subnode);
    }

    const res =
    {
      node: newel,
      insertnode: subnode
    };
    return res;
  }

  _toggleBulletedList() {
    this.toggleList(this.structure.defaultunorderedliststyle);
  }

  _toggleNumberedList() {
    this.toggleList(this.structure.defaultorderedliststyle);
  }

  toggleList(liststyle) {
    this.setSelectionBlockStyle(liststyle, false);
  }

  /** Changes the block style of a single list. Removes all nodes between the range ancestor element and the ancestor param.
      Very crude function, but it does the trick.
  */
  changeRangeBlockStyle(range, ancestor, newblockstyle, preservelocators, undoitem) {
    if (!ancestor.contains(range.getAncestorElement()))
      throw new Error("Ancestor not parent of range in changeRangeBlockStyle");
    if (range.start.element !== range.end.element)
      throw new Error("Simple range required in changeRangeBlockStyle");

    //    console.error('changeRangeBlockStyle start:', richdebug.getStructuredOuterHTML(ancestor, { ancestor: ancestor, range:range }));

    const parts = domlevel.splitDom(ancestor,
      [
        { locator: range.start, toward: 'start', preservetoward: 'end' },
        { locator: range.end, toward: 'end', preservetoward: 'start' }
      ], preservelocators.concat(range), undoitem);

    // Wrap the range in the new block node
    const elt = this.createBlockStyleElement(newblockstyle, true).node;
    domlevel.wrapSimpleRangeInNewNode(range, elt, preservelocators.concat(parts).concat(range), undoitem);

    // For lists, wrap the content in a <li> too
    if (newblockstyle.islist) {
      const newli = document.createElement('li');
      domlevel.wrapSimpleRangeInNewNode(Range.fromNodeInner(elt), newli, preservelocators.concat(parts).concat(range), undoitem);
    }

    // Extract the new block node, place it in a div
    const rewritecontentnode = document.createElement('div');
    domlevel.wrapSimpleRangeInNewNode(Range.fromNodeOuter(elt), rewritecontentnode, preservelocators.concat(parts).concat(range), undoitem);

    // Remove the node, save the position in the insertlocator
    const insertlocator = parts[1].start;
    domlevel.removeSimpleRange(parts[1], preservelocators.concat([insertlocator]), undoitem);

    // Insert the contents of the <div>
    this.insertContainerContents(insertlocator, rewritecontentnode, { inblock: false }, preservelocators, undoitem);

    range.start.assign(insertlocator);
    range.end.assign(parts[1].end);

    // Combine lists if possible
    this.combineAtLocator(ancestor, range.start, false, [], preservelocators.concat([range]), undoitem);
    this.combineAtLocator(ancestor, range.end, true, [], preservelocators.concat([range]), undoitem);

    return range;
  }

  /** Changes the blockstyle of the selection.
      @param newblockstyle -
      @param forced - If not forced, and all selected blocks are of the same list style as the new blockstyle, everything
         is changed to the default blockstyle.
  */
  setSelectionBlockStyle(newblockstyle, forced?: boolean) {
    const undolock = this.getUndoLock();

    let blockstyle = newblockstyle;
    if (typeof blockstyle === "string")
      blockstyle = this.structure.getBlockStyleByTag(blockstyle);
    if (!blockstyle)
      throw new Error("Invalid blockstyle " + newblockstyle);

    //console.log('ssbs', newblockstyle);

    const range = this.getSelectionRange();
    const blockranges = this.getBlocksInRange(range, !blockstyle.islist);

    // If all the selected blockranges are the same list style, and we are selecting a non-forced list style, we revert
    // to the default block style
    //console.log(!forced, blockstyle.islist);
    if (!forced && blockstyle.islist) {
      let allmatch = true;
      for (let i = 0; i < blockranges.length; ++i)
        if (blockranges[i].type !== 'block' || blockranges[i].block.blockstyle.tag !== blockstyle.tag) {
          //console.log(blockranges[i].type, blockranges[i].block.blockstyle.tag, blockstyle.tag);
          allmatch = false;
          break;
        }
      if (allmatch)
        blockstyle = this.structure.defaultblockstyle;
    }

    // Process backward, so we won't have problems with <li> 1 <ol> <li> 2, where converting 1 will break the info of 2
    for (let i = blockranges.length - 1; i >= 0; --i) {
      const blockrange = blockranges[i];
      //      console.log(blockrange);

      let ancestor, localrange;
      if (blockrange.type === 'range') {
        ancestor = blockrange.range.getAncestorElement();
        localrange = blockrange.range;
      } else // block.type === 'block'
      {
        // Table part or no change needed?
        if (!blockrange.block.blockstyle || blockrange.block.blockstyle.istable || blockrange.block.blockstyle.tag === blockstyle.tag)
          continue;

        ancestor = blockrange.block.islist && blockstyle.islist ? blockrange.block.blockparent : blockrange.block.blockroot;
        localrange = Range.fromNodeInner(blockrange.block.contentnode);
      }

      const resultres = this.changeRangeBlockStyle(localrange, ancestor, blockstyle, [range], undolock.undoitem);
      if (i === blockranges.length - 1)
        range.end.assign(resultres.end);
      range.start.assign(resultres.start);
    }

    //range.end.assign(range.start);
    this.selectRange(range);

    undolock.close();

    this.stateHasChanged();
    return true;
  }

  refilterContent(externalcontent) {
    const body = this.getBody();
    // console.log("before refilter", body.innerHTML);

    const oldcontent = document.createElement('div');

    // Use wrap instead of moving firstChild, firefox likes to invent <br>s when moving firstChild's
    domlevel.wrapSimpleRangeInNewNode(Range.fromNodeInner(body), oldcontent);
    body.removeChild(oldcontent);

    const insertlocator = new domlevel.Locator(body);

    this.insertContainerContents(insertlocator, oldcontent, { externalcontent: externalcontent });

    // Make sure selection is placed at start of content
    const range = new Range(insertlocator, insertlocator);
    range.normalize(body);
    this.selectRange(range);

    this.stateHasChanged();
    this._reprocessEmbeddedAutoElements();
  }

  setCellStyle(cell, newstyle) {
    cell.className = "wh-rtd__tablecell" + (newstyle ? " " + newstyle : "");
  }
  setSelectionCellStyle(newstyle) {
    const range = this.getSelectionRange();
    const tablecells = range.querySelectorAll("tr,td"); //FIXME filter embedded tr/tds (eg preview objects)
    const parent = range.getAncestorElement().closest("tr,td");

    for (const applyto of [parent, ...tablecells])
      if (applyto)
        this.setCellStyle(applyto, newstyle);
  }

  // ---------------------------------------------------------------------------
  //
  // Modification handlers
  //

  executeHardEnter() {
    const range = this.getSelectionRange();
    this._executeHardEnterOnRange(range);
  }

  _executeHardEnterOnRange(range) {
    const debughardenter = false;
    const undolock = this.getUndoLock();
    if (debughardenter)
      console.log('hard enter start:', richdebug.getStructuredOuterHTML(this.getBody(), { range: range }));

    this.checkDomStructure(range);

    // Determine the blocks the selection starts & ends in
    const startblock = this.getBlockAtNode(range.start.element);
    const endblock = this.getBlockAtNode(range.end.element);

    if (debughardenter)
      console.log('hard pre:', richdebug.getStructuredOuterHTML(this.getBody(), { range: range, startblock: startblock, endblock: endblock }));

    // Expand selection to first/last visible, sres and eres contain the type of content next to the range
    const sres = range.start.movePastLastVisible(startblock.contentnode);
    let eres = range.end.moveToFirstVisible(endblock.contentnode);

    // Is the selection from block start/until the block end?
    const selectfromblockstart = sres.type === "outerblock";
    let selecteduntilblockend = eres.type === 'outerblock';

    // See if the end selection hits the end <br> of a block, if so include it in the range
    if (eres.type === 'br') {
      const brrange = this.pointsToLastBlockBR(range.end);
      if (brrange) {
        range.end.assign(brrange.end);
        selecteduntilblockend = true;
      } else {
        ++range.end.offset;
        eres = range.end.moveToFirstVisible(endblock.contentnode);
      }
    }

    // now, the range contains the entire content to remove, sres and eres contain info about what is net to the range

    if (debughardenter) {
      console.log(sres, eres);
      console.log('hard outscan:', richdebug.getStructuredOuterHTML(this.getBody(), { range: range }));
    }

    // Are we removing from the start of a block? If so, we insert a block node that should follow the previous block
    // and then remove the range

    // Place where we need to insert the new block
    let blockinsertlocator;

    // block we use as reference to get the style of the block to insert
    let reference_block = startblock;

    let insert_li = startblock.islist;
    let perform_split = !selectfromblockstart;

    // Merge the following content into the new block (adopting its style)
    let merge_with_new_block = !selectfromblockstart;

    // when a whole <li> is selected, split the list and insert a normal paragraph
    if (startblock.islist && selectfromblockstart && selecteduntilblockend) {
      // split the list until the parent of the ol/ul, insert a normal block (default style)
      // and merge the end of the remaining list node into the new block (eliminating it)
      perform_split = true;
      insert_li = false;
      reference_block = null;
      merge_with_new_block = true;
    }

    if (!perform_split) {
      // insert a new block before the currently selected block
      const prevblock = sres.type === "outerblock" && sres.data.previousElementSibling;
      if (prevblock)
        reference_block = this.getBlockAtNode(prevblock);

      blockinsertlocator = domlevel.Locator.newPointingTo(sres.data);
    } else {
      // split the currently selected block
      let splitroot = startblock.blockparent;
      if (insert_li)
        splitroot = startblock.node; // Just need to add a li, split until the <ol>/<ul>

      // Break the current block on the start of the range
      const parts = domlevel.splitDom(splitroot, [{ locator: range.start, toward: 'start' }], [range], undolock.undoitem);
      blockinsertlocator = parts[1].start;
    }

    // insert the new block
    let newblockcontent;
    if (insert_li) {
      const newli = document.createElement('li');
      blockinsertlocator.insertNode(newli, [range], undolock.undoitem);
      newblockcontent = new domlevel.Locator(newli);
    } else {
      // Determine the style of the block to insert
      const newstyle = (reference_block && reference_block?.blockstyle?.nextblockstyle) || this.structure.defaultblockstyle;
      newblockcontent = this.insertBlockNode(blockinsertlocator, newstyle, true, [range], null, null).contentlocator;
    }

    if (debughardenter)
      console.log('post-insert:', richdebug.getStructuredOuterHTML(this.getBody(), { range: range, newblockcontent }));

    if (merge_with_new_block)
      range.start = newblockcontent;
    else {
      // Add a br in the new block so it stays visible
      this.requireVisibleContentInBlockAfterLocator(newblockcontent, [range], undolock.undoitem);
    }

    if (debughardenter)
      console.log('pre remove:', richdebug.getStructuredOuterHTML(this.getBody(), { range }));

    // range now contains the range from the start of the newly inserted block until the end of the removed content. Remove the range
    let loc = this._removeRangeAndStitch(range, null, undolock.undoitem, { normalize: false });

    if (debughardenter)
      console.log('after remove:', richdebug.getStructuredOuterHTML(this.getBody(), { range }));


    const block = this.getBlockAtNode(loc.element);
    if (block.contentnode)
      this.requireVisibleContentInBlockAfterLocator(new domlevel.Locator(block.contentnode), null, undolock.undoitem);

    // If the first character after the new locator is whitespace, rewrite that
    loc = this._correctWhitespaceAroundLocator(loc, undolock.undoitem);
    this.setCursorAtLocator(loc);

    undolock.close();
    this.stateHasChanged();
    return false;
  }

  /// Returns whether a block node has any visible content (other than a <br> that forces a visible empty line)
  _isEmptyBlock(node) {
    let locator = new domlevel.Locator(node);
    let res = locator.scanForward(node, { whitespace: true });
    if (res.type === "outerblock")
      return true;
    if (res.type === "br") // got a br
    {
      locator = domlevel.Locator.newPointingAfter(res.data);
      res = locator.scanForward(node, { whitespace: true });
      return res.type === "outerblock";
    }
    return false;
  }

  // Scans backward, skipping over embedded blocks
  _scanBackwardSkipEmbedded(ancestor, locator) {
    locator = locator.clone();
    for (; ;) {
      const bres = locator.scanBackward(this.getBody(), { whitespace: true, blocks: true });
      if (bres.type === "outerblock")
        return bres.data === ancestor ? null : locator;
      if (bres.type !== "node" || !bres.data.classList.contains("wh-rtd-embeddedobject")) {
        // don't return location after bogus segment break, that breaks positioning
        if (bres.type === "br" && bres.bogussegmentbreak)
          --locator.offset;
        return locator;
      }
      --locator.offset;
    }
  }

  // Scans forward, skipping over embedded blocks
  _scanForwardSkipEmbedded(ancestor, locator) {
    locator = locator.clone();
    for (; ;) {
      const fres = locator.scanForward(ancestor, { whitespace: true, blocks: true });
      if (fres.type === "outerblock")
        return fres.data === ancestor ? null : locator;
      if (fres.type !== "node" || !fres.data.classList.contains("wh-rtd-embeddedobject"))
        return locator;
      ++locator.offset;
    }
  }

  _executeDeleteByKey(forward) {
    const undolock = this.getUndoLock();
    let range = this.getSelectionRange();

    if (range.isCollapsed()) {
      // range is collapsed
      let block = this.getBlockAtNode(range.start.getNearestNode());
      if (this._isEmptyBlock(block.contentnode)) {
        // See if there is a legal position to place the cursor after deleting this
        let newpos;
        if (!forward) // with backspace, try to go back first
          newpos = this._scanBackwardSkipEmbedded(block.blockroot, range.start);
        if (!newpos)
          newpos = this._scanForwardSkipEmbedded(block.blockroot, domlevel.Locator.newPointingAfter(block.contentnode));
        if (!newpos && forward)
          newpos = this._scanBackwardSkipEmbedded(block.blockroot, range.start);
        if (!newpos) // no legal position to place our cursor after deleting?
        {
          undolock.close();
          return true;
        }

        let locator = domlevel.Locator.newPointingTo(block.contentnode);
        locator.removeNode([newpos], undolock.undoitem);
        if (block.islist) // last li?
        {
          const innerloc = new domlevel.Locator(block.node, 0);
          if (innerloc.moveToNextBlockBoundary(this.getBody(), false).type === "outerblock") {
            locator = domlevel.Locator.newPointingTo(block.node);
            locator.removeNode([newpos], undolock.undoitem);
          }
        }

        this.checkDomStructure(Range.fromLocator(newpos), []);
        undolock.close();

        return true;
      }

      // Disallow deleting tables, embedded blocks and captions
      const checkblock = (node) => {
        if (node.matches("div,table,caption"))
          return false;
        return true;
      };

      const newpos = range.end.clone();
      if (forward) {
        const moveres = newpos.moveRight(this.getBody(), { checkblock });
        if (moveres)
          range.end.assign(newpos);
        else {
          undolock.close();
          return true;
        }
      } else {
        const moveres = newpos.moveLeft(this.getBody(), { checkblock });
        if (moveres) {
          // See if the previous block is empty. If so, remove it.
          block = this.getBlockAtNode(newpos.getNearestNode());
          if (this._isEmptyBlock(block.contentnode)) {
            block.contentnode.remove();
            if (block.node !== block.contentnode && this._isEmptyBlock(block.node)) // removed last li in list node?
              block.node.remove();
            undolock.close();
            return true;
          }

          range.start.assign(newpos);
        } else {
          undolock.close();
          return true;
        }
      }

      //console.log('moved right', richdebug.getStructuredOuterHTML(this.getBody(), range, { indent: true }));
    }

    //console.log('pre constrain', richdebug.getStructuredOuterHTML(this.getBody(), range, { indent: true }));
    range = this._constrainRangeCrossTDSelections(range).range;

    const locator = this._removeRangeAndStitch(range, null, undolock.undoitem);
    this.setCursorAtLocator(locator);

    undolock.close();
    return true;
  }

  addListNodeToNode(node, blockstyle) {
    if (node.lastChild && node.lastChild.lastChild) {
      const block = this.getBlockAtNode(node.lastChild.lastChild);
      if (block && block.blockstyle)
        blockstyle = block.blockstyle;
    }

    return this.insertBlockNode(new domlevel.Locator(node, "end"), blockstyle, true, null, null, null);
  }

  areBothListRoots(left, right) {
    return ['ol', 'ul'].includes(left.nodeName.toLowerCase())
      && ['ol', 'ul'].includes(right.nodeName.toLowerCase());
  }

  combineAdjacentLists(ancestor, locator, preservelocators, undoitem) {
    domlevel.combineWithPreviousNodesAtLocator(
      locator,
      ancestor,
      false,
      this.areBothListRoots.bind(this),
      preservelocators,
      undoitem);
  }

  addListLevel() {
    const range = this.getSelectionRange();
    const undolock = this.getUndoLock();

    const filtered = lists.getLevelActionableListNodes(range, this.getBody()).addable;

    //console.log('addlistlevel todo', richdebug.getStructuredOuterHTML(this.getBody(), filtered, true));

    for (let i = 0; i < filtered.length; ++i) {
      const node = filtered[i];

      let prev = node.previousSibling;
      // If prev is null, the li should be moved into the last li of the previous list
      const move_into_prevlist = !prev;
      if (move_into_prevlist)
        prev = node.parentNode.previousSibling.lastChild;

      // Inv: prev is an LI node

      // Move the current li into the previous li, wrapped in a copy of the current parent list node

      // Clone the parent list node & the first list node, append it into prev
      const oldlist = node.parentNode;
      const newlist = oldlist.cloneNode(false);
      new domlevel.Locator(prev, "end").insertNode(newlist, null, undolock.undoitem);
      const ancestor = oldlist.parentNode;

      // Clone the li and move its contents (we currently don't have a DOM move function to move range contents into a node)
      const newli = node.cloneNode(false);
      new domlevel.Locator(newlist, "end").insertNode(newli, null, undolock.undoitem);

      // Move the contents of our node into the parent list, remove node, keep range ok
      let insertpos = new domlevel.Locator(newli);
      domlevel.combineNodes(insertpos, node, [range], undolock.undoitem);

      // If we have moved into another list, check if the old list is empty and if so, remove it
      if (move_into_prevlist && !oldlist.childNodes.length) {
        insertpos = domlevel.Locator.newPointingTo(oldlist);
        insertpos.removeNode([range], undolock.undoitem);
      }

      //console.log('addlistlevel combine', richdebug.getStructuredOuterHTML(this.getBody(), {range:range,insertpos:insertpos,prev:prev}, true));

      // If there was a list at the end of prev, merge it with the newly inserted list
      this.combineAdjacentLists(ancestor, insertpos, [range], undolock.undoitem);
    }

    this.selectRange(range);
    undolock.close();
    this.stateHasChanged();
  }

  removeListLevel() {
    const range = this.getSelectionRange();
    const undolock = this.getUndoLock();
    const orgrange = range.clone();

    const filtered = lists.getLevelActionableListNodes(range, this.getBody()).removeable;

    //console.log('rll pre', richdebug.getStructuredOuterHTML(this.getBody(), { blocks: filtered, orgrange: orgrange }, true));

    for (let i = 0; i < filtered.length; ++i) {
      const node = filtered[i];

      // Make sure our li isn't empty
      this.requireVisibleContentInBlockAfterLocator(new domlevel.Locator(node, 0), [orgrange], undolock.undoitem);

      const block = this.getBlockAtNode(node);
      const parentblock = this.getBlockAtNode(block.blockparent);
      const parent = node.parentNode;

      /*    Current:
            <ol>parentblock
              <li>rest1
                <ol>block
                  <li>node (here)
                    <ol>subnodes
                      <li>sub1
                  <li>rest2
              <li>rest3

            New:
            <ol>parentblock
              <li>rest1
              <li>node (here)
                <ol>block
                  <li>sub1
                  <li>rest2
              <li>rest3
      */
      const splitpoint = new domlevel.Locator(node);

      //console.log('rll presplit', richdebug.getStructuredOuterHTML(this.getBody(), { splitpoint: splitpoint, node: node, blocks: filtered, orgrange: orgrange, parts: parts }, true));

      // Split the dom to separate the non-list contents of the parent li and the selected list item
      const parts = domlevel.splitDom(parentblock.node, [{ locator: splitpoint, toward: 'start' }], [orgrange], undolock.undoitem);

      //console.log('rll postsplit', richdebug.getStructuredOuterHTML(this.getBody(), { node: node, blocks: filtered, orgrange: orgrange, parts: parts }, true));

      /*    Now:
            <ol>parentblock
              <li>rest1
              boundary
              <li> <-- newli
                <-- insertlocator
                <ol>block
                  <li>node (here)
                    <ol>subnodes
                      <li>sub1
                  <li>rest2
              <li>rest3
      */
      // Move the contents of node into the new li
      const newli = parts[1].start.getPointedNode(); /* Must succced, because our li node can't be empty */
      const insertlocator = new domlevel.Locator(newli, 0);

      const cres = domlevel.combineNodes(insertlocator, node, [orgrange], undolock.undoitem);
      const afterlocator = cres.afterlocator;

      //console.log('rll postcombine1', richdebug.getStructuredOuterHTML(this.getBody(), { node: node, blocks: filtered, orgrange: orgrange }, true));


      /*    Now:
            <ol>parentblock
              <li>rest1
              boundary
              <li>node
                <ol>subnodes
                  <li>sub1
                <-- afterlocator
                <ol>#block.node
                  (node was here, is removed by combineNodes)
                  <li>rest2
              <li>rest3
      */

      // If the nodes before and after the afterlocator are both lists, combine them
      this.combineAdjacentLists(newli, afterlocator, [orgrange], undolock.undoitem);

      //console.log('rll postcombine2', richdebug.getStructuredOuterHTML(this.getBody(), { node: node, blocks: filtered, orgrange: orgrange }, true));

      if (parent.parentNode && parent.childNodes.length === 0)
        domlevel.Locator.newPointingTo(parent).removeNode([orgrange], undolock.undoitem);

      this.requireVisibleContentInBlockAfterLocator(new domlevel.Locator(newli, 0), [orgrange], undolock.undoitem);
      //console.log('rll iter end', richdebug.getStructuredOuterHTML(this.getBody(), { node: node, blocks: filtered, orgrange: orgrange }, true));
    }

    //console.log('rll done', richdebug.getStructuredOuterHTML(this.getBody(), { orgrange: orgrange }, true));

    this.selectRange(orgrange);
    undolock.close();
    this.stateHasChanged();
  }

  // Correct dom structure after del & backspace (that may remove the first block node & just leave the body
  checkDomStructure(range, preservelocators) {
    //console.log('start checkDomStructure', richdebug.getStructuredOuterHTML(this.getBody(), range), range, preservelocators);

    const restoreselection = !range;
    if (restoreselection)
      range = this.getSelectionRange();

    preservelocators = [range, ...(preservelocators || [])];

    // First, correct a missing br in the current block, if needed
    const block = this.getBlockAtNode(range.start.getNearestNode());
    let locator = new domlevel.Locator(block.contentnode);
    this.requireVisibleContentInBlockAfterLocator(locator, preservelocators);
    domlevel.cleanupBogusBreaks(range.getAncestorElement(), preservelocators);

    // If the current block has lost its style, reset to default block style
    if (block.blockparent !== block.contentnode && !block.blockstyle && !domlevel.isEmbeddedObject(block.contentnode) && !block.isintable) {
      const localrange = Range.fromNodeInner(block.contentnode);
      this.changeRangeBlockStyle(localrange, block.blockparent, this.structure.defaultblockstyle, preservelocators.concat([range]));
    }

    // See if there is content at start of document not wrapped in block
    locator = new domlevel.Locator(this.getBody());
    let res = locator.scanForward(this.getBody(), { whitespace: true });

    // Yes, there is visible content.
    if (!['innerblock'].includes(res.type) && !(res.type === 'node' && domlevel.isEmbeddedObject(res.data))) {
      // Wrap everything until next block
      locator.moveToNextBlockBoundary(this.getBody(), false);

      // Make sure we handle something like bla<i><p>etc gracefully, can only move simple ranges
      const parts = domlevel.splitDom(this.getBody(), [{ locator: locator, toward: 'start' }], preservelocators);

      // Wrap range in block
      res = this.insertBlockNode(parts[1].start, this.structure.defaultblockstyle, preservelocators, null);
      domlevel.moveSimpleRangeTo(parts[0], res.contentlocator, preservelocators);
      this.requireVisibleContentInBlockAfterLocator(res.contentlocator, preservelocators);
    }

    // Do some combining for DOM niceness
    this.combineAtLocator(this.getBody(), range.start, false, [], preservelocators);
    // ADDME: might be funny
    // this.combineAtLocator(this.getBody(), range.end, true, [], preservelocators);

    if (restoreselection) {
      this.selectRange(range);
      this.stateHasChanged();
    }

    //    console.log('end checkDomStructure', richdebug.getStructuredOuterHTML(this.getBody(), range), range, preservelocators);
  }

  //////////////////////////////////////
  //
  // Block components
  //

  _createEmbeddedObjectNode(data: RTEWidget) {
    return rtesupport.buildEmbeddedObjectNode(data, this.options);
  }

  insertEmbeddedObject(data: RTEWidget) {
    const range = this.getSelectionRange();
    const undolock = this.getUndoLock();
    const rangeiscollapsed = range.isCollapsed();
    const locator = this.removeSelection();

    const node = this._createEmbeddedObjectNode(data);
    this._insertEmbeddedObjectNode(locator, node, [], undolock.undoitem);

    if (rangeiscollapsed)
      this.setCursorAtLocator(locator);
    else
      this.selectNodeOuter(node);

    undolock.close();
    this.stateHasChanged();
    this._reprocessEmbeddedAutoElements();
  }

  updateEmbeddedObject(target, data: RTEWidget) {
    // No undo, embedded object state is kept at server
    const range = this.getSelectionRange();
    const undolock = this.getUndoLock();

    const locator = domlevel.Locator.newPointingTo(target);
    const node = this._createEmbeddedObjectNode(data);

    locator.replacePointedNode(node, [range]);

    this.selectRange(range);

    //    if (undoitem)
    //      undoitem.finish(this.getSelectionRange());
    undolock.close();
    this.stateHasChanged();
    this._reprocessEmbeddedAutoElements();
  }
  removeEmbeddedObject(node) {
    const range = this.getSelectionRange();
    const undolock = this.getUndoLock();

    domlevel.Locator.newPointingTo(node).removeNode([range], undolock.undoitem);

    this.selectRange(range);

    undolock.close();
    this.stateHasChanged();
  }

  _createTableNode(data) {
    const node = document.createElement('table');
    node.className = data.style.classname + " wh-rtd__table";
    const tbody = document.createElement('tbody');

    if (data.caption)
      node.appendChild(<caption class="wh-rtd__tablecaption" contenteditable="false" inert>{data.caption.trim()}</caption>);

    if (data.colwidths) {
      const colgroup = document.createElement('colgroup');
      data.colwidths.forEach(width => {
        const col = document.createElement('col');
        if (width)
          col.style.width = width + 'px';
        colgroup.appendChild(col);
      });
      node.appendChild(colgroup);
    }

    const rowspans = [];
    data.nodes.forEach((rowitem, row) => {
      if (rowitem.type !== 'rowitem')
        throw new Error("Unexpected table rowitem node");

      const tr = document.createElement('tr');
      if (rowitem.height)
        tr.style.height = rowitem.height + "px";

      let col = 0;
      rowitem.nodes.forEach(cellitem => {
        if (rowitem.type !== 'rowitem')
          throw new Error("Unexpected table rowitem node");

        // Determine the current column based on rowspans
        while ((rowspans[col] || 0) > row)
          ++col;

        let cellnode = null;
        if ((col >= data.firstdatacell.col) === (row >= data.firstdatacell.row))
          cellnode = document.createElement("td");
        else {
          cellnode = document.createElement("th");
          cellnode.setAttribute("scope", col >= data.firstdatacell.col ? "col" : "row");
        }

        if (cellitem.colspan > 1)
          cellnode.colSpan = cellitem.colspan;
        if (cellitem.rowspan > 1)
          cellnode.rowSpan = cellitem.rowspan;
        cellnode.className = "wh-rtd__tablecell" + (cellitem.styletag ? " " + cellitem.styletag : "");
        cellnode.propWhRtdCellitem = cellitem;
        tr.appendChild(cellnode);


        for (let colitr = 0; colitr < cellitem.colspan; ++colitr)
          rowspans[col++] = row + cellitem.rowspan;
      });
      tbody.appendChild(tr);
    });

    node.appendChild(tbody);
    tableeditor.fixupScopeTRs(node);
    return node;
  }

  removeTable(node) {
    const range = this.getSelectionRange();
    const undolock = this.getUndoLock();

    domlevel.Locator.newPointingTo(node).removeNode([range], undolock.undoitem);

    this.selectRange(range);

    undolock.close();
    this.stateHasChanged();
  }

  requireBottomParagraph() {
    const body = this.getBody();
    const locator = new domlevel.Locator(body, "end");
    let res = locator.scanBackward(body, { whitespace: true });
    switch (res.type) {
      case "char":
      case "br": return; // got bottom text, all is ok
      case "node":
      case "innerblock": {
        const lname = res.data.nodeName.toLowerCase();
        if (lname !== "table" && !res.data.classList.contains("wh-rtd-embeddedobject"))
          return;

        const undolock = this.getUndoLock();

        const loc = new domlevel.Locator(body, "end");
        res = this.insertBlockNode(loc, this.structure.defaultblockstyle, false, null, null, null);
        this.requireVisibleContentInBlockAfterLocator(new domlevel.Locator(res.node), null, null);
        this.selectRange(Range.fromLocator(res.contentlocator));

        undolock.close();
      } break;
      default: {
        this.checkDomStructure();
      } break;

    }
  }

  //////////////////////////////////////////////////////
  //
  // Lists
  //
  getAvailableListActions(range) {
    const listdata = lists.getLevelActionableListNodes(range, this.getBody());
    return {
      canincrease: listdata.addable.length !== 0,
      candecrease: listdata.removeable.length !== 0
    };
  }
}
