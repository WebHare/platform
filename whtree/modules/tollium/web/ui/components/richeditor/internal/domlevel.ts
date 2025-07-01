import * as browser from "dompack/extra/browser";
import * as dompack from "dompack";
import { throwError } from "@webhare/std";

export type PreservedLocatorList = Array<Locator | Range>;

type DOMRange = {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
};

type GetNodeType<NodeType extends 1 | 2 | 3 | 4 | 7 | 8 | 9 | 10 | 11> =
  NodeType extends 1 ? HTMLElement :
  NodeType extends 2 ? Attr :
  NodeType extends 3 ? Text :
  NodeType extends 4 ? CDATASection :
  NodeType extends 7 ? ProcessingInstruction :
  NodeType extends 8 ? Comment :
  NodeType extends 9 ? Document :
  NodeType extends 10 ? DocumentType :
  NodeType extends 11 ? DocumentFragment :
  never;

export enum NodeType {
  element = 1,
  attribute = 2,
  text = 3,
  cDATASection = 4,
  processingInstruction = 7,
  comment = 8,
  document = 9,
  documentType = 10,
  documentFragment = 11,
}

interface BaseWrapRangeOptions {
  ///Override which elements are allowed to appear inside the new node we're applying (never invoked for textnodes)
  onCanWrapNode?: (element: HTMLElement) => boolean;
  ///If set allows you to limit which nodes will contain the wrapped element
  onAllowIn?: (element: HTMLElement) => boolean;
}

export interface WrapRangeOptions extends BaseWrapRangeOptions {
  preserveLocators?: PreservedLocatorList;
}

export function testType<T extends NodeType>(node: Node, nodetype: T | readonly T[]): node is GetNodeType<T> {
  return Array.isArray(nodetype) ? nodetype.includes(node.nodeType) : node.nodeType === nodetype;
}

export function getAttributes(node: HTMLElement, attrlist: string[]) {
  const result: Record<string, string> = {};
  for (let i = 0; i < attrlist.length; ++i)
    if (node.hasAttribute(attrlist[i])) {
      const value = node.getAttribute(attrlist[i]);
      result[attrlist[i]] = value || "";
    }
  return result;
}

export function getAllAttributes(node: HTMLElement): Record<string, string> {
  const res: Record<string, string> = {};
  for (let i = 0, end = node.attributes.length; i < end; ++i) {
    const name = node.attributes[i].name;
    const value = node.getAttribute(name);

    res[name] = value || "";
  }
  return res;
}

export function setAttributes(node: HTMLElement, attrs: Record<string, string>) {
  // Insert sorted on attributes name
  let keys = Object.keys(attrs).sort();

  // firefox will show attributes in innerHTML in reverse insert order
  if (browser.getName() === "firefox")
    keys = keys.reverse();

  for (let i = 0; i < keys.length; ++i)
    node.setAttribute(keys[i], attrs[keys[i]]);
}

// ---------------------------------------------------------------------------
//
// Range API
//

/* selection logging: rangelog bitmask
   1: log selection.js
   2: log persistentiframe.js
   4: log iframelevel.js (without selectrange)
   8: log structurededitor.js
   16: log whrtebase.js
   32: log domlevel
   64: log iframelevel.js selectrange
*/
const rangelog = 0;
//rangelog = 1+2+4+8+16+32+64;

export class Range {
  start: Locator;
  end: Locator;

  constructor(start: Locator, end: Locator) {
    this.start = start.clone();
    this.end = end.clone();
  }

  clone() {
    return new Range(this.start.clone(), this.end.clone());
  }

  assign(rhs: Range) {
    this.start.assign(rhs.start);
    this.end.assign(rhs.end);
    return this;
  }

  isInDOM() {
    return this.start.isInDOM() && this.end.isInDOM();
  }

  check(maxancestor: ParentNode) {
    this.start.check(maxancestor);
    this.end.check(maxancestor);
    if (this.start.compare(this.end) > 0) throw new Error("Start lies after end");
    return this;
  }

  getAncestor() {
    return Locator.findCommonAncestor(this.start, this.end);
  }

  getAncestorElement() {
    return Locator.findCommonAncestorElement(this.start, this.end);
  }

  getAncestorClosest(selector: string, scope: Node) {
    if (!scope)
      throw new Error("Scope is required");

    const theclosest = this.getAncestorElement().closest(selector);
    return scope.contains(theclosest) ? theclosest : null;
  }

  isCollapsed() {
    return this.start.equals(this.end);
  }

  equals(rhs: Range) {
    return this.start.equals(rhs.start) && this.end.equals(rhs.end);
  }

  /** Normalize a range. If the range is collapsed, the caret is placed past the
      last visible character/element/block boundary
      Otherwise, the start is placed next to the next visible character/element/block
      boundary, and the end is placed next to the previous visible character/element/block boundary.
  */
  normalize(maxancestor: ParentNode, fromnative?: boolean) {
    if (!maxancestor.contains(this.getAncestorElement()))
      throw new Error("Maxancestor is not an ancestor of range");

    this.check(maxancestor);

    //console.log('*');
    //console.log('*');
    //console.log('*');
    // if (rangelog & 32)
    //   console.log('pre normalize', richdebug.getStructuredOuterHTML(maxancestor, { range: this }, true));

    if (this.isCollapsed() && fromnative && browser.getName() === "firefox") {
      /* In firefox, there is a distinction between a|<i>b and a<i>|b. When normalizing a native
         selection here, try to maintain that distinction
         Let's try doing nothing.
      */
      return this;
    }

    // Legalize the selection (outside of unsplittables). Needed for embedded objects in IE.
    this.legalize(maxancestor);

    // Minimize the selection
    this.start.moveToFirstVisible(maxancestor, false, false);
    this.end.movePastLastVisible(maxancestor, false, false);

    // If this collapses the selection, move it past the last visible
    if (this.end.compare(this.start) <= 0) {
      // if (rangelog & 32)
      //   console.log('normalize collapsed ', richdebug.getStructuredOuterHTML(maxancestor, this, false));

      // Place 'm in text
      this.start.moveToFirstVisible(maxancestor, false, true);
      this.end.movePastLastVisible(maxancestor, false, true);

      // if (rangelog & 32)
      //   console.log('normalize collapsed ', richdebug.getStructuredOuterHTML(maxancestor, this, false));

      // We're now in reversed order:  end-start
      const enda = findParent(this.end.getNearestNode(), 'a', maxancestor);
      const starta = findParent(this.start.getNearestNode(), 'a', maxancestor);

      if (starta !== enda && enda)
        this.end.assign(this.start);
      else
        this.start.assign(this.end);
    }

    return this;
  }

  moveEndToPastLastVisible(maxancestor: ParentNode) {
    if (!maxancestor)
      throw new Error("Missing maxancestor");

    const ancestor = this.getAncestor();

    if (this.isCollapsed())
      return;

    // Move end as far below as possible
    this.end.ascend(ancestor);

    if (this.isCollapsed())
      return;

    // End already in text? Done!
    if (!this.end.parentIsElementOrFragmentNode())
      return;

    --this.end.offset;
    this.end.element = this.end.getPointedNode() ?? throwError("End locator does not point to a node"); //found in TS checks and this.end.descendToLeafNode would crash if element === null
    this.end.positionPastLastChild();

    this.end.descendToLeafNode(maxancestor);
  }

  splitStartBoundary(preservelocators: PreservedLocatorList) {
    if (!this.start.parentIsElementOrFragmentNode()) {
      // Try to move start to its parent (and try to move end too, in case start === end at end of text node)
      if (this.start.element === this.end.element)
        this.end.moveToParent(true);

      // Try to move to parent, fails if within text
      this.start.moveToParent(false);

      // Start still inside a text node?
      if (!this.start.parentIsElementOrFragmentNode()) {
        // Split data node
        const newloc = splitDataNode(this.start, (preservelocators || []).concat([this.end]), 'end');

        // Point start node to new text element
        this.start.assign(newloc);
      }
    }
  }

  /** Insert node just before the start of the range
      @param node - Node to insert
      @param preservelocators - Locators to preserver
      @returns Locator pointing to new node
  */
  insertBefore(node: ParentNode, preservelocators: PreservedLocatorList) {
    if (!this.start.parentIsElementOrFragmentNode())
      this.splitStartBoundary(preservelocators);

    const retval = this.start.clone();
    /*var newnode = */this.start.insertNode(node, (preservelocators || []).concat(this));
    //    ++this.start.offset;
    //    if (this.end.element === this.start.element)
    //      ++this.end.offset;
    return retval;
  }

  descendToLeafNodes(maxancestor: ParentNode) {
    if (!maxancestor)
      throw new Error("Missing ancestor!");

    if (!this.isCollapsed()) {
      this.start.descendToLeafNode(maxancestor);

      // FIXME: fails with (start)<b>(end)<i>text</i></start>. Following code should work, test it!
      if (this.start.compare(this.end) > 0)
        this.end.assign(this.start);
      else
        this.moveEndToPastLastVisible(maxancestor);
    } else {
      this.start.descendToLeafNode(maxancestor);
      this.end.assign(this.start);
    }

    return this;
  }

  containsLocator(rhs: Locator) {
    return this.start.compare(rhs) <= 0 && this.end.compare(rhs) >= 0;
  }

  intersect(rhs: Range) {
    if (this.start.compare(rhs.start) < 0)
      this.start.assign(rhs.start);
    else if (this.start.compare(rhs.end) > 0)
      this.start.assign(rhs.end);
    if (this.end.compare(rhs.start) < 0)
      this.end.assign(rhs.start);
    else if (this.end.compare(rhs.end) > 0)
      this.end.assign(rhs.end);
    return this;
  }

  limitToNode(node: Node) {
    const noderange = Range.fromNodeInner(node);
    if (!this.isInDOM()) { // safety
      this.start.assign(noderange.start);
      this.end.assign(noderange.start);
      return this;
    }
    return this.intersect(noderange);
  }

  /** Returns a range of all the childnodes of node that are (partially) included in this range
  */
  getLocalRangeInNode(node: Node) {
    const copy = this.clone();
    const noderange = Range.fromNodeInner(node);
    copy.intersect(noderange);

    copy.start.ascend(node, false, true);
    copy.end.ascend(node, false, true);

    return { range: copy, containswholenode: copy.equals(noderange) };
  }

  getContainedLocators() {
    return [this.start, this.end];
  }

  querySelectorAll(selector: string): Node[] {
    // console.log('Range gebtn', richdebug.getStructuredOuterHTML(this.getAncestorElement(), this));

    const copy = this.clone();
    const ancestor = copy.getAncestorElement();
    //    console.log(copy, ancestor);
    if (!ancestor)
      return [];

    copy.start.ascend(ancestor, false, true);
    copy.end.ascend(ancestor, true, true);

    //    console.log(' ascended', richdebug.getStructuredOuterHTML(this.getAncestorElement() || this.getAncestor(), copy));

    let result: Node[] = [];
    for (let itr = copy.start.clone(); itr.offset < copy.end.offset; ++itr.offset) {
      const child = itr.getPointedNode()!;
      if (testType(child, NodeType.element)) {
        if (child.matches(selector))
          result.push(child);

        if (itr.offset === copy.start.offset || itr.offset === copy.end.offset - 1) { // May be partial!
          const subrange = this.clone().intersect(Range.fromNodeInner(child));
          result = result.concat(subrange.querySelectorAll(selector));
        } else {
          const nodes = Array.from(child.querySelectorAll(selector));
          // console.log('  child ', child, nodes);
          result = result.concat(nodes);
        }
      }
      //      else console.log('  child ignored ', child);
    }
    return result;
  }

  toDOMRange(): DOMRange {
    const result =
    {
      startContainer: this.start.element,
      startOffset: this.start.offset,
      endContainer: this.end.element,
      endOffset: this.end.offset
    };
    return result;
  }

  isLegal(maxancestor: ParentNode) {
    if (!this.start.isLegal(maxancestor) || !this.end.isLegal(maxancestor))
      return false;

    // Must be within the same contenteditable node
    return this.start.getParentContentEditable(maxancestor) === this.end.getParentContentEditable(maxancestor);
  }

  legalize(maxancestor: ParentNode) {
    this.start.legalize(maxancestor, false);
    this.end.legalize(maxancestor, true);

    const start_contenteditable = this.start.getParentContentEditable(maxancestor);
    if (start_contenteditable !== this.end.getParentContentEditable(maxancestor))
      this.limitToNode(start_contenteditable);

    return this;
  }

  static fromSelection(selection: Selection) {
    const start = new Locator(selection.anchorNode ?? throwError("Incomplete selection, no anchorNode"), selection.anchorOffset);
    const end = new Locator(selection.focusNode ?? throwError("Incomplete selection, no focusNode"), selection.focusOffset);
    const reversed = start.compare(end) > 0;
    return new Range(reversed ? end : start, reversed ? start : end);
  }

  static fromDOMRange(range: DOMRange) {
    return new Range(new Locator(range.startContainer, range.startOffset), new Locator(range.endContainer, range.endOffset));
  }

  static fromRangyRange(range: DOMRange) {
    return new Range(new Locator(range.startContainer, range.startOffset), new Locator(range.endContainer, range.endOffset));
  }

