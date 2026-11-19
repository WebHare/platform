import * as domlevel from "./domlevel";
import { encodeString } from "@webhare/std";

/* Snapshots are a representation of a DOM-tree. References are taken to all
   nodes (elements and text), and all modifyable properties (nodeValue, attributes
   and childNodes) are saved too. This ensures that when a snapshot is restored,
   the browser undo history still functions.

   The 'src' attribute of img elements is not restored, because when pasting it
   in the editor, a placeholder source will be used, and the real image will be
   put in the src later, far after the saving of the snapshots
*/

export type Snapshot = {
  node: Node;
  type: "snapshot";
  childNodes: ParseResult[] | null;
  range: domlevel.Range;
};

type ParseResult = {
  node: Node;
  type: "element" | "embedded" | "text" | "unknown";
  childNodes: ParseResult[] | null;
  attrs: Record<string, string> | null;
  nodeValue: string | null;
};

function parseNode(node: Node) {
  // Use a fixed record to describe nodes, JITs like them
  const result: ParseResult = {
    node: node,
    type: "unknown",
    childNodes: null,
    attrs: null,
    nodeValue: ""
  };

  switch (node.nodeType) {
    case 1: // element
      {
        if (domlevel.isEmbeddedObject(node)) {
          // No need to recurse into embedded objects (only done when result.childNodes is an array)
          result.type = "embedded";
          result.attrs = domlevel.getAllAttributes(node as HTMLElement);
        } else {
          result.type = "element";
          result.childNodes = [];
          result.attrs = domlevel.getAllAttributes(node as HTMLElement);
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

function generateSnapshotRecursive(node: Node, resultlist: ParseResult[]) {
  for (const subnode of Array.from(node.childNodes)) {
    const parsed = parseNode(subnode);
    resultlist.push(parsed);

    if (parsed.childNodes)
      generateSnapshotRecursive(subnode, parsed.childNodes);
  }
}

/** Takes a snapshot of the current contents of rootnode
    @param rootnode - Rootnode to take the snapshot of
    @param range - Range to save (selection range)
    @returns Snapshot record
*/
export function generateSnapshot(rootnode: Node, range: domlevel.Range): Snapshot {
  const snapshot = {
    node: rootnode,
    type: "snapshot" as const,
    childNodes: [],
    range: range.clone()
  };

  generateSnapshotRecursive(rootnode, snapshot.childNodes);

  return snapshot;
}

export function compressSnapshotChildNodes(left: ParseResult, right: ParseResult): { left: ParseResult; right: ParseResult } | null;
export function compressSnapshotChildNodes(left: Snapshot, right: Snapshot): { left: Snapshot; right: Snapshot } | null;

/** Removes childnodes of trees that are equal
*/
export function compressSnapshotChildNodes(left: Snapshot | ParseResult, right: Snapshot | ParseResult) {
  if (!left.childNodes || !right.childNodes) {
    //console.log(`cscn not both children`, left, right);
    return null;
  }

  let havechange = false;
  left = { ...left };
  right = { ...right };

  left.childNodes = [...left.childNodes || []];
  right.childNodes = [...right.childNodes || []];

  const leftChildNodeLength = left.childNodes.length;
  const rightChildNodeLength = right.childNodes.length;

  for (let li = 0; li < leftChildNodeLength; ++li) {
    const l = left.childNodes[li];
    if (!l.childNodes)
      continue;

    for (let ri = 0; ri < rightChildNodeLength; ++ri) {
      const r = right.childNodes[ri];
      if (l.node === r.node && r.childNodes) {
        //console.log(` compare `, l, r);

        const res = compressSnapshotChildNodes(l, r);
        if (res) {
          havechange = true;
          left.childNodes[li] = res.left;
          right.childNodes[ri] = res.right;
        }
      }
    }
  }

  if (leftChildNodeLength !== rightChildNodeLength) {
    //console.log(`cscn childnode len`, left, right);

    return havechange ? { left, right } : null;
  }

  for (let i = 0; i < leftChildNodeLength; ++i) {
    const l = left.childNodes[i], r = right.childNodes[i];

    if (l.node !== r.node
      || l.type !== r.type
      || (l.childNodes || r.childNodes) // childnodes are eliminated if equal
      || l.nodeValue !== r.nodeValue
      || !attrsEqual(l.attrs, r.attrs, r.node.nodeName.toLowerCase() === "img")) {
      //console.log(`cscn childnode idx ${i} differs`, left, right);

      return havechange ? { left, right } : null;
    }
  }

  left.childNodes = null;
  right.childNodes = null;

  //console.log(`cscn children equal`, left, right);
  return { left, right };
}

function attrsEqual(a: unknown, b: unknown, isimg: boolean) {
  if (!a || !b)
    return !a === !b;

  const la = Object.entries(a);
  const ra = Object.entries(b);

  if (la.length !== ra.length)
    return false;

  for (let ai = 0, ae = la.length; ai < ae; ++ai)
    if (la[ai][0] !== ra[ai][0] || la[ai][1] !== ra[ai][1]) {
      if (isimg && la[ai][0] === "src")
        continue;
      return false;
    }

  return true;
}

export function snapshotsEqual(left: Snapshot, right: Snapshot) {
  if (left.node !== right.node) {
    console.log('nodes unequal');
    return false;
  }

  if (!left.range.equals(right.range)) {
    console.log('range unequal', left.range, right.range);
  }

  const res = compressSnapshotChildNodes(left, right);
  if (res)
    ({ left, right } = res);

  if (left.childNodes || right.childNodes)
    return false;

  return true;
}

export function dumpSnapShot(item: ParseResult | Snapshot, snapshot?: Snapshot, indent?: number): string {
  if (!snapshot && item.type === "snapshot")
    snapshot = item;
  indent = indent || 0;

  if (item.type === "text")
    return `"${item.nodeValue}"`;

  let res = `<${item.node.nodeName}`;
  if ("attrs" in item && item.attrs) {
    for (const a of Object.entries(item.attrs))
      res += ` ${a[0]}="${encodeString(a[1], 'attribute')}"`;
  }

  if (item.childNodes && item.childNodes.length)
    return res + `>\n` + item.childNodes.map(c => "  ".repeat(indent + 1) + dumpSnapShot(c, snapshot, indent + 1) + "\n").join("") + "  ".repeat(indent) + `</${item.node.nodeName}>`;
  else
    return res + `/>`;
}
