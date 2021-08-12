const rangy = require('@mod-system/js/frameworks/rangy/rangy13');
import * as richdebug from "./richdebug";
import * as browser from "dompack/extra/browser";
import * as dompack from "dompack";

import Range from './dom/range.es';

//var richdebug = require('./richdebug');


rangy.config.alertOnFail=false; //prevent Rangy frmo complaining about missing document.body - that actually happens when location.href early redirects and we don't want that alert..

function getAttributes (node, attrlist)
{
  var result = {};
  for (let i = 0; i < attrlist.length; ++i)
    if (node.hasAttribute(attrlist[i]))
    {
      var value = node.getAttribute(attrlist[i], 2); //FIXME '2' was added for IE , still needed?
      result[attrlist[i]] = value;
    }
  return result;
}

function getAllAttributes (node)
{
  var res = {};
  for (var i = 0, end = node.attributes.length; i < end; ++i)
  {
    if (node.attributes[i].specified === false) // IE7  returns all attributes, set specified on present values
      continue;

    var name = node.attributes[i].name;
    var value = node.getAttribute(name, 2); // Return value as string, do not interpolate (or make links absolute)

    res[name] = value;
  }
  return res;
}

function setAttributes (node, attrs)
{
  // Insert sorted on attributes name
  var keys = Object.keys(attrs).sort();

  // firefox will show attributes in innerHTML in reverse insert order
  if (browser.getName() === "firefox")
    keys = keys.reverse();

  for (var i = 0; i < keys.length; ++i)
    node.setAttribute(keys[i], attrs[keys[i]]);
}

/** Class that gathers undo/redo items
*/
class UndoItem
{
  constructor(ancestor)
  {
    this.ancestor = ancestor;
    this.items = [];
    this.finished = false;

    this.onitemadded = null;
    this.onstatechange = null;
  }

  addItem(undo, redo)
  {
    if (this.finished)
      throw new Error("Undo item already finished, can't add more items");

    var item = { undo: undo, redo: redo };
    this.items.push(item);
    this.onitemadded && this.onitemadded(item);
  }

  finish()
  {
    this.finished = true;
  }

  undo()
  {
    //console.log('UNDO pre: ', richdebug.getStructuredOuterHTML(this.ancestor, null, true));
    for (var i = this.items.length - 1; i >= 0; --i)
    {
      this.items[i].undo();
      this.onstatechange && this.onstatechange({ pos: i });
    }
  }

  redo()
  {
    //console.log('REDO pre: ', richdebug.getStructuredOuterHTML(this.ancestor, null, true));
    for (var i = 0; i < this.items.length; ++i)
    {
      this.items[i].redo();
      //console.log('redo after item ' + i + ":", richdebug.getStructuredOuterHTML(this.ancestor, null, true));
      this.onstatechange && this.onstatechange({ pos: i + 1});
    }
  }
}

// ---------------------------------------------------------------------------
//
// Helper functions
//

/** Returns whether a node matches a filter
    @param node Node to test
    @param filter Filter to execute. True is returned for the different types of filter when:
              string: nodeName is equal (case insensitive)
              array: contains lowercase nodeName
              function: filter(node) returns TRUE
*/
function isNodeFilterMatch(node, filter)
{
  if (!node)
    throw new Error("No node in isNodeFilterMatch");
  if (Array.isArray(filter))
    return filter.includes(node.nodeName.toLowerCase());
  if (typeof filter == "string")
    return node.nodeName.toLowerCase() == filter.toLowerCase();
  return filter(node);
}

