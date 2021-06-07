import * as domlevel from "./domlevel";

class PasteCleanup
{
  constructor(options)
  {
    this.data = null;
    this.options =
        { mode: '' // 'clipboarddata', 'framepaste'
        , ...options
        };

    if (![ 'clipboarddata', 'framepaste', '' ].includes(this.options.mode))
      throw new Error("Illegal paste cleanup mode '" + this.options.mode + "'");
  }

  applyCleanup(data)
  {
    this.data = data;

    var result =
      { breakafter:   null // not yet known
      };

    if (this.options.mode == 'framepaste')
      result.breakafter = true;

    var todelete = [];

    let imgs = this.data.querySelectorAll('img');
    for (let i = 0; i < imgs.length; ++i)
    {
      // Used to see whether paste would be merged to next paragraph
      if (imgs[i].className == 'whrte-interchange-end')
      {
        todelete.push(imgs[i]);
        let node = imgs[i];
        if (node.parentNode != this.data) // Placed within other node -> was concatenated
          result.breakafter = false;
        else
        {
          // See if there is an inline node between the last block elt and our br. If so: concatenation
          // (firefox doesn't wrap inlines in block elts)
          result.breakafter = false;
          while ((node = node.previousSibling))
          {
            // Opera adds spurious empty text nodes
            if ([3, 4].includes(node.nodeType) && node.nodeValue != '')
              break;

            if (node.nodeType != 1) // No element? Ignore
              continue;

            if (domlevel.isNodeBlockElement(node))
            {
              result.breakafter = true;
              break;
            }
          }
        }
      }
    }

    // Remove the interchange nodes - and all nodes that are left empty because of their removal.
    // FIXME: test for partial table selection
    for (let i = 0; i < todelete.length; ++i)
    {
      let node = todelete[i];
      while (node != this.data && node.parentNode && !node.firstChild)
      {
        let parent = node.parentNode;
        parent.removeChild(node);
        node = parent;
      }
    }

    // remove empty block (P, LI, OL & UL) nodes
    var pnodes = this.data.querySelectorAll('*');
    for (let i = pnodes.length - 1; i >= 0; --i)
      if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ol', 'ul', 'li' ].includes(pnodes[i].nodeName.toLowerCase()))
      {
        let node = pnodes[i];
        var locator = new domlevel.Locator(node, 0);
        var res = locator.scanForward(node, { whitespace: true });
        if (res.type == 'outerblock')
          pnodes[i].parentNode.removeChild(pnodes[i]);
      }

    // IE can copy LI nodes without their parent OL/UL. Create a UL, move them into it
    var linodes = this.data.querySelectorAll('li');
    for (let i = 0; i < linodes.length; ++i)
    {
      let parent = linodes[i].parentNode;
      if (![ 'ol', 'ul' ].includes(parent.nodeName.toLowerCase()))
      {
        let node = linodes[i];
        let nodes = [];
        for (; node && node.nodeType == 1 && node.nodeName.toLowerCase() == 'li'; node = node.nextSibling)
          nodes.push(node);

        var listnode = document.createElement('ul');
        parent.insertBefore(listnode, linodes[i]);
        for (var j = 0; j < nodes.length; ++j)
          listnode.appendChild(nodes[j]);
      }
    }

    // If we have a top-level <br>, that is an interchange BR signalling a selected block barrier
    if (data.lastChild && data.lastChild.nodeType == 1 && data.lastChild.nodeName.toLowerCase() == 'br')
    {
      data.removeChild(data.lastChild);
      result.breakafter = true;
    }

    // No explicit break found after?
    if (result.breakafter === null)
      result.breakafter = false;

    return result;
  }

}

module.exports = PasteCleanup;
