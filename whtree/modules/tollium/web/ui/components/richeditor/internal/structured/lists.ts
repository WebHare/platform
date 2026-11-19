import * as domlevel from "../domlevel";

/** Updates a path with the next node. All elements that are not a proper ancestor of node are removed, then
    node is appended.
    @param path - Current path
    @param node - New node
    @returns Whether the node had no ancestor in the old path
*/
function updatePathForNextNode(path: Node[], node: Node): boolean {
  let found = false;
  for (let n = path.length - 1; !found && n >= 0; --n) {
    if (path[n].contains(node)) {
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

export function getLevelActionableListNodes(range: domlevel.Range, scope: HTMLElement): { addable: HTMLLIElement[]; removeable: HTMLLIElement[] } {
  // Keep range intact
  range = range.clone();

  // Adjust the range, so all partially selected <li>'s fall within the range (otherwise they won't be returned by
  // querySelectorAll)
  const startliparent = domlevel.findParent(range.start.getNearestNode(), "li", scope);
  if (startliparent)
    range.start.assign(domlevel.Locator.newPointingTo(startliparent));

  const endliparent = domlevel.findParent(range.end.getNearestNode(), "li", scope);
  if (endliparent) {
    if (endliparent === startliparent) {
      range.end.assign(domlevel.Locator.newPointingAfter(startliparent));
    } else {
      range.end.ascend(scope, false);
      const endlistart = domlevel.Locator.newPointingTo(endliparent);
      const endliend = domlevel.Locator.newPointingAfter(endliparent);
      // If the end <li> is partially selected, select the whole <li>
      if (range.end.compare(endlistart) > 0)
        range.end = endliend;
    }
  }

  const linodes = range.querySelectorAll('li') as HTMLLIElement[];

  const addable: HTMLLIElement[] = [], removeable: HTMLLIElement[] = [];

  // Find the nodes that can be added a level
  let path: Node[] = [];
  for (let i = 0; i < linodes.length; ++i) {
    if (!linodes[i].isContentEditable)
      continue;

    if (!linodes[i].previousSibling) {
      // If this is the first li within a list, and there is another list directly before this list, it may be added to that list
      const list = linodes[i].parentNode;
      if (!list?.parentNode)
        continue;

      const prevlistlocator = domlevel.Locator.newPointingTo(list);
      prevlistlocator.moveToPreviousBlockBoundary(list.parentNode, true);
      //console.log('glaln prevlist:', richdebug.getStructuredOuterHTML(scope, { prevlist: prevlistlocator }, true));
      const prevlist = prevlistlocator.getPointedNode();
      if (!prevlist || prevlist === list || (prevlist.nodeName.toUpperCase() !== "UL" && prevlist.nodeName.toUpperCase() !== "OL"))
        continue;
    } else if (linodes[i].previousSibling?.nodeType !== 1 || linodes[i].previousSibling?.nodeName.toLowerCase() !== 'li')
      continue;

    // Don't select partial nodes when our selection starts in a list within that node
    if (startliparent && linodes[i] !== startliparent && linodes[i].contains(startliparent))
      continue;

    if (!updatePathForNextNode(path, linodes[i]))
      addable.push(linodes[i]);
  }

  // Find the nodes that can be removed a level
  path = [];
  for (let i = 0; i < linodes.length; ++i) {
    if (!linodes[i].isContentEditable)
      continue;

    const parent = linodes[i].parentNode;
    if (!parent || !domlevel.findParent(parent, "li", scope))
      continue;

    // Don't select partial nodes when our selection starts in a list within that node
    if (linodes[i] !== startliparent && linodes[i].contains(startliparent))
      continue;

    if (!updatePathForNextNode(path, linodes[i]))
      removeable.push(linodes[i]);
  }

  return { addable: addable, removeable: removeable };
}