function applyPreserveFunc(preserve, func)
{
  var list = [];
  if (!preserve)
    return list;

  // Eliminate duplicates, double corrections mess up a lot of stuff
  for (let p of preserve)
  {
    for (let locator of p.getContainedLocators())
      if (list.indexOf(locator) === -1)
        list.push(locator);
  }

  list.forEach((item, idx) => func(item, idx, list));
  /*/ // Enable this to get better debugging of preserve functions
  console.log('Apply preserve func', func);
  list.each(function(item)
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
function getNodeChildCount(element)
{
  if (element.nodeType == 1 || element.nodeType == 11)
    return element.childNodes.length; // for element nodes, document fragments, etc
  else
    return element.nodeValue ? element.nodeValue.length : 0; // for text nodes
}

/** Searches for a parent with a specific nodename (or test function). Stops testing after ancestor has been encountered.
    (ancestor may be returned)
    @param node Node to start at
    @param filter Filter to use (see isNodeFilterMatch for types of filters)
    @param maxancestor Node to stop at (no parent of the ancestor will be given back,
*/
function findParent(node, filter, maxancestor)
{
  for(;node;node=node.parentNode)
  {
    if (isNodeFilterMatch(node, filter))
      return node;
    if (node === maxancestor)
      break;
  }
  return null;
}

/// Is the node transparent for content (must we iterate through them while scanning)
function isTransparentNode(node)
{
  var uname = node.nodeName.toUpperCase();

  var isIgnorable =
      [ "TBODY", "COL", "COLGROUP", "TR", "TFOOT", "THEAD" ].indexOf(uname) != -1;

  return isIgnorable;
}

/// Returns whether a node is a block element
function isNodeBlockElement(node)
{
  var uname = node.nodeName.toUpperCase();

  var isBlockElement =
      [ 'ADDRESS', 'BLOCKQUOTE', 'CENTER', 'CODE', 'DIV', 'DL', 'FIELDSET', 'FORM', 'H1'
      , 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'ISINDEX', 'MENU', 'OL', 'P', 'PRE', 'TABLE', 'UL'
        //FIXME: the following tags must be treated as block elements too, make another func for that instead of misusing this one
      , 'DD', 'DT', 'FRAMESET', 'LI', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR' ].indexOf(uname) != -1;

  return isBlockElement;
}

/// Returns whether a node is a block element that's always visible
function isNodeAlwaysVisibleBlockElement(node)
{
  var uname = node.nodeName.toUpperCase();

  // Look out, in FF LI is visible when empty, but not editable!
  var list =
        [ 'ADDRESS', 'BLOCKQUOTE'/*, 'CENTER', 'DIV'*/, 'DL', 'FIELDSET', 'FORM'/*, 'H1'*/
        , /*'H2', 'H3', 'H4', 'H5', 'H6', 'HR', */'ISINDEX', 'MENU'/*, 'OL', 'P', 'PRE'*/, 'TABLE'/*, 'UL'*/
          //FIXME: the following tags must be treated as block elements too, make another func for that instead of misusing this one
        , 'DD', 'DT', 'FRAMESET', 'LI', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR' ];

  return list.indexOf(uname) != -1;
}

/// Returns whether a node required a br when empty to make it visible (and editable for Firefox)
function doesNodeRequireFillingWhenEmpty(node)
{
  return doesNodeRequireInterchangeFillingWhenEmpty(node);
}


/// Returns whether a node is a block element that's always visible
function doesNodeRequireInterchangeFillingWhenEmpty(node)
{
  // LI is visible, but not editable in firefox when empty.
  var list =
        [ 'CENTER', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'P', 'LI' ];

  var uname = node.nodeName.toUpperCase();
  return list.indexOf(uname) != -1;
}

export function isEmbeddedObject(node)
{
  return node.nodeType == 1
         && node.classList
         && node.classList.contains('wh-rtd-embeddedobject');
}

export function queryEmbeddedObjects(node)
{
  return dompack.qSA(node, '.wh-rtd-embeddedobject');
}

function isNodeSplittable(node)
{
  if (node.nodeType != 1)
    return true;
  //non-html nodes may not have a classList (IE11 SVG nodes)
  if (isEmbeddedObject(node))
    return false;
  var uname = node.nodeName.toUpperCase();
  return uname != 'BR'
      && uname != 'AREA'
      && uname != 'LINK'
      && uname != 'IMG'
      && uname != 'PARAM'
      && uname != 'HR'
      && uname != 'INPUT'
      && uname != 'META'
      && uname != 'COL'
      && uname != 'SVG';
}

/** When locator points to segmentbreak (<br> or '\r', '\n'), see if the next position
    is a block boundary. If so, the break isn't visible (except on IE8 and lower)
    Assumes locator points at a real segment boundary.
*/
function getInvisibleSegmentBreakRange(locator, maxancestor)
{
  var orglocator = locator;
  locator = locator.clone();

  // Might be a '\r\n' in white-space: pre (ADDME test if "\r""\n" would also work)
  if (!locator.parentIsElementOrFragmentNode && locator.element.nodeValue.substr(locator.offset, 2) == '\r\n')
    locator.offset += 2;
  else
    ++locator.offset;
  var pastbreak = locator.clone();

  var res2 = locator.scanForward(maxancestor, { whitespace: true });
  if (res2.type == 'outerblock' || res2.type == 'innerblock')
    return new Range(orglocator, pastbreak);

  return null;
}

/** Get the range around the locator where the cursor would be displayed at the same visual position. <del>If placed
    after the last br in a blockon non-ie, autocorrected to range before br.</del>
    @return
    @cell return.valid Whether the cursor could be placed here
    @cell return.down Downstream locator position
    @cell return.downres scanBackward result for the downstream position
    @cell return.up Upstream locator position
    @cell return.upres scanForward result for the upstream position
*/
function getVisualEquivalenceRangeInBlock(maxancestor, locator, correctpastlastbr)
{
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

  var down = locator.clone();
  var downres = down.scanBackward(maxancestor, { whitespace: true });

  var up = locator.clone();
  var upres = up.scanForward(maxancestor, { whitespace: true });

  //console.log('gverib scanres', whitespacehandling, richdebug.getStructuredOuterHTML(maxancestor, { locator: locator, up: up, down: down }));

  // br before block isn't visible on non-IE browsers. Move to before BR.
  if (correctpastlastbr && downres.type == 'br' && upres.blockboundary)
  {
    --down.offset;
    up = down.clone();
    upres = downres;

    downres = down.scanForward(maxancestor, { whitespace: true });
  }

  // Determine the position in the table above
  var whitespacehandling;
  if (downres.visiblecontent)
    whitespacehandling = 'normal';
  else if (upres.visiblecontent || upres.type == 'br')
    whitespacehandling = 'ignore';
  else if (upres.type == 'outerblock' && upres.alwaysvisible && downres.type == 'outerblock' && downres.alwaysvisible)
    whitespacehandling = 'ignore';
  else
    whitespacehandling = 'invalid';

  //console.log('gverib ', whitespacehandling, richdebug.getStructuredOuterHTML(maxancestor, { locator: locator, up: up, down: down }));
  //console.log(downres, upres);

  var valid = whitespacehandling != 'invalid';
  if (whitespacehandling == 'normal')
  {
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
    var lastfoundwhitespace = locator.clone();
    var lastfoundwhitespaceres = null;

    var downw = locator.clone();
    while (true)
    {
      var downwres = downw.scanBackward(maxancestor, {}); // stop at blocks & whitespace

      if (downwres.type == 'whitespace')
      {
        lastfoundwhitespace.assign(downw);
        lastfoundwhitespaceres = downwres;
        --downw.offset;
      }
      else
        break;
    }

    //console.log('verb within norm', richdebug.getStructuredOuterHTML(maxancestor, { locator: locator, up: up, down: down, lastfoundwhitespace: lastfoundwhitespace, downw: downw }));

    if (!lastfoundwhitespaceres)
    {
      // No whitespace before, can't ignore the whitespace after. Rescan.
      up.assign(down);
      upres = up.scanForward(maxancestor, {});
    }
    else
    {
      down.assign(lastfoundwhitespace);
      downres = lastfoundwhitespaceres;
    }
  }

  //console.log('gverb result, valid:', valid, richdebug.getStructuredOuterHTML(maxancestor, { locator: locator, up: up, down: down, lastfoundwhitespace: lastfoundwhitespace, downw: downw }));

  return { valid: valid, down: down, downres: downres, up: up, upres: upres, range: new Range(down, up) };
}

function getVisualEquivalenceRange(maxancestor, locator)
{
  //console.log('gver pre', richdebug.getStructuredOuterHTML(maxancestor, { locator: locator }));

  var elt = locator.element;
  while (elt != maxancestor)
  {
    if (!isNodeSplittable(elt))
    {
      var down = Locator.newPointingTo(elt);
      let up = Locator.newPointingAfter(elt);

      let res =
        { down: down
        , downres: down.scanBackward(maxancestor, { whitespace: true, blocks:true ,li: true })
        , up: up
        , upres: up.scanForward(maxancestor, { whitespace: true, blocks:true ,li: true })
        };

      res.range = new Range(res.down, res.up);
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
  if (res.downres.type == 'br')
    --res.down.offset;

  // Get the current block
  var block = findParent(locator.element, isNodeBlockElement, maxancestor) || maxancestor;

  for (var i = 0; i < 2; ++i)
  {
    // Scan upstream in the round 1: current block, round 2: entire document
    var upcopy = res.up.clone();
    /*var upres = */res.up.scanForward(block, { whitespace: true, blocks: true });

    if (!upcopy.equals(res.up))
    {
      res = getVisualEquivalenceRangeInBlock(maxancestor, res.up, true);
      if (res.valid)
        return res;
    }

    // Scan upstream in the round 1: current block, round 2: entire document
    var downcopy = res.down.clone();
    /*var downres = */res.down.scanBackward(block, { whitespace: true, blocks: true });
    //console.log('gver downres', i, richdebug.getStructuredOuterHTML(maxancestor, { locator: locator, locator: locator, down: res.down, up: res.up, upcopy: upcopy, downres: downres }));

    if (!downcopy.equals(res.down) || i == 1)
    {
      res = getVisualEquivalenceRangeInBlock(maxancestor, res.down, true);
      if (res.valid || i == 1)
        return res;
    }

    // Early out
    if (block == maxancestor)
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
    @param locator Place to split the data node
    @param preservelocators List of locators/ranges to keep valid.
    @param preservetoward 'start' or 'end' (default: 'end') Direction to move preserved locators at the splitpoint
    @return Locator pointing to new element
*/
function splitDataNode(locator, preservelocators, preservetoward, undoitem)
{
  if (preservetoward && ![ 'start', 'end' ].includes(preservetoward))
    throw new Error("Illegal preservetoward value '" + preservetoward + "'");

  // Clone locator, so its presence in preservelocators won't mess up stuff during the applyPreserveFunc
  locator = locator.clone();

  var oldvalue = locator.element.nodeValue;

  var newnode = rangy.dom.splitDataNode(locator.element, locator.offset);

  if (undoitem)
    undoitem.addItem(
      _undoSplitDataNode.bind(this, locator.element, oldvalue, newnode, '', true),
      _redoSplitDataNode.bind(this, locator.element, locator.element.nodeValue, newnode, newnode.nodeValue, true));

  // Correct preservelocators for the node split
  applyPreserveFunc(preservelocators, _correctForNodeSplit.bind(this, locator, newnode, preservetoward == 'start'));

  return Locator.newPointingTo(newnode);
}

function _undoSplitDataNode(oldelt, oldeltval, newelt, neweltval, handlenewelt)
{
  oldelt.nodeValue = oldeltval;
  newelt.nodeValue = neweltval;
  if (handlenewelt)
    newelt.parentNode.removeChild(newelt);
}

function _redoSplitDataNode(oldelt, oldeltval, newelt, neweltval, handlenewelt)
{
  oldelt.nodeValue = oldeltval;
  newelt.nodeValue = neweltval;
  if (handlenewelt)
    oldelt.parentNode.insertBefore(newelt, oldelt.nextSibling);
}

/** Splits an element node at a locator, can keep other locators at the same position
    @param locator Place to split the element node
    @param preservelocators List of locators/ranges to keep valid.
    @param preservetoward 'start' or 'end' (default: 'end') Direction to move preserved locators at the splitpoint
    @return Locator pointing to new element
*/
function splitElement(locator, preservelocators, preservetoward, undoitem)
{
  if (preservetoward && ![ 'start', 'end' ].includes(preservetoward))
    throw new Error("Illegal preservetoward value '" + preservetoward + "'");

  // Clone locator, so its presence in preservelocators won't mess up stuff during the applyPreserveFunc
  locator = locator.clone();

  // Create result locator, point to element after locator.element
  var result = Locator.newPointingTo(locator.element);
  ++result.offset;

  // Create the new node, and insert it in the dom
  var newnode = locator.element.cloneNode(false);
  result.insertNode(newnode, null, undoitem);

  // Move all nodes past locator to the new node
  var tocopy = Array.from(locator.element.childNodes).slice(locator.offset);
  appendNodes(tocopy, newnode);

  if (undoitem)
    undoitem.addItem(
      _undoSplitElement.bind(this, locator.element, tocopy, newnode),
      _redoSplitElement.bind(this, locator.element, tocopy, newnode));

  // Correct preservelocators for the node split
  applyPreserveFunc(preservelocators, _correctForNodeSplit.bind(this, locator, newnode, preservetoward == 'start'));

  return result;
}

function _undoSplitElement(oldelt, nodes, newelt)
{
  appendNodes(nodes, oldelt);
}

function _redoSplitElement(oldelt, nodes, newelt)
{
  appendNodes(nodes, newelt);
}

/** Corrects this locator for changes made when splitting a node
    @param splitlocator Position where the split was made
    @param newnode New node, that received the contents of the parent node after the split position.
*/
function _correctForNodeSplit(splitlocator, newnode, towardstart, tocorrect)
{

//    console.log(' cfns', '$'+locator.id, locator.element, locator.offset, '$'+splitlocator.id, splitlocator.element, splitlocator.offset);
  if (tocorrect.element == splitlocator.element && (towardstart ? tocorrect.offset > splitlocator.offset : tocorrect.offset >= splitlocator.offset))
  {
    // console.log(' move to new element');
    tocorrect.element = newnode;
    tocorrect.offset -= splitlocator.offset;
  }
  else if (tocorrect.element == splitlocator.element.parentNode && tocorrect.offset > rangy.dom.getNodeIndex(splitlocator.element))
  {
    // console.log(' move to nextsibling');
    // Correct for extra inserted node
    ++tocorrect.offset;
  }
}

/** Split the dom in-place beneath an ancestor node for a list of locators.
    For every split part, locators pointing to the start and the end of the fragment are provided
    (but only if the fragments had any elements)
    @param ancestor Ancestor node
    @param splitpoints Points to split the locators on
    @cell splitpoints.locator
    @cell splitpoints.toward 'start'/'end'
    @param preservelocators Optional list of locators/ranges to preserve
    @return Array of Range objects, describing the space betweent the splitpoints (all with parent = ancestor)
*/
function splitDom(ancestor, splitpoints, preservelocators, undoitem)
{
  if (!ancestor)
    throw new Error("No ancestor in splitdom!");

  //console.log('Splitdom pre ', ancestor, richdebug.getStructuredOuterHTML(ancestor, splitpoints));
  //console.log('Splitdom pre  preserve', richdebug.getStructuredOuterHTML(ancestor, preservelocators));

  if ([3,4].includes(ancestor.nodeType))
    throw new Error("splitDom ancestor must be an element");

  // Copy the preservelocators array, we have some extra locators to preserve
  preservelocators = (preservelocators || []).slice();
  var resultlocators = [];

  // Move the splitpoints as far up to their ancestor as possible, to avoid unnecessary splits. Done in 2
  // steps because the initial ascend step influences the preservelocators.
  for (var i = 0; i < splitpoints.length; ++i)
  {
    var orglocator = splitpoints[i].locator;
    splitpoints[i].locator = splitpoints[i].locator.clone();

    // Move locator as far toward ancestor as possible, so we can avoid splitting off empty elements
    splitpoints[i].locator.ascend(ancestor, splitpoints[i].toward === 'end');

    var preservetoward = splitpoints[i].preservetoward = splitpoints[i].preservetoward || 'end';
    if (!['start','end'].includes(preservetoward))
      throw new Error("Illegal preservetoward value '" + preservetoward + "'");

    var cmp = splitpoints[i].locator.compare(orglocator);
    if (cmp < 0)
    {
      // Correct preservelocators for the node split
      applyPreserveFunc(preservelocators, _correctForSplitLocatorMove.bind(this, splitpoints[i].locator, orglocator, preservetoward == 'start', splitpoints[i].locator));
      splitpoints[i].preservetoward = 'start';
    }
    else if (cmp > 0)
    {
      // Correct preservelocators for the node split
      applyPreserveFunc(preservelocators, _correctForSplitLocatorMove.bind(this, orglocator, splitpoints[i].locator, preservetoward == 'end', splitpoints[i].locator));
      splitpoints[i].preservetoward = 'end';
    }
  }

  //console.log('Splitdom pre adj ', ancestor, richdebug.getStructuredOuterHTML(ancestor, splitpoints));
  //console.log('Splitdom pre adj preserve', richdebug.getStructuredOuterHTML(ancestor, preservelocators));

  /* Go from back to front, so the cloned nodes don't interfere with earlier locators
     The locators that point to the split parts are inserted into resultlocators
     (locators are formatted so that the element != ancestor, to avoid invaliding offsets within
      the ancestor)
  */
  for (let i = splitpoints.length - 1; i >= 0; --i)
  {
    var locator = splitpoints[i].locator; // no clone needed anymore

    // Move locator as far toward ancestor as possible, so we can avoid splitting off empty elements
    locator.ascend(ancestor, splitpoints[i].toward === 'end');

    // Within a text node? Split the text node, and retarget the locator to the new element
    if (locator.element.nodeType == 3)
      locator = splitDataNode(locator, preservelocators, splitpoints[i].preservetoward, undoitem);

    while (locator.element != ancestor)
      locator = splitElement(locator, preservelocators, splitpoints[i].preservetoward, undoitem);

    // Add to beginning to keep in correct order
    resultlocators.splice(0, 0, locator);

    // And make sure it is preserved with further modifications
    preservelocators.push(locator);
  }

  // Add locators to start and end of ancestor
  resultlocators.splice(0, 0, new Locator(ancestor));
  resultlocators.push(new Locator(ancestor, "end"));

  // Calculate all ranges
  var result = [];
  for (let i = 0; i < resultlocators.length - 1; ++i)
    result.push(new Range(resultlocators[i], resultlocators[i+1]));

  //console.log('Splitdom post preserve', richdebug.getStructuredOuterHTML(ancestor, preservelocators));
  //console.log('Splitdom post', richdebug.getStructuredOuterHTML(ancestor, result));

  return result;
}

/** Corrects this locator for the moving of the splitting locator upstream
    @param orglocator Original splitting locator
    @param locator
*/
function _correctForSplitLocatorMove(rangestart, rangeend, includebounds, newlocator, tocorrect)
{
  if (tocorrect.compare(rangestart) > (includebounds?-1:0) && tocorrect.compare(rangeend) < (includebounds?1:0))
    tocorrect.assign(newlocator);
}

/** Combines a node and its previous sibling (moves all childnodes from node into its previousSibling)
    and keeps a list of locators as close as possible to their original place
    @param node
    @param preservelocators
    @return Place where stuff was inserted
*/
function combineNodeWithPreviousNode(node, preservelocators, undoitem)
{
  if (!node)
    throw new Error("Illegal parameter");

  var left = node.previousSibling;
  var right = node;

  if (!left)
    throw new Error("Node has no previous sibling to combine with");

  return combineNodes(new Locator(left, "end"), right, preservelocators, undoitem);
}


/** Moves the contents of a node into a previous node at the specified position, keeps a list of locators
    as close as possible to their original place. Keeps a list of locators/ranges as close as possible to
    their original place (locators between the insert position and the moved content are repositioned to
    the insertposition)
    @param insertlocator
    @param right
    @param preservelocators
    @return Node & locator where stuff was inserted & locator after place where stuff was inserted
*/
function combineNodes(insertlocator, right, preservelocators, undoitem)
{
  insertlocator = insertlocator.clone();
  var left = insertlocator.element;

  if (left.nodeType != right.nodeType || ![1,3,4].includes(left.nodeType))
    throw new Error("Left and right node not the same type (or no element or data node)");

/* TODO: express in terms of moveRangeTo, so we can remove the insanely complicated correct code below.
  var range = Range.fromNodeInner(right);
  var res = moveRangeTo(range, insertlocator, preservelocators);

  var new_rightlocator = res.movedforward ? res.insertlocator : res.afterlocator;

  // Correct preservelocators for the node combine (before actual changes!)
  applyPreserveFunc(preservelocators, _correctForNodeCombine2.bind(this, right, new_rightlocator));

  var locator = Locator.newPointingTo(right);
  locator.removeNode(preservelocators.concat([ res.insertlocator, res.afterlocator ]));

  return { node: left, locator: res.insertlocator, afterlocator: res.afterlocator };
*/

  //console.log('combineNodes pre: ', richdebug.getStructuredOuterHTML(left.ownerDocument, { insertlocator: insertlocator, range: Range.fromNodeInner(right) }, true));
  //console.log('combineNodes locators: ', richdebug.getStructuredOuterHTML(left.ownerDocument, preservelocators, true));
  //for (var i = 0; locators && i < locators.length; ++i)
  //  console.log(' ', locators[i].element, locators[i].offset);

  //var leftend = new Locator(left, "end");
  var rightptr = Locator.newPointingTo(right);
  var afterrightptr = Locator.newPointingAfter(right);

  var moveforward = false;
  if (afterrightptr.compare(insertlocator) <= 0)
    moveforward = true;
  else if (rightptr.compare(insertlocator) < 0)
    throw new Error("Can't move content inside removed node");

  // Correct preservelocators for the node combine (before actual changes!)
  applyPreserveFunc(preservelocators, _correctForNodeCombine.bind(this, insertlocator, right, rightptr, afterrightptr, moveforward));

  var afterlocator = insertlocator.clone();
  if (left.nodeType == 1)
  {
    //var pointednode = insertlocator.getPointedNode();

    var nodes = removeNodeContents(right);
    insertNodesAtLocator(nodes, insertlocator);
    afterlocator.offset += nodes.length;

    if (undoitem)
      undoitem.addItem(
        appendNodes.bind(this, nodes, right),
        insertNodesAtLocator.bind(this, nodes, insertlocator.clone()));
  }
  else
  {
    var oldvalue = left.nodeValue;
    var oldright = right.nodeValue;
    left.nodeValue = left.nodeValue.substr(0, insertlocator.offset) + right.nodeValue + left.nodeValue.substr(insertlocator.offset);
    afterlocator.offset += right.nodeValue.length;

    if (undoitem)
      undoitem.addItem(
        _redoSplitDataNode.bind(this, left, oldvalue, right, oldright, false),
        _undoSplitDataNode.bind(this, left, left.nodeValue, right, right.nodeValue, false));

  }

  rightptr = Locator.newPointingTo(right);
  rightptr.removeNode([ insertlocator, afterlocator ], undoitem);

  return { node: left, locator: insertlocator, afterlocator: afterlocator };
}

/** Corrects this locator for changes made when combining a node. Called before actual changes are made!
    @param appendlocator Place where childnodes of the removed node were placed
    @param newnode New node, that received the contents of the parent node after the split position.
*/
function _correctForNodeCombine(insertlocator, removednode, removedlocator, afterremovedlocator, moveforward, tocorrect)
{
  // Correct the insert locator for removed node
  var corr_insertlocator = insertlocator;
  if (insertlocator.element == removedlocator.element && insertlocator.offset > removedlocator.offset)
  {
    corr_insertlocator = insertlocator.clone();
    --corr_insertlocator.offset;
  }

  if (tocorrect.element == removednode)
  {
    // Within the removed element? Adjust to new place relative to (corrected) insertlocator
    tocorrect.element = corr_insertlocator.element;
    tocorrect.offset += corr_insertlocator.offset;
    return;
  }

  // Within the removed nodes? No correction needed
  if (tocorrect.compare(removedlocator) > 0 && tocorrect.compare(afterremovedlocator) < 0)
    return;

  if (moveforward)
  {
    if (tocorrect.compare(afterremovedlocator) >= 0 && tocorrect.compare(insertlocator) <= 0)
    {
      tocorrect.assign(corr_insertlocator);
      tocorrect.offset += removednode.childNodes.length;
    }
    else if (tocorrect.element == insertlocator.element && tocorrect.offset >= insertlocator.offset)
    {
      let plus = tocorrect.offset - insertlocator.offset;
      tocorrect.assign(corr_insertlocator);
      tocorrect.offset += plus;
    }
    else if (tocorrect.element == removedlocator.element && tocorrect.offset > removedlocator.offset)
      --tocorrect.offset;
  }
  else
  {
    if (tocorrect.compare(removedlocator) <= 0 && tocorrect.compare(insertlocator) >= 0)
      tocorrect.assign(corr_insertlocator);
    else if (tocorrect.element == insertlocator.element && tocorrect.offset >= insertlocator.offset)
    {
      let plus = tocorrect.offset - insertlocator.offset;
      if (tocorrect.element == removedlocator.element && tocorrect.offset > removedlocator.offset)
        --plus;

      tocorrect.assign(corr_insertlocator);
      tocorrect.offset += plus + removednode.childNodes.length;
    }
    else if (tocorrect.element == removedlocator.element && tocorrect.offset > removedlocator.offset)
      --tocorrect.offset;
  }
}

function moveSimpleRangeTo(range, insertlocator, preservelocators, undoitem)
{
  if (range.start.element != range.end.element)
    throw new Error("moveRangeTo can only move a range with the start and end element the same");

  var rangeisnode = range.start.parentIsElementOrFragmentNode();
  if (rangeisnode != insertlocator.parentIsElementOrFragmentNode())
    throw new Error("moveRangeTo can only move nodes to within elements & data to within data nodes");

  // Clone all locators, don't want the preserve functions to mess with them
  insertlocator = insertlocator.clone();
  var startlocator = range.start.clone();
  var endlocator = range.end.clone();

  // Keep the original, possibly need to correct for the removal of the nodes if in the same parent.
  let orginsertlocator = insertlocator.clone();

  //console.log(range.start, range.end, insertlocator);

  //console.log('moveRangeTo pre: ', richdebug.getStructuredOuterHTML(Locator.findCommonAncestorElement(range.start, insertlocator), { insertlocator: insertlocator, range: range }, true));

  var moveforward = false;
  if (endlocator.compare(insertlocator) <= 0)
    moveforward = true;
  else if (startlocator.compare(insertlocator) < 0)
    throw new Error("Can't move content inside removed node");//#1" + richdebug.getStructuredOuterHTML(Locator.findCommonAncestorElement(range.start, insertlocator), { insertlocator: insertlocator, range: range })


  // Correct insertlocator if needed. May only be used after range has been removed from the DOM!!
  if (insertlocator.element == startlocator.element && insertlocator.offset >= endlocator.offset)
    insertlocator.offset -= endlocator.offset - startlocator.offset;

  //console.log('remove pre1', richdebug.getStructuredOuterHTML(Locator.findCommonAncestorElement(startlocator, insertlocator), { nodes: nodes, startlocator_element: startlocator.element }));

  //console.log('#1', startlocator.element, preservelocators.contains(startlocator));

  // Correct preservelocators for the node combine (before actual changes!)
  applyPreserveFunc(preservelocators, _correctForNodeMove.bind(this, startlocator, endlocator, orginsertlocator, insertlocator, moveforward));

  //console.log('#2', startlocator.element);
  //console.log(nodes);
  //console.log('remove pre2', richdebug.getStructuredOuterHTML(Locator.findCommonAncestorElement(startlocator, insertlocator), { nodes: nodes, startlocator_element: startlocator.element }));

  // Need the afterlocator and the insertlocator too, so copy
  var afterlocator = insertlocator.clone();

  if (rangeisnode)
  {
    // Remove the nodes from the range. After this, the correct insertlocator is valid
    var nodes = Array.from(startlocator.element.childNodes).slice(startlocator.offset, endlocator.offset);
    var oldafterlocator = afterlocator.clone();

    afterlocator = removeAndInsertNodesAtLocator(nodes, afterlocator);

    if (undoitem)
      undoitem.addItem(
        removeAndInsertNodesAtLocator.bind(this, nodes, startlocator),
        removeAndInsertNodesAtLocator.bind(this, nodes, oldafterlocator));
  }
  else
  {
    // Move data over from the original location to the new location
    var oldnode = startlocator.element;
    var newnode = insertlocator.element; // may be the same as oldnode!

    var oldnodeoldval = oldnode.nodeValue;
    var newnodeoldval = newnode.nodeValue;

    // First get the data to move, and remove it. Only after that, insertlocator is valid.
    var tomove = oldnode.nodeValue.substring(startlocator.offset, endlocator.offset);
    oldnode.nodeValue = oldnode.nodeValue.substr(0, startlocator.offset) + oldnode.nodeValue.substr(endlocator.offset);

    // insertlocator is now valid. Insert the data, adjust the afterlocator
    newnode.nodeValue = newnode.nodeValue.substr(0, insertlocator.offset) + tomove + newnode.nodeValue.substr(insertlocator.offset);
    afterlocator.offset += tomove.length;

    if (undoitem)
      undoitem.addItem(
        _undoSplitDataNode.bind(this, oldnode, oldnodeoldval, newnode, newnodeoldval, false),
        _redoSplitDataNode.bind(this, oldnode, oldnode.nodeValue, newnode, newnode.nodeValue, false));
  }

  return { insertlocator: insertlocator, afterlocator: afterlocator, movedforward: moveforward };
}

function _correctForNodeMove(startlocator, endlocator, insertlocator, corr_insertlocator, moveforward, tocorrect)
{
  if (tocorrect.element == startlocator.element)
  {
    // Between any of the moved nodes? Move to (corrected) insertlocator
    if (tocorrect.offset > startlocator.offset && tocorrect.offset < endlocator.offset)
    {
      //console.log(' between moved nodes');
      tocorrect.element = corr_insertlocator.element;
      tocorrect.offset = corr_insertlocator.offset + (tocorrect.offset - startlocator.offset);
      return;
    }
  }

  var startcompare = tocorrect.compare(startlocator);
  var endcompare = tocorrect.compare(endlocator);

  if (startcompare > 0 && endcompare < 0)
  {
    //console.log(' inside moved nodes');
    return; // Within the removed nodes? No correction needed
  }

  // Between the moved nodes and the insertposition? Move to start/end of newly inserted nodes
  if (moveforward)
  {
    if (endcompare >= 0 && tocorrect.compare(insertlocator) <= 0)
    {
      //console.log(' forward, between end and insertpoint');
      tocorrect.element = corr_insertlocator.element;
      tocorrect.offset = corr_insertlocator.offset + (endlocator.offset - startlocator.offset);
      return;
    }
  }
  else
  {
    if (startcompare <= 0 && tocorrect.compare(insertlocator) >= 0)
    {
      //console.log(' backward, between insertpoint and start');
      tocorrect.assign(corr_insertlocator);
      return;
    }
  }

  if (startlocator.element == insertlocator.element)
  {
    //console.log(' start.elt=insert.elt, no correction needed');
    return;
  }

  if (tocorrect.element == insertlocator.element)
  {
    if (tocorrect.offset > insertlocator.offset)
    {
      //console.log(' after inserted nodes', tocorrect.offset, insertlocator.offset, corr_insertlocator.offset);
      tocorrect.offset = corr_insertlocator.offset + (tocorrect.offset - insertlocator.offset) + (endlocator.offset - startlocator.offset);
      return;
    }
  }
  else if (tocorrect.element == endlocator.element)
  {
    if (tocorrect.offset >= endlocator.offset)
    {
      //console.log(' after removed nodes');
      tocorrect.offset -= endlocator.offset - startlocator.offset;
      return;
    }
  }
  //console.log(' no correction needed');
}

function removeSimpleRange(range, preservelocators, undoitem)
{
  if (range.start.element != range.end.element)
    throw new Error("removeRange can only remove a range with the start and end element the same");

  range = range.clone();

  var rangeisnode = range.start.parentIsElementOrFragmentNode();

  // Correct preservelocators for the node combine (before actual changes!)
  applyPreserveFunc(preservelocators, _correctForRangeRemove.bind(this, range));

  var fragment = document.createDocumentFragment();
  if (rangeisnode)
  {
    // Remove the nodes from the range
    var nodes = Array.from(range.start.element.childNodes).slice(range.start.offset, range.end.offset);
    for (var i = 0; i < nodes.length; ++i)
      fragment.appendChild(nodes[i]);

    if (undoitem)
      undoitem.addItem(
        removeAndInsertNodesAtLocator.bind(this, nodes, range.start),
        removeSimpleRange.bind(this, range));
  }
  else
  {
    // Just remove the data
    var oldnode = range.start.element;
    var oldvalue = oldnode.nodeValue;
    var tomove = oldnode.nodeValue.substring(range.start.offset, range.end.offset);
    oldnode.nodeValue = oldnode.nodeValue.substr(0, range.start.offset) + oldnode.nodeValue.substr(range.end.offset);
    fragment.appendChild(document.createTextNode(tomove));

    // FIXME: bit too hacky!
    if (undoitem)
      undoitem.addItem(
        _undoSplitDataNode.bind(this, oldnode, oldvalue, oldnode, oldvalue, false),
        _redoSplitDataNode.bind(this, oldnode, oldnode.nodeValue, oldnode, oldnode.nodeValue, false));
  }

  return { fragment: fragment };
}

function _correctForRangeRemove(range, tocorrect)
{
  if (tocorrect.element == range.end.element && tocorrect.offset >= range.end.offset)
    tocorrect.offset -= range.end.offset - range.start.offset;
  else if (tocorrect.compare(range.start) > 0 && tocorrect.compare(range.end) < 0)
    tocorrect.assign(range.start);
}

/** Replaces a node with its contents
*/
function replaceSingleNodeWithItsContents(node, preservelocators, undoitem)
{
  //var parent = node.parentNode;

//    console.log('RNWIC pre ', richdebug.getStructuredOuterHTML(parent, preservelocators));
  var locator = Locator.newPointingTo(node);

  var nodes = removeNodeContents(node);
  insertNodesAtLocator(nodes, locator);

  if (undoitem)
    undoitem.addItem(
      removeAndInsertNodesAtLocator.bind(this, nodes, new Locator(node)),
      removeAndInsertNodesAtLocator.bind(this, nodes, locator));

  var nodelocator = Locator.newPointingTo(node);
  nodelocator.removeNode(null, undoitem);

  // Correct preservelocators for the node combine
  applyPreserveFunc(preservelocators, _correctForReplaceWithChildren.bind(this, locator, node, nodes.length));
//    console.log('RNWIC post', richdebug.getStructuredOuterHTML(parent, preservelocators));
}

/** Corrects the range for changes made when a node is replaced with its contents
    @param locator Locator of the removed node
    @param endlocator Locator of the end of inserted children (locator.element == endlocator.element)
    @param removednode Removed node
*/
function _correctForReplaceWithChildren(locator, removednode, childcount, tocorrect)
{
  if (tocorrect.element == removednode) // Within the removed element? Adjust to new place within old element
  {
    tocorrect.element = locator.element;
    tocorrect.offset += locator.offset;
  }
  else if (tocorrect.element == locator.element && tocorrect.offset > locator.offset)
  {
    // Points to node that's nextsibling of right. Correct for right's removal, and the children insert
    tocorrect.offset = tocorrect.offset - 1 + childcount;
  }
}

/** Wraps the nodes point to by locator (and nodecount-1 of its siblings) in a new node, that is then
    inserted at that location
    @param Locator Locator pointing to node to wrap
    @param nodecount Nr of nodes to wrap
    @param newnode Node to replace the nodes with
    @param preservelocators Locators/ranges to preserve
*/
function wrapSimpleRangeInNewNode(range, newnode, preservelocators, undoitem)
{
  if (range.start.element != range.end.element)
    throw new Error("wrapSimpleRangeInNewNode only works with ranges where start element is equal to end element");

  // Preserve range too
  preservelocators = (preservelocators || []).concat(range);
  return wrapNodesInNewNode(range.start, range.end.offset - range.start.offset, newnode, preservelocators, undoitem);
}


/** Wraps the nodes point to by locator (and nodecount-1 of its siblings) in a new node, that is then
    inserted at that location
    @param Locator Locator pointing to node to wrap
    @param nodecount Nr of nodes to wrap
    @param newnode Node to replace the nodes with
    @param preservelocators Locators/ranges to preserver
*/
function wrapNodesInNewNode(locator, nodecount, newnode, preservelocators, undoitem)
{
  //console.log('WNINN pre', richdebug.getStructuredOuterHTML(locator.element, preservelocators, true), newnode);

  // Clone locator, so its presence in preservelocators won't mess up stuff during the applyPreserveFunc
  locator = locator.clone();

  let nodes = Array.from(locator.element.childNodes).slice(locator.offset, locator.offset + nodecount);
  appendNodes(nodes, newnode);

  if (undoitem)
    undoitem.addItem(
      removeAndInsertNodesAtLocator.bind(this, nodes, locator.clone()),
      removeAndInsertNodesAtLocator.bind(this, nodes, new Locator(newnode)));

  locator.insertNode(newnode, null, undoitem);

  // Correct preservelocators for the node split
  applyPreserveFunc(preservelocators, _correctForNodeWrap.bind(this, locator, nodecount, newnode));

  //console.log('WNINN post', richdebug.getStructuredOuterHTML(locator.element, preservelocators, true));

  ++locator.offset;
  return locator;
}

function _correctForNodeWrap(locator, childcount, newnode, tocorrect)
{
  if (tocorrect.element == locator.element)
  {
    if (tocorrect.offset >= locator.offset)
    {
      if (tocorrect.offset <= locator.offset + childcount)
      {
        tocorrect.element = newnode;
        tocorrect.offset -= locator.offset;
      }
      else
        tocorrect.offset = tocorrect.offset - childcount + 1;
    }
  }
}

/** Removes all nodes in a tree that match a filter
*/
function removeNodesFromTree(node, filter, preservelocators, undoitem)
{
  // FIXME: combine adjacesnt same (text)nodes
  for (var i = 0; i < node.childNodes.length;)
  {
    var child = node.childNodes[i];
    if (isNodeFilterMatch(child, filter))
      replaceSingleNodeWithItsContents(child, preservelocators, undoitem);
    else
    {
      removeNodesFromTree(child, filter, preservelocators, undoitem);
      ++i;
    }
  }
}

 /** Removes nodes from a range, when the nodes to remove have already been split on the range
     boundaries
     @param ancestor Ancestor to start at
     @param range Range to remove nodes
     @param filter Filter function to test the nodes on, or nodename
     @param preservelocators Locators/ranges to preserver
*/
function removeNodesFromRangeRecursiveInternal(ancestor, range, filter, preservelocators, undoitem)
{
  // FIXME: combine adjacesnt same (text)nodes

  var xstart = range.start.clone();
  xstart.ascend(ancestor, false, true);
  var xend = range.end.clone();
  xend.ascend(ancestor, true, true);

  //console.log('RNFRR local', richdebug.getStructuredOuterHTML(ancestor, {xend:xend,xstart:xstart}));

  preservelocators = (preservelocators || []).slice();
  preservelocators.push(xend);

  while (!xstart.equals(xend))
  {
    // console.log(xstart.element, xstart.offset, xend.element, xend.offset);
    var node = xstart.getPointedNode();

    // Skip data nodes
    if ([3,4].includes(node.nodeType))
    {
      ++xstart.offset;
      continue;
    }

    if (isNodeFilterMatch(node, filter))
      replaceSingleNodeWithItsContents(node, preservelocators, undoitem);
    else
    {
      var noderange = Range.fromNodeInner(node);
      var subrange = range.clone();
      subrange.intersect(noderange);

      if (subrange.equals(noderange))
        removeNodesFromTree(node, filter, preservelocators, undoitem);
      else
        removeNodesFromRangeRecursiveInternal(node, subrange, filter, preservelocators, undoitem);
      ++xstart.offset;
    }
  }

  //console.log('RNFRR end', richdebug.getStructuredOuterHTML(ancestor));
}

/** Removes nodes that match a filter from a tree (but keeps their contents)
    @param range Range to remove the nodes from (is kept valid)
    @param maxancestor Ancestor to stop at
    @param filter Filter for nodes to remove (either string for nodename match or function)
    @param preservelocators Additional locators/ranges to preserve
*/
function removeNodesFromRange(range, maxancestor, filter, preservelocators, undoitem)
{
  preservelocators = (preservelocators || []).slice();
  preservelocators.push(range);

  var ancestor;

  // console.log('RNFR start', richdebug.getStructuredOuterHTML(maxancestor, range));

  // Is an ancestor of the range a match? If so, split the dom around the range and remove the node.
  while (true)
  {
    ancestor = range.getAncestorElement();
    let typeparent = findParent(ancestor, filter, maxancestor);

    if (!typeparent || typeparent == maxancestor)
      break;

//      console.log('splitdom for ancestor! ' + xcount);
//      console.log('A locations ', richdebug.getStructuredOuterHTML(maxancestor, {ancestor:ancestor,typeparent: typeparent,range:range}));

//      console.log('A split pre ', richdebug.getStructuredOuterHTML(typeparent.parentNode, {ancestor:ancestor,typeparent: typeparent,range:range}));
    var parts = splitDom(typeparent.parentNode, [ { locator: range.start, toward: 'start' }, { locator: range.end, toward: 'end' } ], preservelocators, undoitem);
//      console.log('A split post', richdebug.getStructuredOuterHTML(typeparent.parentNode, {typeparent: typeparent,range:range}));
//      console.log('A split post2', richdebug.getStructuredOuterHTML(typeparent.parentNode, parts));

    var locator = parts[1].start.clone();

    var localpreserve = preservelocators.concat([ locator, parts[1].end ]);

    while (!locator.equals(parts[1].end))
    {
      var node = locator.getPointedNode();
//        console.log('A replace pre', richdebug.getStructuredOuterHTML(typeparent.parentNode, {node:node, locator:locator}));
      ++locator.offset;
      replaceSingleNodeWithItsContents(node, localpreserve, undoitem);
//        console.log('A replace post', richdebug.getStructuredOuterHTML(typeparent.parentNode, {node:node, locator:locator}));
    }

    //
    range.start.assign(parts[1].start.clone());
    range.end.assign(locator);

//      console.log('ancestor splitdom done', richdebug.getStructuredOuterHTML(typeparent.parentNode, {typeparent: typeparent,range:range}));
  }

  //
  while (true)
  {
    let typeparent = findParent(range.start.element, filter, ancestor);
    if (!typeparent)
      break;

//      console.log('L split pre ', richdebug.getStructuredOuterHTML(typeparent.parentNode, orglocators));
    let parts = splitDom(typeparent.parentNode, [ { locator: range.start, toward: 'start' } ], preservelocators, undoitem);
//      console.log('L split post', richdebug.getStructuredOuterHTML(typeparent.parentNode, orglocators));
    range.start.assign(parts[1].start);
  }

  while (true)
  {
    let typeparent = findParent(range.end.element, filter, ancestor);
    if (!typeparent)
      break;

//      console.log('R split pre ', richdebug.getStructuredOuterHTML(typeparent.parentNode, orglocators));
    let parts = splitDom(typeparent.parentNode, [ { locator: range.end, toward: 'end' } ], preservelocators, undoitem);
//      console.log('R split post', richdebug.getStructuredOuterHTML(typeparent.parentNode, orglocators));
    range.end.assign(parts[0].end);
  }

  removeNodesFromRangeRecursiveInternal(ancestor, range, filter, preservelocators, undoitem);

  // console.log('RNFR done', richdebug.getStructuredOuterHTML(maxancestor, range));
}

function canWrapNode(node, canwrapnodefunc, mustwrapnodefunc)
{
  /*
  var mustanswer = mustwrapnodefunc && mustwrapnodefunc(node);
  var cananswer = !canwrapnodefunc || canwrapnodefunc(node);
  console.log('canWrapNode', node, mustanswer, cananswer);*/
  return (mustwrapnodefunc && mustwrapnodefunc(node)) || (!canwrapnodefunc || canwrapnodefunc(node));
}

function getWrappingSplitRoot(locator, ancestor, canwrapnodefunc, mustwrapnodefunc)
{
  var node = locator.element;
  if ([3,4].includes(node.nodeType))
    node = node.parentNode;
  while (node != ancestor && canWrapNode(node, canwrapnodefunc, mustwrapnodefunc))
    node = node.parentNode;
  return node;
}

function wrapRangeRecursiveInternal(range, ancestor, createnodefunc, canwrapnodefunc, mustwrapnodefunc, preservelocators, undoitem)
{
//    console.log('WRRI start', richdebug.getStructuredOuterHTML(ancestor, range));

  // Get the range of nodes we need to visit in the current ancestor
  var localrange = range.clone();
  localrange.start.ascend(ancestor, false, true);
  localrange.end.ascend(ancestor, true, true);

//    console.log('WRRI local', richdebug.getStructuredOuterHTML(ancestor, localrange));

  // Make sure localrange.end is preserved!!!
  preservelocators = (preservelocators || []).slice();
  preservelocators.push(localrange.end);

  /* Iterate through the nodes. Collect wrappable nodes, wrap them when first unwrappable node
     is encountered, or after end of range. Iterate into unwrappable nodes
  */
  var wrapstart = localrange.start.clone();
  while (!localrange.start.equals(localrange.end))
  {
    // Text node or wrappable: goto next sibling
    var node = localrange.start.getPointedNode();
    if ([3,4].includes(node.nodeType) || canWrapNode(node, canwrapnodefunc, mustwrapnodefunc))
    {
      ++localrange.start.offset;
      continue;
    }

    // Current node is unwrappable. Wrap previous wrappebles (if present)
    if (!wrapstart.equals(localrange.start))
    {
      let newnode = createnodefunc();
      // console.log('call wninn1', preservelocators);
      wrapNodesInNewNode(wrapstart, localrange.start.offset - wrapstart.offset, newnode, preservelocators, undoitem);
      ++wrapstart.offset;
    }

    // Calculate subrange within node for iteration (localrange.constrainto(node)?)
    var noderange = Range.fromNodeInner(node);
    var subrange = range.clone();
    subrange.intersect(noderange);

    // Iterate into the node, and reset the start if the first wrappable node
    wrapRangeRecursiveInternal(subrange, node, createnodefunc, canwrapnodefunc, mustwrapnodefunc, preservelocators, undoitem);

    ++wrapstart.offset;
    localrange.start.assign(wrapstart);
  }

    // Wrap previous wrappebles (if present)
  if (!wrapstart.equals(localrange.start))
  {
    let newnode = createnodefunc();
    // console.log('call wninn2', preservelocators);
    wrapNodesInNewNode(wrapstart, localrange.start.offset - wrapstart.offset, newnode, preservelocators, undoitem);
  }

//    console.log('WRRI end', richdebug.getStructuredOuterHTML(ancestor));
}

function wrapRange(range, createnodefunc, canwrapnodefunc, mustwrapnodefunc, preservelocators, undoitem)
{
//    console.log('wrapRange', range, createnodefunc, canwrapnodefunc, mustwrapnodefunc, preservelocators);

  // Make sure range is preserved too
  preservelocators = (preservelocators || []).slice();
  preservelocators.push(range);

  range = range.clone();
//    range.descendToLeafNodes();

//    console.log('WR going split0', richdebug.getStructuredOuterHTML(range.getAncestor() || range.start.element.ownerDocument, { loc: range.start }));
  var ancestor = range.getAncestorElement();
  if (mustwrapnodefunc)
  {
    while (mustwrapnodefunc(ancestor))
      ancestor = ancestor.parentNode;
  }

//    console.log('WR before presplits', richdebug.getStructuredOuterHTML(ancestor, range));

//    console.log('WR going split1', richdebug.getStructuredOuterHTML(ancestor, { loc: range.start }));
  var startroot = getWrappingSplitRoot(range.start, ancestor, canwrapnodefunc, mustwrapnodefunc);

//    console.log('WR startroot', richdebug.getStructuredOuterHTML(ancestor, {startroot:startroot}));

//    console.log('WR going split2', richdebug.getStructuredOuterHTML(startroot, { loc: range.start }));
  var parts = splitDom(startroot, [ { locator: range.start, toward: "end" } ], preservelocators.concat([range.end]), undoitem);

//    console.log('WR after start split', richdebug.getStructuredOuterHTML(ancestor, parts));

  range.start.assign(parts[1].start);

  var endroot = getWrappingSplitRoot(range.end , ancestor, canwrapnodefunc, mustwrapnodefunc);
//    console.log('WR presplit', richdebug.getStructuredOuterHTML(ancestor, {endroot:endroot, range: range}));

  parts = splitDom(endroot, [ { locator: range.end, toward: "start" } ], preservelocators.concat([range.start]), undoitem);

  range.end.assign(parts[0].end);

//    console.log('WR after presplits', richdebug.getStructuredOuterHTML(ancestor, range));

  wrapRangeRecursiveInternal(range, ancestor, createnodefunc, canwrapnodefunc, mustwrapnodefunc, preservelocators, undoitem);
}

/** Combines adjacent nodes of with each other at a locator recursively
    @param locator Locator to the place to combine the nodes
    @param ancestor Ancestor node
    @param towardsend Direction to go (used when locator is placed within empty node)
    @param combinetest Test to check whether nodes. Can be nodeName, array of nodeNames or bool function. If false,
        only text nodes will be combined.
    @param preservelocators Locators/ranges to preserve the location of
 */
function combineWithPreviousNodesAtLocator(locator, ancestor, towardsend, combinetest, preservelocators, undoitem)
{
  if (!ancestor.contains(locator.element))
    throw new Error("Locator position problem");

  preservelocators = (preservelocators || []).slice();
  preservelocators.push(locator);

  locator = locator.clone();
  locator.ascend(ancestor, towardsend, false);

  while (locator.offset != 0)
  {
    if (!locator.parentIsElementOrFragmentNode() || locator.pointsPastChildrenEnd())
      break;

//      console.log(locator.element, locator.offset);

    var right = locator.getPointedNode();
    var left = right.previousSibling;

    if (right.nodeType != left.nodeType)
      break;

    // Always combine text/cdata nodes
    if (![3,4].includes(right.nodeType))
    {
      if (right.nodeType != 1)
        break;

      if (typeof combinetest == "function")
      {
        if (!combinetest(left, right))
          return;
      }
      else if (combinetest)
      {
        if (left.nodeName.toLowerCase() != right.nodeName.toLowerCase())
          break;
        if (typeof combinetest == "string")
        {
          if (left.nodeName.toLowerCase() != combinetest.toLowerCase())
            break;
        }
        else if (Array.isArray(combinetest))
        {
          if (!combinetest.includes(left.nodeName.toLowerCase()))
            break;
        }
        else
          throw new Error("Illegal combinetest in combineWithPreviousNodesAtLocator");
      }
      else
        break;
    }

    var res = combineNodeWithPreviousNode(right, preservelocators, undoitem);
    locator = res.locator;
  }
}

function hasNodeVisibleContent(node)
{
  if (isNodeAlwaysVisibleBlockElement(node))
    return true;

  var locator = new Locator(node);
  var res = locator.scanForward(node, { whitespace: true });
  return res.type != 'outerblock';
}

/** Make sure the content before the locator (and the block itself) is visible. If the next item is
    a superfluous block filler, it is removed
*/
function correctBlockFillerUse(locator, block, preservelocators, undoitem)
{
  var down = locator.clone();
  var downres = down.scanBackward(block, { whitespace: true });

  //console.log('correctBlockFillerUse', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down }));

  // If downres is a br, there is visible content (block not empty), and a br is needed when
  // upstream is a block boundary (inner block or outer block)
  if (downres.type == 'br')
  {
    let up = locator.clone();
    let upres = up.scanForward(block, { whitespace: true });

    //console.log(' found br', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, up: up }));

    // Blockboundaries merge with previous segment boundaries. Add one.
    if (upres.blockboundary)
    {
      let node = document.createElement('br');
      node.setAttribute('data-wh-rte', 'bogus');
      up.insertNode(node, preservelocators, undoitem);
      //console.log(' inserted br', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, up: up }));
      return { locator: up, node: node };
    }

    // Otherwise we're ok
    return null;
  }

  // Now, we only need to worry about the block being empty.
  downres = down.scanBackward(block, { whitespace: true, blocks: true });
  if (downres.type == 'outerblock' && downres.data == block && doesNodeRequireFillingWhenEmpty(block))
  {
    //console.log(' found outerblock', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, up: up }));

    let up = locator.clone();
    let upres = up.scanForward(block, { whitespace: true, blocks: true });

    if (upres.type == 'outerblock' && upres.data == block)
    {
      //console.log(' found outerblock both sides', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, up: up }));

      let node = document.createElement('br');
      node.setAttribute('data-wh-rte', 'bogus');
      up.insertNode(node, preservelocators, undoitem);

      //console.log(' inserted br', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, up: up }));
      return { locator: up, node: node };
    }
  }
  else
  {
    // There is stuff that makes the block visible. Filler br is not needed, see if there is one
    let up = locator.clone();
    let upres = up.scanForward(block, { whitespace: true, blocks: true });

    //console.log(' got down visible', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, up: up }));

    if (upres.type == 'br')
    {
      // Save it's location, see if it's really a filler
      var firstbr = up.clone();
      ++up.offset;

      let upres = up.scanForward(block, { whitespace: true, blocks: true });
      if (upres.type == 'outerblock' && upres.data == block)
      {
        firstbr.removeNode(preservelocators, undoitem);
        //console.log(' removed br', richdebug.getStructuredOuterHTML(block, { locator: locator, down: down, firstbr: firstbr }));
      }
    }
  }

  return null;
}

/** Make sure there is visible content in the current block after the locator
    If not, a 'br' is inserted.
    @param locator Locator within block
    @param maxancestor Block node
    @param preservelocators Locators to preserver
*/
function requireVisibleContentInBlockAfterLocator(locator, maxancestor, preservelocators, undoitem)
{
  return correctBlockFillerUse(locator, maxancestor, preservelocators, undoitem);
}

/// Removes nodes from the DOM
function removeNodes(nodes)
{
   for (var i = 0; i < nodes.length; ++i)
    if (nodes[i].parentNode)
      nodes[i].parentNode.removeChild(nodes[i]);
}

/// Removes all nodes from the dom, then inserts them at locator. Make sure locator is valid after removal of the nodes!
function removeAndInsertNodesAtLocator(nodes, locator)
{
  removeNodes(nodes);
  return insertNodesAtLocator(nodes, locator);
}

/** Inserts nodes at a new location. undo only works if the items don't need to be restored to their
    original position!
*/
function insertNodesAtLocator(nodes, locator, preservelocators, undoitem)
{
  var insertpos = locator.clone();
  for (var i = 0; i < nodes.length; ++i)
    insertpos = insertpos.insertNode(nodes[i], preservelocators);

  if (undoitem)
    undoitem.addItem(
      removeNodes.bind(this, nodes.slice()),
      insertNodesAtLocator.bind(this, nodes, locator.clone()));

  return insertpos;
}

function appendNodes(nodes, dest)
{
  for (var i = 0; i < nodes.length; ++i)
    dest.appendChild(nodes[i]);
}

function removeNodeContents(node, undoitem)
{
  /* Copy childNodes, then remove those from the dom. Must do it that way,
     because FF invents <br _moz_editor_bogus_node="TRUE"> when removing them one by one
  */
  var nodes = Array.from(node.childNodes);
  nodes.forEach(child => node.removeChild(child));

  if (undoitem)
    undoitem.addItem(
      insertNodesAtLocator.bind(this, nodes, new Locator(node)),
      removeNodeContents.bind(this, node));

  return nodes;
}

function combineAdjacentTextNodes(locator, preservelocators, undoitem)
{
  const xlocator = locator;
  let orglocator = locator.clone();
  preservelocators = (preservelocators || []).concat([ orglocator ]);
  orglocator.descendToLeafNode(locator.element, false);

  if ([3, 4].includes(locator.element.nodeType))
    locator.assign(Locator.newPointingTo(locator.element));
  let pointednode = locator.getPointedNode();
  if (!pointednode || ![3, 4].includes(pointednode.nodeType))
  {
    console.log(xlocator, orglocator, locator);
    throw new Error("Locator does not point to a text node");
  }

  while (true)
  {
    const prev = pointednode.previousSibling;
    if (!prev || ![3, 4].includes(prev.nodeType))
      break;
    pointednode = prev;
  }

  while (true)
  {
    const next = pointednode.nextSibling;
    if (!next || ![3, 4].includes(next.nodeType))
      break;

    let insertlocator = new Locator(pointednode, "end");
    combineNodes(insertlocator, next, preservelocators, undoitem);
  }

  return orglocator;
}

/** Given a locator that points inside a text node, the whitespaces/nbsps after the locator are rewritten
    to prevent whitespace collapsing and superfluous nbsps
*/
function rewriteWhitespace(maxancestor, locator, preservelocators, undoitem)
{
  const orglocator = locator.clone();
  preservelocators = (preservelocators || []).concat(orglocator);

  const elt = locator.element;
  const oldvalue = elt.nodeValue;

  if (![3, 4].includes(elt.nodeType))
    throw new Error("Locator does not point inside a text node");

  let newvalue = elt.nodeValue;

  // Determine whether the last character was whitespace. Treat start of parent as whitespace (want <b>"\u00a0content"</b>)
  let prev_whitespace = locator.offset === 0 || ' \t\r\n'.indexOf(newvalue.substr(locator.offset - 1, 1)) !== -1;

  while (locator.offset < newvalue.length)
  {
    // get the number of whitespace characters following the current locator
    let whitespaces = 0;
    while (locator.offset + whitespaces < newvalue.length && ' \t\r\n'.indexOf(newvalue.substr(locator.offset + whitespaces, 1)) !== -1)
      ++whitespaces;

    // get the characters we'll look at (1 character if not whitespace). Done if not whitespace or nbsp
    const part = newvalue.substr(locator.offset, whitespaces || 1);
    if (!whitespaces && part != "\u00a0")
      break;

    // calc the stuff we'll replace the part with, and the new nodevale
    const newpart = prev_whitespace ? "\u00a0" : " ";
    const restoffset = locator.offset + part.length;
    newvalue = newvalue.substr(0, locator.offset) + newpart + newvalue.substr(locator.offset + part.length);
    const newoffset = locator.offset + newpart.length;

    // correct all preserved locators
    applyPreserveFunc(preservelocators, (tocorrect) =>
    {
      if (tocorrect.element === locator.element && tocorrect.offset > locator.offset)
      {
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

  if (prev_whitespace)
  {
    // previous was whitespace, see if next is also whitespace (non-character, like br or block breaks)
    // if so, replace the previous with nbsp
    let scanres = locator.clone().scanForward(maxancestor, { whitespace: true });
    if ([ "innerblock", "outerblock", "br" ].includes(scanres.type))
      newvalue = newvalue.substr(0, locator.offset - 1) + "\u00a0" + newvalue.substr(locator.offset);
  }

  // apply changes if needed, record undo
  if (oldvalue !== newvalue)
  {
    elt.nodeValue = newvalue;
    if (undoitem)
      undoitem.addItem(() => elt.nodeValue = oldvalue, () => elt.nodeValue = newvalue);
  }

  return orglocator;
}

// ---------------------------------------------------------------------------
//
// Locator (points to a specific place in the DOM)
//

class Locator
{
  constructor(element, offset)
  {
    if (!element)
      throw new Error("No valid element in locator initialize");

    // Element (may be a element or a text node)
    this.element =element;
    // Offset within childNodes(elements) of nodeValue(text/cdata). May be equal to childNodes.length/nodeValue.length!
    this.offset = offset == 'end' ? getNodeChildCount(element) : offset || 0;
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  getMaxChildOffset(element)
  {
    if (element.nodeType == 1 || element.nodeType == 11)
      return element.childNodes.length; // for element nodes, document fragments, etc
    else
      return element.nodeValue ? element.nodeValue.length : 0; // for text nodes
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  /// Set the locator object
  set(element, offset)
  {
    if (!element) throw new Error("No valid element in locator set");
    this.element = element;
    if (offset === 'end')
      this.offset = this.getMaxChildOffset(element);
    else
      this.offset = offset || 0;
  }

  /// Clones a locator object
  clone()
  {
    return new Locator(this.element, this.offset);
  }

  /// Assigns a the position of another locator to this locator
  assign(rhs)
  {
    this.element = rhs.element;
    this.offset = rhs.offset;
    return this;
  }

  /// Get the node this locator points to (element.childNodes[offset]) if applicable
  getPointedNode()
  {
    return this.parentIsElementOrFragmentNode() && this.offset < this.element.childNodes.length
        ? this.element.childNodes[this.offset]
        : null;
  }

  /// When applicable, get the node this locator points to, otherwise get the parent node.
  getNearestNode()
  {
    return this.getPointedNode() || this.element;
  }

  /// When applicable, get the node this locator points to, otherwise get the parent node. DEPRECATED, use getNearestNode
  getNearestElement()
  {
    var elt = this.getNearestNode();
    if (elt.nodeType != 1 && elt.nodeType != 11)
      return elt.parentNode;
    return elt;
  }

  pointsPastChildrenEnd()
  {
    return this.offset >= this.getMaxChildOffset(this.element);
  }

  /** Get the path through the dom tree from the ancestor to an element, not including the ancestor
      @param ancestor
  */
  getPathFromAncestor(ancestor)
  {
    var treenodes=[],element = this.element;
    for(;element!=ancestor;element=element.parentNode)
      treenodes.push(element);
    return treenodes.reverse();
  }

  getRelativePath(ancestor)
  {
    var path = [ this.offset ];
    var node = this.element;
    for (; node && node != ancestor; node = node.parentNode)
      path.unshift(rangy.dom.getNodeIndex(node));
    return path;
  }

  /** Returns whether the locator points to an element within a specific parent node
      @param parentNode
  */
  isWithinNode(parentNode)
  {
    var current = this.element;
    while (current && current != parentNode)
      current = current.parentNode;
    return current == parentNode;
  }

  parentIsElementOrFragmentNode()
  {
    return this.element.nodeType == 1 || this.element.nodeType == 11;
  }

  moveToParent(towardend, forced)
  {
    // If node is empty, determine direction by towardend
    // If at start or at end, go to start resp. end
    // If not forced, return false
    // Determine direction by towardend

    if (this.pointsPastChildrenEnd())
    {
      // Node might be empty
      if (this.offset != 0)
        towardend = true; // Node not empty
      else
        ; // Node is empty.
    }
    else
    {
      // Node not empty
      if (this.offset == 0)
        towardend = false;
      else if (!forced)
        return false;
    }

    this.offset = rangy.dom.getNodeIndex(this.element) + (towardend?1:0);
    this.element = this.element.parentNode;

    return true;
  }

  /** Ascends a locator toward the ancestor while the offset == 0/element size
  */
  ascend(ancestor, towardend, forced)
  {
    if (!ancestor)
      throw new Error("Invalid ancestor in Locator.ascend");
//    console.log('AscendLocator ancestor', ancestor,' towardend: ', towardend, ', html: ', richdebug.getStructuredOuterHTML(ancestor, { toascend: this }));

    while (this.element != ancestor)
    {
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
  descendToLeafNode(maxancestor, allowunsplittables)
  {
    if (typeof maxancestor != "object")
      throw new Error("Missing ancestor!");

    //console.log('DescendLocator before ', this.element.nodeName, this.element.nodeValue, this.offset, 'len: ' + this.element.childNodes.length);

    // descend only in nodes of type element
    var towardend = false;
    if (this.element.nodeType == 1 || this.element.nodeType == 11)
    {
      if (this.offset >= this.element.childNodes.length)
      {
        // One past children: descend into lastchild (if present)
        while ((this.element.nodeType == 1 || this.element.nodeType == 11) && this.element.lastChild)
          this.element = this.element.lastChild;

        this.positionPastLastChild();
        towardend = true;
      }
      else
      {
        // Locator points to a child, descend through firstchild
        if (this.offset != 0)
        {
          this.element = this.element.childNodes[this.offset];
          this.offset = 0;
        }

        // Descend with firstChild into leaf
        while ((this.element.nodeType == 1 || this.element.nodeType == 11) && this.element.firstChild)
          this.element = this.element.firstChild;
      }
    }

    if (!allowunsplittables && !isNodeSplittable(this.element))
    {
      //console.log('DescendLocator descended into unsplittable node', this.element.nodeName);
      this.moveToParent(towardend);
    }

    //console.log('DescendLocator after ',this.element.nodeName,this.element.nodeValue,this.offset);
    return this;
  }

  positionPastLastChild()
  {
    this.offset = this.getMaxChildOffset(this.element);
    return this;
  }

  insertNode(node, preservelocators, undoitem)
  {
    if (!this.parentIsElementOrFragmentNode())
      throw new Error("Inserting only allowed when parent is a node");

    /* Firefox removes <br _moz_editor_bogus_node> when inserting stuff after it. That messes up our
       locator system big-time. FF keeps track internally, clearing _moz_editor_bogus_node doesn't work.
       Inserting a <br> of our own after it makes FF remove its br. Locators shouldn't be in <br>'s anyway,
       so no preservation needed.
    */
    var bogusbr = null, newbr = null;
    if (this.offset)
    {
      var prev = this.element.childNodes[this.offset-1];
      if (prev.nodeType == 1 && prev.nodeName.toLowerCase() == 'br' && prev.getAttribute('_moz_editor_bogus_node'))
      {
        bogusbr = prev;
        newbr = document.createElement('br');
        this.element.insertBefore(newbr, this.getPointedNode());
        if (prev.parentNode) // Just to be sure.
          prev.parentNode.removeChild(prev);
      }
    }

    var pointednode = this.getPointedNode();

    this.element.insertBefore(node, pointednode);
    var next = this.clone();

    if (undoitem)
      undoitem.addItem(
        this._undoInsertNode.bind(this, this.element, node, bogusbr, newbr, pointednode),
        this._redoInsertNode.bind(this, this.element, node, bogusbr, newbr, pointednode));

    applyPreserveFunc(preservelocators, this._correctForNodeInsert.bind(this, next));

    ++next.offset;
    return next;
  }

  _undoInsertNode(element, node, bogusbr, replacebr, insertbefore)
  {
    node.parentNode.removeChild(node);
    if (replacebr)
    {
      element.insertBefore(bogusbr, insertbefore);
      element.removeChild(replacebr);
    }
  }

  _redoInsertNode(element, node, bogusbr, replacebr, insertbefore)
  {
    if (replacebr)
    {
      element.insertBefore(replacebr, insertbefore);
      if (bogusbr.parentNode)
        bogusbr.parentNode.removeChild(bogusbr);
    }
    element.insertBefore(node, insertbefore);
  }

  _correctForNodeInsert(locator, tocorrect)
  {
    if (tocorrect.element == locator.element && tocorrect.offset >= locator.offset)
      ++tocorrect.offset;
  }

  removeNode(preservelocators, undoitem)
  {
    if (!this.parentIsElementOrFragmentNode())
      throw new Error("Removing a node only allowed when parent is a node");
    if (this.offset >= this.getMaxChildOffset(this.element))
      throw new Error("Locator does not point to an element");

    var removed = this.element.childNodes[this.offset];
    this.element.removeChild(removed);

    var pointednode = this.element.childNodes[this.offset] || null;

    if (undoitem)
      undoitem.addItem(
        this._redoInsertNode.bind(this, this.element, removed, null, null, pointednode),
        this._undoInsertNode.bind(this, this.element, removed, null, null, pointednode));

    var locator = this.clone();
    applyPreserveFunc(preservelocators, this._correctForNodeRemove.bind(this, locator, removed));
  }

  _correctForNodeRemove(locator, removed, tocorrect)
  {
    if (tocorrect.element == locator.element && tocorrect.offset > locator.offset)
      --tocorrect.offset;
    else if (tocorrect.element == removed || (removed.contains && removed.contains(tocorrect.element))) //contains doesn't always exist on IE11? is this a textnode issue or just a bug?
      tocorrect.assign(locator);
  }

  // Replace the node this locator points to (not named replaceNode because ClamAV detects CVE 2015-1623 in combination with .createDocumentFragment (and some more code))
  replacePointedNode(newnode, preservelocators)
  {
    if (!this.parentIsElementOrFragmentNode())
      throw new Error("Removing a node only allowed when parent is a node");
    if (this.offset >= this.getMaxChildOffset(this.element))
      throw new Error("Locator does not point to an element");
    if (!newnode)
      throw new Error("No valid new node given");

    var oldnode = this.element.childNodes[this.offset];
    this.element.replaceChild(newnode, oldnode);

    applyPreserveFunc(preservelocators, this._correctForNodeReplace.bind(this, oldnode, newnode));
  }

  _correctForNodeReplace(oldnode, newnode, tocorrect)
  {
    if (tocorrect.element == oldnode)
      tocorrect.element = newnode;
  }

  equals(rhs)
  {
    return this.element === rhs.element && this.offset == rhs.offset;
  }

  compare(rhs)
  {
    return rangy.dom.comparePoints(this.element, this.offset, rhs.element, rhs.offset);
  }

  check(maxancestor)
  {
    if (!this.element) throw new Error("Element not valid");
    if (maxancestor && !maxancestor.contains(this.element)) throw new Error("Element is not child of maxancestor");
    if (this.offset<0) throw new Error("Negative offset");
    if (this.offset>this.getMaxChildOffset(this.element)) throw new Error("Offset too big");
  }

  isInDOM()
  {
    if (!this.element.ownerDocument || !this.element.ownerDocument.documentElement)
    {
      console.warn("Element has no ownerDocument", this.element.ownerDocument, (this.element.ownerDocument || {}).documentElement);
      return false;
    }
    return this.element.ownerDocument.documentElement.contains(this.element);
  }

  getContainedLocators()
  {
    return [ this ];
  }

  /** Scan downstream to the previous visible element
      @param ignore .whitespace .blocks .li .alwaysvisibleblocks
      @return
      @cell return.type 'innerblock', 'outerblock', 'node', 'char', 'br', 'whitespace'
      @cell return.data
      @cell return.blockboundary
      @cell return.alwaysvisible
      @cell return.segmentbreak
      @cell return.whitespace
  */
  scanBackward(maxancestor, ignore)
  {
    if (!maxancestor)
      throw new Error("Missing ancestor");

    if (this.offset > GetNodeEndOffset(this.element))
      throw new Error("Illegal offset!");

    if (typeof ignore.li == "undefined")
      ignore.li = ignore.blocks;

    while (true)
    {
      if (this.offset == 0)
      {
        // At start of node, need to exit it
        let isblock = isNodeBlockElement(this.element);
        if (isblock || this.element == maxancestor)
        {
          var isalwaysvisible = isNodeAlwaysVisibleBlockElement(this.element);
          if (!ignore.blocks || (isalwaysvisible && !ignore.alwaysvisibleblocks) || this.element == maxancestor)
          {
            var retval = { type: 'outerblock', data: this.element, blockboundary: true, segmentbreak: true, alwaysvisible: isalwaysvisible };
            return retval;
          }
        }

        this.moveToParent(false);
      }
      else
      {
        if ([3,4].includes(this.element.nodeType))
        {
          var data = this.element.nodeValue.substr(this.offset-1, 1);
          var whitespace = ' \t\r\n'.indexOf(data) != -1;
          if (!whitespace || !ignore.whitespace)
          {
            var res =
                { type: whitespace ? 'whitespace' : 'char'
                , data: data
                , visiblecontent: !whitespace
                };

            return res;
          }

          --this.offset;
          continue;
        }

        // We're within an element
        --this.offset;

        var node = this.getPointedNode();
        if (![1, 3, 4].includes(node.nodeType)) // Skip unknown nodetypes
          continue;

        if (node.nodeType == 1 && !isTransparentNode(node))
        {
          // Always return unsplittable nodes
          if (!isNodeSplittable(node))
          {
            ++this.offset;

            var segmentbreak = node.nodeName.toLowerCase() == 'br';
            if (segmentbreak)
            {
              let bogussegmentbreak = false;
              if (isNodeBlockElement(this.element))
              {
                // br is bogus when its the last br in a block node (ignoring whitespace-only text nodes)
                bogussegmentbreak = true;

                for (let i = this.offset, e = this.element.childNodes.length; i < e; ++i)
                {
                  let node = this.element.childNodes[i];
                  if (!([3,4].includes(node.nodeType)) || node.nodeValue.trim())
                  {
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
          let isblock = isNodeBlockElement(node);
          var isli = node.nodeName.toLowerCase() == 'li';

          if ((isli && !ignore.li) || (!isli && isblock && !ignore.blocks))
//          if (isblock && !ignore.blocks)
          {
            ++this.offset;
            return { type: 'innerblock', data: node, blockboundary: true, segmentbreak: true };
          }
        }

        // Move to end of contents of previous node
        this.set(this.getPointedNode(), "end");
      }
    }
  }

  // Old name, remove when not referenced anymore
  scanUpStream(maxancestor, ignore) { return this.scanForward(maxancestor, ignore); }

  /** Scan upstream to the next visible element
      @param
      @param ignore .whitespace .blocks
      @return
      @cell return.type 'innerblock', 'outerblock', 'node', 'char', 'br', 'whitespace'
      @cell return.data
      @cell return.blockboundary
      @cell return.alwaysvisible
      @cell return.segmentbreak
      @cell return.whitespace
  */
  scanForward(maxancestor, ignore)
  {
    if (!maxancestor.contains(this.element))
    {
      console.log(maxancestor, this.element);
      throw new Error("Maxancestor is not ancestor of locator");
    }

    while (true)
    {
      if (this.pointsPastChildrenEnd())
      {
        var isblock = isNodeBlockElement(this.element);
        if (isblock || this.element == maxancestor)
        {
          var isalwaysvisible = isNodeAlwaysVisibleBlockElement(this.element);
          if (!ignore.blocks || isalwaysvisible || this.element == maxancestor)
            return { type: 'outerblock', data: this.element, blockboundary: true, segmentbreak: true, alwaysvisible: isalwaysvisible };
        }

        this.moveToParent(true);
      }
      else
      {
        if ([3,4].includes(this.element.nodeType))
        {
          var data = this.element.nodeValue.substr(this.offset, 1);
          var whitespace = ' \t\r\n'.indexOf(data) != -1;

          if (!whitespace || !ignore.whitespace)
          {
            var res =
                { type: whitespace ? 'whitespace' : 'char'
                , data: data
                , visiblecontent: !whitespace
                };
            return res;
          }

          ++this.offset;
          continue;
        }

        var node = this.getPointedNode();
        if (![ 1, 3, 4 ].includes(node.nodeType))
        {
          ++this.offset;
          continue;
        }

        if (node.nodeType == 1 && !isTransparentNode(node))
        {
          // Return unsplittable nodes
          if (!isNodeSplittable(node))
          {
            var segmentbreak = node.nodeName.toLowerCase() == 'br';
            if (segmentbreak)
            {
              var bogussegmentbreak = segmentbreak && node.getAttribute('data-wh-rte') == 'bogus';
              return { type: 'br', data: node, segmentbreak: true, bogussegmentbreak: bogussegmentbreak };
            }

            return { type: 'node', data: node, visiblecontent: true };
          }

          let isblock = isNodeBlockElement(node);
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
  movePastLastVisible(maxancestor, stopatblock, placeintext)
  {
    if (!maxancestor.contains(this.element))
      throw new Error("Ancestor is not ancestor of this locator");
    if (stopatblock)
      throw new Error("Stopatblock not supported for movePastLastVisible");

    var range = getVisualEquivalenceRange(maxancestor, this);
    this.assign(range.down);

    if (placeintext && ![ 'whitespace', 'char' ].includes(range.downres.type))
    {
      var copy = this.clone();
      var res = copy.scanForward(maxancestor, {});
      if ([ 'whitespace', 'char' ].includes(res.type))
        this.assign(copy);
    }

    return range.downres;
  }

  moveToFirstVisible(maxancestor, stopatblock, placeintext)
  {
    if (!maxancestor.contains(this.element))
      throw new Error("Ancestor is not ancestor of this locator");
    if (stopatblock)
      throw new Error("Stopatblock not supported for moveToFirstVisible");

    var range = getVisualEquivalenceRange(maxancestor, this);
    //console.log('mtfv range', richdebug.getStructuredOuterHTML(maxancestor, { locator: this, range: range }, true));
    this.assign(range.up);

    if (placeintext && ![ 'whitespace', 'char' ].includes(range.upres.type))
    {
      var copy = this.clone();
      var res = copy.scanBackward(maxancestor, {});
      if ([ 'whitespace', 'char' ].includes(res.type))
        this.assign(copy);
    }

    return range.upres;
  }

  moveLeft(maxancestor, options = {})
  {
    let original = this.clone();
    var res = this.movePastLastVisible(maxancestor);
    switch (res.type)
    {
      case 'innerblock':
        this.set(res.data, "end"); break;
      case 'outerblock':
        {
          if (this.element != maxancestor)
            this.ascend(maxancestor, false);

          let res = this.scanBackward(maxancestor, { whitespace: true });
          if ((res.type === "node" || res.type === "innerblock") && options.checkblock && !options.checkblock(res.data))
          {
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
          let codechar = this.element.nodeValue.charCodeAt(this.offset);
          if (this.offset && codechar >= 0xdc00 && codechar < 0xe000) // UTF-16 surrogate pair second codepoint?
            --this.offset;
          break;
        }
    }

    var range = getVisualEquivalenceRangeInBlock(maxancestor, this);
    if (range.valid)
    {
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

  moveRight(maxancestor, options = {})
  {
    let original = this.clone();
    var res = this.moveToFirstVisible(maxancestor);
    if (res.type == 'br')
    {
      let range = getInvisibleSegmentBreakRange(this, maxancestor);
      //console.log('moveright foundbr', richdebug.getStructuredOuterHTML(maxancestor, { locator: this, range: range }));

      if (range)
      {
        this.assign(range.end);
        res = this.scanForward(maxancestor, { whitespace: true });
      }
    }
    switch (res.type)
    {
      case 'innerblock':
        this.set(res.data, 0); break;
      case 'outerblock':
        {
          if (this.element != maxancestor)
            this.ascend(maxancestor, true);

          let res = this.scanForward(maxancestor, { whitespace: true });
          if ((res.type === "node" || res.type === "innerblock") && options.checkblock && !options.checkblock(res.data))
          {
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
          let codechar = this.element.nodeValue.charCodeAt(this.offset);
          let is_multiword = codechar >= 0xd800 && codechar < 0xdc00;
          ++this.offset;
          if (is_multiword)
          {
            codechar = this.element.nodeValue.charCodeAt(this.offset);
            if (codechar >= 0xdc00 && codechar < 0xe000)
              ++this.offset;
          }
          break;
        }
    }

    let range = getVisualEquivalenceRangeInBlock(maxancestor, this);
    //console.log("right eqrange", range, richdebug.getStructuredOuterHTML(maxancestor, range, { indent: true }));
    //console.log('mtnbb iter', richdebug.getStructuredOuterHTML(this.element.parentNode, { locator: this }));

    if (range.valid)
    {
      this.assign(range.up);
      return true;
    }

    this.scanForward(maxancestor, { blocks: true, whitespace: true });
    this.scanBackward(maxancestor, { whitespace: true });

    this.movePastLastVisible(maxancestor);
    return true;
  }

  /** Move the locator to the previous block tag, or the start of the current block
      @param maxancestor Ancestor to treat as parent block
      @return Locator is positioned just before block boundary
      @cell return.type 'innerblock', 'outerblock'
      @cell return.node Relevant block
  */
  moveToPreviousBlockBoundary(maxancestor, ignoreinnerblock)
  {
    while (true)
    {
      //console.log('mtnbb iter', richdebug.getStructuredOuterHTML(this.element.parentNode, { locator: this }));

      // Don't do stuff within data nodes
      if (!this.parentIsElementOrFragmentNode())
        this.offset = 0;

      if (this.offset == 0)
      {
        if (this.element == maxancestor || isNodeBlockElement(this.element))
          return { type: 'outerblock', data: this.element, blockboundary: true };
        this.moveToParent(false);
      }
      else
      {
         --this.offset;
        var node = this.getPointedNode();

        if (node.nodeType != 1 || !isNodeSplittable(node) || ignoreinnerblock)
          continue;

        if (isNodeBlockElement(node))
        {
          ++this.offset;
          return { type: 'innerblock', data: node, blockboundary: true };
        }

        this.element = node;
        this.positionPastLastChild();
      }
    }
  }


  /** Move the locator to the next block tag, or the end of the current block
      @param maxancestor Ancestor to treat as parent block
      @return Locator is positioned just before block boundary
      @cell return.type 'innerblock', 'outerblock'
      @cell return.node Relevant block
  */
  moveToNextBlockBoundary(maxancestor, ignoreinnerblock)
  {
    while (true)
    {
      //console.log('mtnbb iter', richdebug.getStructuredOuterHTML(this.element.parentNode, { locator: this }));

      // Don't do stuff within data nodes
      if (!this.parentIsElementOrFragmentNode())
        this.positionPastLastChild();

      if (this.pointsPastChildrenEnd())
      {
        if (this.element == maxancestor || isNodeBlockElement(this.element))
          return { type: 'outerblock', data: this.element, blockboundary: true };
        this.moveToParent(true);
      }
      else
      {
        var node = this.getPointedNode();

        if (node.nodeType != 1 || !isNodeSplittable(node) || ignoreinnerblock)
        {
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

  isLegal(maxancestor)
  {
    var node = this.element;
    while (node)
    {
      // Locator may not be inside an unsplittable node
      if (!isNodeSplittable(node))
        return false;

      if (node === maxancestor)
        return true;

      node = node.parentNode;
    }
    return false;
  }

  getParentContentEditable(maxancestor)
  {
    // Return the highest parent that is still contenteditable (limited by maxancestor
    var node = this.element;
    for (; node && node !== maxancestor; node = node.parentNode)
    {
      if (!node.parentNode || !node.parentNode.isContentEditable)
        return node;
    }
    return maxancestor;
  }

  legalize(maxancestor, towardend)
  {
    var node = this.element;
    while (node && node !== maxancestor)
    {
      // If parent isn't splittable, ascend to its parent. Assuming the maxancestor is splittable!!!
      if (!isNodeSplittable(node) && node )
        this.ascend(node.parentNode, towardend, true);

      node = node.parentNode;
    }
  }

  static findCommonAncestor(locator_a, locator_b)
  {
    return rangy.dom.getCommonAncestor(locator_a.element, locator_b.element);
  }

  static findCommonAncestorElement(locator_a, locator_b)
  {
    var ancestor = this.findCommonAncestor(locator_a, locator_b);
    if (ancestor && ![1, 9, 11].includes(ancestor.nodeType) && ancestor.nodeType) // allow element, document(fragement)
      ancestor = ancestor.parentNode;
    return ancestor;
  }

  /// Get start and end locator from a range
  static getFromRange(range)
  {
    if (!range)
      return null;

    var result =
      { start:  new Locator(range.startContainer, range.startOffset)
      , end:    new Locator(range.endContainer, range.endOffset)
      };
    return result;
  }

  static newPointingTo(node)
  {
    return new Locator(node.parentNode, rangy.dom.getNodeIndex(node));
  }

  static newPointingAfter(node)
  {
    var locator = Locator.newPointingTo(node);
    ++locator.offset;
    return locator;
  }

  static fromRelativePath(ancestor, path)
  {
    var lastoffset = path.pop();
    var elt = ancestor;
    for (var i = 0; i < path.length; ++i)
      elt = elt.childNodes[path[i]];
    return new Locator(elt, lastoffset);
  }
}

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  WHRTE range iterator
  //

/*
// Moves a locator that points past the last element to the next node (but never escapes the ancestor)
function MoveLocatorToNextLowestNodeStart(ancestor, locator)
{
  if (locator.element && locator.offset == GetNodeEndOffset(locator.element))
  {
    while (locator.element != ancestor && !locator.element.nextSibling)
      locator.element = locator.element.parentNode;

    if (locator.element != ancestor)
      locator.element = locator.element.nextSibling;
    else
      locator.element = null;
    locator.offset = 0;
  }

  while (locator.element && locator.offset == 0 && !locator.element.previousSibling)
  {
    if (locator.element == ancestor)
    {
      locator.element = null;
      break;
    }
    locator.element = locator.element.parentNode;
  }

  if (locator.element == null)
  {
    locator.element = ancestor;
    locator.offset = ancestor.childNodes.length;
    return false;
  }
  return true;
}
*/

function GetNodeEndOffset(element)
{
  if (element.nodeType == 1 || element.nodeType == 11)
    return element.childNodes.length; // for element nodes, document fragments, etc
  else
    return element.nodeValue ? element.nodeValue.length : 0; // for text nodes
}

/*
class RangeIterator
{ constructor(range)
  {
    this.locators = Locator.getFromRange(range);
    this.ancestor = Locator.findCommonAncestor(this.locators.start, this.locators.end);
    console.log('**', this.locators, range);
    this.node = null;
    this.depth = 0;
    this.leftpath = null;
    this.rightpath = null;

    if (this.ancestor.nodeType == 3)
      this.ancestor = this.ancestor.parentNode;
    if (this.locators.end.element.nodeType == 3 && this.locators.end.offset != 0 && !this.locators.start.equals(this.locators.end))
      this.locators.end.offset = this.locators.end.element.nodeValue.length;

    //console.log('ITR init', richdebug.getStructuredOuterHTML(this.ancestor, this.locators));

    MoveLocatorToNextLowestNodeStart(this.ancestor, this.locators.end);
    if (!MoveLocatorToNextLowestNodeStart(this.ancestor, this.locators.start))
    {
      // start iterator past last ancestor element
      //console.log('start past end',richdebug.getStructuredOuterHTML(this.ancestor, this.locators), this.locators);
      return;
    }

    //console.log(this.locators.start.element.nodeName, this.ancestor.nodeName);
    //console.log('ITR corrected',richdebug.getStructuredOuterHTML(this.ancestor, this.locators), this.locators);

  //  console.log('ancestor',this.ancestor);
  //  console.log('locators',this.locators);

    this.leftpath = this.locators.start.getPathFromAncestor(this.ancestor);
    this.rightpath = this.locators.end.getPathFromAncestor(this.ancestor);

  //  console.log('leftpath: ', this.leftpath);
  //  console.log('rightpath: ', this.rightpath);

    this.node = this.locators.start.element;
    this.depth = this.leftpath.length;

    if (this.node == this.locators.end.element && this.locators.end.offset != GetNodeEndOffset(this.locators.end.element))
    {
      this.node = null;
    }
    else
    {
      this.depth = this.leftpath.length;
      if (this.locators.start.offset == GetNodeEndOffset(this.node))
        this.nextRecursive();
    }
    console.log('ITR init node', this.node, 'depth:', this.depth);
  }

  atEnd()
  {
    return !this.node;
  }

  nextRecursive()
  {
    console.log('ITR nextRecursive in', this.node, 'depth:', this.depth);
    if (this.node.nodeType != 3 && this.node.firstChild)
    {
      this.node = this.node.firstChild;
      ++this.depth;
      if (this.node == this.locators.end.element)
      {
        this.node = null;
        console.log('ITR nextRecursive at end');
        return false;
      }
      console.log('ITR nextRecursive result:', this.node, 'depth:', this.depth);
      return true;
    }
    else
      return this.next();
  }

  next()
  {
    console.log('ITR next', this.node, 'depth:', this.depth);
    while (!this.node.nextSibling && this.node != this.ancestor)
    {
      --this.depth;
      this.node = this.node.parentNode;
    }

    console.log('candidate node:', this.node, 'depth:', this.depth);

    if (this.node == this.ancestor)
    {
      console.log('ITR next at end');
      this.node = null;
      return false;
    }
    this.node = this.node.nextSibling;

    // pre: this.itr != this.locators.end.element
    if (this.rightpath.length >= this.depth)
    {
      var eltmax = this.depth ? this.rightpath[this.depth - 1] : this.ancestor;
      var eltdeeper = this.rightpath.length > this.depth;

      if (this.node == eltmax && !eltdeeper)
        this.node = null;
    }
    if (this.node)
      console.log('ITR next result:', this.node, 'depth:', this.depth);
    else
      console.log('ITR next at end');

    return this.node != null;
  }
}
*/

export
    { setAttributes
    , getAllAttributes
    , UndoItem
    , Locator
    , getAttributes

    , splitDataNode
    , splitElement
    , moveSimpleRangeTo
    , findParent
    , isNodeBlockElement
    , isNodeSplittable
    , removeSimpleRange
    , combineNodeWithPreviousNode
    , combineNodes
    , combineAdjacentTextNodes
    , appendNodes
    , replaceSingleNodeWithItsContents
    , wrapNodesInNewNode
    , wrapSimpleRangeInNewNode
    , removeNodesFromTree
    , removeNodeContents
    , splitDom
    , removeNodesFromRange
    , insertNodesAtLocator
    , wrapRange
    , combineWithPreviousNodesAtLocator
    , requireVisibleContentInBlockAfterLocator
    , hasNodeVisibleContent
    , getInvisibleSegmentBreakRange
    , getVisualEquivalenceRange
    , rewriteWhitespace
    };
