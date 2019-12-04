export default class RangeIterator2
{
  constructor(xrange)
  {
     /// Ancestor of the selection range
    this.ancestor = null;
     /// Current iterator
    this.current = null;
     /// Node pointed to by current iterator, null when at end
    this.node = null;
     /// range.start ascended toward start to parent of current node (marks partially selected node of range start)
    this.localstart = null;
     /// range.end ascended toward start to parent of current node (marks partially selected node of range end)
    this.localend = null;

     /// Selection range
    this.range = xrange.clone();

    //console.log('ITR2 org range', richdebug.getStructuredOuterHTML(this.range.getAncestorElement(), { range: this.range }, true));

    if (this.range.isCollapsed())
      return;

    if (!this.range.start.parentIsElementOrFragmentNode())
      this.range.start.moveToParent(false, true);
    if (!this.range.end.parentIsElementOrFragmentNode())
      this.range.end.moveToParent(true, true);

    this.ancestor = this.range.getAncestorElement();

    // Move range start and end as far towards the ancestor as possible
    this.range.start.ascend(this.ancestor, false);
    this.range.end.ascend(this.ancestor, true);

    this.localstart = this.range.start.clone();
    this.localstart.ascend(this.ancestor, false, true);

    this.localend = this.range.end.clone();
    this.localend.ascend(this.ancestor, false, true);

    //console.log('ITR2 mod range', richdebug.getStructuredOuterHTML(this.ancestor, { range: this.range, localstart: this.localstart, localend: this.localend, current: this.current }, true));

    this.current = this.localstart.clone();

    this.node = this.localstart.getPointedNode();
  }

  atEnd()
  {
    return !this.node;
  }

  next()
  {
    return this.nextInternal(false);
  }

  nextRecursive()
  {
    return this.nextInternal(true);
  }

  nextInternal(recursive)
  {
    //console.log('ITR2 nextRecursive', richdebug.getStructuredOuterHTML(this.ancestor, { range: this.range, localstart: this.localstart, localend: this.localend, current: this.current }, true));
    if (this.current.equals(this.range.end))
    {
      //console.log(' immediately at end');
      this.node = null;
      return false;
    }

    if (this.localstart && this.current.equals(this.localstart))
    {
      //console.log(' at localstart');
      if (this.localstart.equals(this.range.start))
      {
        //console.log(' localstart == range.start');
        this.localstart = null;
      }
      else
      {
        this.localstart = this.range.start.clone();
        this.localstart.ascend(this.node, false, true);

        this.current.assign(this.localstart);
        this.node = this.current.getPointedNode();
        //console.log(' followed localstart', richdebug.getStructuredOuterHTML(this.ancestor, { range: this.range, localstart: this.localstart, localend: this.localend, current: this.current }, true));
        return true;
      }
    }

    if (!this.node.firstChild)
    {
      ++this.current.offset;
      this.current.ascend(this.ancestor, true);

      //console.log(' no child, ++offset && ascended', richdebug.getStructuredOuterHTML(this.ancestor, { range: this.range, localstart: this.localstart, localend: this.localend, current: this.current }, true));

      if (this.current.equals(this.range.end))
      {
        //console.log(' at end');
        this.node = null;
        return false;
      }
      else
      {
        //console.log(' ok');
        this.node = this.current.getPointedNode();
        return true;
      }
    }

    if (this.localend && this.current.equals(this.localend))
    {
      //console.log(' at localend');
      if (this.localend.equals(this.range.end))
      {
        this.node = null;
        return false;
      }

      this.localend = this.range.start.clone();
      this.localend.ascend(this.node, false, true);

      this.current.element = this.node;
      this.current.offset = 0;

      //console.log(' followed localend', richdebug.getStructuredOuterHTML(this.ancestor, { range: this.range, localstart: this.localstart, localend: this.localend, current: this.current }, true));

      this.node = this.current.getPointedNode();
      return true;
    }
    else
    {
      //console.log(' into child', richdebug.getStructuredOuterHTML(this.ancestor, { range: this.range, localstart: this.localstart, localend: this.localend, current: this.current }, true));

      this.current.element = this.node;
      this.current.offset = 0;

      this.node = this.current.getPointedNode();
      return true;
    }
  }
}