  static forNode(node: Node) {
    console.warn('Range.forNode is deprecated, use fromNodeInner!'); console.trace();
    return new Range(new Locator(node), new Locator(node, "end"));
  }

  static withinNode(node: Node) {
    console.warn('Range.withinNode is deprecated, use fromNodeInner!'); console.trace();
    return new Range(new Locator(node), new Locator(node, "end"));
  }

  static fromNodeInner(node: Node) {
    return new Range(new Locator(node), new Locator(node, "end"));
  }

  static fromNodeOuter(node: Node) {
    return new Range(Locator.newPointingTo(node), Locator.newPointingAfter(node));
  }

  static fromLocator(loc: Locator) {
    return new Range(loc, loc);
  }

  static getLogLevel() {
    return rangelog;
  }
}


// ---------------------------------------------------------------------------
//
// Helper functions
//

type NodeFilterFunction = string | string[] | ((node: Node) => boolean);

function getNodeIndex(node: Node): number {
  let i = 0;
  let countnode: Node | null = node;
  while ((countnode = countnode.previousSibling))
    ++i;
  return i;
}

function getCommonAncestor(lhs: Node, rhs: Node): Node {
  const ancestors: Node[] = [];
  for (let n: Node | null = lhs; n; n = n.parentNode) {
    ancestors.push(n);
  }

  for (let n: Node | null = rhs; n; n = n.parentNode)
    if (ancestors.includes(n))
      return n;

  throw new Error(`Internal error: no common ancestor found. Nodes are outside the DOM ?`);
}

function compareContained(container: Locator, contained: Locator) {
  if (container.offset === 0)
    return 1; //container is at the front. everything contained in it is behind it
  if (container.offset === GetNodeEndOffset(container.element))
    return -1; //container is at the end. everything contained in it is before it

  const ascended = contained.clone();
  ascended.ascend(container.element, "really", true);
  return ascended.offset <= container.offset ? -1 : 1;
}

/** Returns whether a node matches a filter
    @param node - Node to test
    @param filter - Filter to execute. True is returned for the different types of filter when:
              string: nodeName is equal (case insensitive)
              array: contains lowercase nodeName
              function: filter(node) returns TRUE
*/
function isNodeFilterMatch(node: Node, filter: NodeFilterFunction) {
  if (!node)
    throw new Error("No node in isNodeFilterMatch");
  if (Array.isArray(filter))
    return filter.includes(node.nodeName.toLowerCase());
  if (typeof filter === "string")
    return node.nodeName.toLowerCase() === filter.toLowerCase();
  return filter(node);
}


function applyPreserveFunc(preserve: PreservedLocatorList | undefined, func: (loc: Locator, idx: number, list: Locator[]) => void) {
  const list: Locator[] = [];
  if (!preserve)
    return list;

  // Eliminate duplicates, double corrections mess up a lot of stuff
  for (const p of preserve) {
    for (const locator of p.getContainedLocators())
      if (list.indexOf(locator) === -1)
        list.push(locator);
  }

  list.forEach((item, idx) => func(item, idx, list));
  /*/ // Enable this to get better debugging of preserve functions
  console.log('Apply preserve func', func);
  list.each(function (item)
    {
      if (item.id)
        console.log('pre  ' + (typeof item.id=="undefined"?'':'$'+item.id+'/'+(item.cc||0)),item.element, item.offset, func);
      func(item);
      if (item.id)
      {
        item.cc = (item.cc||0)+1;
        console.log('post ' + (typeof item.id=="undefined"?'':'$'+item.id+'/'+item.cc), item.element, item.offset);
      }
    });
  //*/
  return list;
}

// ---------------------------------------------------------------------------
//
// Public API - testing & finding
//

/** Returns the number of childnodes/characters in a node (that's the locator offset that points past
    all contained content
*/
function getNodeChildCount(element: Node) {
  if (testType(element, [NodeType.element, NodeType.documentFragment]))
    return element.childNodes.length; // for element nodes, document fragments, etc
  else
    return element.nodeValue ? element.nodeValue.length : 0; // for text nodes
}

/** Searches for a parent with a specific nodename (or test function). Stops testing after ancestor has been encountered.
    (ancestor may be returned)
    @param node - Node to start at
    @param filter - Filter to use (see isNodeFilterMatch for types of filters)
    @param maxancestor - Node to stop at (no parent of the ancestor will be given back,
*/
export function findParent(node: Node, filter: NodeFilterFunction, maxancestor: Node) {
  for (; node; node = node.parentNode as Node) {
    if (isNodeFilterMatch(node, filter))
      return node;
    if (node === maxancestor)
      break;
  }
  return null;
}

/// Is the node transparent for content (must we iterate through them while scanning)
function isTransparentNode(node: Node) {
  const uname = node.nodeName.toUpperCase();

  const isIgnorable =
    ["TBODY", "COL", "COLGROUP", "TR", "TFOOT", "THEAD"].indexOf(uname) !== -1;

  return isIgnorable;
}

/// Returns whether a node is a block element
export function isNodeBlockElement(node: Node) {
  const uname = node.nodeName.toUpperCase();

  const isBlockElement =
    [
      'ADDRESS', 'BLOCKQUOTE', 'CENTER', 'CODE', 'DIV', 'DL', 'FIELDSET', 'FORM', 'H1',
      'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'ISINDEX', 'MENU', 'OL', 'P', 'PRE', 'TABLE', 'UL',
      //FIXME: the following tags must be treated as block elements too, make another func for that instead of misusing this one
      'DD', 'DT', 'FRAMESET', 'LI', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR'
    ].indexOf(uname) !== -1;

  return isBlockElement;
}

/// Returns whether a node is a block element that's always visible
function isNodeAlwaysVisibleBlockElement(node: Node) {
  const uname = node.nodeName.toUpperCase();

  // Look out, in FF LI is visible when empty, but not editable!
  const list =
    [
      'ADDRESS', 'BLOCKQUOTE'/*, 'CENTER', 'DIV'*/, 'DL', 'FIELDSET', 'FORM',/*, 'H1'*/
       /*'H2', 'H3', 'H4', 'H5', 'H6', 'HR', */'ISINDEX', 'MENU'/*, 'OL', 'P', 'PRE'*/, 'TABLE',/*, 'UL'*/
      //FIXME: the following tags must be treated as block elements too, make another func for that instead of misusing this one
      'DD', 'DT', 'FRAMESET', 'LI', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR'
    ];

  return list.indexOf(uname) !== -1;
}

/// Returns whether a node required a br when empty to make it visible (and editable for Firefox)
function doesNodeRequireFillingWhenEmpty(node: Node) {
  return doesNodeRequireInterchangeFillingWhenEmpty(node);
}


/// Returns whether a node is a block element that's always visible
function doesNodeRequireInterchangeFillingWhenEmpty(node: Node) {
  // LI is visible, but not editable in firefox when empty.
  const list =
    ['CENTER', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'P', 'LI'];

  const uname = node.nodeName.toUpperCase();
  return list.indexOf(uname) !== -1;
}

export function isEmbeddedObject(node: Node) {
  return testType(node, NodeType.element)
    && node.classList
    && node.classList.contains('wh-rtd-embeddedobject');
}

export function queryEmbeddedObjects(node: HTMLElement) {
  return dompack.qSA(node, '.wh-rtd-embeddedobject');
}

export function isNodeSplittable(node: Node) {
  if (node.nodeType !== 1)
    return true;
  if (isEmbeddedObject(node))
    return false;
  const uname = node.nodeName.toUpperCase();
  return uname !== 'BR'
    && uname !== 'AREA'
    && uname !== 'LINK'
    && uname !== 'IMG'
    && uname !== 'PARAM'
    && uname !== 'HR'
    && uname !== 'INPUT'
    && uname !== 'META'
    && uname !== 'COL'
    && uname !== 'SVG';
}

/** When locator points to segmentbreak (<br> or '\\r', '\\n'), see if the next position
    is a block boundary. If so, the break isn't visible (except on IE8 and lower)
    Assumes locator points at a real segment boundary.
*/
export function getInvisibleSegmentBreakRange(locator: Locator, maxancestor: Node) {
  const orglocator = locator;
  locator = locator.clone();

  // Might be a '\r\n' in white-space: pre (ADDME test if "\r""\n" would also work)
  if (!locator.parentIsElementOrFragmentNode && (locator.element.nodeValue || "").substring(locator.offset, locator.offset + 2) === '\r\n')
    locator.offset += 2;
  else
    ++locator.offset;
  const pastbreak = locator.clone();

  const res2 = locator.scanForward(maxancestor, { whitespace: true });
  if (res2.type === 'outerblock' || res2.type === 'innerblock')
    return new Range(orglocator, pastbreak);

  return null;
}

/** Get the range around the locator where the cursor would be displayed at the same visual position. <del>If placed
    after the last br in a blockon non-ie, autocorrected to range before br.</del>
    @returns
    \@cell return.valid Whether the cursor could be placed here
    \@cell return.down Downstream locator position
    \@cell return.downres scanBackward result for the downstream position
    \@cell return.up Upstream locator position
    \@cell return.upres scanForward result for the upstream position
*/
export function getVisualEquivalenceRangeInBlock(maxancestor: Node, locator: Locator, correctpastlastbr?: boolean) {
  /* Whitespace handling table: (inv: invalid, norm: normal, ign: ignore whitespace)
     inv* Invalid, ignore whitespace handling on IE

     UP:      outer outer/av inner br   visiblec
  DOWN:      +-----+--------+-----+----+--------+
    outer    |INV  |N/A     |INV  |IGN |IGN     |
    outer/av |N/A  |IGN     |INV  |IGN |IGN     |
    inner    |INV  |INV     |INV  |IGN |IGN     |
    br       |INV* |INV*    |INV* |IGN |IGN     |
    visiblec |IGN  |IGN     |IGN  |IGN |NORM    |
             +-----+--------+-----+----+--------+
  */

  const down = locator.clone();
  let downres = down.scanBackward(maxancestor, { whitespace: true });

  let up = locator.clone();
  let upres = up.scanForward(maxancestor, { whitespace: true });

  //console.log('gverib scanres', whitespacehandling, richdebug.getStructuredOuterHTML(maxancestor, { locator: locator, up: up, down: down }));

  // br before block isn't visible on non-IE browsers. Move to before BR.
  if (correctpastlastbr && downres.type === 'br' && upres.blockboundary) {
    --down.offset;
    up = down.clone();
    upres = downres;

    downres = down.scanForward(maxancestor, { whitespace: true });
  }

  // Determine the position in the table above
  let whitespacehandling;
  if (downres.visiblecontent)
    whitespacehandling = 'normal';
  else if (upres.visiblecontent || upres.type === 'br')
    whitespacehandling = 'ignore';
  else if (upres.type === 'outerblock' && upres.alwaysvisible && downres.type === 'outerblock' && downres.alwaysvisible)
    whitespacehandling = 'ignore';
  else
    whitespacehandling = 'invalid';

  //console.log('gverib ', whitespacehandling, richdebug.getStructuredOuterHTML(maxancestor, { locator: locator, up: up, down: down }));
  //console.log(downres, upres);

  const valid = whitespacehandling !== 'invalid';
  if (whitespacehandling === 'normal') {
    // Normal whitespace handling
    // xx       x<>x
    // x| x     x<> x
    // x |x     x <>x
    // x |x     x <>x
    // x|  x    x<>  x
    // x | x    x < >x
    // x  |x    x < >x
    // x|   x    x<>   x
    // x |  x    x <  >x
    // x  | x    x <  >x
    // x   |x    x <  >x

    // Locator that will point after first whitespace (x |  x), but only if it is left of current locator
    const lastfoundwhitespace = locator.clone();
    let lastfoundwhitespaceres = null;

    const downw = locator.clone();
    for (; ;) {
      const downwres = downw.scanBackward(maxancestor, {}); // stop at blocks & whitespace

      if (downwres.type === 'whitespace') {
        lastfoundwhitespace.assign(downw);
        lastfoundwhitespaceres = downwres;
        --downw.offset;
      } else
        break;
    }

    //console.log('verb within norm', richdebug.getStructuredOuterHTML(maxancestor, { locator: locator, up: up, down: down, lastfoundwhitespace: lastfoundwhitespace, downw: downw }));

    if (!lastfoundwhitespaceres) {
      // No whitespace before, can't ignore the whitespace after. Rescan.
      up.assign(down);
      upres = up.scanForward(maxancestor, {});
    } else {
      down.assign(lastfoundwhitespace);
      downres = lastfoundwhitespaceres;
    }
  }

  //console.log('gverb result, valid:', valid, richdebug.getStructuredOuterHTML(maxancestor, { locator: locator, up: up, down: down, lastfoundwhitespace: lastfoundwhitespace, downw: downw }));

  return { valid: valid, down: down, downres: downres, up: up, upres: upres, range: new Range(down, up) };
}

