import * as dompack from "dompack";
import * as domlevel from "./domlevel";
import { encodeValue } from "dompack/types/text";

/* Snapshots are a representation of a DOM-tree. References are taken to all
   nodes (elements and text), and all modifyable properties (nodeValue, attributes
   and childNodes) are saved too. This ensures that when a snapshot is restored,
   the browser undo history still functions.

   The 'src' attribute of img elements is not restored, because when pasting it
   in the editor, a placeholder source will be used, and the real image will be
   put in the src later, far after the saving of the snapshots
*/

function parseNode(node)
{
  // Use a fixed record to describe nodes, JITs like them
  let result =
      { node:       node
      , type:       ""
      , childNodes: null
      , attrs:      null
      , nodeValue:  ""
      };

  switch (node.nodeType)
  {
    case 1: // element
    {
      if (domlevel.isEmbeddedObject(node))
      {
        // No need to recurse into embedded objects (only done when result.childNodes is an array)
        result.type = "embedded";
        result.attrs = domlevel.getAllAttributes(node);
      }
      else
      {
        result.type = "element";
        result.childNodes = [];
        result.attrs = domlevel.getAllAttributes(node);
      }
    } break;
    case 3: // text
    case 4: // cdata
    {
      result.type = "text";
      result.nodeValue = node.nodeValue;
    } break;
    default: // rest
    {
      result.type = "unknown";
    }
  }
  return result;
}

function generateSnapshotRecursive(node, resultlist)
{
  for (let subnode of Array.from(node.childNodes))
  {
    var parsed = parseNode(subnode);
    resultlist.push(parsed);

    if (parsed.childNodes)
      generateSnapshotRecursive(subnode, parsed.childNodes);
  }
}

// Make sure all attributes are set according to attrs, removes other attributes
function restoreAttributes(node, attrs)
{
  let current = domlevel.getAllAttributes(node);
  let needset = false;

  // Remove attributes that shouldn't be present, see if update is needed
  for (let attr in current)
  {
    if (!(attr in attrs))
      node.removeAttribute(attr);
    else if (current[attr] != attrs[attr])
    {
      /* Don't overwrite src of img. At paste, the delay-loading will changes
         them to the correct value *after* the creation of the snapshot.
      */
      if (attr == "src" && node.nodeName.toLowerCase() == "img")
        attrs.src = current.src;
      else
        needset = true;
    }
  }

  // See if any attributes need to be added
  for (let attr in attrs)
    if (!(attr in current))
      needset = true;

  // Use domlevel to set attributes
  if (needset)
    domlevel.setAttributes(node, attrs);
}

/// Restores text and attributes of a node (non-recursive)
function restoreNode(doc, item)
{
  var result = item.node;
  if (item.attrs)
    restoreAttributes(result, item.attrs);
  if (item.type === "text")
  {
    try
    {
      // IE sometimes transforms text nodes to EmptyTextNodes - can't change nodeValue, can't insert
      if (result.nodeValue != item.nodeValue)
        result.nodeValue = item.nodeValue;
    }
    catch (e)
    {
      // If that happens, don't care about browser undo anymore
      result = doc.createText(item.nodeValue);
    }
  }

  return result;
}

function restoreSnapshotRecursive(doc, node, resultlist)
{
  let lastinserted = null;

  // Convert the nodes, insert them at the beginning of the node childlist
  for (let item of resultlist)
  {
    var subnode = restoreNode(doc, item);
    if (item.childNodes)
      restoreSnapshotRecursive(doc, subnode, item.childNodes);

    let insertbefore = lastinserted ? lastinserted.nextSibling : node.firstChild;
    lastinserted = subnode;

    if (insertbefore === subnode)
      continue;

    node.insertBefore(subnode, insertbefore);
  }

  // Remove all nodes after the last inserted node
  while (node.lastChild !== lastinserted)
    node.lastChild.remove();
}

/** Takes a snapshot of the current contents of rootnode
    @param rootnode Rootnode to take the snapshot of
    @param range Range to save (selection range)
    @return Snapshot record
*/
export function generateSnapshot(rootnode, range)
{
  var snapshot =
      { node:       rootnode
      , type:       "snapshot"
      , childNodes: []
      , range:      range.clone()
      };

  generateSnapshotRecursive(rootnode, snapshot.childNodes);

  return snapshot;
}

