import * as domlevel from "./domlevel";

class SelectionInterface
{
  // ---------------------------------------------------------------------------
  //
  // Initialize
  //

  constructor(node)
  {
    this.node = node;
    this.doc = node.ownerDocument;

    // Determine whether the node is in an iframe relative to the run-location of this code
    this.isiframe = this.node.defaultView != window;
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  // ---------------------------------------------------------------------------
  //
  // Initialize
  //

  /** Returns the current selection in a domlevel.Range object - if present. Even when having focus,
      it is not guaranteed that a selection exists.
  */
  getSelectionRange()
  {
    var selection = this.doc.getSelection();
    if (!selection || selection.rangeCount == 0)
      return null;

    var domrange = selection.getRangeAt(0);
    if(domlevel.getRangeLogLevel() & 1)
      console.log('got range', domrange.startContainer, domrange.startOffset, domrange.endContainer, domrange.endOffset);

    var result = domlevel.Range.fromDOMRange(domrange);
    if(domlevel.getRangeLogLevel() & 1)
      console.log('range', result.start.element, result.start.offset, result.end.element, result.end.offset);

    return result;
  }

  /** Sets the current selection to the range in a domlevel.Range object
      @param range Range to select
  */
  selectRange(range)
  {
    if (!range)
      throw new Error("No range specified");
    if (!range.start.element || !range.end.element)
      throw new Error("Range start or end are not valid nodes");

    var selection = this.doc.getSelection();
    if (!selection)
    {
      if(domlevel.getRangeLogLevel() & 1)
        console.log('have NO selection object');
      return false;
    }

    if(domlevel.getRangeLogLevel() & 1)
      console.log('have selection object', range.start, range.end);

    // Rangy sometimes fails on IE. This standard code passes the tests...
    var domrange = this.doc.createRange();
    domrange.setStart(range.start.element, range.start.offset);
    domrange.setEnd(range.end.element, range.end.offset);

    if(domlevel.getRangeLogLevel() & 1)
      console.log('SI selectRange dom result', domrange);

    selection.removeAllRanges();
    selection.addRange(domrange);

    if(domlevel.getRangeLogLevel() & 1)
      console.log('SI final selection', selection);

    // Don't detach the domrange. At least IE 10 needs it.
    return true;
  }
}

module.exports = SelectionInterface;
