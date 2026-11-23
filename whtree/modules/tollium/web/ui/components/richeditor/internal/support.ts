import * as tablesupport from "./tableeditor";
import * as dompack from "@webhare/dompack";
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

/** Attributes recording the size of an embedded object's preview in copied HTML */
const previewWidthAttr = "data-wh-preview-width", previewHeightAttr = "data-wh-preview-height";

/** Record the size of the previews of the embedded objects in copied content, so the placeholders shown after pasting them
 *  take about the same space as the previews will
 * @param container - Copied content
 * @param body - Body of the editor the content was copied from
 */
export function recordEmbeddedObjectSizes(container: HTMLElement, body: HTMLElement) {
  for (const node of queryEmbeddedObjects(container)) {
    const instanceref = node.dataset.instanceref;
    const preview = instanceref ? body.querySelector(`.wh-rtd-embeddedobject[data-instanceref="${CSS.escape(instanceref)}"] > .wh-rtd-embeddedobject__box > .wh-rtd-embeddedobject__preview`) : null;
    if (!preview)
      continue;

    const rect = preview.getBoundingClientRect();
    node.setAttribute(previewWidthAttr, String(Math.round(rect.width)));
    node.setAttribute(previewHeightAttr, String(Math.round(rect.height)));
  }
}

function getPreviewSize(value: string | null) {
  const size = parseInt(value || "");
  return size > 0 ? Math.min(size, 10000) : 0;
}

/** Give the preview node of a placeholder the size of the original preview. Block embedded objects only get its height, as their
 *  width follows the width of the editor they're pasted into */
function setPlaceholderSize(previewnode: HTMLElement, size: { width: number; height: number }) {
  if (size.width && previewnode.nodeName === 'SPAN')
    previewnode.style.width = size.width + "px";
  if (size.height)
    previewnode.style.height = size.height + "px";
}

/** Replace the embedded objects in pasted content with placeholders. The previews and other data of the pasted embedded objects
 *  came from the clipboard and can't be trusted, so we only keep their instance reference and have the server render them again.
 *  Embedded objects without an instance reference are removed
 * @param container - Pasted content. Should not be part of a live document
 */
export function replaceEmbeddedObjectsWithPlaceholders(container: HTMLElement) {
  for (const node of queryEmbeddedObjects(container)) {
    if (!container.contains(node)) //nested in an embedded object we've already replaced
      continue;

    const instanceref = node.getAttribute("data-instanceref");
    if (!instanceref) {
      node.remove();
      continue;
    }

    const doc = node.ownerDocument;
    const basenode = node.nodeName === 'SPAN' ? 'span' : 'div';
    const placeholder = doc.createElement(basenode);
    placeholder.className = "wh-rtd-embeddedobject wh-rtd-embeddedobject--placeholder";
    placeholder.setAttribute("data-instanceref", instanceref);
    //the size is stored on the preview node, so it doesn't end up in the value
    const preview = doc.createElement(basenode);
    preview.className = "wh-rtd-embeddedobject__preview";
    setPlaceholderSize(preview, {
      width: getPreviewSize(node.getAttribute(previewWidthAttr)),
      height: getPreviewSize(node.getAttribute(previewHeightAttr))
    });
    placeholder.append(preview);
    node.replaceWith(placeholder);
  }
}

export function parseEmbeddedObjectNode(node: HTMLElement): RTEWidget & { type: string } {
  if (node.classList.contains("wh-rtd-embeddedobject--placeholder")) { //created by replaceEmbeddedObjectsWithPlaceholders, or a reparse of a placeholder still waiting for its preview
    const preview = node.querySelector<HTMLElement>(".wh-rtd-embeddedobject__preview");
    return {
      type: 'embeddedobject',
      instanceref: node.getAttribute("data-instanceref") || '',
      htmltext: '',
      typetext: '',
      canedit: false,
      canwrite: false,
      embedtype: node.nodeName === 'SPAN' ? 'inline' : 'block',
      wide: false,
      placeholder: {
        width: getPreviewSize(preview?.style.width || null),
        height: getPreviewSize(preview?.style.height || null)
      }
    };
  }

  let htmltext = node.dataset.innerhtmlContents || '';
  if (!htmltext) { //we may have already rendered a preview (reparse of existing code) (TODO does this also apply in ProseMirror?)
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
    canwrite: node.hasAttribute("data-writable"),
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
    + (data.canwrite ? " wh-rtd-embeddedobject--writable" : "")
    + (data.wide ? " wh-rtd-embeddedobject--wide" : "")
    + (isinline ? " wh-rtd-embeddedobject--inline" : " wh-rtd-embeddedobject--block")
    + (has_inlinepreview ? " wh-rtd-embeddedobject--hasinlinepreview" : "")
    + (data.placeholder ? " wh-rtd-embeddedobject--placeholder" : "");
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
  if (data.placeholder)
    setPlaceholderSize(previewnode, data.placeholder);
  else
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
    //remove all classes to only keep the bare minimum needed for the value
    for (const className of node.classList)
      if (!["wh-rtd-embeddedobject", "wh-rtd-embeddedobject--inline", "wh-rtd-embeddedobject--block"].includes(className))
        node.classList.remove(className);
  });

  //clean table editors
  tablesupport.cleanupTree(returntree);

  dompack.qSA(returntree, "*[tabindex], *[todd-savedtabindex]").forEach(item => {
    item.removeAttribute("tabindex");
    item.removeAttribute("todd-savedtabindex");
  });

  return returntree.innerHTML;
}