function getVisualEquivalenceRange(maxancestor: Node, locator: Locator) {
  //console.log('gver pre', richdebug.getStructuredOuterHTML(maxancestor, { locator: locator }));

  let elt: Node | null = locator.element;
  while (elt && elt !== maxancestor) {
    if (!isNodeSplittable(elt)) {
      const down = Locator.newPointingTo(elt);
      const up = Locator.newPointingAfter(elt);

      const res = {
        down,
        downres: down.scanBackward(maxancestor, { whitespace: true, blocks: true, li: true }),
        up,
        upres: up.scanForward(maxancestor, { whitespace: true, blocks: true, li: true }),
        range: new Range(down, up)
      };
      //console.log('gver unsplit res', richdebug.getStructuredOuterHTML(maxancestor, { locator: locator, locator: locator, down: res.down, up: res.up }));
      return res;
    }
    elt = elt.parentNode;
  }

  // Don't autocorrect <br>|<p>a to |<br><p>a, chrome does <br><p>|a in concordance with following rules.
  let res = getVisualEquivalenceRangeInBlock(maxancestor, locator, false);
  //console.log('gver imm res', richdebug.getStructuredOuterHTML(maxancestor, { locator: locator, locator: locator, down: res.down, up: res.up }));
  if (res.valid)
    return res;

  /* Between inner/outer block boundaries, there is no valid cursor position.

     It seems that chrome first searches forward in the current block element until visible content,
     then backwards in current block, then forwards over current document, then backwards over full
     document.

     If the downres type is a 'br', we must be in non-ie, but first need to look to the right. When looking
     downstream, we need to skip the <br>
  */

  // Skip downstream <br> if present
  if (res.downres.type === 'br')
    --res.down.offset;

  // Get the current block
  let block = findParent(locator.element, isNodeBlockElement, maxancestor) || maxancestor;

  for (let i = 0; i < 2; ++i) {
    // Scan upstream in the round 1: current block, round 2: entire document
    const upcopy = res.up.clone();
    /*var upres = */res.up.scanForward(block, { whitespace: true, blocks: true });

    if (!upcopy.equals(res.up)) {
      res = getVisualEquivalenceRangeInBlock(maxancestor, res.up, true);
      if (res.valid)
        return res;
    }

    // Scan upstream in the round 1: current block, round 2: entire document
    const downcopy = res.down.clone();
    /*var downres = */res.down.scanBackward(block, { whitespace: true, blocks: true });
    //console.log('gver downres', i, richdebug.getStructuredOuterHTML(maxancestor, { locator: locator, locator: locator, down: res.down, up: res.up, upcopy: upcopy, downres: downres }));

    if (!downcopy.equals(res.down) || i === 1) {
      res = getVisualEquivalenceRangeInBlock(maxancestor, res.down, true);
      if (res.valid || i === 1)
        return res;
    }

    // Early out
    if (block === maxancestor)
      break;

    block = maxancestor;
  }

  return getVisualEquivalenceRangeInBlock(maxancestor, res.up, true);
}

// ---------------------------------------------------------------------------
//
// Public API - DOM manipulation
//

/** Splits a data node at a locator, can keep other locators at the same position
    @param locator - Place to split the data node
    @param preservelocators - List of locators/ranges to keep valid.
    @param preservetoward - 'start' or 'end' (default: 'end') Direction to move preserved locators at the splitpoint
    @returns Locator pointing to new element
*/
export function splitDataNode(locator: Locator, preservelocators: PreservedLocatorList, preservetoward?: "start" | "end") {
  if (preservetoward && !['start', 'end'].includes(preservetoward))
    throw new Error("Illegal preservetoward value '" + preservetoward + "'");

  // Clone locator, so its presence in preservelocators won't mess up stuff during the applyPreserveFunc
  locator = locator.clone();

  const newnode = (locator.element as Text).splitText(locator.offset);

  // Correct preservelocators for the node split
  applyPreserveFunc(preservelocators, (tocorrect) => _correctForNodeSplit(locator, newnode, preservetoward === 'start', tocorrect));

  return Locator.newPointingTo(newnode);
}

/** Splits an element node at a locator, can keep other locators at the same position
    @param locator - Place to split the element node
    @param preservelocators - List of locators/ranges to keep valid.
    @param preservetoward - 'start' or 'end' (default: 'end') Direction to move preserved locators at the splitpoint
    @returns Locator pointing to new element
*/
export function splitElement(locator: Locator, preservelocators: PreservedLocatorList, preservetoward: "start" | "end") {
  if (preservetoward && !['start', 'end'].includes(preservetoward))
    throw new Error("Illegal preservetoward value '" + preservetoward + "'");

  // Clone locator, so its presence in preservelocators won't mess up stuff during the applyPreserveFunc
  locator = locator.clone();

  // Create result locator, point to element after locator.element
  const result = Locator.newPointingTo(locator.element);
  ++result.offset;

  // Create the new node, and insert it in the dom
  const newnode = locator.element.cloneNode(false);
  result.insertNode(newnode);

  // Move all nodes past locator to the new node
  const tocopy = Array.from(locator.element.childNodes).slice(locator.offset);
  (newnode as HTMLElement).append(...tocopy);

  // Correct preservelocators for the node split
  applyPreserveFunc(preservelocators, (tocorrect) => _correctForNodeSplit(locator, newnode, preservetoward === 'start', tocorrect));

  return result;
}

/** Corrects this locator for changes made when splitting a node
    @param splitlocator - Position where the split was made
    @param newnode - New node, that received the contents of the parent node after the split position.
*/
function _correctForNodeSplit(splitlocator: Locator, newnode: Node, towardstart: boolean, tocorrect: Locator) {

  //    console.log(' cfns', '$'+locator.id, locator.element, locator.offset, '$'+splitlocator.id, splitlocator.element, splitlocator.offset);
  if (tocorrect.element === splitlocator.element && (towardstart ? tocorrect.offset > splitlocator.offset : tocorrect.offset >= splitlocator.offset)) {
    // console.log(' move to new element');
    tocorrect.element = newnode;
    tocorrect.offset -= splitlocator.offset;
  } else if (tocorrect.element === splitlocator.element.parentNode && tocorrect.offset > getNodeIndex(splitlocator.element)) {
    // console.log(' move to nextsibling');
    // Correct for extra inserted node
    ++tocorrect.offset;
  }
}

/** Split the dom in-place beneath an ancestor node for a list of locators.
    For every split part, locators pointing to the start and the end of the fragment are provided
    (but only if the fragments had any elements)
    @param ancestor - Ancestor node
    @param splitpoints - Points to split the locators on
    \@cell splitpoints.locator
    \@cell splitpoints.toward 'start'/'end'
    @param preservelocators - Optional list of locators/ranges to preserve
    @returns Array of Range objects, describing the space betweent the splitpoints (all with parent = ancestor)
*/
export function splitDom(ancestor: Node, splitpoints: Array<{ locator: Locator; toward: "start" | "end"; preservetoward?: "start" | "end" }>, preservelocators: PreservedLocatorList) {
  if (!ancestor)
    throw new Error("No ancestor in splitdom!");

  //console.log('Splitdom pre ', ancestor, richdebug.getStructuredOuterHTML(ancestor, splitpoints));
  //console.log('Splitdom pre  preserve', richdebug.getStructuredOuterHTML(ancestor, preservelocators));

  if ([3, 4].includes(ancestor.nodeType))
    throw new Error("splitDom ancestor must be an element");

  // Copy the preservelocators array, we have some extra locators to preserve
  preservelocators = (preservelocators || []).slice();
  const resultlocators: Locator[] = [];

  // Move the splitpoints as far up to their ancestor as possible, to avoid unnecessary splits. Done in 2
  // steps because the initial ascend step influences the preservelocators.
  for (let i = 0; i < splitpoints.length; ++i) {
    const orglocator = splitpoints[i].locator;
    splitpoints[i].locator = splitpoints[i].locator.clone();

    // Move locator as far toward ancestor as possible, so we can avoid splitting off empty elements
    splitpoints[i].locator.ascend(ancestor, splitpoints[i].toward === 'end');

    const preservetoward = splitpoints[i].preservetoward = splitpoints[i].preservetoward || 'end';
    if (!['start', 'end'].includes(preservetoward))
      throw new Error("Illegal preservetoward value '" + preservetoward + "'");

    const cmp = splitpoints[i].locator.compare(orglocator);
    if (cmp < 0) {
      // Correct preservelocators for the node split
      applyPreserveFunc(preservelocators, (tocorrect) => _correctForSplitLocatorMove(splitpoints[i].locator, orglocator, preservetoward === 'start', splitpoints[i].locator, tocorrect));
      splitpoints[i].preservetoward = 'start';
    } else if (cmp > 0) {
      // Correct preservelocators for the node split
      applyPreserveFunc(preservelocators, (tocorrect) => _correctForSplitLocatorMove(orglocator, splitpoints[i].locator, preservetoward === 'end', splitpoints[i].locator, tocorrect));
      splitpoints[i].preservetoward = 'end';
    }
  }

  //console.log('Splitdom pre adj ', ancestor, richdebug.getStructuredOuterHTML(ancestor, splitpoints));
  //console.log('Splitdom pre adj preserve', richdebug.getStructuredOuterHTML(ancestor, preservelocators));

  /* Go from back to front, so the cloned nodes don't interfere with earlier locators
     The locators that point to the split parts are inserted into resultlocators
     (locators are formatted so that the element !== ancestor, to avoid invaliding offsets within
      the ancestor)
  */
  for (let i = splitpoints.length - 1; i >= 0; --i) {
    let locator = splitpoints[i].locator; // no clone needed anymore

    // Move locator as far toward ancestor as possible, so we can avoid splitting off empty elements
    locator.ascend(ancestor, splitpoints[i].toward === 'end');

    // Within a text node? Split the text node, and retarget the locator to the new element
    if (locator.element.nodeType === 3)
      locator = splitDataNode(locator, preservelocators, splitpoints[i].preservetoward);

    while (locator.element !== ancestor)
      locator = splitElement(locator, preservelocators, splitpoints[i].preservetoward as "start" | "end");

    // Add to beginning to keep in correct order
    resultlocators.splice(0, 0, locator);

    // And make sure it is preserved with further modifications
    preservelocators.push(locator);
  }

  // Add locators to start and end of ancestor
  resultlocators.splice(0, 0, new Locator(ancestor));
  resultlocators.push(new Locator(ancestor, "end"));

  // Calculate all ranges
  const result = [];
  for (let i = 0; i < resultlocators.length - 1; ++i)
    result.push(new Range(resultlocators[i], resultlocators[i + 1]));

  //console.log('Splitdom post preserve', richdebug.getStructuredOuterHTML(ancestor, preservelocators));
  //console.log('Splitdom post', richdebug.getStructuredOuterHTML(ancestor, result));

  return result;
}

/** Corrects this locator for the moving of the splitting locator upstream
    @param orglocator - Original splitting locator
    @param locator -
*/
function _correctForSplitLocatorMove(rangestart: Locator, rangeend: Locator, includebounds: boolean, newlocator: Locator, tocorrect: Locator) {
  if (tocorrect.compare(rangestart) > (includebounds ? -1 : 0) && tocorrect.compare(rangeend) < (includebounds ? 1 : 0))
    tocorrect.assign(newlocator);
}

/** Combines a node and its previous sibling (moves all childnodes from node into its previousSibling)
    and keeps a list of locators as close as possible to their original place
    @param node -
    @param preservelocators -
    @returns Place where stuff was inserted
*/
export function combineNodeWithPreviousNode(node: Node, preservelocators: PreservedLocatorList) {
  if (!node)
    throw new Error("Illegal parameter");

  const left = node.previousSibling;
  const right = node;

  if (!left)
    throw new Error("Node has no previous sibling to combine with");

  return combineNodes(new Locator(left, "end"), right, preservelocators);
}


/** Moves the contents of a node into a previous node at the specified position, keeps a list of locators
    as close as possible to their original place. Keeps a list of locators/ranges as close as possible to
    their original place (locators between the insert position and the moved content are repositioned to
    the insertposition)
    @param insertlocator -
    @param right -
    @param preservelocators -
    @returns Node & locator where stuff was inserted & locator after place where stuff was inserted
*/
export function combineNodes(insertlocator: Locator, right: Node, preservelocators: PreservedLocatorList) {
  insertlocator = insertlocator.clone();
  const left = insertlocator.element;

  if (left.nodeType !== right.nodeType || ![1, 3, 4].includes(left.nodeType))
    throw new Error("Left and right node not the same type (or no element or data node)");

  /* TODO: express in terms of moveRangeTo, so we can remove the insanely complicated correct code below.
    var range = Range.fromNodeInner(right);
    var res = moveRangeTo(range, insertlocator, preservelocators);

    var new_rightlocator = res.movedforward ? res.insertlocator : res.afterlocator;

    // Correct preservelocators for the node combine (before actual changes!)
    applyPreserveFunc(preservelocators, (tocorrect) => _correctForNodeCombine2(right, new_rightlocator, tocorrect));

    var locator = Locator.newPointingTo(right);
    locator.removeNode(preservelocators.concat([ res.insertlocator, res.afterlocator ]));

    return { node: left, locator: res.insertlocator, afterlocator: res.afterlocator };
  */

  //console.log('combineNodes pre: ', richdebug.getStructuredOuterHTML(left.ownerDocument, { insertlocator: insertlocator, range: Range.fromNodeInner(right) }, true));
  //console.log('combineNodes locators: ', richdebug.getStructuredOuterHTML(left.ownerDocument, preservelocators, true));
  //for (var i = 0; locators && i < locators.length; ++i)
  //  console.log(' ', locators[i].element, locators[i].offset);

  //var leftend = new Locator(left, "end");
  let rightptr = Locator.newPointingTo(right);
  const afterrightptr = Locator.newPointingAfter(right);

  let moveforward = false;
  if (afterrightptr.compare(insertlocator) <= 0)
    moveforward = true;
  else if (rightptr.compare(insertlocator) < 0)
    throw new Error("Can't move content inside removed node");

  // Correct preservelocators for the node combine (before actual changes!)
  applyPreserveFunc(preservelocators, (tocorrect) => _correctForNodeCombine(insertlocator, right, rightptr, afterrightptr, moveforward, tocorrect));

  const afterlocator = insertlocator.clone();
  if (left.nodeType === 1) {
    //var pointednode = insertlocator.getPointedNode();

    const nodes = removeNodeContents(right);
    insertNodesAtLocator(nodes, insertlocator);
    afterlocator.offset += nodes.length;
  } else {
    left.nodeValue = (left.nodeValue || "").substring(0, insertlocator.offset) + right.nodeValue + (left.nodeValue || "").substring(insertlocator.offset);
    afterlocator.offset += (right.nodeValue || "").length;
  }

  rightptr = Locator.newPointingTo(right);
  rightptr.removeNode([insertlocator, afterlocator]);

  return { node: left, locator: insertlocator, afterlocator: afterlocator };
}