/** Restores a snapshot taken earlier
    @param rootnode Rootnode to restore the snapshot to
    @param range Range to save (selection range)
    @return Selection range to restore
*/
export function restoreSnapshot(rootnode, snapshot)
{
  restoreSnapshotRecursive(rootnode.ownerDocument, rootnode, snapshot.childNodes);

  var range = snapshot.range.clone();
  if (range.start.element == snapshot.node)
    range.start.element = rootnode;
  if (range.end.element == snapshot.node)
    range.end.element = rootnode;

  return range;
}

/** Removes childnodes of trees that are equal
*/
export function compressSnapshotChildNodes(left, right)
{
  if (!left.childNodes || !right.childNodes)
  {
    //console.log(`cscn not both children`, left, right);
    return null;
  }

  let havechange = false;
  left = Object.assign({}, left);
  right = Object.assign({}, right);

  left.childNodes = [ ...left.childNodes ];
  right.childNodes = [ ...right.childNodes ];

  let leftChildNodeLength = left.childNodes.length;
  let rightChildNodeLength = right.childNodes.length;

  for (let li = 0; li < leftChildNodeLength; ++li)
  {
    let l = left.childNodes[li];
    if (!l.childNodes)
      continue;

    for (let ri = 0; ri < rightChildNodeLength; ++ri)
    {
      let r = right.childNodes[ri];
      if (l.node === r.node && r.childNodes)
      {
        //console.log(` compare `, l, r);

        let res = compressSnapshotChildNodes(l, r);
        if (res)
        {
          havechange = true;
          left.childNodes[li] = res.left;
          right.childNodes[ri] = res.right;
        }
      }
    }
  }

  if (leftChildNodeLength !== rightChildNodeLength)
  {
    //console.log(`cscn childnode len`, left, right);

    return havechange ? { left, right } : null;
  }

  for (let i = 0; i < leftChildNodeLength; ++i)
  {
    let l = left.childNodes[i], r = right.childNodes[i];

    if (l.node !== r.node
        || l.type !== r.type
        || (l.childNodes || r.childNodes) // childnodes are eliminated if equal
        || l.nodeValue !== r.nodeValue
        || !attrsEqual(l.attrs, r.attrs, r.node.nodeName.toLowerCase() == "img"))
    {
      //console.log(`cscn childnode idx ${i} differs`, left, right);

      return havechange ? { left, right } : null;
    }
  }

  left.childNodes = null;
  right.childNodes = null;

  //console.log(`cscn children equal`, left, right);
  return { left, right };
}

function attrsEqual(a, b, isimg)
{
  if (!a || !b)
    return !a === !b;

  let la = Object.entries(a);
  let ra = Object.entries(b);

  if (la.length !== ra.length)
    return false;

  for (let ai = 0, ae = la.length; ai < ae; ++ai)
    if (la[ai][0] !== ra[ai][0] || la[ai][1] !== ra[ai][1])
    {
      if (isimg && la[ai][0] === "src")
        continue;
      return false;
    }

  return true;
}

export function snapshotsEqual(left, right)
{
  if (left.node !== right.node)
  {
    console.log('nodes unequal');
    return false;
  }

  if (!left.range.equals(right.range))
  {
    console.log('range unequal', left.range, right.range);
//    return false;
  }

  let res = compressSnapshotChildNodes(left, right);
  if (res)
    ({ left, right } = res);

  if (left.childNodes || right.childNodes)
    return false;

  return true;
}

export function dumpSnapShot(item, snapshot, indent)
{
  snapshot = snapshot || item;
  indent = indent || 0;

  if (item.type == "text")
    return `"${item.nodeValue}"`;

  let res = `<${item.node.nodeName}`;
  if (item.attrs)
  {
    for (let a of Object.entries(item.attrs))
      res += ` ${a[0]}="${encodeValue(a[1])}"`;
  }

  if (item.childNodes && item.childNodes.length)
    return res + `>\n` + item.childNodes.map(c => "  ".repeat(indent + 1) + dumpSnapShot(c, snapshot, indent + 1) + "\n").join("") + "  ".repeat(indent) + `</${item.node.nodeName}>`;
  else
    return res + `/>`;
}
