/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import { Locator, findParent, splitDataNode, PreservedLocatorList, testType, NodeType } from '../domlevel';
import * as richdebug from "../richdebug";
import * as browser from "dompack/extra/browser";

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

export default class Range {
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
    if (rangelog & 32)
      console.log('pre normalize', richdebug.getStructuredOuterHTML(maxancestor, { range: this }, true));

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
      if (rangelog & 32)
        console.log('normalize collapsed ', richdebug.getStructuredOuterHTML(maxancestor, this, false));

      // Place 'm in text
      this.start.moveToFirstVisible(maxancestor, false, true);
      this.end.movePastLastVisible(maxancestor, false, true);

      if (rangelog & 32)
        console.log('normalize collapsed ', richdebug.getStructuredOuterHTML(maxancestor, this, false));

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
    this.end.element = this.end.getPointedNode();
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

  containsRange(rhs: Range) {
    return this.containsLocator(rhs.start) && this.containsEnd(rhs.start);
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

  toDOMRange() {
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
    const start = new Locator(selection.anchorNode, selection.anchorOffset);
    const end = new Locator(selection.focusNode, selection.focusOffset);
    const reversed = start.compare(end) > 0;
    return new Range(reversed ? end : start, reversed ? start : end);
  }

  static fromDOMRange(range) {
    return new Range(new Locator(range.startContainer, range.startOffset), new Locator(range.endContainer, range.endOffset));
  }

  static fromRangyRange(range) {
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