/** Corrects this locator for changes made when combining a node. Called before actual changes are made!
    @param appendlocator - Place where childnodes of the removed node were placed
    @param newnode - New node, that received the contents of the parent node after the split position.
*/
function _correctForNodeCombine(insertlocator: Locator, removednode: Node, removedlocator: Locator, afterremovedlocator: Locator, moveforward: boolean, tocorrect: Locator) {
  // Correct the insert locator for removed node
  let corr_insertlocator = insertlocator;
  if (insertlocator.element === removedlocator.element && insertlocator.offset > removedlocator.offset) {
    corr_insertlocator = insertlocator.clone();
    --corr_insertlocator.offset;
  }

  if (tocorrect.element === removednode) {
    // Within the removed element? Adjust to new place relative to (corrected) insertlocator
    tocorrect.element = corr_insertlocator.element;
    tocorrect.offset += corr_insertlocator.offset;
    return;
  }

  // Within the removed nodes? No correction needed
  if (tocorrect.compare(removedlocator) > 0 && tocorrect.compare(afterremovedlocator) < 0)
    return;

  if (moveforward) {
    if (tocorrect.compare(afterremovedlocator) >= 0 && tocorrect.compare(insertlocator) <= 0) {
      tocorrect.assign(corr_insertlocator);
      tocorrect.offset += removednode.childNodes.length;
    } else if (tocorrect.element === insertlocator.element && tocorrect.offset >= insertlocator.offset) {
      const plus = tocorrect.offset - insertlocator.offset;
      tocorrect.assign(corr_insertlocator);
      tocorrect.offset += plus;
    } else if (tocorrect.element === removedlocator.element && tocorrect.offset > removedlocator.offset)
      --tocorrect.offset;
  } else {
    if (tocorrect.compare(removedlocator) <= 0 && tocorrect.compare(insertlocator) >= 0)
      tocorrect.assign(corr_insertlocator);
    else if (tocorrect.element === insertlocator.element && tocorrect.offset >= insertlocator.offset) {
      let plus = tocorrect.offset - insertlocator.offset;
      if (tocorrect.element === removedlocator.element && tocorrect.offset > removedlocator.offset)
        --plus;

      tocorrect.assign(corr_insertlocator);
      tocorrect.offset += plus + removednode.childNodes.length;
    } else if (tocorrect.element === removedlocator.element && tocorrect.offset > removedlocator.offset)
      --tocorrect.offset;
  }
}

export function moveSimpleRangeTo(range: Range, insertlocator: Locator, preservelocators: PreservedLocatorList) {
  if (range.start.element !== range.end.element)
    throw new Error("moveRangeTo can only move a range with the start and end element the same");

  const rangeisnode = range.start.parentIsElementOrFragmentNode();
  if (rangeisnode !== insertlocator.parentIsElementOrFragmentNode())
    throw new Error("moveRangeTo can only move nodes to within elements & data to within data nodes");

  // Clone all locators, don't want the preserve functions to mess with them
  insertlocator = insertlocator.clone();
  const startlocator = range.start.clone();
  const endlocator = range.end.clone();

  // Keep the original, possibly need to correct for the removal of the nodes if in the same parent.
  const orginsertlocator = insertlocator.clone();

  //console.log(range.start, range.end, insertlocator);

  //console.log('moveRangeTo pre: ', richdebug.getStructuredOuterHTML(Locator.findCommonAncestorElement(range.start, insertlocator), { insertlocator: insertlocator, range: range }, true));

  let moveforward = false;
  if (endlocator.compare(insertlocator) <= 0)
    moveforward = true;
  else if (startlocator.compare(insertlocator) < 0)
    throw new Error("Can't move content inside removed node");//#1" + richdebug.getStructuredOuterHTML(Locator.findCommonAncestorElement(range.start, insertlocator), { insertlocator: insertlocator, range: range })


  // Correct insertlocator if needed. May only be used after range has been removed from the DOM!!
  if (insertlocator.element === startlocator.element && insertlocator.offset >= endlocator.offset)
    insertlocator.offset -= endlocator.offset - startlocator.offset;

  //console.log('remove pre1', richdebug.getStructuredOuterHTML(Locator.findCommonAncestorElement(startlocator, insertlocator), { nodes: nodes, startlocator_element: startlocator.element }));

  //console.log('#1', startlocator.element, preservelocators.contains(startlocator));

  // Correct preservelocators for the node combine (before actual changes!)
  applyPreserveFunc(preservelocators, (tocorrect) => _correctForNodeMove(startlocator, endlocator, orginsertlocator, insertlocator, moveforward, tocorrect));

  //console.log('#2', startlocator.element);
  //console.log(nodes);
  //console.log('remove pre2', richdebug.getStructuredOuterHTML(Locator.findCommonAncestorElement(startlocator, insertlocator), { nodes: nodes, startlocator_element: startlocator.element }));

  // Need the afterlocator and the insertlocator too, so copy
  let afterlocator = insertlocator.clone();

  if (rangeisnode) {
    // Remove the nodes from the range. After this, the correct insertlocator is valid
    const nodes = Array.from(startlocator.element.childNodes).slice(startlocator.offset, endlocator.offset);

    afterlocator = removeAndInsertNodesAtLocator(nodes, afterlocator);
  } else {
    // Move data over from the original location to the new location
    const oldnode = startlocator.element;
    const newnode = insertlocator.element; // may be the same as oldnode!

    // First get the data to move, and remove it. Only after that, insertlocator is valid.
    const tomove = (oldnode.nodeValue || "").substring(startlocator.offset, endlocator.offset);
    oldnode.nodeValue = (oldnode.nodeValue || "").substring(0, startlocator.offset) + (oldnode.nodeValue || "").substring(endlocator.offset);

    // insertlocator is now valid. Insert the data, adjust the afterlocator
    newnode.nodeValue = (newnode.nodeValue || "").substring(0, insertlocator.offset) + tomove + (newnode.nodeValue || "").substring(insertlocator.offset);
    afterlocator.offset += tomove.length;
  }

  return { insertlocator: insertlocator, afterlocator: afterlocator, movedforward: moveforward };
}

function _correctForNodeMove(startlocator: Locator, endlocator: Locator, insertlocator: Locator, corr_insertlocator: Locator, moveforward: boolean, tocorrect: Locator) {
  if (tocorrect.element === startlocator.element) {
    // Between any of the moved nodes? Move to (corrected) insertlocator
    if (tocorrect.offset > startlocator.offset && tocorrect.offset < endlocator.offset) {
      //console.log(' between moved nodes');
      tocorrect.element = corr_insertlocator.element;
      tocorrect.offset = corr_insertlocator.offset + (tocorrect.offset - startlocator.offset);
      return;
    }
  }

  const startcompare = tocorrect.compare(startlocator);
  const endcompare = tocorrect.compare(endlocator);

  if (startcompare > 0 && endcompare < 0) {
    //console.log(' inside moved nodes');
    return; // Within the removed nodes? No correction needed
  }

  // Between the moved nodes and the insertposition? Move to start/end of newly inserted nodes
  if (moveforward) {
    if (endcompare >= 0 && tocorrect.compare(insertlocator) <= 0) {
      //console.log(' forward, between end and insertpoint');
      tocorrect.element = corr_insertlocator.element;
      tocorrect.offset = corr_insertlocator.offset + (endlocator.offset - startlocator.offset);
      return;
    }
  } else {
    if (startcompare <= 0 && tocorrect.compare(insertlocator) >= 0) {
      //console.log(' backward, between insertpoint and start');
      tocorrect.assign(corr_insertlocator);
      return;
    }
  }

  if (startlocator.element === insertlocator.element) {
    //console.log(' start.elt=insert.elt, no correction needed');
    return;
  }

  if (tocorrect.element === insertlocator.element) {
    if (tocorrect.offset > insertlocator.offset) {
      //console.log(' after inserted nodes', tocorrect.offset, insertlocator.offset, corr_insertlocator.offset);
      tocorrect.offset = corr_insertlocator.offset + (tocorrect.offset - insertlocator.offset) + (endlocator.offset - startlocator.offset);
      return;
    }
  } else if (tocorrect.element === endlocator.element) {
    if (tocorrect.offset >= endlocator.offset) {
      //console.log(' after removed nodes');
      tocorrect.offset -= endlocator.offset - startlocator.offset;
      return;
    }
  }
  //console.log(' no correction needed');
}

export function removeSimpleRange(range: Range, preservelocators: PreservedLocatorList) {
  if (range.start.element !== range.end.element)
    throw new Error("removeRange can only remove a range with the start and end element the same");

  range = range.clone();

  const rangeisnode = range.start.parentIsElementOrFragmentNode();

  // Correct preservelocators for the node combine (before actual changes!)
  applyPreserveFunc(preservelocators, (tocorrect) => _correctForRangeRemove(range, tocorrect));

  const fragment = document.createDocumentFragment();
  if (rangeisnode) {
    // Remove the nodes from the range
    const nodes = Array.from(range.start.element.childNodes).slice(range.start.offset, range.end.offset);
    for (let i = 0; i < nodes.length; ++i)
      fragment.appendChild(nodes[i]);
  } else {
    // Just remove the data
    const oldnode = range.start.element;
    const tomove = (oldnode.nodeValue || "").substring(range.start.offset, range.end.offset);
    oldnode.nodeValue = (oldnode.nodeValue || "").substr(0, range.start.offset) + (oldnode.nodeValue || "").substr(range.end.offset);
    fragment.appendChild(document.createTextNode(tomove));
  }

  return { fragment: fragment };
}

function _correctForRangeRemove(range: Range, tocorrect: Locator) {
  if (tocorrect.element === range.end.element && tocorrect.offset >= range.end.offset)
    tocorrect.offset -= range.end.offset - range.start.offset;
  else if (tocorrect.compare(range.start) > 0 && tocorrect.compare(range.end) < 0)
    tocorrect.assign(range.start);
}

/** Replaces a node with its contents
*/
export function replaceSingleNodeWithItsContents(node: Node, preservelocators: PreservedLocatorList) {
  //var parent = node.parentNode;

  //    console.log('RNWIC pre ', richdebug.getStructuredOuterHTML(parent, preservelocators));
  const locator = Locator.newPointingTo(node);

  const nodes = removeNodeContents(node);
  insertNodesAtLocator(nodes, locator);

  const nodelocator = Locator.newPointingTo(node);
  nodelocator.removeNode();

  // Correct preservelocators for the node combine
  applyPreserveFunc(preservelocators, (tocorrect) => _correctForReplaceWithChildren(locator, node, nodes.length, tocorrect));
  //    console.log('RNWIC post', richdebug.getStructuredOuterHTML(parent, preservelocators));
}

/** Corrects the range for changes made when a node is replaced with its contents
    @param locator - Locator of the removed node
    @param endlocator - Locator of the end of inserted children (locator.element === endlocator.element)
    @param removednode - Removed node
*/
function _correctForReplaceWithChildren(locator: Locator, removednode: Node, childcount: number, tocorrect: Locator) {
  if (tocorrect.element === removednode) { // Within the removed element? Adjust to new place within old element
    tocorrect.element = locator.element;
    tocorrect.offset += locator.offset;
  } else if (tocorrect.element === locator.element && tocorrect.offset > locator.offset) {
    // Points to node that's nextsibling of right. Correct for right's removal, and the children insert
    tocorrect.offset = tocorrect.offset - 1 + childcount;
  }
}

