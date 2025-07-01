import * as tablesupport from "./tableeditor";
import * as dompack from 'dompack';
import type { RTESettings, RTEWidget, TargetInfo } from "./types";
import { queryEmbeddedObjects } from "./domlevel";

export function getTargetInfo(actiontarget: { __node: HTMLElement }): TargetInfo | null { //provide JSON-safe information about the action target
  const node = actiontarget.__node;
  if (node.matches('a')) {
    return {
      type: 'hyperlink',
      link: node.getAttribute("href") || "", //note that getAttribute gives the 'true' link but 'href' may give a resolved link
      target: (node as HTMLAnchorElement).target || '',
      __node: node
    };
  } else if (node.matches('td,th,caption')) {
    const tablenode = node.closest('table')!; //these element *have* to be inside a table in the RTD
    const editor = tablesupport.getEditorForNode(tablenode);
    let targetinfo: TargetInfo = {
      tablecaption: editor.getCaption(),
      tablestyletag: tablenode.classList[0],
      numrows: editor.numrows,
      numcolumns: editor.numcolumns,
      datacell: editor.locateFirstDataCell()
    };

    if (node.matches('td,th')) {
      targetinfo = {
        ...targetinfo,
        type: 'cell',
        cellstyletag: node.classList[1] || '',
        __node: node
      };
    } else {
      targetinfo = {
        ...targetinfo,
        type: 'table',
        __node: tablenode
      };
    }
    return targetinfo;
  } else if (node.matches('.wh-rtd-embeddedobject')) {
    return {
      type: 'embeddedobject',
      instanceref: node.dataset.instanceref,
      __node: node
    };
  } else if (node.matches('img')) {
    const align = node.classList.contains("wh-rtd__img--floatleft") ? 'left' : node.classList.contains("wh-rtd__img--floatright") ? 'right' : '';
    let linkinfo = null;
    const link = node.closest('a');
    if (link)
      linkinfo = {
        link: link.href,
        target: link.target || ''
      };

    return {
      type: 'img',
      align: align,
      width: Number(node.getAttribute("width")),
      height: Number(node.getAttribute("height")),
      alttext: (node as HTMLImageElement).alt,
      link: linkinfo,
      src: (node as HTMLImageElement).src,
      __node: node
    };
  }
  return null;
}

export function replaceClasses(node: HTMLElement, removeclass: string, addclass: string) {
  removeclass = removeclass.trim();
  addclass = addclass.trim();

  if (removeclass !== "") {
    // remove old classes (to keep extra classes set later intact)
    for (const cname of removeclass.split(" ")) {
      if (cname !== "")
        node.classList.remove(cname);
    }
  }

  if (addclass !== "") {
    for (const cname of addclass.split(" ")) {
      if (cname !== "")
        node.classList.add(cname);
    }
  }
}

export function parseEmbeddedObjectNode(node: HTMLElement): RTEWidget & { type: string } {
  let htmltext = node.dataset.innerhtmlContents || '';
  if (!htmltext) { //we may have already rendered a preview (reparse of existing code or pasted content) (TODO does this also apply in ProseMirror?)
    const currentpreview = node.querySelector(".wh-rtd-embeddedobject__preview");
    if (currentpreview)
      htmltext = currentpreview.innerHTML;
  }

  return {
    type: 'embeddedobject',
    instanceref: node.getAttribute("data-instanceref") || '',
    htmltext: htmltext,
    typetext: node.getAttribute("data-widget-typetext") || '',
    canedit: node.classList.contains("wh-rtd-embeddedobject--editable"),
    embedtype: node.nodeName === 'SPAN' ? 'inline' : 'block',
    wide: node.hasAttribute("data-widget-wide")
  };
}

export function buildEmbeddedObjectNode(data: RTEWidget, config: Pick<RTESettings, "editembeddedobjects">): HTMLElement {
  const isinline = data.embedtype === 'inline';
  const basenode = isinline ? 'span' : 'div';

  const has_inlinepreview = /wh-rtd__inlinepreview/.exec(data.htmltext);

  const node = document.createElement(basenode); //the basenode is also used to show selection status
  node.className = "wh-rtd-embeddedobject"
    + (data.canedit ? " wh-rtd-embeddedobject--editable" : "")
    + (data.wide ? " wh-rtd-embeddedobject--wide" : "")
    + (isinline ? " wh-rtd-embeddedobject--inline" : " wh-rtd-embeddedobject--block")
    + (has_inlinepreview ? " wh-rtd-embeddedobject--hasinlinepreview" : "");
  node.dataset.instanceref = data.instanceref;
  node.contentEditable = "false";

  const box = document.createElement(basenode); //the box is the 'gray' rounded border area for the widget
  box.className = "wh-rtd-embeddedobject__box";
  node.appendChild(box);

  let typebox = null;

  if (data.typetext) {
    /* if we neeed a todd icon, reuse <img class="wh-rtd__preview__typeboxicon" width="16" height="16" data-toddimg="[icon]|16|16|w"> */
    typebox = document.createElement(basenode);
    typebox.className = "wh-rtd-embeddedobject__typebox";
    typebox.innerHTML = data.typetext;
  }

  //objectbuttons need to appear first so we can use position:sticky
  const objectbuttons = document.createElement(basenode);
  objectbuttons.className = "wh-rtd-objectbuttons";

  const stickyheader = document.createElement(basenode);
  stickyheader.className = "wh-rtd-embeddedobject__stickyheader";
  if (typebox)
    stickyheader.appendChild(typebox);
  stickyheader.appendChild(objectbuttons);
  box.appendChild(stickyheader);

  const previewnode = document.createElement(basenode);
  previewnode.className = "wh-rtd-embeddedobject__preview";
  previewnode.innerHTML = data.htmltext;
  box.appendChild(previewnode);

  if (!isinline) {
    const navabovebutton = document.createElement(basenode);
    navabovebutton.className = "wh-rtd-navabovebutton";
    navabovebutton.setAttribute("data-rte-subaction", "navabove");

    objectbuttons.appendChild(navabovebutton);

    const navunderbutton = document.createElement(basenode);
    navunderbutton.className = "wh-rtd-navunderbutton";
    navunderbutton.setAttribute("data-rte-subaction", "navunder");

    objectbuttons.appendChild(navunderbutton);
  }

  if (config.editembeddedobjects) {
    const editbutton = document.createElement(basenode);
    editbutton.className = "wh-rtd-editbutton";
    editbutton.setAttribute("data-rte-subaction", "edit");

    objectbuttons.appendChild(editbutton);
  }

  const deletebutton = document.createElement(basenode);
  deletebutton.className = "wh-rtd-deletebutton";
  deletebutton.setAttribute("data-rte-subaction", "delete");

  objectbuttons.appendChild(deletebutton);

  return node;
}

export function getCleanValue(tree: HTMLElement): string {
  const returntree = tree.cloneNode(true) as HTMLElement;

  //clean embedded objects
  queryEmbeddedObjects(returntree).forEach(node => {
    node.contentEditable = "inherit";
    node.replaceChildren();
  });

  //clean table editors
  tablesupport.cleanupTree(returntree);

  dompack.qSA(returntree, "*[tabindex], *[todd-savedtabindex]").forEach(item => {
    item.removeAttribute("tabindex");
    item.removeAttribute("todd-savedtabindex");
  });

  return returntree.innerHTML;
}
