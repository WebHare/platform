import * as domlevel from "../domlevel";

/** Updates a path with the next node. All elements that are not a proper ancestor of node are removed, then
    node is appended.
    @param path Current path
    @param node New node
    @return Whether the node had no ancestor in the old path
*/
function updatePathForNextNode(path, node)
{
  var found = false;
  for (var n = path.length - 1; !found && n >= 0; --n)
  {
    if (path[n].contains(node))
    {
      // Remove all non-ancestor elements from the array
      path.splice(n + 1, path.length - n - 1);
      found = true;
      break;
    }
  }

  if (!found)
    path.splice(0, path.length);
  path.push(node);

  return found;
}

export function getLevelActionableListNodes(range, scope)
{
  // Keep range intact
  range = range.clone();

  // Adjust the range, so all partially selected <li>'s fall within the range (otherwise they won't be returned by
  // querySelectorAll)
  var startliparent = domlevel.findParent(range.start.getNearestNode(), "li", scope);
  if (startliparent)
    range.start.assign(domlevel.Locator.newPointingTo(startliparent));

  var endliparent = domlevel.findParent(range.end.getNearestNode(), "li", scope);
  if (endliparent)
  {
    if (endliparent == startliparent)
    {
      range.end.assign(domlevel.Locator.newPointingAfter(startliparent));
    }
    else
    {
      range.end.ascend(scope, false);
      var endlistart = domlevel.Locator.newPointingTo(endliparent);
      var endliend = domlevel.Locator.newPointingAfter(endliparent);
      // If the end <li> is partially selected, select the whole <li>
      if (range.end.compare(endlistart) > 0)
        range.end = endliend;
    }
  }

  let linodes = Array.from(range.querySelectorAll('li'));

  var addable = [], removeable = [];

  // Find the nodes that can be added a level
  var path = [];
  for (let i = 0; i < linodes.length; ++i)
  {
    if (!linodes[i].isContentEditable)
      continue;

    if (!linodes[i].previousSibling)
    {
      // If this is the first li within a list, and there is another list directly before this list, it may be added to that list
      var prevlist = domlevel.Locator.newPointingTo(linodes[i].parentNode);
      prevlist.moveToPreviousBlockBoundary(linodes[i].parentNode.parentNode, true);
      //console.log('glaln prevlist:', richdebug.getStructuredOuterHTML(scope, { prevlist: prevlist }, true));
      prevlist = prevlist.getPointedNode();
      if (!prevlist || prevlist == linodes[i].parentNode || (prevlist.nodeName.toUpperCase() != "UL" && prevlist.nodeName.toUpperCase() != "OL"))
        continue;
    }
    else if (linodes[i].previousSibling.nodeType != 1 || linodes[i].previousSibling.nodeName.toLowerCase() != 'li')
      continue;

    // Don't select partial nodes when our selection starts in a list within that node
    if (startliparent && linodes[i] != startliparent && linodes[i].contains(startliparent))
      continue;

    if (!updatePathForNextNode(path, linodes[i]))
      addable.push(linodes[i]);
  }

  // Find the nodes that can be removed a level
  path = [];
  for (let i = 0; i < linodes.length; ++i)
  {
    if (!linodes[i].isContentEditable)
      continue;

    if (!domlevel.findParent(linodes[i].parentNode, "li", scope))
      continue;

    // Don't select partial nodes when our selection starts in a list within that node
    if (linodes[i] != startliparent && linodes[i].contains(startliparent))
      continue;

    if (!updatePathForNextNode(path, linodes[i]))
      removeable.push(linodes[i]);
  }

  return { addable: addable, removeable: removeable };
}