/** Wraps the nodes point to by locator (and nodecount-1 of its siblings) in a new node, that is then
    inserted at that location
    @param Locator - Locator pointing to node to wrap
    @param nodecount - Nr of nodes to wrap
    @param newnode - Node to replace the nodes with
    @param preservelocators - Locators/ranges to preserve
*/
export function wrapSimpleRangeInNewNode(range: Range, newnode: Node, preservelocators: PreservedLocatorList) {
  if (range.start.element !== range.end.element)
    throw new Error("wrapSimpleRangeInNewNode only works with ranges where start element is equal to end element");

  // Preserve range too
  preservelocators = (preservelocators || []).concat(range);
  return wrapNodesInNewNode(range.start, range.end.offset - range.start.offset, newnode, preservelocators);
}


/** Wraps the nodes point to by locator (and nodecount-1 of its siblings) in a new node, that is then
    inserted at that location
    @param Locator - Locator pointing to node to wrap
    @param nodecount - Nr of nodes to wrap
    @param newnode - Node to replace the nodes with
    @param preservelocators - Locators/ranges to preserver
*/
export function wrapNodesInNewNode(locator: Locator, nodecount: number, newnode: Node, preservelocators: PreservedLocatorList) {
  //console.log('WNINN pre', richdebug.getStructuredOuterHTML(locator.element, preservelocators, true), newnode);

  // Clone locator, so its presence in preservelocators won't mess up stuff during the applyPreserveFunc
  locator = locator.clone();

  const nodes = Array.from(locator.element.childNodes).slice(locator.offset, locator.offset + nodecount);
  (newnode as HTMLElement).append(...nodes);

  locator.insertNode(newnode);

  // Correct preservelocators for the node split
  applyPreserveFunc(preservelocators, (tocorrect) => _correctForNodeWrap(locator, nodecount, newnode, tocorrect));

  //console.log('WNINN post', richdebug.getStructuredOuterHTML(locator.element, preservelocators, true));

  ++locator.offset;
  return locator;
}

function _correctForNodeWrap(locator: Locator, childcount: number, newnode: Node, tocorrect: Locator) {
  if (tocorrect.element === locator.element) {
    if (tocorrect.offset >= locator.offset) {
      if (tocorrect.offset <= locator.offset + childcount) {
        tocorrect.element = newnode;
        tocorrect.offset -= locator.offset;
      } else
        tocorrect.offset = tocorrect.offset - childcount + 1;
    }
  }
}

/** Removes all nodes in a tree that match a filter
*/
export function removeNodesFromTree(node: Node, filter: NodeFilterFunction, preservelocators: PreservedLocatorList) {
  // FIXME: combine adjacesnt same (text)nodes
  for (let i = 0; i < node.childNodes.length;) {
    const child = node.childNodes[i];
    if (isNodeFilterMatch(child, filter))
      replaceSingleNodeWithItsContents(child, preservelocators);
    else {
      removeNodesFromTree(child, filter, preservelocators);
      ++i;
    }
  }
}

/** Removes nodes from a range, when the nodes to remove have already been split on the range
    boundaries
    @param ancestor - Ancestor to start at
    @param range - Range to remove nodes
    @param filter - Filter function to test the nodes on, or nodename
    @param preservelocators - Locators/ranges to preserver
*/
function removeNodesFromRangeRecursiveInternal(ancestor: Node, range: Range, filter: NodeFilterFunction, preservelocators: PreservedLocatorList) {
  // FIXME: combine adjacesnt same (text)nodes

  const xstart = range.start.clone();
  xstart.ascend(ancestor, false, true);
  const xend = range.end.clone();
  xend.ascend(ancestor, true, true);

  //console.log('RNFRR local', richdebug.getStructuredOuterHTML(ancestor, {xend:xend,xstart:xstart}));

  preservelocators = (preservelocators || []).slice();
  preservelocators.push(xend);

  while (!xstart.equals(xend)) {
    // console.log(xstart.element, xstart.offset, xend.element, xend.offset);
    const node = xstart.getPointedNode();
    if (!node)
      throw new Error(`Could not find pointed to node`);

    // Skip data nodes
    if ([3, 4].includes(node.nodeType)) {
      ++xstart.offset;
      continue;
    }

    if (isNodeFilterMatch(node, filter))
      replaceSingleNodeWithItsContents(node, preservelocators);
    else {
      const noderange = Range.fromNodeInner(node);
      const subrange = range.clone();
      subrange.intersect(noderange);

      if (subrange.equals(noderange))
        removeNodesFromTree(node, filter, preservelocators);
      else
        removeNodesFromRangeRecursiveInternal(node, subrange, filter, preservelocators);
      ++xstart.offset;
    }
  }

  //console.log('RNFRR end', richdebug.getStructuredOuterHTML(ancestor));
}

/** Removes nodes that match a filter from a tree (but keeps their contents)
    @param range - Range to remove the nodes from (is kept valid)
    @param maxancestor - Ancestor to stop at
    @param filter - Filter for nodes to remove (either string for nodename match or function)
    @param preservelocators - Additional locators/ranges to preserve
*/
export function removeNodesFromRange(range: Range, maxancestor: Node, filter: NodeFilterFunction, preservelocators: PreservedLocatorList) {
  preservelocators = (preservelocators || []).slice();
  preservelocators.push(range);

  let ancestor;

  // console.log('RNFR start', richdebug.getStructuredOuterHTML(maxancestor, range));

  // Is an ancestor of the range a match? If so, split the dom around the range and remove the node.
  for (; ;) {
    ancestor = range.getAncestorElement();
    const typeparent = findParent(ancestor, filter, maxancestor);

    if (!typeparent || typeparent === maxancestor || !typeparent.parentNode)
      break;

    //      console.log('splitdom for ancestor! ' + xcount);
    //      console.log('A locations ', richdebug.getStructuredOuterHTML(maxancestor, {ancestor:ancestor,typeparent: typeparent,range:range}));

    //      console.log('A split pre ', richdebug.getStructuredOuterHTML(typeparent.parentNode, {ancestor:ancestor,typeparent: typeparent,range:range}));
    const parts = splitDom(typeparent.parentNode, [{ locator: range.start, toward: 'start' }, { locator: range.end, toward: 'end' }], preservelocators);
    //      console.log('A split post', richdebug.getStructuredOuterHTML(typeparent.parentNode, {typeparent: typeparent,range:range}));
    //      console.log('A split post2', richdebug.getStructuredOuterHTML(typeparent.parentNode, parts));

    const locator = parts[1].start.clone();

    const localpreserve = preservelocators.concat([locator, parts[1].end]);

    while (!locator.equals(parts[1].end)) {
      const node = locator.getPointedNode();
      if (!node)
        throw new Error(`Could not find pointed to node`);
      //        console.log('A replace pre', richdebug.getStructuredOuterHTML(typeparent.parentNode, {node:node, locator:locator}));
      ++locator.offset;
      replaceSingleNodeWithItsContents(node, localpreserve);
      //        console.log('A replace post', richdebug.getStructuredOuterHTML(typeparent.parentNode, {node:node, locator:locator}));
    }

    //
    range.start.assign(parts[1].start.clone());
    range.end.assign(locator);

    //      console.log('ancestor splitdom done', richdebug.getStructuredOuterHTML(typeparent.parentNode, {typeparent: typeparent,range:range}));
  }

  //
  for (; ;) {
    const typeparent = findParent(range.start.element, filter, ancestor);
    if (!typeparent)
      break;

    //      console.log('L split pre ', richdebug.getStructuredOuterHTML(typeparent.parentNode, orglocators));
    const parts = splitDom(typeparent.parentNode as Node, [{ locator: range.start, toward: 'start' }], preservelocators);
    //      console.log('L split post', richdebug.getStructuredOuterHTML(typeparent.parentNode, orglocators));
    range.start.assign(parts[1].start);
  }

  for (; ;) {
    const typeparent = findParent(range.end.element, filter, ancestor);
    if (!typeparent)
      break;

    //      console.log('R split pre ', richdebug.getStructuredOuterHTML(typeparent.parentNode, orglocators));
    const parts = splitDom(typeparent.parentNode as Node, [{ locator: range.end, toward: 'end' }], preservelocators);
    //      console.log('R split post', richdebug.getStructuredOuterHTML(typeparent.parentNode, orglocators));
    range.end.assign(parts[0].end);
  }

  removeNodesFromRangeRecursiveInternal(ancestor, range, filter, preservelocators);

  // console.log('RNFR done', richdebug.getStructuredOuterHTML(maxancestor, range));
}

function canWrapNode(node: HTMLElement, canwrapnodefunc: ((node: HTMLElement) => boolean) | undefined) {
  return (!canwrapnodefunc || canwrapnodefunc(node));
}

function getWrappingSplitRoot(locator: Locator, ancestor: Node, canwrapnodefunc: ((node: HTMLElement) => boolean) | undefined) {
  let node = locator.element;
  if ([3, 4].includes(node.nodeType)) //3=Text node, 4=CDATA
    node = node.parentNode as Node;
  while (node !== ancestor && canWrapNode(node as HTMLElement, canwrapnodefunc))
    node = node.parentNode as Node;
  return node;
}

function wrapRangeRecursiveInternal(range: Range, ancestor: Node, createnodefunc: () => HTMLElement, preservelocators: PreservedLocatorList, options?: BaseWrapRangeOptions) {
  //    console.log('WRRI start', richdebug.getStructuredOuterHTML(ancestor, range));

  // Get the range of nodes we need to visit in the current ancestor
  const localrange = range.clone();
  localrange.start.ascend(ancestor, false, true);
  localrange.end.ascend(ancestor, true, true);

  //    console.log('WRRI local', richdebug.getStructuredOuterHTML(ancestor, localrange));

  // Make sure localrange.end is preserved!!!
  preservelocators = (preservelocators || []).slice();
  preservelocators.push(localrange.end);

  /* Iterate through the nodes. Collect wrappable nodes, wrap them when first unwrappable node
     is encountered, or after end of range. Iterate into unwrappable nodes
  */
  const wrapstart = localrange.start.clone();
  while (!localrange.start.equals(localrange.end)) {
    // Text node or wrappable: goto next sibling
    const node = localrange.start.getPointedNode();
    if (!node)
      throw new Error(`Could not find pointed to node`);
    if ([3, 4].includes(node.nodeType) || canWrapNode(node as HTMLElement, options?.onCanWrapNode)) {
      ++localrange.start.offset;
      continue;
    }

    // Current node is unwrappable. Wrap previous wrappebles (if present)
    if (!wrapstart.equals(localrange.start)) {
      const newnode = createnodefunc();
      // console.log('call wninn1', preservelocators);
      wrapNodesInNewNode(wrapstart, localrange.start.offset - wrapstart.offset, newnode, preservelocators);
      ++wrapstart.offset;
    }

    // Calculate subrange within node for iteration (localrange.constrainto(node)?)
    const noderange = Range.fromNodeInner(node);
    const subrange = range.clone();
    subrange.intersect(noderange);

    if (!options?.onAllowIn || options?.onAllowIn(node as HTMLElement)) {
      // Iterate into the node, and reset the start if the first wrappable node
      wrapRangeRecursiveInternal(subrange, node, createnodefunc, preservelocators, options);
    }

    ++wrapstart.offset;
    localrange.start.assign(wrapstart);
  }

  // Wrap previous wrappebles (if present)
  if (!wrapstart.equals(localrange.start)) {
    const newnode = createnodefunc();
    // console.log('call wninn2', preservelocators);
    wrapNodesInNewNode(wrapstart, localrange.start.offset - wrapstart.offset, newnode, preservelocators);
  }

  //    console.log('WRRI end', richdebug.getStructuredOuterHTML(ancestor));
}

export function wrapRange(range: Range, createnodefunc: () => HTMLElement, options?: WrapRangeOptions): void {
  //    console.log('wrapRange', range, createnodefunc, canwrapnodefunc, mustwrapnodefunc, preservelocators);

  // Make sure range is preserved too
  const preservelocators = [...(options?.preserveLocators || []), range];

  range = range.clone();
  //    range.descendToLeafNodes();

  //    console.log('WR going split0', richdebug.getStructuredOuterHTML(range.getAncestor() || range.start.element.ownerDocument, { loc: range.start }));
  const ancestor = range.getAncestorElement();

  //    console.log('WR before presplits', richdebug.getStructuredOuterHTML(ancestor, range));

  //    console.log('WR going split1', richdebug.getStructuredOuterHTML(ancestor, { loc: range.start }));
  const startroot = getWrappingSplitRoot(range.start, ancestor, options?.onCanWrapNode);

  //    console.log('WR startroot', richdebug.getStructuredOuterHTML(ancestor, {startroot:startroot}));

  //    console.log('WR going split2', richdebug.getStructuredOuterHTML(startroot, { loc: range.start }));
  let parts = splitDom(startroot, [{ locator: range.start, toward: "end" }], preservelocators.concat([range.end]));

  //    console.log('WR after start split', richdebug.getStructuredOuterHTML(ancestor, parts));

  range.start.assign(parts[1].start);

  //    console.log('WR presplit', richdebug.getStructuredOuterHTML(ancestor, {endroot:endroot, range: range}));
  const endroot = getWrappingSplitRoot(range.end, ancestor, options?.onCanWrapNode);

  parts = splitDom(endroot, [{ locator: range.end, toward: "start" }], preservelocators.concat([range.start]));

  range.end.assign(parts[0].end);

  //    console.log('WR after presplits', richdebug.getStructuredOuterHTML(ancestor, range));

  wrapRangeRecursiveInternal(range, ancestor, createnodefunc, preservelocators, options);
}

