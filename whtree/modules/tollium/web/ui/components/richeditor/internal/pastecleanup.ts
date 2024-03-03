import * as domlevel from "./domlevel";

export default class PasteCleanup {
  data: HTMLElement | null;

  constructor() {
    this.data = null;
  }

  applyCleanup(data: HTMLElement): { breakafter: null | boolean } {
    this.data = data;

    const result: {
      breakafter: null | boolean;
    } = {
      breakafter: null // not yet known
    };

    const todelete: Element[] = [];

    // Remove the interchange nodes - and all nodes that are left empty because of their removal.
    // FIXME: test for partial table selection
    for (let i = 0; i < todelete.length; ++i) {
      let node: Node = todelete[i];
      while (node !== this.data && node.parentNode && !node.firstChild) {
        const parent = node.parentNode;
        parent.removeChild(node);
        node = parent;
      }
    }

    // remove empty block (P, LI, OL & UL) nodes
    const pnodes = this.data.querySelectorAll('*');
    for (let i = pnodes.length - 1; i >= 0; --i)
      if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ol', 'ul', 'li'].includes(pnodes[i].nodeName.toLowerCase())) {
        const node = pnodes[i];
        const locator = new domlevel.Locator(node, 0);
        const res = locator.scanForward(node, { whitespace: true });
        if (res.type === 'outerblock')
          pnodes[i].remove();
      }

    // IE can copy LI nodes without their parent OL/UL. Create a UL, move them into it
    const linodes = this.data.querySelectorAll('li');
    for (let i = 0; i < linodes.length; ++i) {
      const parent = linodes[i].parentNode;
      if (!['ol', 'ul'].includes(parent?.nodeName.toLowerCase() || "")) {
        let node: Node | null = linodes[i];
        const nodes = [];
        for (; node && node.nodeType === 1 && node.nodeName.toLowerCase() === 'li'; node = node.nextSibling)
          nodes.push(node);

        const listnode = document.createElement('ul');
        parent?.insertBefore(listnode, linodes[i]);
        for (let j = 0; j < nodes.length; ++j)
          listnode.appendChild(nodes[j]);
      }
    }

    // If we have a top-level <br>, that is an interchange BR signalling a selected block barrier
    if (data.lastChild && data.lastChild.nodeType === 1 && data.lastChild.nodeName.toLowerCase() === 'br') {
      data.removeChild(data.lastChild);
      result.breakafter = true;
    }

    // No explicit break found after?
    if (result.breakafter === null)
      result.breakafter = false;

    return result;
  }
}
