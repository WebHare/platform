import * as tablesupport from "./tableeditor";
import * as dompack from 'dompack';

export function fixupScopeTRs(node: HTMLElement) {
  for (const tr of dompack.qSA(node, 'tr')) {
    const scoperow = Boolean(tr.querySelector('th[scope=row]'));
    tr.classList.toggle('wh-rtd--hasrowheader', scoperow);

    const scopecol = Boolean(tr.querySelector('th[scope=col]'));
    tr.classList.toggle('wh-rtd--hascolheader', scopecol);
  }
}

//Might be better to split this into separate interfaces, but for now this is just inferred based on existing code
export interface TargetInfo {
  __node?: HTMLElement;
  type?: "hyperlink" | "cell" | "table" | "embeddedobject" | "img";
  //for hyperlink and image - but they set up inconsistent definitions. They should be the same.
  link?: string | { link: string; target: string } | null;
  //for hyperlink:
  target?: string;
  //for cell/table
  cellstyletag?: string;
  tablecaption?: string;
  tablestyletag?: string;
  numrows?: number;
  numcolumns?: number;
  datacell?: HTMLElement;
  //for embeddedobject:
  instanceref?: string;
  //for image:
  width?: number;
  height?: number;
  alttext?: string;
  src?: string;
  align?: string;
}

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

  if (removeclass != "") {
    // remove old classes (to keep extra classes set later intact)
    for (const cname of removeclass.split(" ")) {
      if (cname != "")
        node.classList.remove(cname);
    }
  }

  if (addclass != "") {
    for (const cname of addclass.split(" ")) {
      if (cname != "")
        node.classList.add(cname);
    }
  }
}