/** Combines adjacent nodes of with each other at a locator recursively
    @param locator - Locator to the place to combine the nodes
    @param ancestor - Ancestor node
    @param towardsend - Direction to go (used when locator is placed within empty node)
    @param combinetest - Test to check whether nodes. Can be nodeName, array of nodeNames or bool function. If false,
        only text nodes will be combined.
    @param preservelocators - Locators/ranges to preserve the location of
 */
export function combineWithPreviousNodesAtLocator(locator: Locator, ancestor: Node, towardsend: boolean, combinetest: string | string[] | ((left: Node, right: Node) => boolean), preservelocators: PreservedLocatorList) {
  if (!ancestor.contains(locator.element))
    throw new Error("Locator position problem");

  preservelocators = (preservelocators || []).slice();
  preservelocators.push(locator);

  locator = locator.clone();
  locator.ascend(ancestor, towardsend, false);

  while (locator.offset !== 0) {
    if (!locator.parentIsElementOrFragmentNode() || locator.pointsPastChildrenEnd())
      break;

    //      console.log(locator.element, locator.offset);

    const right = locator.getPointedNode();
    if (!right)
      throw new Error(`Could not find pointed to node`);
    const left = right.previousSibling as Node;

    if (right.nodeType !== left.nodeType)
      break;

    // Always combine text/cdata nodes
    if (![3, 4].includes(right.nodeType)) {
      if (right.nodeType !== 1)
        break;

      if (typeof combinetest === "function") {
        if (!combinetest(left, right))
          return;
      } else if (combinetest) {
        if (left.nodeName.toLowerCase() !== right.nodeName.toLowerCase())
          break;
        if (typeof combinetest === "string") {
          if (left.nodeName.toLowerCase() !== combinetest.toLowerCase())
            break;
        } else if (Array.isArray(combinetest)) {
          if (!combinetest.includes(left.nodeName.toLowerCase()))
            break;
        } else
          throw new Error("Illegal combinetest in combineWithPreviousNodesAtLocator");
      } else
        break;
    }

    const res = combineNodeWithPreviousNode(right, preservelocators);
    locator = res.locator;
  }
}

export function hasNodeVisibleContent(node: Node) {
  if (isNodeAlwaysVisibleBlockElement(node))
    return true;

  const locator = new Locator(node);
  const res = locator.scanForward(node, { whitespace: true });
  return res.type !== 'outerblock';
}

/** Make sure the content before the locator (and the block itself) is visible. If the next item is
    a superfluous block filler, it is removed
*/
function correctBlockFillerUse(locator: Locator, block: Node, preservelocators: PreservedLocatorList) {
  const down = locator.clone();
  let downres = down.scanBackward(block, { whitespace: true });

  //console.log('correctBlockFillerUse', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down }));

  // If downres is a br, there is visible content (block not empty), and a br is needed when
  // upstream is a block boundary (inner block or outer block)
  if (downres.type === 'br' || (downres.type === "node" && downres.data.classList.contains("wh-rtd-embeddedobject--inline"))) {
    const up = locator.clone();
    const upres = up.scanForward(block, { whitespace: true });

    //console.log(' found br', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, up: up }));

    // Blockboundaries merge with previous segment boundaries. Add one.
    if (upres.blockboundary) {
      const node = document.createElement('br');
      node.setAttribute('data-wh-rte', 'bogus');
      up.insertNode(node, preservelocators);
      //console.log(' inserted br', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, up: up }));
      return { locator: up, node: node };
    }

    // Otherwise we're ok
    return null;
  }

  // Now, we only need to worry about the block being empty.
  downres = down.scanBackward(block, { whitespace: true, blocks: true });
  if (downres.type === 'outerblock' && downres.data === block && doesNodeRequireFillingWhenEmpty(block)) {
    //console.log(' found outerblock', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, up: up }));

    const up = locator.clone();
    const upres = up.scanForward(block, { whitespace: true, blocks: true });

    if (upres.type === 'outerblock' && upres.data === block) {
      //console.log(' found outerblock both sides', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, up: up }));

      const node = document.createElement('br');
      node.setAttribute('data-wh-rte', 'bogus');
      up.insertNode(node, preservelocators);

      //console.log(' inserted br', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, up: up }));
      return { locator: up, node: node };
    }
  } else {
    // There is stuff that makes the block visible. Filler br is not needed, see if there is one
    const up = locator.clone();
    let upres = up.scanForward(block, { whitespace: true, blocks: true });

    //console.log(' got down visible', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, up: up }));

    if (upres.type === 'br') {
      // Save it's location, see if it's really a filler
      const firstbr = up.clone();
      ++up.offset;

      upres = up.scanForward(block, { whitespace: true, blocks: true });
      if (upres.type === 'outerblock' && upres.data === block) {
        firstbr.removeNode(preservelocators);
        //console.log(' removed br', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, firstbr: firstbr }));
      }
    }
  }

  return null;
}

/** Make sure there is visible content in the current block after the locator
    If not, a 'br' is inserted.
    @param locator - Locator within block
    @param maxancestor - Block node
    @param preservelocators - Locators to preserver
*/
export function requireVisibleContentInBlockAfterLocator(locator: Locator, maxancestor: Node, preservelocators: PreservedLocatorList) {
  return correctBlockFillerUse(locator, maxancestor, preservelocators);
}

/** Cleanup the bogus breaks that aren't needed anymore
    @param node - Node to test the children of
    @param preservelocators - Locators to preserver
*/
export function cleanupBogusBreaks(node: HTMLElement, preservelocators: PreservedLocatorList) {
  const breaks = node.querySelectorAll(`br[data-wh-rte="bogus"]`);
  for (const breaknode of breaks) {
    const brlocator = Locator.newPointingTo(breaknode);
    const downres = brlocator.clone().scanBackward(node, { whitespace: true });
    if ((downres.type === 'br' && !downres.bogussegmentbreak) || (downres.type === "outerblock") || (downres.type === "innerblock") || (downres.type === "node" && downres.data.classList.contains("wh-rtd-embeddedobject--inline")))
      continue;

    brlocator.removeNode(preservelocators);
  }
}

/// Removes nodes from the DOM
function removeNodes(nodes: Node[]) {
  for (let i = 0; i < nodes.length; ++i) {
    const parentNode = nodes[i].parentNode;
    if (parentNode)
      parentNode.removeChild(nodes[i]);
  }
}

/// Removes all nodes from the dom, then inserts them at locator. Make sure locator is valid after removal of the nodes!
function removeAndInsertNodesAtLocator(nodes: Node[], locator: Locator) {
  removeNodes(nodes);
  return insertNodesAtLocator(nodes, locator);
}

/** Inserts nodes at a new location. undo only works if the items don't need to be restored to their
    original position!
*/
export function insertNodesAtLocator(nodes: Node[], locator: Locator, preservelocators?: PreservedLocatorList) {
  let insertpos = locator.clone();
  for (let i = 0; i < nodes.length; ++i)
    insertpos = insertpos.insertNode(nodes[i], preservelocators);

  return insertpos;
}

export function removeNodeContents(node: Node) {
  /* Copy childNodes, then remove those from the dom. Must do it that way,
     because FF invents <br _moz_editor_bogus_node="TRUE"> when removing them one by one
  */
  const nodes: Node[] = Array.from(node.childNodes);
  nodes.forEach(child => node.removeChild(child));

  return nodes;
}

export function combineAdjacentTextNodes(locator: Locator, preservelocators: PreservedLocatorList) {
  const xlocator = locator;
  const orglocator = locator.clone();
  preservelocators = (preservelocators || []).concat([orglocator]);
  orglocator.descendToLeafNode(locator.element, false);

  if ([3, 4].includes(locator.element.nodeType))
    locator.assign(Locator.newPointingTo(locator.element));
  let pointednode = locator.getPointedNode();
  if (!pointednode || ![3, 4].includes(pointednode.nodeType)) {
    console.log(xlocator, orglocator, locator);
    throw new Error("Locator does not point to a text node");
  }

  for (; ;) {
    const prev: Node | null = pointednode.previousSibling;
    if (!prev || ![3, 4].includes(prev.nodeType))
      break;
    pointednode = prev;
  }

  for (; ;) {
    const next = pointednode.nextSibling;
    if (!next || ![3, 4].includes(next.nodeType))
      break;

    const insertlocator = new Locator(pointednode, "end");
    combineNodes(insertlocator, next, preservelocators);
  }

  return orglocator;
}

/** Given a locator that points inside a text node, the whitespaces/nbsps after the locator are rewritten
    to prevent whitespace collapsing and superfluous nbsps
*/
export function rewriteWhitespace(maxancestor: Node, locator: Locator, preservelocators: PreservedLocatorList) {
  const orglocator = locator.clone();
  preservelocators = (preservelocators || []).concat(orglocator);

  const elt = locator.element;
  const oldvalue = elt.nodeValue;

  if (![3, 4].includes(elt.nodeType))
    throw new Error("Locator does not point inside a text node");

  let newvalue = elt.nodeValue || "";

  // Determine whether the last character was whitespace. Treat start of parent as whitespace (want <b>"\u00a0content"</b>)
  let prev_whitespace = locator.offset === 0 || ' \t\r\n'.indexOf(newvalue.substr(locator.offset - 1, 1)) !== -1;

  while (locator.offset < newvalue.length) {
    // get the number of whitespace characters following the current locator
    let whitespaces = 0;
    while (locator.offset + whitespaces < newvalue.length && ' \t\r\n'.indexOf(newvalue.substr(locator.offset + whitespaces, 1)) !== -1)
      ++whitespaces;

    // get the characters we'll look at (1 character if not whitespace). Done if not whitespace or nbsp
    const part = newvalue.substr(locator.offset, whitespaces || 1);
    if (!whitespaces && part !== "\u00a0")
      break;

    // calc the stuff we'll replace the part with, and the new nodevale
    const newpart = prev_whitespace ? "\u00a0" : " ";
    const restoffset = locator.offset + part.length;
    newvalue = newvalue.substr(0, locator.offset) + newpart + newvalue.substr(locator.offset + part.length);
    const newoffset = locator.offset + newpart.length;

    // correct all preserved locators
    applyPreserveFunc(preservelocators, (tocorrect) => {
      if (tocorrect.element === locator.element && tocorrect.offset > locator.offset) {
        if (tocorrect.offset >= restoffset)
          tocorrect.offset += newpart.length - part.length;
        else
          tocorrect.offset = newoffset;
      }
    });

    // whitespace alternates betwen ' ' and nbsp
    prev_whitespace = !prev_whitespace;
    locator.offset = newoffset;
  }

  if (prev_whitespace) {
    // previous was whitespace, see if next is also whitespace (non-character, like br or block breaks)
    // if so, replace the previous with nbsp
    const scanres = locator.clone().scanForward(maxancestor, { whitespace: true });
    if (["innerblock", "outerblock", "br"].includes(scanres.type))
      newvalue = newvalue.substr(0, locator.offset - 1) + "\u00a0" + newvalue.substr(locator.offset);
  }

  // apply changes if needed, record undo
  if (oldvalue !== newvalue) {
    elt.nodeValue = newvalue;
  }

  return orglocator;
}

// ---------------------------------------------------------------------------
//
// Locator (points to a specific place in the DOM)
//

interface ScanIgnoreOptions {
  whitespace?: boolean;
  li?: boolean;
  blocks?: boolean;
  alwaysvisibleblocks?: boolean;
}

type ScanResult = ({
  type: "whitespace" | "char";
  data: string;
  visiblecontent: boolean;
} | {
  type: "outerblock";
  data: Node;
  blockboundary: boolean;
  segmentbreak: boolean;
  alwaysvisible: boolean;
} | {
  type: "innerblock";
  data: Node;
  blockboundary: boolean;
  segmentbreak: boolean;
} | {
  type: "br";
  data: Node;
  segmentbreak: boolean;
  bogussegmentbreak: boolean;
} | {
  type: "node";
  data: HTMLElement;
  visiblecontent: boolean;
}) & {
  blockboundary?: boolean;
  visiblecontent?: boolean;
};

export class Locator {
  element: Node;
  offset: number;

  constructor(element: Node, offset?: "end" | number) {
    if (!element)
      throw new Error("No valid element in locator initialize");

    // Element (may be a element or a text node)
    this.element = element;
    // Offset within childNodes(elements) of nodeValue(text/cdata). May be equal to childNodes.length/nodeValue.length!
    this.offset = offset === 'end' ? getNodeChildCount(element) : offset || 0;
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  getMaxChildOffset(element: Node) {
    if (testType(element, [NodeType.element, NodeType.documentFragment]))
      return element.childNodes.length; // for element nodes, document fragments, etc
    else
      return element.nodeValue ? element.nodeValue.length : 0; // for text nodes
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  /// Set the locator object
  set(element: Node, offset: number | "end") {
    if (!element) throw new Error("No valid element in locator set");
    this.element = element;
    if (offset === 'end')
      this.offset = this.getMaxChildOffset(element);
    else
      this.offset = offset || 0;
  }

  /// Clones a locator object
  clone() {
    return new Locator(this.element, this.offset);
  }

  /// Assigns a the position of another locator to this locator
  assign(rhs: Locator) {
    this.element = rhs.element;
    this.offset = rhs.offset;
    return this;
  }

  /// Get the node this locator points to (element.childNodes[offset]) if applicable
  getPointedNode() {
    return this.parentIsElementOrFragmentNode() && this.offset < this.element.childNodes.length
      ? this.element.childNodes[this.offset] as Node
      : null;
  }

  /// When applicable, get the node this locator points to, otherwise get the parent node.
  getNearestNode() {
    return this.getPointedNode() || this.element;
  }

  /// When applicable, get the node this locator points to, otherwise get the parent node. DEPRECATED, use getNearestNode
  getNearestElement() {
    const elt = this.getNearestNode();
    if (elt.nodeType !== 1 && elt.nodeType !== 11)
      return elt.parentNode;
    return elt;
  }

  pointsPastChildrenEnd() {
    return this.offset >= this.getMaxChildOffset(this.element);
  }

  /** Get the path through the dom tree from the ancestor to an element, not including the ancestor
      @param ancestor -
  */
  getPathFromAncestor(ancestor: Node) {
    const treenodes = [];
    let element = this.element;
    for (; element !== ancestor; element = element.parentNode as Node)
      treenodes.push(element);
    return treenodes.reverse();
  }

  getRelativePath(ancestor: Node) {
    const path = [this.offset];
    let node = this.element;
    for (; node && node !== ancestor; node = node.parentNode as Node)
      path.unshift(getNodeIndex(node));
    return path;
  }

  /** Returns whether the locator points to an element within a specific parent node
      @param parentNode -
  */
  isWithinNode(parentNode: Node) {
    let current = this.element;
    while (current && current !== parentNode)
      current = current.parentNode as Node;
    return current === parentNode;
  }

  parentIsElementOrFragmentNode() {
    return this.element.nodeType === 1 || this.element.nodeType === 11;
  }

  // TODO: It's unclear why 'towardend' is ignored for offset === 0. we really need it for node comparison so for now i'll just add an extra value for it
  moveToParent(towardend?: boolean | "really", forced?: boolean) {
    // If node is empty, determine direction by towardend
    // If at start or at end, go to start resp. end
    // If not forced, return false
    // Determine direction by towardend

    if (this.pointsPastChildrenEnd()) {
      // Node might be empty
      if (this.offset !== 0)
        towardend = true; // Node not empty
      else
        ; // Node is empty.
    } else {
      // Node not empty
      if (this.offset === 0) {
        if (towardend !== "really")
          towardend = false;
      } else if (!forced)
        return false;
    }

    this.offset = getNodeIndex(this.element) + (towardend ? 1 : 0);
    this.element = this.element.parentNode as Node;

    return true;
  }

  /** Ascends a locator toward the ancestor while the offset === 0/element size
  */
  ascend(ancestor: Node, towardend?: boolean | "really", forced?: boolean) {
    if (!ancestor)
      throw new Error("Invalid ancestor in Locator.ascend");
    //    console.log('AscendLocator ancestor', ancestor,' towardend: ', towardend, ', html: ', richdebug.getStructuredOuterHTML(ancestor, { toascend: this }));

    while (this.element !== ancestor) {
      if (!this.moveToParent(towardend, forced))
        break;
      if (!this.element)
        throw new Error("Locator was pointed outside the tree of ancestor");
    }

    //    console.log('AscendLocator result', richdebug.getStructuredOuterHTML(ancestor, { toascend: this }));
    return this;
  }

  /** Descends into leaf nodes (but keeps it out of unsplittable nodes)
  */
  descendToLeafNode(maxancestor: Node, allowunsplittables?: boolean) {
    if (typeof maxancestor !== "object")
      throw new Error("Missing ancestor!");

    //console.log('DescendLocator before ', this.element.nodeName, this.element.nodeValue, this.offset, 'len: ' + this.element.childNodes.length);

    // descend only in nodes of type element
    let towardend = false;
    if (this.element.nodeType === 1 || this.element.nodeType === 11) {
      if (this.offset >= this.element.childNodes.length) {
        // One past children: descend into lastchild (if present)
        while ((this.element.nodeType === 1 || this.element.nodeType === 11) && this.element.lastChild)
          this.element = this.element.lastChild;

        this.positionPastLastChild();
        towardend = true;
      } else {
        // Locator points to a child, descend through firstchild
        if (this.offset !== 0) {
          this.element = this.element.childNodes[this.offset];
          this.offset = 0;
        }

        // Descend with firstChild into leaf
        while ((this.element.nodeType === 1 || this.element.nodeType === 11) && this.element.firstChild)
          this.element = this.element.firstChild;
      }
    }

    if (!allowunsplittables && !isNodeSplittable(this.element)) {
      //console.log('DescendLocator descended into unsplittable node', this.element.nodeName);
      this.moveToParent(towardend);
    }

    //console.log('DescendLocator after ',this.element.nodeName,this.element.nodeValue,this.offset);
    return this;
  }

  positionPastLastChild() {
    this.offset = this.getMaxChildOffset(this.element);
    return this;
  }

  insertNode(node: Node, preservelocators?: PreservedLocatorList) {
    if (!this.parentIsElementOrFragmentNode())
      throw new Error("Inserting only allowed when parent is a node");

    /* Firefox removes <br _moz_editor_bogus_node> when inserting stuff after it. That messes up our
       locator system big-time. FF keeps track internally, clearing _moz_editor_bogus_node doesn't work.
       Inserting a <br> of our own after it makes FF remove its br. Locators shouldn't be in <br>'s anyway,
       so no preservation needed.
    */
    let newbr = null;
    if (this.offset) {
      const prev = this.element.childNodes[this.offset - 1];
      if (testType(prev, NodeType.element) && prev.nodeName.toLowerCase() === 'br' && prev.getAttribute('_moz_editor_bogus_node')) {
        newbr = document.createElement('br');
        this.element.insertBefore(newbr, this.getPointedNode());
        if (prev.parentNode) // Just to be sure.
          prev.parentNode.removeChild(prev);
      }
    }

    const pointednode = this.getPointedNode();

    this.element.insertBefore(node, pointednode);
    const next = this.clone();

    applyPreserveFunc(preservelocators, (tocorrect) => this._correctForNodeInsert(next, tocorrect));

    ++next.offset;
    return next;
  }

  private _correctForNodeInsert(locator: Locator, tocorrect: Locator) {
    if (tocorrect.element === locator.element && tocorrect.offset >= locator.offset)
      ++tocorrect.offset;
  }

  removeNode(preservelocators?: PreservedLocatorList) {
    if (!this.parentIsElementOrFragmentNode())
      throw new Error("Removing a node only allowed when parent is a node");
    if (this.offset >= this.getMaxChildOffset(this.element))
      throw new Error("Locator does not point to an element");

    const removed = this.element.childNodes[this.offset];
    this.element.removeChild(removed);

    const locator = this.clone();
    applyPreserveFunc(preservelocators, (tocorrect) => this._correctForNodeRemove(locator, removed, tocorrect));
  }

  _correctForNodeRemove(locator: Locator, removed: Node, tocorrect: Locator) {
    if (tocorrect.element === locator.element && tocorrect.offset > locator.offset)
      --tocorrect.offset;
    else if (tocorrect.element === removed || (removed.contains && removed.contains(tocorrect.element))) //contains doesn't always exist on IE11? is this a textnode issue or just a bug?
      tocorrect.assign(locator);
  }

  // Replace the node this locator points to (not named replaceNode because ClamAV detects CVE 2015-1623 in combination with .createDocumentFragment (and some more code))
  replacePointedNode(newnode: Node, preservelocators: PreservedLocatorList) {
    if (!this.parentIsElementOrFragmentNode())
      throw new Error("Removing a node only allowed when parent is a node");
    if (this.offset >= this.getMaxChildOffset(this.element))
      throw new Error("Locator does not point to an element");
    if (!newnode)
      throw new Error("No valid new node given");

    const oldnode = this.element.childNodes[this.offset];
    this.element.replaceChild(newnode, oldnode);

    applyPreserveFunc(preservelocators, (tocorrect) => this._correctForNodeReplace(oldnode, newnode, tocorrect));
  }

  _correctForNodeReplace(oldnode: Node, newnode: Node, tocorrect: Locator) {
    if (tocorrect.element === oldnode)
      tocorrect.element = newnode;
  }

  equals(rhs: Locator) {
    return this.element === rhs.element && this.offset === rhs.offset;
  }

  compare(rhs: Locator) {
    if (this.element === rhs.element)
      return Math.sign(this.offset - rhs.offset);

    const pos = this.element.compareDocumentPosition(rhs.element); //DOCUMENT_POSITION_CONTAINS = 8, DOCUMENT_POSITION_CONTAINED_BY = 16
    if (pos & Node.DOCUMENT_POSITION_CONTAINS) //our element is inside rhs. find our offset in rhs
      return compareContained(rhs, this);
    if (pos & Node.DOCUMENT_POSITION_CONTAINED_BY) //our element is inside rhs. find our offset in rhs
      return compareContained(this, rhs) * -1;

    return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  check(maxancestor: Node) {
    if (!this.element) throw new Error("Element not valid");
    if (maxancestor && !maxancestor.contains(this.element)) throw new Error("Element is not child of maxancestor");
    if (this.offset < 0) throw new Error("Negative offset");
    if (this.offset > this.getMaxChildOffset(this.element)) throw new Error("Offset too big");
  }

  isInDOM() {
    if (!this.element.ownerDocument || !this.element.ownerDocument.documentElement) {
      console.warn("Element has no ownerDocument", this.element.ownerDocument, (this.element.ownerDocument || {}).documentElement);
      return false;
    }
    return this.element.ownerDocument.documentElement.contains(this.element);
  }

  getContainedLocators() {
    return [this];
  }

  /** Scan downstream to the previous visible element
      @param ignore - .whitespace .blocks .li .alwaysvisibleblocks
      @returns
      \@cell return.type 'innerblock', 'outerblock', 'node', 'char', 'br', 'whitespace'
      \@cell return.data
      \@cell return.blockboundary
      \@cell return.alwaysvisible
      \@cell return.segmentbreak
      \@cell return.whitespace
  */
  scanBackward(maxancestor: Node, ignore: ScanIgnoreOptions): ScanResult {
    if (!maxancestor)
      throw new Error("Missing ancestor");

    if (this.offset > GetNodeEndOffset(this.element))
      throw new Error("Illegal offset!");

    if (typeof ignore.li === "undefined")
      ignore.li = ignore.blocks;

    for (; ;) {
      if (this.offset === 0) {
        // At start of node, need to exit it
        const isblock = isNodeBlockElement(this.element);
        if (isblock || this.element === maxancestor) {
          const isalwaysvisible = isNodeAlwaysVisibleBlockElement(this.element);
          if (!ignore.blocks || (isalwaysvisible && !ignore.alwaysvisibleblocks) || this.element === maxancestor) {
            return { type: 'outerblock', data: this.element, blockboundary: true, segmentbreak: true, alwaysvisible: isalwaysvisible };
          }
        }

        this.moveToParent(false);
      } else {
        if ([3, 4].includes(this.element.nodeType)) {
          const data = (this.element.nodeValue || "").substr(this.offset - 1, 1);
          const whitespace = ' \t\r\n'.indexOf(data) !== -1;
          if (!whitespace || !ignore.whitespace) {
            return {
              type: whitespace ? 'whitespace' : 'char',
              data: data,
              visiblecontent: !whitespace
            };
          }

          --this.offset;
          continue;
        }

        // We're within an element
        --this.offset;

        const node = this.getPointedNode();
        if (!node)
          continue;
        if (!testType(node, [NodeType.element, NodeType.text, NodeType.cDATASection]))// Skip unknown nodetypes
          continue;

        if (testType(node, NodeType.element) && !isTransparentNode(node)) {
          // Always return unsplittable nodes
          if (!isNodeSplittable(node)) {
            ++this.offset;

            const segmentbreak = node.nodeName.toLowerCase() === 'br';
            if (segmentbreak) {
              let bogussegmentbreak = false;
              if (isNodeBlockElement(this.element)) {
                // br is bogus when its the last br in a block node (ignoring whitespace-only text nodes)
                bogussegmentbreak = true;

                for (let i = this.offset, e = this.element.childNodes.length; i < e; ++i) {
                  const itrnode = this.element.childNodes[i];
                  if (!([3, 4].includes(itrnode.nodeType)) || (itrnode.nodeValue || "").trim()) {
                    bogussegmentbreak = false;
                    break;
                  }
                }
              }
              return { type: 'br', data: node, segmentbreak: true, bogussegmentbreak: bogussegmentbreak };
            }

            return { type: 'node', data: node, visiblecontent: true };
          }

          // Stop at inner blocks if requested
          const isblock = isNodeBlockElement(node);
          const isli = node.nodeName.toLowerCase() === 'li';

          if ((isli && !ignore.li) || (!isli && isblock && !ignore.blocks)) {
            ++this.offset;
            return { type: 'innerblock', data: node, blockboundary: true, segmentbreak: true };
          }
        }

        // Move to end of contents of previous node
        this.set(this.getPointedNode() as Node, "end");
      }
    }
  }

  // Old name, remove when not referenced anymore
  scanUpStream(maxancestor: Node, ignore: ScanIgnoreOptions): ScanResult { return this.scanForward(maxancestor, ignore); }

  /** Scan upstream to the next visible element
      @param maxancestor -
      @param ignore - .whitespace .blocks
      @returns
      \@cell return.type 'innerblock', 'outerblock', 'node', 'char', 'br', 'whitespace'
      \@cell return.data
      \@cell return.blockboundary
      \@cell return.alwaysvisible
      \@cell return.segmentbreak
      \@cell return.whitespace
  */
  scanForward(maxancestor: Node, ignore: ScanIgnoreOptions): ScanResult {
    if (!maxancestor.contains(this.element)) {
      console.log(maxancestor, this.element);
      throw new Error("Maxancestor is not ancestor of locator");
    }

    for (; ;) {
      if (this.pointsPastChildrenEnd()) {
        const isblock = isNodeBlockElement(this.element);
        if (isblock || this.element === maxancestor) {
          const isalwaysvisible = isNodeAlwaysVisibleBlockElement(this.element);
          if (!ignore.blocks || isalwaysvisible || this.element === maxancestor)
            return { type: 'outerblock', data: this.element, blockboundary: true, segmentbreak: true, alwaysvisible: isalwaysvisible };
        }

        this.moveToParent(true);
      } else {
        if ([3, 4].includes(this.element.nodeType)) {
          const data = (this.element.nodeValue || "").substring(this.offset, this.offset + 1);
          const whitespace = ' \t\r\n'.indexOf(data) !== -1;

          if (!whitespace || !ignore.whitespace) {
            return {
              type: whitespace ? 'whitespace' : 'char',
              data: data,
              visiblecontent: !whitespace
            };
          }

          ++this.offset;
          continue;
        }

        const node = this.getPointedNode();
        if (!node)
          throw new Error(`Could not get pointed to node`);
        if (![1, 3, 4].includes(node.nodeType)) {
          ++this.offset;
          continue;
        }

        if (testType(node, NodeType.element) && !isTransparentNode(node)) {
          // Return unsplittable nodes
          if (!isNodeSplittable(node)) {
            const segmentbreak = node.nodeName.toLowerCase() === 'br';
            if (segmentbreak) {
              const bogussegmentbreak = segmentbreak && node.getAttribute('data-wh-rte') === 'bogus';
              return { type: 'br', data: node, segmentbreak: true, bogussegmentbreak: bogussegmentbreak };
            }

            return { type: 'node', data: node, visiblecontent: true };
          }

          const isblock = isNodeBlockElement(node);
          //var isalwaysvisible = isblock && isNodeAlwaysVisibleBlockElement(node);
          if ((isblock && !ignore.blocks)/* || isalwaysvisible*/)
            return { type: 'innerblock', data: node, blockboundary: true, segmentbreak: true };
        }

        // Move to start of contents of current node
        this.set(node, 0);
      }
    }
  }

  //walks left to the last visible node or character, and puts the locator right from it.
  movePastLastVisible(maxancestor: Node, stopatblock?: unknown, placeintext?: boolean) {
    if (!maxancestor.contains(this.element))
      throw new Error("Ancestor is not ancestor of this locator");
    if (stopatblock)
      throw new Error("Stopatblock not supported for movePastLastVisible");

    const range = getVisualEquivalenceRange(maxancestor, this);
    this.assign(range.down);

    if (placeintext && !['whitespace', 'char'].includes(range.downres.type)) {
      const copy = this.clone();
      const res = copy.scanForward(maxancestor, {});
      if (['whitespace', 'char'].includes(res.type))
        this.assign(copy);
    }

    return range.downres;
  }

  moveToFirstVisible(maxancestor: Node, stopatblock?: unknown, placeintext?: boolean) {
    if (!maxancestor.contains(this.element))
      throw new Error("Ancestor is not ancestor of this locator");
    if (stopatblock)
      throw new Error("Stopatblock not supported for moveToFirstVisible");

    const range = getVisualEquivalenceRange(maxancestor, this);
    //console.log('mtfv range', richdebug.getStructuredOuterHTML(maxancestor, { locator: this, range: range }, true));
    this.assign(range.up);

    if (placeintext && !['whitespace', 'char'].includes(range.upres.type)) {
      const copy = this.clone();
      const res = copy.scanBackward(maxancestor, {});
      if (['whitespace', 'char'].includes(res.type))
        this.assign(copy);
    }

    return range.upres;
  }

  moveLeft(maxancestor: Node, options: { checkblock?: (node: Node) => boolean } = {}) {
    const original = this.clone();
    let res = this.movePastLastVisible(maxancestor);
    switch (res.type) {
      case 'innerblock':
        this.set(res.data, "end"); break;
      case 'outerblock':
        {
          if (this.element !== maxancestor)
            this.ascend(maxancestor, false);

          res = this.scanBackward(maxancestor, { whitespace: true });
          if ((res.type === "node" || res.type === "innerblock") && options.checkblock && !options.checkblock(res.data)) {
            this.assign(original);
            return false;
          }
        } break;
      case 'br':
      case 'node':
        {
          --this.offset;
        } break;
      case 'whitespace':
      case 'char':
        {
          --this.offset;
          const codechar = (this.element.nodeValue || "").charCodeAt(this.offset);
          if (this.offset && codechar >= 0xdc00 && codechar < 0xe000) // UTF-16 surrogate pair second codepoint?
            --this.offset;
          break;
        }
    }

    const range = getVisualEquivalenceRangeInBlock(maxancestor, this);
    if (range.valid) {
      this.assign(range.down);
      return true;
    }

    res = this.scanBackward(maxancestor, { blocks: true, whitespace: true });

    // When we encounter a bogus br at the end of a block node, place the locator before it
    if (res.type === "br" && res.bogussegmentbreak)
      --this.offset;
    this.scanForward(maxancestor, { whitespace: true });

    this.movePastLastVisible(maxancestor);
    return true;
  }

  moveRight(maxancestor: Node, options: { checkblock?: (node: Node) => boolean } = {}) {
    const original = this.clone();
    let res = this.moveToFirstVisible(maxancestor);
    if (res.type === 'br') {
      const range = getInvisibleSegmentBreakRange(this, maxancestor);
      //console.log('moveright foundbr', richdebug.getStructuredOuterHTML(maxancestor, { locator: this, range: range }));

      if (range) {
        this.assign(range.end);
        res = this.scanForward(maxancestor, { whitespace: true });
      }
    }
    switch (res.type) {
      case 'innerblock':
        this.set(res.data, 0); break;
      case 'outerblock':
        {
          if (this.element !== maxancestor)
            this.ascend(maxancestor, true);

          res = this.scanForward(maxancestor, { whitespace: true });
          if ((res.type === "node" || res.type === "innerblock") && options.checkblock && !options.checkblock(res.data)) {
            this.assign(original);
            return false;
          }
        } break;
      case 'br':
      case 'node':
        {
          ++this.offset;
          break;
        }
      case 'whitespace':
      case 'char':
        {
          let codechar = (this.element.nodeValue || "").charCodeAt(this.offset);
          const is_multiword = codechar >= 0xd800 && codechar < 0xdc00;
          ++this.offset;
          if (is_multiword) {
            codechar = (this.element.nodeValue || "").charCodeAt(this.offset);
            if (codechar >= 0xdc00 && codechar < 0xe000)
              ++this.offset;
          }
          break;
        }
    }

    const range = getVisualEquivalenceRangeInBlock(maxancestor, this);
    //console.log("right eqrange", range, richdebug.getStructuredOuterHTML(maxancestor, range, { indent: true }));
    //console.log('mtnbb iter', richdebug.getStructuredOuterHTML(this.element.parentNode, { locator: this }));

    if (range.valid) {
      this.assign(range.up);
      return true;
    }

    this.scanForward(maxancestor, { blocks: true, whitespace: true });
    this.scanBackward(maxancestor, { whitespace: true });

    this.movePastLastVisible(maxancestor);
    return true;
  }

  /** Move the locator to the previous block tag, or the start of the current block
      @param maxancestor - Ancestor to treat as parent block
      @returns Locator is positioned just before block boundary
      \@cell return.type 'innerblock', 'outerblock'
      \@cell return.node Relevant block
  */
  moveToPreviousBlockBoundary(maxancestor: Node, ignoreinnerblock: boolean) {
    for (; ;) {
      //console.log('mtnbb iter', richdebug.getStructuredOuterHTML(this.element.parentNode, { locator: this }));

      // Don't do stuff within data nodes
      if (!this.parentIsElementOrFragmentNode())
        this.offset = 0;

      if (this.offset === 0) {
        if (this.element === maxancestor || isNodeBlockElement(this.element))
          return { type: 'outerblock', data: this.element, blockboundary: true };
        this.moveToParent(false);
      } else {
        --this.offset;
        const node = this.getPointedNode();
        if (!node)
          throw new Error(`Could not find pointed to node`);

        if (node.nodeType !== 1 || !isNodeSplittable(node) || ignoreinnerblock)
          continue;

        if (isNodeBlockElement(node)) {
          ++this.offset;
          return { type: 'innerblock', data: node, blockboundary: true };
        }

        this.element = node;
        this.positionPastLastChild();
      }
    }
  }


  /** Move the locator to the next block tag, or the end of the current block
      @param maxancestor - Ancestor to treat as parent block
      @returns Locator is positioned just before block boundary
      \@cell return.type 'innerblock', 'outerblock'
      \@cell return.node Relevant block
  */
  moveToNextBlockBoundary(maxancestor: Node, ignoreinnerblock: boolean) {
    for (; ;) {
      //console.log('mtnbb iter', richdebug.getStructuredOuterHTML(this.element.parentNode, { locator: this }));

      // Don't do stuff within data nodes
      if (!this.parentIsElementOrFragmentNode())
        this.positionPastLastChild();

      if (this.pointsPastChildrenEnd()) {
        if (this.element === maxancestor || isNodeBlockElement(this.element))
          return { type: 'outerblock', data: this.element, blockboundary: true };
        this.moveToParent(true);
      } else {
        const node = this.getPointedNode();
        if (!node)
          throw new Error(`No pointed node found`);

        if (node.nodeType !== 1 || !isNodeSplittable(node) || ignoreinnerblock) {
          ++this.offset;
          continue;
        }
        if (isNodeBlockElement(node))
          return { type: 'innerblock', data: node, blockboundary: true };

        this.element = node;
        this.offset = 0;
      }
    }
  }

  isLegal(maxancestor: Node) {
    let node: Node | null = this.element;
    while (node) {
      // Locator may not be inside an unsplittable node
      if (!isNodeSplittable(node))
        return false;

      if (node === maxancestor)
        return true;

      node = node.parentNode;
    }
    return false;
  }

  getParentContentEditable(maxancestor: Node) {
    // Return the highest parent that is still contenteditable (limited by maxancestor
    let node = this.element;
    for (; node && node !== maxancestor; node = node.parentNode) {
      if (!node.parentNode || !(node.parentNode as HTMLElement).isContentEditable)
        return node;
    }
    return maxancestor;
  }

  legalize(maxancestor: Node, towardend: boolean) {
    let node = this.element;
    while (node && node !== maxancestor) {
      // If parent isn't splittable, ascend to its parent. Assuming the maxancestor is splittable!!!
      if (!isNodeSplittable(node) && node)
        this.ascend(node.parentNode as Node, towardend, true);

      node = node.parentNode as Node;
    }
  }

  static findCommonAncestor(locator_a: Locator, locator_b: Locator) {
    return getCommonAncestor(locator_a.element, locator_b.element);
  }

  static findCommonAncestorElement(locator_a: Locator, locator_b: Locator): Element {
    let ancestor = getCommonAncestor(locator_a.element, locator_b.element);
    if ([3, 4].includes(ancestor.nodeType))
      ancestor = ancestor.parentNode!; //a textnode should alwasys be in an element

    return ancestor as Element;
  }

  /// Get start and end locator from a range
  static getFromRange(range: AbstractRange) {
    if (!range)
      return null;

    const result =
    {
      start: new Locator(range.startContainer, range.startOffset),
      end: new Locator(range.endContainer, range.endOffset)
    };
    return result;
  }

  static newPointingTo(node: Node) {
    return new Locator(node.parentNode as Node, getNodeIndex(node));
  }

  static newPointingAfter(node: Node) {
    const locator = Locator.newPointingTo(node);
    ++locator.offset;
    return locator;
  }

  static fromRelativePath(ancestor: Node, path: number[]) {
    const lastoffset = path.pop();
    let elt = ancestor;
    for (let i = 0; i < path.length; ++i)
      elt = elt.childNodes[path[i]];
    return new Locator(elt, lastoffset);
  }
}

function GetNodeEndOffset(element: Node) {
  if (element.nodeType === 1 || element.nodeType === 11)
    return element.childNodes.length; // for element nodes, document fragments, etc
  else
    return element.nodeValue ? element.nodeValue.length : 0; // for text nodes
}
