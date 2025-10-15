/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import * as scrollmonitor from '@mod-tollium/js/internal/scrollmonitor';

import RTEToolbar from './toolbar';
import * as menu from '@mod-tollium/web/ui/components/basecontrols/menu';
import { getTid } from "@webhare/gettid";
import "@mod-tollium/web/ui/components/richeditor/richeditor.lang.json";

import { convertHtmlToPlainText } from "@mod-system/js/internal/converthtmltoplaintext";
import * as styleloader from './styleloader';

import { getFormService } from "@webhare/forms/src/formservice"; //TODO should not require formservice in core RTD code, RTD integration should take care of it

import { isMultiSelectKey, loadImage } from '@webhare/dompack';
import * as browser from "dompack/extra/browser";
import * as KeyboardHandler from "dompack/extra/keyboard";
import SelectionInterface from './selection';
import * as tablesupport from "./tableeditor";
import * as richdebug from "./richdebug";
import * as domlevel from "./domlevel";
import * as support from "./support";
import * as icons from '@mod-tollium/js/icons';
import Range from './dom/range';
import type { BlockStyle, ExternalStructureDef } from "./parsedstructure";
import { encodeString } from "@webhare/std";
import { getFileAsDataURL, requestFile } from '@webhare/upload';
import type { ActionState, GetPlainTextMethod, GetPlainTextOptions, RTEComponent } from './types';
import { RTECompBase } from './rtecompbase';
import { handleCopyEvent } from "./clipboard";

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  HTML values
//

// Get a plain text interpretation of the current rte contents
function GetOuterPlain(node: Node): string {
  if (domlevel.testType(node, [domlevel.NodeType.element, domlevel.NodeType.documentFragment] as const)) {
    // Don't return contents of certain elements
    if (('|script|style|').indexOf('|' + node.nodeName.toLowerCase() + '|') >= 0)
      return '';

    // Return certain elements as-is
    if (('|br|hr|img|').indexOf('|' + node.nodeName.toLowerCase() + '|') >= 0)
      return GetNodeXML(node);

    const nodes = [];

    // Leave some element tags
    if (('|blockquote|table|tbody|tr|th|td|').indexOf('|' + node.nodeName.toLowerCase() + '|') >= 0)
      nodes.push('<' + node.nodeName.toLowerCase() + GetNodeXML_Attributes(node as Element) + '>');

    // Get subnode texts
    for (let subnode = node.firstChild; subnode; subnode = subnode.nextSibling)
      nodes.push(GetOuterPlain(subnode));

    // Add newline after certain elements
    if (('|blockquote|div|dd|dt|fieldset|form|h1|h2|h3|h4|h5|h6|li|p|pre|').indexOf('|' + node.nodeName.toLowerCase() + '|') >= 0)
      nodes.push('<br/>');

    // Leave some element tags
    if (('|blockquote|table|tbody|tr|th|td|').indexOf('|' + node.nodeName.toLowerCase() + '|') >= 0)
      nodes.push('</' + node.nodeName.toLowerCase() + '>');

    return nodes.join('');
  }
  if (node.nodeType === 3 || node.nodeType === 4) {
    if (!node.nodeValue)
      return '';
    let value = encodeString(node.nodeValue, 'attribute');

    // Replace newlines with <br> nodes within pre elements
    let nodeitr = node.parentNode;
    for (; nodeitr; nodeitr = nodeitr.parentNode)
      if (('|pre|').indexOf('|' + node.nodeName.toLowerCase() + '|') >= 0)
        break;
    if (nodeitr)
      value = value.split('\r\n').join('\n')   // Replace \r\n with \n
        .split('\r').join('\n')     // Replace \r with \n
        .split('\n').join('<br/>'); // Replace \n with <br/>

    return value;
  }
  return '';
}


function GetNodeXML(node: Node, inner?: boolean): string {
  if (!node)
    return '';

  const s = [];
  switch (node.nodeType) {
    case 9: // document
      if (!inner)
        s.push('<html><body>');
      s.push(GetNodeXML((node as Document).body, true));
      if (!inner)
        s.push('</body></html>');
      break;
    case 1: { // element
      const elt = node as Element;
      if (!elt.childNodes.length) {
        // Don't export the bogus Mozilla line break node
        if (elt.nodeName.toLowerCase() === 'br'
          && (elt.getAttribute('_moz_editor_bogus_node') === 'TRUE'
            || elt.getAttribute('type') === '_moz'))
          break;
        if (!inner)
          s.push('<' + elt.nodeName.toLowerCase() + GetNodeXML_Attributes(elt) + '/>');
      } else {
        if (!inner)
          s.push('<' + elt.nodeName.toLowerCase() + GetNodeXML_Attributes(elt) + '>');
        for (let child = elt.firstChild; child; child = child.nextSibling)
          s.push(GetNodeXML(child, false));
        if (!inner)
          s.push('</' + elt.nodeName.toLowerCase() + '>');
      }
      break;
    }
    case 3: // text
      if (node.nodeValue)
        s.push(encodeString(node.nodeValue, 'attribute'));
      break;
  }
  return s.join('');
}

function GetNodeXML_Attributes(node: Element) {
  const s = [];
  for (let i = 0; i < node.attributes.length; ++i)
    s.push(' ' + node.attributes[i].nodeName.toLowerCase() + '="' + encodeString(node.attributes[i].nodeValue || "", 'attribute') + '"');
  return s.join('');
}

function undoMutationEvents(ancestor: Element, records: MutationRecord[], recordrecords: boolean) {
  const redoRecords = [];
  let redoObserver;

  if (recordrecords) {
    redoObserver = new MutationObserver((newrecords) => redoRecords.push(...newrecords));
    redoObserver.observe(ancestor,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true
      });
  }

  //console.log(`start undo of `, records);
  for (const rec of records.reverse()) {
    //console.log(`undoing record`, rec);
    switch (rec.type) {
      case "attributes":
        {
          if (rec.oldValue === null)
            if (rec.attributeNamespace)
              (rec.target as Element).removeAttributeNS(rec.attributeNamespace, rec.attributeName as string);
            else
              (rec.target as Element).removeAttribute(rec.attributeName as string);
          else
            if (rec.attributeNamespace)
              (rec.target as Element).setAttributeNS(rec.attributeNamespace, rec.attributeName as string, rec.oldValue);
            else
              (rec.target as Element).setAttribute(rec.attributeName as string, rec.oldValue);
        } break;
      case "characterData":
        {
          rec.target.nodeValue = rec.oldValue;
        } break;
      case "childList":
        {
          for (const node of rec.addedNodes)
            (node as Element).remove();
          if (rec.removedNodes.length) {
            const nodes = Array.from(rec.removedNodes);
            if (rec.nextSibling)
              (rec.nextSibling as ChildNode).before(...nodes);
            else
              (rec.target as ParentNode).append(...nodes);
          }
        }
    }
  }

  //console.log(`finished undo`);

  if (redoObserver) {
    redoRecords.push(...redoObserver.takeRecords());
    redoObserver.disconnect();
    //console.log(`generated redo records`, redoRecords);
    return redoRecords;
  }

  return null;
}

/** This undo item works by using snapshots. The initial method was using domlevel methods that added undo/redo actions
    to an undo item, but using snapshots is easier (and a lot more memory intensive). The domlevel recording can be
    re-developed later, because it has clear time/space savings inb the browser session.
*/
class EditorUndoItem {
  editor: EditorBase;
  preselection: Range;
  postselection: Range | null;
  undoRecords: MutationRecord[];
  redoRecords: MutationRecord[] | null;
  locks: UndoLock[];
  undoChangeObserver: MutationObserver | null;
  finished: undefined | true;
  onfinish: undefined | ((undoitem: EditorUndoItem) => void);

  constructor(editor: EditorBase, selection: Range) {
    this.editor = editor;
    this.preselection = selection.clone();
    this.postselection = null;
    this.undoRecords = [];
    this.redoRecords = null;
    this.locks = [];

    // Watch all changes happening within this undoitem
    this.undoChangeObserver = new MutationObserver((records) => this.undoRecords.push(...records));
    this.undoChangeObserver.observe(editor.getBody(),
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true
      });
  }

  finish(selection?: Range) {
    if (!selection)
      selection = this.editor.getSelectionRange();

    this.undoRecords.push(...(this.undoChangeObserver?.takeRecords() ?? []));
    this.undoChangeObserver?.disconnect();
    this.undoChangeObserver = null;

    this.postselection = selection.clone();
    this.finished = true;

    if (this.onfinish)
      this.onfinish(this);
  }

  undo() {
    this.redoRecords = undoMutationEvents(this.editor.getBody(), this.undoRecords, !this.redoRecords) || this.redoRecords;
    this.editor.selectRange(this.preselection);
  }

  redo() {
    if (!this.redoRecords)
      throw new Error(`Redo records not available`);
    undoMutationEvents(this.editor.getBody(), this.redoRecords, false);
    this.editor.selectRange(this.postselection);
  }
}

class UndoLock {
  undoitem: null;
  _undoitem: EditorUndoItem | null;
  stack: Error | undefined;

  constructor(undoitem: EditorUndoItem | null) {
    // FIXME: public dom-level undoitem for now - remove when domlevel undoitem is removed
    this.undoitem = null;

    this._undoitem = undoitem;
    if (undoitem) {
      undoitem.locks.push(this);
      this.stack = new Error("undo lock acquisition");
    }
  }

  close() {
    if (this._undoitem) {
      const closedlock = this._undoitem.locks.pop();
      if (closedlock !== this)
        throw new Error(`Inner lock was not closed!, this lock stack: ${this.stack} inner lock stack ${closedlock?.stack}`);

      if (!this._undoitem.locks.length)
        this._undoitem.finish();
    }
  }
}


const defaultimgplaceholder = "data:image/png;base64,R0lGODlhHwAfAPUAAP///0h5ke7y9N7m687b4cTU27zN1uXs78vZ37bJ0+vw8uLq7cHS2brM1cbV3Nrj6Pj5+sDQ2d/o6+zx826VqGOMoYGis9Tf5ZizwbDFz4Wmtfv7/JKvvXqdr9Xg5fn6+3uer2uTpgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh/hpDcmVhdGVkIHdpdGggYWpheGxvYWQuaW5mbwAh+QQJCgAAACwAAAAAHwAfAAAG/0CAcEgUDAgFA4BiwSQexKh0eEAkrldAZbvlOD5TqYKALWu5XIwnPFwwymY0GsRgAxrwuJwbCi8aAHlYZ3sVdwtRCm8JgVgODwoQAAIXGRpojQwKRGSDCRESYRsGHYZlBFR5AJt2a3kHQlZlERN2QxMRcAiTeaG2QxJ5RnAOv1EOcEdwUMZDD3BIcKzNq3BJcJLUABBwStrNBtjf3GUGBdLfCtadWMzUz6cDxN/IZQMCvdTBcAIAsli0jOHSJeSAqmlhNr0awo7RJ19TJORqdAXVEEVZyjyKtE3Bg3oZE2iK8oeiKkFZGiCaggelSTiA2LhxiZLBSjZjBL2siNBOFQ84LxHA+mYEiRJzBO7ZCQIAIfkECQoAAAAsAAAAAB8AHwAABv9AgHBIFAwIBQPAUCAMBMSodHhAJK5XAPaKOEynCsIWqx0nCIrvcMEwZ90JxkINaMATZXfju9jf82YAIQxRCm14Ww4PChAAEAoPDlsAFRUgHkRiZAkREmoSEXiVlRgfQgeBaXRpo6MOQlZbERN0Qx4drRUcAAJmnrVDBrkVDwNjr8BDGxq5Z2MPyUQZuRgFY6rRABe5FgZjjdm8uRTh2d5b4NkQY0zX5QpjTc/lD2NOx+WSW0++2RJmUGJhmZVsQqgtCE6lqpXGjBchmt50+hQKEAEiht5gUcTIESR9GhlgE9IH0BiTkxrMmWIHDkose9SwcQlHDsOIk9ygiVbl5JgMLuV4HUmypMkTOkEAACH5BAkKAAAALAAAAAAfAB8AAAb/QIBwSBQMCAUDwFAgDATEqHR4QCSuVwD2ijhMpwrCFqsdJwiK73DBMGfdCcZCDWjAE2V347vY3/NmdXNECm14Ww4PChAAEAoPDltlDGlDYmQJERJqEhGHWARUgZVqaWZeAFZbERN0QxOeWwgAAmabrkMSZkZjDrhRkVtHYw+/RA9jSGOkxgpjSWOMxkIQY0rT0wbR2LQV3t4UBcvcF9/eFpdYxdgZ5hUYA73YGxruCbVjt78G7hXFqlhY/fLQwR0HIQdGuUrTz5eQdIc0cfIEwByGD0MKvcGSaFGjR8GyeAPhIUofQGNQSgrB4IsdOCqx7FHDBiYcOQshYjKDxliVDpRjunCjdSTJkiZP6AQBACH5BAkKAAAALAAAAAAfAB8AAAb/QIBwSBQMCAUDwFAgDATEqHR4QCSuVwD2ijhMpwrCFqsdJwiK73DBMGfdCcZCDWjAE2V347vY3/NmdXNECm14Ww4PChAAEAoPDltlDGlDYmQJERJqEhGHWARUgZVqaWZeAFZbERN0QxOeWwgAAmabrkMSZkZjDrhRkVtHYw+/RA9jSGOkxgpjSWOMxkIQY0rT0wbR2I3WBcvczltNxNzIW0693MFYT7bTumNQqlisv7BjswAHo64egFdQAbj0RtOXDQY6VAAUakihN1gSLaJ1IYOGChgXXqEUpQ9ASRlDYhT0xQ4cACJDhqDD5mRKjCAYuArjBmVKDP9+VRljMyMHDwcfuBlBooSCBQwJiqkJAgAh+QQJCgAAACwAAAAAHwAfAAAG/0CAcEgUDAgFA8BQIAwExKh0eEAkrlcA9oo4TKcKwharHScIiu9wwTBn3QnGQg1owBNld+O72N/zZnVzRApteFsODwoQABAKDw5bZQxpQ2JkCRESahIRh1gEVIGVamlmXgBWWxETdEMTnlsIAAJmm65DEmZGYw64UZFbR2MPv0QPY0hjpMYKY0ljjMZCEGNK09MG0diN1gXL3M5bTcTcyFtOvdzBWE+207pjUKpYrL+wY7MAB4EerqZjUAG4lKVCBwMbvnT6dCXUkEIFK0jUkOECFEeQJF2hFKUPAIkgQwIaI+hLiJAoR27Zo4YBCJQgVW4cpMYDBpgVZKL59cEBhw+U+QROQ4bBAoUlTZ7QCQIAIfkECQoAAAAsAAAAAB8AHwAABv9AgHBIFAwIBQPAUCAMBMSodHhAJK5XAPaKOEynCsIWqx0nCIrvcMEwZ90JxkINaMATZXfju9jf82Z1c0QKbXhbDg8KEAAQCg8OW2UMaUNiZAkREmoSEYdYBFSBlWppZl4AVlsRE3RDE55bCAACZpuuQxJmRmMOuFGRW0djD79ED2NIY6TGCmNJY4zGQhBjStPTFBXb21DY1VsGFtzbF9gAzlsFGOQVGefIW2LtGhvYwVgDD+0V17+6Y6BwaNfBwy9YY2YBcMAPnStTY1B9YMdNiyZOngCFGuIBxDZAiRY1eoTvE6UoDEIAGrNSUoNBUuzAaYlljxo2M+HIeXiJpRsRNMaq+JSFCpsRJEqYOPH2JQgAIfkECQoAAAAsAAAAAB8AHwAABv9AgHBIFAwIBQPAUCAMBMSodHhAJK5XAPaKOEynCsIWqx0nCIrvcMEwZ90JxkINaMATZXfjywjlzX9jdXNEHiAVFX8ODwoQABAKDw5bZQxpQh8YiIhaERJqEhF4WwRDDpubAJdqaWZeAByoFR0edEMTolsIAA+yFUq2QxJmAgmyGhvBRJNbA5qoGcpED2MEFrIX0kMKYwUUslDaj2PA4soGY47iEOQFY6vS3FtNYw/m1KQDYw7mzFhPZj5JGzYGipUtESYowzVmF4ADgOCBCZTgFQAxZBJ4AiXqT6ltbUZhWdToUSR/Ii1FWbDnDkUyDQhJsQPn5ZU9atjUhCPHVhgTNy/RSKsiqKFFbUaQKGHiJNyXIAAh+QQJCgAAACwAAAAAHwAfAAAG/0CAcEh8JDAWCsBQIAwExKhU+HFwKlgsIMHlIg7TqQeTLW+7XYIiPGSAymY0mrFgA0LwuLzbCC/6eVlnewkADXVECgxcAGUaGRdQEAoPDmhnDGtDBJcVHQYbYRIRhWgEQwd7AB52AGt7YAAIchETrUITpGgIAAJ7ErdDEnsCA3IOwUSWaAOcaA/JQ0amBXKa0QpyBQZyENFCEHIG39HcaN7f4WhM1uTZaE1y0N/TacZoyN/LXU+/0cNyoMxCUytYLjm8AKSS46rVKzmxADhjlCACMFGkBiU4NUQRxS4OHijwNqnSJS6ZovzRyJAQo0NhGrgs5bIPmwWLCLHsQsfhxBWTe9QkOzCwC8sv5Ho127akyRM7QQAAOwAAAAAAAAAAAA==";



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  Undo stuff
//

// ---------------------------------------------------------------------------
//
// RTE single area editor
//

export interface EditorBaseOptions {
  structure: ExternalStructureDef | null;
  allowtags: string[] | null;
  hidebuttons: string[];
  content: string;
  enabled: boolean;
  readonly: boolean;
  log: boolean;
  cssinstance: string | null;
  csslinks: string[] | null;
  csscode: string;
  preloadedcss: { addcss: Array<{ type: string; src: string }> } | null;
  breakupnodes: string[];
  htmlclass: string;
  bodyclass: string;
  contentarea: boolean;
  editembeddedobjects: boolean;
  allowundo: boolean;
  margins: string;
  propertiesaction: boolean;
  toolbarlayout: string[][] | null;
  contentareawidth: string | null;
  imgloadplaceholder: string | null;
  language: string;
}

export default class EditorBase extends RTECompBase implements RTEComponent {
  structure: ExternalStructureDef | undefined;
  blockroots: string[];
  lastselectionstate = new TextFormattingState;
  toolbar = null;
  addcss = [];
  /** Whether document is dirty. Initial set to true to avoid firing events during init */
  dirty = true;
  original_value = "<neverset>";
  /** URLs of images we have already seen and stored on the server */
  knownimages: string[] = [];
  language: string;
  bodydiv;

  constructor(container: HTMLElement, options: Partial<EditorBaseOptions>) {
    const originalcontent = [...container.childNodes];
    super(container, options);

    if (dompack.debugflags.rte)
      console.log("[rte] initializing rtd", this.container, this.options);

    //ADDME globally manage css loaded by instances
    if (this.options.csslinks)
      this.options.csslinks.forEach(href => this.addcss.push({ type: "link", src: href }));

    if (this.options.preloadedcss)
      this.addcss.push(...this.options.preloadedcss.addcss);

    if (this.options.csscode)
      this.addcss.push({ type: "style", src: this.options.csscode });

    //Create two divs inside the container, which will play the role of HTML and BODY
    this.bodydiv = dompack.create("div", {
      className: "wh-rtd wh-rtd-editor wh-rtd__body wh-rtd-editor-bodynode wh-rtd-theme-default " + this.options.bodyclass,
      on: { "dompack:takefocus": evt => this._takeSafeFocus(evt) },
      childNodes: originalcontent
    });
    this.htmldiv.append(this.bodydiv);

    if (browser.getName() === "safari" && browser.getVersion() < 13)
      this.bodydiv.classList.add("wh-rtd__body--safariscrollfix");

    //Fixes a Firefox repositioning issue, tested by richdoc.teststructured-scroll - as of 2022-11-29 we still need this workaround
    this.scrollmonitor = new scrollmonitor.Monitor(this.container);
    scrollmonitor.saveScrollPosition(this.container);

    this.htmldiv.addEventListener("mousedown", evt => this._gotPageClick(evt));
    this.htmldiv.addEventListener("click", evt => this._gotClick(evt));
    this.htmldiv.addEventListener("contextmenu", evt => this._gotContextMenu(evt));

    if (this.options.readonly)
      this.toolbarnode.style.display = "none";

    this._updateEnablingAttributes();

    let margins = 'none';
    if (this.options.structure && this.options.structure.contentareawidth) {
      if (this.options.contentarea) {
        this.bodydiv.parentNode.classList.add('wh-rtd-withcontentarea');
        this.bodydiv.classList.add('wh-rtd__body--contentarea');
      }
      this.bodydiv.style.width = this.options.structure.contentareawidth; //NOTE: already contains 'px'
      margins = this.options.margins;
    }

    this.htmldiv.classList.add("wh-rtd--margins-" + margins);
    if (margins !== 'none') //include -active if -any- margin is present. should replace wh-rtd-withcontentarea and wh-rtd__body--contentarea eventually
      this.htmldiv.classList.add("wh-rtd--margins-active");

    const editoropts = {
      log: this.options.log,
      breakupnodes: this.options.breakupnodes,
      editembeddedobjects: this.options.editembeddedobjects,
      allowundo: this.options.structure && this.options.allowundo
    };

    if (this.options.structure) {
      /*
      NOTE: contenteditable makes the node focusable, however the wh-rtd__undoholder is a hidden node we don't want to be focused.
      We prevent it from appearing in (and messing up) tabnavigation we also add tabindex="-1" in addition to the contenteditable="true".
      */

      if (this.options.allowundo) {
        this.undonode = <div contenteditable="true" class="wh-rtd__undoholder" tabindex="-1" />;
        this.container.appendChild(this.undonode);
      }

      editoropts.structure = this.options.structure; //FIXME limit structure to what is needed here
    } else {
      editoropts.allowtags = this.options.allowtags;
    }

    this.selectionitf = new SelectionInterface(this.bodydiv);

    this.selectingrange = false; // Currently busy selecting range. Needed for synchronous event selectionchange
    this.ignorenextfocus = false; // Needed to ignore range setting when refocusing body

    this.ultypes = ["", "disc", "circle", "square"];
    this.oltypes = ["", "decimal", "lower-roman", "upper-roman"];

    this.delayedsurrounds = [];

    // Undo stuff
    this.undostack = [];
    this.undopos = 0;
    this.undoselectitf = null;

    // input event stuff
    this.oninputhandlers = [];
    this.activeinputhandler = '';

    this.tableeditors = [];
    this.repeatupdatetableuntil = null;
    this.attachedinputevents = false;
    this.inputeventfunction = null;
    this.blockroots = ['body', 'td', 'th'];

    this.tableeditorstatechangedelay = null;

    if (this.undonode)
      options.allowundo = true;

    //elements that respond to action-properties
    this.properties_selector = "img, a[href]";

    //if(this.options.log) console.log('apply saved state');
    //this.stateHasChanged(true);

    if (this.onload)
      this.onload();

    this._mouseupcallback = e => this._gotMouseUp(e);

    if (this.options.log)
      console.log('onloadcompletedelayed finished');

    // Listen to focus and focusout/focusin (focusin is needed on IE11, focus runs after the element gets focus
    // (rob: my guess is that happens when the old focused element disappears, but not sure)
    this._registerFrameEventListeners();

    this.language = this.options.language;
    this.SetBreakupNodes(options && options.breakupnodes);
    this.setupUndoNode();
    //    this.stateHasChanged();
  }

  _constructorTail() {
    if (this.options.enabled)
      this.editareaconnect();

    this.toolbar = new RTEToolbar(this, this.toolbarnode, this.toolbaropts);
    this._fireStateChange();

    styleloader.register(this);
    if (this.options.preloadedcss)
      styleloader.unregister(this.options.preloadedcss);
    this.clearDirty();
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  _takeSafeFocus(evt) {
    //TODO? An alternative approach might be to have the ScrollMonitor watch focus events ?
    //take focus but save scroll position  (ADDME for non-body nodes too!)
    evt.preventDefault();

    const scrollleft = evt.target.parentNode.scrollLeft;
    const scrolltop = evt.target.parentNode.scrollTop;

    evt.target.focus(); //on chrome, focus resets scroll position. https://bugs.chromium.org/p/chromium/issues/detail?id=75072

    evt.target.parentNode.scrollLeft = scrollleft;
    evt.target.parentNode.scrollTop = scrolltop;
  }

  _gotContextMenu(event) {
    // with ctrl-shift, don't react on the event, fallback to browser menu
    if (event.ctrlKey && event.shiftKey)
      return;

    event.stopPropagation();
    event.preventDefault();

    // Contextmenu event changes selection, but the select event will fire later, so force update when getting the state.
    this._gotSelectionChange(null); //Fixes Chrome's weird cross-td-boundary selection right click

    const selectionstate = this.getSelectionState(true);
    if (!selectionstate)
      return;

    const actiontarget = selectionstate.propstarget ? support.getTargetInfo({ __node: selectionstate.propstarget }) : null;

    const menuitems = [];
    for (const menuitem of
      [
        { action: "table-addrow-before", title: getTid("tollium:components.rte.table_addrow_before") },
        { action: "table-addrow-after", title: getTid("tollium:components.rte.table_addrow_after") },
        null,
        { action: "table-addcolumn-before", title: getTid("tollium:components.rte.table_addcolumn_before") },
        { action: "table-addcolumn-after", title: getTid("tollium:components.rte.table_addcolumn_after") },
        null,
        { action: "table-deleterow", title: getTid("tollium:components.rte.table_deleterow") },
        { action: "table-deletecolumn", title: getTid("tollium:components.rte.table_deletecolumn") },
        null,
        { action: "table-addpara-before", title: getTid("tollium:components.rte.table_addpara_before") },
        { action: "table-addpara-after", title: getTid("tollium:components.rte.table_addpara_after") },
        null,
        { action: "table-mergeright", title: getTid("tollium:components.rte.table_mergeright") },
        { action: "table-mergedown", title: getTid("tollium:components.rte.table_mergedown") },
        { action: "table-splitcols", title: getTid("tollium:components.rte.table_splitcols") },
        { action: "table-splitrows", title: getTid("tollium:components.rte.table_splitrows") },
        null,
        ...(this.options.propertiesaction ? [{ action: "action-properties", title: getTid("tollium:components.rte.properties") }] : [])
      ]) {
      if (!menuitem || selectionstate.actionstate[menuitem.action].available)
        menuitems.push(menuitem);
    }

    if (!dompack.dispatchCustomEvent(this.bodydiv, "wh:richeditor-contextmenu", {
      bubbles: true,
      cancelable: true,
      detail: { actiontarget, menuitems }
    })) {
      return;
    }
    if (!menuitems.some(_ => _))
      return; //no non-null items, don't open it

    const contextmenu = <ul onClick={evt => this._activateRTDMenuItem(evt, actiontarget)}>
      {menuitems.map(item => item ? <li data-action={item.action}>{item.title}</li> : <li class="divider" />)}
    </ul>;

    menu.openAt(contextmenu, event, { eventnode: this.node });
  }

  _activateRTDMenuItem(evt, actiontarget) {
    dompack.stop(evt);
    const item = evt.target.closest('li');
    this.executeAction(item.dataset.action, actiontarget);
  }

  //get the current dirty flag
  isDirty() {
    return this.dirty;
  }

  //clear dirty state
  clearDirty() {
    this.original_value = this.getValue();
    this.dirty = false;
  }

  _checkDirty() {
    if (this.dirty)
      return;

    this.dirty = this.original_value !== this.getValue();
    if (this.dirty) {
      if (dompack.debugflags.rte)
        console.log("[rte] Document got dirty, firing event");

      dompack.dispatchCustomEvent(this.container, "wh:richeditor-dirty", { bubbles: true, cancelable: false });
    }
  }

  // ---------------------------------------------------------------------------
  //
  // Callbacks
  //
  _gotClick(event) {
    dompack.stop(event); //no click should ever escape an RTE area

    const linkel = event.target.closest('a[href]');
    if (linkel
      && linkel.href.match(/^https?:/)
      && (!this.isEditable() || isMultiSelectKey(event))) {
      window.open(linkel.href, '_blank');
    }
  }

  _gotPageClick(event) {
    if (!this.isEditable())
      return;

    // clicked on the html-div?
    if (this.htmldiv === event.target) {
      // focus body node instead
      this.bodydiv.focus();
      event.preventDefault();
    }

    const lastelt = this.bodydiv.lastElementChild;
    if (!lastelt || event.clientY > lastelt.getBoundingClientRect().bottom)
      this.requireBottomParagraph();
  }

  _updateEnablingAttributes() {
    const rtdstatenode = this.stylescopenode || this.htmldiv;
    rtdstatenode.classList.toggle('wh-rtd--enabled', this.isEditable());
    rtdstatenode.classList.toggle('wh-rtd--disabled', !this.options.enabled);
    rtdstatenode.classList.toggle('wh-rtd--readonly', this.options.readonly);
  }

  _gotStateChange(event) {
    this._fireStateChange();
    this._checkDirty();
  }

  _fireStateChange() {
    dompack.dispatchCustomEvent(this.bodydiv, 'wh:richeditor-statechange', { bubbles: true, cancelable: false });
  }

  // ---------------------------------------------------------------------------
  //
  // Action and content API
  //

  updateTarget(actiontarget, settings) {
    const undolock = this.getUndoLock();

    const node = actiontarget.__node;
    if (node.matches('a'))
      this._updateHyperlink(actiontarget.__node, settings);
    else if (node.matches('td,th'))
      this._updateCell(actiontarget.__node, settings);
    else if (node.matches('table'))
      this._updateTable(actiontarget.__node, settings);
    else if (node.matches('.wh-rtd-embeddedobject')) {
      if (node.classList.contains("wh-rtd-embeddedobject")) {
        //we'll simply reinsert
        if (settings) {
          if (settings.type === 'replace') {
            this.updateEmbeddedObject(node, settings.data);
          } else if (settings.type === 'remove') {
            this.removeEmbeddedObject(node);
          }
        }
      }
    } else if (node.matches('img')) {
      if (settings.width)
        node.setAttribute("width", settings.width);
      else
        node.removeAttribute("width");
      if (settings.height)
        node.setAttribute("height", settings.height);
      else
        node.removeAttribute("height");

      node.align = '';
      node.alt = settings.alttext;
      node.className = "wh-rtd__img" + (settings.align === 'left' ? " wh-rtd__img--floatleft" : settings.align === "right" ? " wh-rtd__img--floatright" : "");

      let link = node.closest('A');
      if (link && !settings.link) //remove the hyperlink
      {
        link.replaceWith(node);
        this.selectNodeOuter(node);
      } else if (settings.link) //add or update a hyperlink
      {
        if (!link) {
          //replace the image with the link
          link = document.createElement('a');
          node.replaceWith(link);
          link.appendChild(node);
          this.selectNodeOuter(link);
        }

        link.href = settings.link.link;
        link.target = settings.link.target || '';
      }
    } else {
      console.error(node, settings);
      throw new Error("Did not understand action target");
    }
    undolock.close();
  }

  _updateHyperlink(node, settings) {
    const undolock = this.getUndoLock();

    if (settings.destroy) //get rid of the hyperlink
    {
      this.selectNodeOuter(node);
      this.removeHyperlink();
    } else {
      if ('link' in settings)
        node.setAttribute("href", settings.link);
      if ('target' in settings)
        if (settings.target)
          node.target = settings.target;
        else
          node.removeAttribute('target');
    }

    this._checkDirty();
    undolock.close();
  }

  _updateTable(table, settings) {
    if (settings.removetable) {
      this.removeTable(table);
      return;
    }

    const editor = tablesupport.getEditorForNode(table);
    if (editor) {
      editor.setFirstDataCell(settings.datacell.row, settings.datacell.col);
      editor.setStyleTag(settings.tablestyletag);
      editor.setCaption(settings.tablecaption);
    }
  }

  _updateCell(node, settings) {
    //apply cell update before table updates... the table might destroy our node! (eg if it gets replaced by a TH)
    this.setCellStyle(node, settings.cellstyletag);
    this._updateTable(node.closest('table'), settings);
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  getBody(): HTMLElement {
    return this.bodydiv;
  }

  onStateChange(callback: () => void) {
    this.getBody().addEventListener("wh:richeditor-statechange", callback);
  }

  qS<T extends HTMLElement>(selector: string): T | null {
    return this.getBody().querySelector(selector);
  }

  qSA<T extends HTMLElement>(selector: string): T[] {
    return Array.from(this.getBody().querySelectorAll<T>(selector));
  }

  getButtonNode(actionname) {
    return this.toolbarnode.querySelector('span.wh-rtd-button[data-button=' + actionname + ']');
  }

  isEditable() {
    return this.options.enabled && !this.options.readonly;
  }

  getEditor() {
    return this;
  }

  getValue(): string {
    return support.getCleanValue(this.getBody());
  }

  setValue(val: string) {
    this.dirty = true;

    this.bodydiv.innerHTML = val;
    this.resetUndoStack();
    this.knownimages = this.qSA<HTMLImageElement>('img')
      .filter(node => !node.closest(".wh-rtd-embeddedobject"))
      .map(node => node.src);

    this.reprocessAfterExternalSet();

    this.original_value = this.getValue();
    this.dirty = false;

    this._checkDirty();
  }

  focus() {
    this.bodydiv.focus();
  }

  setEnabled(enabled) {
    if (enabled === this.options.enabled)
      return;

    this.options.enabled = enabled;

    if (this.bodydiv)
      this._updateEnablingAttributes();

    if (this.options.readonly) // Readonly still active, no change
      return;

    if (enabled) {
      this.editareaconnect();
      this._fireStateChange();
    } else {
      this.editareadisconnect();
      this._fireStateChange();
    }
  }

  setReadonly(readonly) {
    if (readonly === this.options.readonly)
      return;

    this.options.readonly = readonly;

    this.toolbarnode.style.display = readonly ? "none" : "block";
    this._updateEnablingAttributes();

    if (!this.options.enabled) // Readonly still active, no change in editability
      return;

    if (!readonly) {
      this._fireStateChange();
      this.editareaconnect();
    } else {
      this.editareadisconnect();
      this._fireStateChange();
    }
  }

  setHTMLClass(htmlclass) {
    support.replaceClasses(this.htmldiv, this.options.htmlclass, htmlclass);
    this.options.htmlclass = htmlclass;
  }

  setBodyClass(bodyclass) {
    support.replaceClasses(this.bodydiv, this.options.bodyclass, bodyclass);
    this.options.bodyclass = bodyclass;
  }

  getPlainText(method: GetPlainTextMethod, options: GetPlainTextOptions = []): string {
    switch (method) {
      case "converthtmltoplaintext":
        {
          const suppress_urls = options.includes("suppress_urls");
          const unix_newlines = options.includes("unix_newlines");
          return convertHtmlToPlainText(this.bodydiv, { suppress_urls, unix_newlines });
        }
      case "textcontent":
        {
          return this.bodydiv.textContent || '';
        }
    }
    throw new Error("Unsupported method for plaintext conversion: " + method);
  }

  // used by tests only, remove when possible
  get editnode() {
    return this.bodydiv;
  }

  setupUndoNode() {
    if (this.undonode && this.options.allowundo) {
      this.undonode.innerHTML = '0';
      this.undoselectitf = new SelectionInterface(this.undonode);

      if (window.MutationObserver) {
        // Add mutation observer to undonode, so we'll get notifified on changes
        this.undoNodeMutationObserver = new MutationObserver(evt => this.gotUndoChange('mutation', evt));
        this.undoNodeMutationObserver.observe(
          this.undonode,
          {
            characterData: true,
            subtree: true,
            childList: true
          });
      } else
        this.undonode.addEventListener('input', evt => this.gotUndoChange('input', evt));

      // Revert focus back to contentEditable node ASAP
      // - Chrome gives undo node focus upon change
      // - Firefox needs focus to execute InsertHTML
      this.undonode.addEventListener('focus', evt => this.refocusAfterUndoUpdate(evt));
    }
  }

  gotUndoChange(name, event) {
    const elt = parseInt(this.undonode.innerHTML);
    //console.log('gotUndoChange', name, event, "new indopos: ", elt, 'current undopos: ', this.undopos);
    if (elt === this.undopos)
      return;

    //console.log('un/redo ' + name + ': ' + elt);
    this.changeUndoPosition(elt);
  }

  refocusAfterUndoUpdate() {
    setTimeout(() => this.getBody().focus());
    this.stateHasChanged();
  }

  destroy() {
    this.toolbarnode.remove();
    styleloader.unregister(this);

    if (this.fontslistener)
      document.fonts.removeEventListener("loadingdone", this.fontslistener);

    if (this.scheduledupdatetableeditors) {
      cancelAnimationFrame(this.repeatupdatetableanimframe);
      clearTimeout(this.repeatupdatetabletimeout);
    }

    this.bodydiv.contentEditable = false;
  }


  execCommand(command, p1, p2) {
    try {
      // execCommand should be called on the document, not the editable area (contenteditable/designmode)
      this.bodydiv.ownerDocument.execCommand(command, p1, p2);
    } catch (e) {
      if (this.options.log)
        console.log('ExecCommand exception', e);
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions - selection
  //

  /** Make sure a range doesn't contain 2 tds or straddles into another table
      @param range -
      @returns
      \@cell changed
      \@cell range
  */
  _constrainRangeCrossTDSelections(range) {
    let changed = false;
    let base = range.getAncestorElement();

    range = range.clone();
    const startpath = range.start.getPathFromAncestor(base).reverse();
    for (let i = 0; i < startpath.length; ++i) {
      const node = startpath[i];
      if (node.nodeType === 1 && (["td", "th"].includes(node.nodeName.toLowerCase()))) {
        range.intersect(Range.fromNodeInner(node));
        changed = true;
        break;
      }
    }

    // Get new base in case we have corrected
    base = range.getAncestorElement();

    // if the end locator points within an inner table
    const endpath = range.end.getPathFromAncestor(base).reverse();
    for (let i = 0; i < endpath.length; ++i) {
      const node = endpath[i];
      if (node.nodeType === 1 && node.nodeName.toLowerCase() === "table") {
        const locator = domlevel.Locator.newPointingTo(node);
        locator.scanBackward(this.getBody(), { whitespace: true, blocks: true }); // if we set past the last block elt, we'll delete that linebreak too, too dangerous
        if (range.start.compare(locator) <= 0)
          range.end.assign(locator);
        else
          range.end.assign(range.start);
        changed = true;
        break;
      }
    }

    return { changed, range };
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions - focus stuff
  //

  hasFocus() {
    let active = document.activeElement;
    while (active && active !== this.bodydiv)
      active = active.parentNode;
    return Boolean(active);
  }

  takeFocus() {
    this.bodydiv.focus();
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  setContentsHTML(htmlcode, options) {
    //note: WE don't use 'raw', but the structurededitor does! raw bypasses its cleanup
    this.bodydiv.innerHTML = htmlcode;
    this.setCursorAtLocator(new domlevel.Locator(this.getBody()));
  }
  setContentsHTMLRaw(htmlcode) {
    this.setContentsHTML(htmlcode, { raw: true });
  }

  /// Returns raw selection range (for use in tests)
  debugGetRawSelectionRange() {
    return this.selectionitf.getSelectionRange();
  }

  _fixChromeInitialPositionBug(range) {
    const bodynode = this.getBody();

    // Fixes chrome positioning the cursor at the first node when the document starts with embedded blocks, and then selecting an empty paragraph after those blocks
    if (range.end.element === bodynode && range.end.offset === 0) {
      const loc = range.end.clone();
      let modified = false;
      for (; ;) {
        const node = loc.getPointedNode();
        if ((!node) || (node.nodeType !== 1) || node.isContentEditable)
          break;
        ++loc.offset;
        modified = true;
      }
      range.assign(Range.fromLocator(loc));
      this.selectionitf.selectRange(range);

      if (modified && (Range.getLogLevel() & 4))
        console.log('getSelectionRange native was not legal (contentEditable error). After normalize', richdebug.getStructuredOuterHTML(this.getBody(), range, true), range.start, range.end);
    }
  }

  /** Returns a $wh.Rich.range with the current selection, constrained to body node/editelement. The returned
      range is limited to the contentbodynode, and descended into leaf nodes.

      @returns Copy of the current selection
  */
  getSelectionRange(options?: { skipnormalize?: boolean }): Range {
    const skipnormalize = options && options.skipnormalize;

    const bodynode = this.getBody();

    if (this.hasFocus()) {
      const range = this.selectionitf.getSelectionRange();
      if (range) {
        if (Range.getLogLevel() & 4)
          console.log('getSelectionRange have native selection (limited to body node)', richdebug.getStructuredOuterHTML(this.getBody(), range, true), { ...range.start }, { ...range.end });

        range.limitToNode(bodynode);
        if (!range.isLegal(this.getBody())) {
          console.log('normalize illegal range');
          range.normalize(this.getBody());
          this.selectionitf.selectRange(range);

          if (Range.getLogLevel() & 4)
            console.log('getSelectionRange native was not legal. After normalize', richdebug.getStructuredOuterHTML(this.getBody(), range, true), range.start, range.end);
        }

        this._fixChromeInitialPositionBug(range);
        this.currentrange = range;
      } else if (this.currentrange) {
        this.currentrange.limitToNode(bodynode);

        if (Range.getLogLevel() & 4)
          console.log('getSelectionRange no native selection, use saved', richdebug.getStructuredOuterHTML(this.getBody(), this.currentrange, true), this.currentrange.start, this.currentrange.end);
      }
    } else if (this.currentrange) {
      this.currentrange.limitToNode(bodynode);

      if (Range.getLogLevel() & 4)
        console.log('getSelectionRange no focus, use saved', richdebug.getStructuredOuterHTML(this.getBody(), this.currentrange, true), this.currentrange.start, this.currentrange.end);
    }

    if (!this.currentrange) {
      // No focus yet, and no saved selection - use default (start of document)
      const locator = new domlevel.Locator(bodynode);
      this.currentrange = new Range(locator, locator);
      if (Range.getLogLevel() & 4)
        console.log('getSelectionRange no saved selection', richdebug.getStructuredOuterHTML(this.getBody(), this.currentrange, true), this.currentrange.start, this.currentrange.end);
    }

    const retval = this.currentrange.clone();
    if (!skipnormalize) {
      retval.normalize(bodynode, true);
      if (Range.getLogLevel() & 4)
        console.log('getSelectionRange normalized selection', richdebug.getStructuredOuterHTML(this.getBody(), retval, true), retval.start, retval.end);
    }

    return retval;
  }

  /** Changes the current selection to the passed range
      @param range - Range to select
  */
  selectRange(range, options?: { skipnormalize?: boolean }) {
    if (!domlevel.isNodeSplittable(range.start.element))
      throw new Error("Trying to put start of selection within an unsplittable element (" + range.start.element.nodeName + ')');
    if (!domlevel.isNodeSplittable(range.end.element))
      throw new Error("Trying to put end of selection within an unsplittable element (" + range.end.element.nodeName + ')');

    const body = this.getBody();
    this.currentrange = range.clone();

    if (Range.getLogLevel() & 64)
      console.log('selectrange before limit', richdebug.getStructuredOuterHTML(body, this.currentrange, true), this.currentrange.start, this.currentrange.end);
    this.currentrange.limitToNode(body);
    if (Range.getLogLevel() & 64)
      console.log('selectrange after limit', richdebug.getStructuredOuterHTML(body, this.currentrange, true), this.currentrange.start, this.currentrange.end);

    if (!options || !options.skipnormalize) {
      this.currentrange.normalize(body);
      if (Range.getLogLevel() & 64)
        console.log('selectrange after normalize', richdebug.getStructuredOuterHTML(body, this.currentrange, true), this.currentrange.start, this.currentrange.end);
    }

    //console.log('B selectingrange set', richdebug.getStructuredOuterHTML(this.getBody(), range, true));
    this.selectingrange = true;

    if (this.hasFocus())
      this.selectionitf.selectRange(this.currentrange);

    if (Range.getLogLevel() & 64)
      console.log('EA selectRange', this.connected, richdebug.getStructuredOuterHTML(body, range, false));

    this.selectingrange = false;
    //console.log('B selectingrange res', richdebug.getStructuredOuterHTML(this.getBody(), this.getSelectionRange(), true));

    this.selectionHasChanged(this.currentrange);
    this.stateHasChanged();
  }

  setCursorAtLocator(locator) {
    this.selectRange(new Range(locator, locator));
  }

  selectNodeInner(node) {
    this.selectRange(Range.fromNodeInner(node));
  }

  selectNodeOuter(node) {
    this.selectRange(Range.fromNodeOuter(node));
  }

  collapseSelection(tostart) {
    const range = this.getSelectionRange();
    if (tostart)
      range.end.assign(range.start);
    else
      range.start.assign(range.end);
    this.selectRange(range);
  }

  editareaconnect() {
    if (this.options.readonly)
      this.bodydiv.tabIndex = 0; // Even if it's not editable, the body div is still focusable (e.g. for editing specific embedded components)
    else
      this.bodydiv.contentEditable = true;

    // No Firefox, we don't want your fancy inline table editing or object resizing (can only be called _after_ editarea is
    // connected, i.e. contentEditable is set)
    this.execCommand("enableInlineTableEditing", null, "false");
    this.execCommand("enableObjectResizing", null, "false");

    this.stateHasChanged();
  }
  editareadisconnect() {
    if (this.options.readonly)
      this.bodydiv.tabIndex = -1;
    else
      this.bodydiv.contentEditable = false;

    this.stateHasChanged();
  }

  reprocessAfterExternalSet() {
    //external update to the value. reset the selection, the delayed surrounds
    this.currentrange = null;
    this.delayedsurrounds = [];

    const range = this.getSelectionRange();
    this.selectRange(range);

    this._reprocessEmbeddedAutoElements();
  }

  /// reprocess stuff like icons in embedded blocks
  _reprocessEmbeddedAutoElements() {
    icons.loadMissingImages({ node: this.getBody() });
  }

  SetBreakupNodes(nodenames) {
    if (nodenames && nodenames.length)
      this.breakupnodes = nodenames;
    else
      this.breakupnodes = [];
  }
  onFocus(event) {
    // Restore the focus on onfocus event. But don't if focusing because of a click on editable stuff
    if (this.currentrange && !this.ignorenextfocus) {
      this.selectionitf.selectRange(this.currentrange);
    }

    // Need to explicitly disable inline table editing here, doing it once just isn't enough.
    if (browser.getName() === "firefox") {
      document.execCommand("enableInlineTableEditing", null, "false");
      document.execCommand("enableObjectResizing", null, "false");
    }

    this.ignorenextfocus = false;

    this.updateTableEditors();
  }

  onFocusIn(event) {
    // Restore the selection (FIXME: this might cause problems when focus lies within an embedded object)
    if (this.currentrange && !this.ignorenextfocus)
      this.selectionitf.selectRange(this.currentrange);

    // Ignore the next focus event
    this.ignorenextfocus = true;
  }


  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Formatting
  //
  applyTextStyle(textstyle, apply) {
    //ADDME proper list of textstyles we should prevent?
    if (!['b', 'i', 'u', 'strike', 'sub', 'sup'].includes(textstyle))
      console.warn("ADDME: Didn't test ApplyTextStyle for '" + textstyle + "' yet");

    this.DelayedSurroundSelection({
      element: textstyle,
      wrapin: apply,
      splitprohibits: ['a'],
      splitblockelements: false
    });
  }


  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Contents API
  //

  setCursor(element, offset) {
    if (!element)
      throw new Error("Invalid element passed to setCursor");

    this.setCursorAtLocator(new domlevel.Locator(element, offset || 0));
  }

  SetSelection(newrange) {
    this.selectRange(Range.fromDOMRange(newrange));
  }

  SelectAll() {
    this.selectNodeInner(this.getBody());
    this.stateHasChanged();
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  New selection API
  //
  selectNodeContents(node) {
    console.warn('selectNodeContents is deprecated, use selectNodeInner!'); console.trace();
    this.selectRange(Range.withinNode(node));
  }

  insertTextAtCursor(text) {
    //console.log('setselt: ', richdebug.getStructuredOuterHTML(this.getBody(), Range.fromDOMRange(this.GetSelectionObject().GetRange())));

    const range = this.getSelectionRange();
    if (!range.isCollapsed())
      throw new Error("insertTextAtCursor does not support selections");

    // selection is collapsed, so range start = range end, so we can just use range start
    //    console.log('insertTextAtCursor DescendLocatorToLeafNode locators.start');
    range.start.descendToLeafNode(this.getBody());

    // locators.start should now point to a text node, insert the text
    let textnode = range.start.element;
    let textoffset = range.start.offset;
    if (textnode.nodeType !== 3) // If it's not a text node (e.g. in an empty document), create one
    {
      if (textnode.childNodes.length)
        textnode = textnode.insertBefore(document.createTextNode(''), textnode.childNodes.item(textoffset));
      else
        textnode = textnode.appendChild(document.createTextNode(''));
      textoffset = 0;
    }
    let nodetext = textnode.nodeValue;
    nodetext = nodetext.substr(0, textoffset) + text + nodetext.substr(textoffset);
    textnode.nodeValue = nodetext;

    this.selectRange(
      new Range(
        new domlevel.Locator(textnode, textoffset),
        new domlevel.Locator(textnode, textoffset + text.length)));
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Undo API
  //

  _updateUndoNodeForNewUndoItem(item) {
    this.undonode.focus();

    this.undoselectitf.selectRange(Range.fromNodeInner(this.undonode));
    this.undonode.ownerDocument.execCommand("InsertHTML", false, String(this.undopos));

    this.getBody().focus();
    this.selectRange(item.postselection);

    if (dompack.debugflags.rte)
      console.log('[rte] finished recording undo item', item);
  }


  /** Ensures the actions within the undo lock are recorded into the browser undo buffer. Nested calls
      are allowed.
  */
  getUndoLock() {
    if (!this.options.allowundo)
      return new UndoLock(null);

    const last = this.undostack.length && this.undostack[this.undostack.length - 1];
    if (last && !last.finished)
      return new UndoLock(last);

    // Allocate a new undo item, place it on the undo stack (erase redoable items)
    const item = new EditorUndoItem(this, this.getSelectionRange());
    this.undostack.splice(this.undopos, this.undostack.length - this.undopos, item);
    ++this.undopos;

    if (dompack.debugflags.rte)
      console.warn('[rte] start recording undo item', item);

    item.onfinish = (finisheditem) => this._updateUndoNodeForNewUndoItem(finisheditem);
    return new UndoLock(item);
  }

  resetUndoStack() {
    if (!this.options.allowundo)
      return;

    this.undopos = 0;
    this.undostack = [];
    if (this.undonode) {
      // replaces the #text node of the undonode, so the browser undo won't affect that node anymore
      this.undonode.textContent = "0";
    }
  }

  changeUndoPosition(newpos) {
    let nothrow = false;
    try {
      while (newpos < this.undopos) {
        --this.undopos;
        this.undostack[this.undopos].undo();
      }
      while (newpos > this.undopos && this.undopos < this.undostack.length) {
        this.undostack[this.undopos].redo();
        ++this.undopos;
      }
      this.undopos = newpos;
      nothrow = true;
    } finally {
      if (!nothrow) {
        this.undostack = [];
        this.undopos = 0;
      }
    }
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Dom analyzing
  //

  /** Describes the first ancestor blocknode of a block. If no block is found, the block section node is returned
      in all values.
      @param node - Block node (or child thereof)
      @returns
      \@cell return.node Block top node (p/h1..h6/ol/ul)
      \@cell return.contentnode Block content node (li if node is the li node of a list or inside of it, otherwise equal to the block top node)
      \@cell return.blockparent Parent of the block node
      \@cell return.blockroot Root ancestor of the blocks (body, td, th or content body)
  */
  getBlockAtNode(node: Node): {
    node: ParentNode;
    contentnode: ParentNode;
    blockroot: ParentNode;
    blockparent: ParentNode;
    islist: boolean;
    isintable: boolean;
    blockstyle: object | null;
  } {
    // Look out - can also be used within document fragments!
    let root: ParentNode = this.getBody();

    let res_node: ParentNode | null = null;
    let res_contentnode: ParentNode | null = null;
    let res_blockroot: ParentNode | null = null;
    let res_blockparent: ParentNode | null = null;
    let res_islist = false;
    let res_isintable = false;
    let res_blockstyle: object | null = null;

    let curnode: Node | null = node;
    for (; curnode && curnode !== root; curnode = curnode.parentNode)
      if (domlevel.testType(curnode, domlevel.NodeType.element)) {
        if (['tr', 'td'].includes(curnode.nodeName.toLowerCase()))
          res_isintable = true;

        if (curnode.nodeName.toLowerCase() === 'li')
          res_contentnode = curnode;
        else if (domlevel.isNodeBlockElement(curnode)) {
          const islist = ['ol', 'ul'].includes(curnode.nodeName.toLowerCase());
          if (this.structure && this.structure.getBlockStyleByTag) //FIXME why do we care?
            res_blockstyle = curnode.className ? this.structure.getBlockStyleByTag(curnode.className) : null;
          res_node = curnode;
          res_contentnode = (islist && res_contentnode) || curnode;
          res_blockparent = curnode.parentNode;
          res_islist = islist;
          break;
        } else if (this.blockroots.includes(curnode.nodeName.toLowerCase())) { // FIXME: better name for listunbreakablenodes
          res_node = curnode;
          res_contentnode = curnode;
          res_blockroot = curnode;
          res_blockparent = curnode.parentNode;
          break;
        }
      } else if (domlevel.testType(curnode, domlevel.NodeType.documentFragment))
        root = curnode;

    for (; curnode && curnode !== root; curnode = curnode.parentNode) {
      if (domlevel.testType(curnode, domlevel.NodeType.documentFragment))
        root = curnode;
      else if (domlevel.testType(curnode, domlevel.NodeType.element) && this.blockroots.includes(curnode.nodeName.toLowerCase())) { // FIXME: better name for listunbreakablenodes
        res_blockroot = curnode;
        break;
      }
    }

    const res = {
      node: res_node || root,
      contentnode: res_contentnode || root,
      blockroot: res_blockroot || root,
      blockparent: res_blockparent || root,
      islist: res_islist,
      isintable: res_isintable,
      blockstyle: res_blockstyle
    };
    //    console.log('getBlockAtNode res: ', res);

    return res;
  }


  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Dom manipulation, internal
  //

  /** If the after the locator, there is no visible content inside the block element where the locator is placed,
      insert a <br> (only when browser needs it, and that means IE)
      @param locator -
      @param preservelocators -
      @param undoitem -
  */
  requireVisibleContentInBlockAfterLocator(locator, preservelocators, undoitem) {
    const blocknode = this.getBlockAtNode(locator.element).contentnode;
    domlevel.requireVisibleContentInBlockAfterLocator(locator, blocknode, preservelocators, undoitem);
  }

  /** Removes a range and move the contents after the ranges inside the block at the start range
      @param range - Range to remove
      @param preservelocators - Locators to keep valid
      @param undoitem - Undo item
      \@cell options.normalize Normalize the range before executing
      @returns Locator at place of removed range
  */
  _removeRangeAndStitch(range: Range, preservelocators: domlevel.PreservedLocatorList, undoitem: unknown, { normalize = true } = {}) {
    preservelocators = (preservelocators || []).slice();

    // No need to do work on empty selections
    if (normalize)
      range.normalize(this.getBody());
    if (range.isCollapsed())
      return range.start.clone();

    // Make sure we can insert at the start, and insert a temporary node to make sure splitdom
    // returns the current block in part[0]
    range.splitStartBoundary(preservelocators);
    const insertpos = range.start.clone();

    const tnode = document.createElement("img"); // Img elements are more stable than text nodes - not combined
    range.start = range.start.insertNode(tnode, [range.end, ...preservelocators]);

    // Determine which blocks we start&end in
    const startblock = this.getBlockAtNode(range.start.getNearestNode());
    const endblock = this.getBlockAtNode(range.end.getNearestNode());
    let blockend = null;

    // If range end is just before an inner node, we won't append that block
    const endbeforeinnernode = (endblock.node as Node) === range.end.getNearestNode();

    // Determine the root we are splitting in
    const root = range.getAncestorElement();

    // Spanning different blocks!
    if (startblock.contentnode !== endblock.contentnode) {
      blockend = new domlevel.Locator(endblock.contentnode, "end");
    } else {
      blockend = new domlevel.Locator(range.end.element, "end");
    }

    //console.log('removeRangeAndStitch start:', richdebug.getStructuredOuterHTML(root, { root:root, range:range, blockend: blockend }));

    //console.log('enter presplit:  ', richdebug.getStructuredOuterHTML(root, { range_start: range.start, range_end: range.end, blockend: blockend }));
    //console.log('enter postsplit: ', richdebug.getStructuredOuterHTML(root, parts));
    const parts = domlevel.splitDom(root, [{ locator: range.start, toward: 'start' }, { locator: range.end, toward: 'end' }, { locator: blockend, toward: 'end' }], preservelocators);

    // Ranges:
    //    0: content before range (keep, except our temporary element)
    //    1: content within range (delete)
    //    2: content after range end until block end (append to 0)
    //    3: content after block where range end is located (keep)

    preservelocators = preservelocators.concat(parts);
    preservelocators.push(insertpos);

    // Remove the contents of range 1, keep the other part locators valid
    domlevel.removeSimpleRange(parts[1], preservelocators);

    let insertlocator = domlevel.Locator.newPointingTo(tnode);
    insertlocator.removeNode(preservelocators);

    // Content to append?
    if (!endbeforeinnernode && !parts[2].start.equals(parts[2].end)) {
      const locator = parts[2].start.clone();
      locator.descendToLeafNode(this.getBody());

      // See if there is a block in the removed fragment. If so, move only its contents.
      const restblock = this.getBlockAtNode(locator.getNearestNode());

      // restblock.contentnode contains the data. But it might also be the rootblock. Intersect with parts[2] for that!
      range = Range.fromNodeInner(restblock.contentnode);
      range.intersect(parts[2]);

      const res = domlevel.moveSimpleRangeTo(range, insertlocator, parts);

      // Calculate range to remove
      range = new Range(res.afterlocator, parts[2].end);
      range.start.ascend(root, true, true);

      domlevel.removeSimpleRange(range, preservelocators);
    } else {
      //console.log('no preinsert');
      this.requireVisibleContentInBlockAfterLocator(insertlocator, preservelocators, undoitem);
    }

    insertlocator = this._correctWhitespaceAroundLocator(insertlocator, undoitem);

    range.start.assign(insertlocator);
    range.end.assign(insertlocator);

    //console.log('removeRangeAndStitch done:', richdebug.getStructuredOuterHTML(root, { insertlocator: insertlocator }));
    return insertlocator;
  }

  appendNodeContentsAfterRemove(insertlocator: domlevel.Locator, contentnode: ParentNode) {
    const nodes = domlevel.removeNodeContents(contentnode);
    domlevel.insertNodesAtLocator(nodes, insertlocator, []);
    return insertlocator;
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Dom manipulation, unsorted/untranslated
  //

  /// Corrects whitespace around a locator, assuming the whitespace after the locator should be visible
  _correctWhitespaceAroundLocator(locator, undoitem) {
    // pointing to a text node?
    if ([3, 4].includes(locator.getNearestNode().nodeType))
      locator = domlevel.combineAdjacentTextNodes(locator, null, undoitem);

    const prevlocator = locator.clone();
    const prevres = prevlocator.scanBackward(this.getBody(), {});
    if (prevres.type === "whitespace")
      domlevel.rewriteWhitespace(this.getBody(), prevlocator, [locator], undoitem);

    if (!prevlocator.equals(locator)) {
      const nextlocator = locator.clone();
      const nextres = nextlocator.scanForward(this.getBody(), {});
      if (nextres.type === "whitespace")
        domlevel.rewriteWhitespace(this.getBody(), nextlocator, [locator], undoitem);
    }

    return locator;
  }

  replaceRangeWithNode(range, newnode, undoitem) {
    if (newnode)
      range.insertBefore(newnode, [], undoitem);

    return this._removeRangeAndStitch(range, null, undoitem);
  }

  replaceSelectionWithNode(newnode, select) {
    const undolock = this.getUndoLock();
    const res = this.replaceRangeWithNode(this.getSelectionRange(), newnode, undolock.undoitem);
    if (select)
      this.selectNodeOuter(newnode);
    else
      this.setCursorAtLocator(res);

    undolock.close();
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Actions
  //

  executeSoftEnter() {
    const range = this.getSelectionRange();
    const undolock = this.getUndoLock();

    const iscollapsed = range.isCollapsed();

    // First insert the new br node
    const newbr = document.createElement('br');
    /*var res = */range.insertBefore(newbr, [], undolock.undoitem);

    // If we had a selection, then remove it
    let loc;
    if (iscollapsed) {
      this.requireVisibleContentInBlockAfterLocator(range.start, null, undolock.undoitem);
      loc = this._correctWhitespaceAroundLocator(range.start, undolock.undoitem);
    } else
      loc = this._removeRangeAndStitch(range, null, undolock.undoitem);

    loc = this._correctWhitespaceAroundLocator(loc, undolock.undoitem);
    this.setCursorAtLocator(loc);

    undolock.close();
    this.stateHasChanged();
    return false;
  }

  /** Free RTE needs to break blockquotes - the rest of the browser implementation is good enough
      @returns Whether browser implementation is to be used
  */
  executeHardEnter() {
    const range = this.getSelectionRange();

    // Find blockquotes at start - but don't break through tables
    let breakparent = domlevel.findParent(range.start.element, ['blockquote', 'th', 'td'], this.getBody());
    let topblockquote;
    while (breakparent) {
      if (breakparent.nodeName.toLowerCase() !== 'blockquote')
        break;

      topblockquote = breakparent;
      breakparent = domlevel.findParent(breakparent.parentNode, ['blockquote', 'th', 'td'], this.getBody());
    }

    if (topblockquote) {
      const undolock = this.getUndoLock();
      const parts = domlevel.splitDom(topblockquote.parentNode, [{ locator: range.start, toward: 'end' }], range, undolock.undoitem);
      parts[1].start.insertNode(document.createElement('br'), [], undolock.undoitem);
      this.setCursorAtLocator(parts[1].start);
      undolock.close();
      this.stateHasChanged();
      return false;
    }
    return true;
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Dom manipulation, rest
  //

  ReplaceSelection(splitparent, newnode) {
    const range = this.getSelectionRange();
    const undolock = this.getUndoLock();
    const locators = range;

    if (!splitparent)
      splitparent = domlevel.Locator.findCommonAncestorElement(locators.start, locators.end);

    // Split the splitparent at selection start (and end if selection isn't empty)
    const splitlocators = [{ locator: locators.start, toward: 'start' }];
    if (locators.start.element !== locators.end.element || locators.start.offset !== locators.end.offset)
      splitlocators.push({ locator: locators.end, toward: 'end' });

    //console.log('rs presplit: ', richdebug.getStructuredOuterHTML(this.getBody(), splitlocators.map(function (item){return item.locator;})));
    const parts = domlevel.splitDom(splitparent, splitlocators, undolock.undoitem);
    //console.log(parts);
    //console.log('rs post: ', richdebug.getStructuredOuterHTML(this.getBody(), parts));

    // Find last node before cursor position (highest ancestor of right element of first part)
    let leftborder = parts[0].end.element;
    while (leftborder.parentNode && leftborder.parentNode !== splitparent)
      leftborder = leftborder.parentNode;

    // Find first node after cursor position (highest ancestor of left element of last part)
    let rightborder = parts[parts.length - 1].start.element;
    while (rightborder.parentNode && rightborder.parentNode !== splitparent)
      rightborder = rightborder.parentNode;

    //console.log('rs post: ', richdebug.getStructuredOuterHTML(this.getBody(), { leftborder: leftborder, rightborder: rightborder, splitparent: splitparent }));

    if (leftborder.parentNode !== splitparent || rightborder.parentNode !== splitparent)
      return;

    // Clear all nodes between border nodes
    if (leftborder !== rightborder)
      while (leftborder.nextSibling && leftborder.nextSibling !== rightborder)
        leftborder.parentNode.removeChild(leftborder.nextSibling);

    if (leftborder !== rightborder && leftborder.nextSibling !== rightborder)
      return;

    // Insert new node between border nodes
    rightborder.parentNode.insertBefore(newnode, rightborder);

    // Select new node (outer, may be a <br> or <img>)
    this.selectNodeOuter(newnode);
    undolock.close();
  }

  insertImage(url, width, height) {
    const img = <img src={url} class="wh-rtd__img" />;
    if (width && height) {
      img.height = height;
      img.width = width;
    }

    this.replaceSelectionWithNode(img, true);
    this.stateHasChanged();
  }

  insertHyperlink(url, options) {
    this._surroundSelection({
      element: 'a',
      wrapin: true,
      attrs: {
        href: url,
        target: options && options.target ? options.target : null
      },
      splitprohibits: [],
      avoidwhitespace: true
    });
    this.stateHasChanged();
    this._checkDirty();
  }

  removeHyperlink() {
    const range = this.getSelectionRange();
    if (range.isCollapsed()) {
      // No selection: find the A node that is the parent of the cursor and select that one
      // ADDME: unselect and keep current cursor position
      //var range = sel.GetRange();
      const path = (new domlevel.Locator(range.getAncestorElement())).getPathFromAncestor(this.getBody());

      let i;
      for (i = path.length - 1; i >= 0; --i)
        if (path[i].nodeName.toLowerCase() === 'a') {
          this.selectRange(Range.withinNode(path[i]));
          break;
        }

      // No A node found
      if (i === -1)
        return;
    }

    this._surroundSelection({
      element: 'a',
      wrapin: false,
      splitprohibits: []
    });
  }

  insertTable(cols, rows) {
    if (cols <= 0 || rows <= 0)
      return;

    const body = this.getBody();
    //    var selobj = this.GetSelectionObject();
    //    var range = selobj.GetRange();
    //    if (!range)
    //      return;
    const locators = this.getSelectionRange();
    if (!locators)
      return;
    //$wh.Rich.Locator.getFromRange(range);

    const undolock = this.getUndoLock();

    let startelement = locators.start.element;
    if (startelement === body)
      startelement = body.firstChild;
    else
      while (startelement.parentNode !== body)
        startelement = startelement.parentNode;

    let endelement = locators.end.element;
    if (endelement === body)
      endelement = body.lastChild;
    else
      while (endelement.parentNode !== body)
        endelement = endelement.parentNode;
    endelement = endelement.nextSibling;

    // Create the table
    const tablenode = document.createElement('table');

    tablenode.appendChild(document.createElement('tbody'));
    for (let row = 0; row < rows; ++row) {
      const tr = tablenode.lastChild.appendChild(document.createElement('tr'));
      for (let col = 0; col < cols; ++col) {
        const td = tr.appendChild(document.createElement('td'));
        td.appendChild(document.createTextNode((col + 1) + "," + (row + 1)));
      }
    }

    body.insertBefore(tablenode, endelement);
    this.stateHasChanged();

    undolock.close();
  }

  _undo() {
    //this.ExecCommand('undo');
  }

  _redo() {
    //this.ExecCommand('redo');
  }

  _clearFormatting() {
    //ADDME: Only clear formatting of selected contents?
    const body = this.getBody();
    this.setContentsHTML(GetOuterPlain(body, true));
    this.stateHasChanged();
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Private API
  //

  _registerFrameEventListeners() {
    if (!this.bodydiv.__wh_rte_doneevents) {
      this.bodydiv.__wh_rte_doneevents = true;
      this.bodydiv.addEventListener('focus', this.onFocus.bind(this));
      this.bodydiv.addEventListener('focusin', this.onFocusIn.bind(this));
      new KeyboardHandler.default(this.bodydiv,
        {
          "Accel+Alt+1": event => this._onStyleSwitch(event, 1),
          "Accel+Alt+2": event => this._onStyleSwitch(event, 2),
          "Accel+Alt+3": event => this._onStyleSwitch(event, 3),
          "Accel+Alt+4": event => this._onStyleSwitch(event, 4),
          "Accel+Alt+5": event => this._onStyleSwitch(event, 5),
          "Accel+Alt+6": event => this._onStyleSwitch(event, 6),
          "Accel+Alt+7": event => this._onStyleSwitch(event, 7),
          "Accel+Alt+8": event => this._onStyleSwitch(event, 8),
          "Accel+Alt+9": event => this._onStyleSwitch(event, 9),
          "Accel+Alt+0": event => this._onStyleSwitch(event, 0)
        });
      this.bodydiv.addEventListener('keydown', this._gotKeyDown.bind(this));
      this.bodydiv.addEventListener('keypress', this._gotKeyPress.bind(this));
      this.bodydiv.addEventListener('keyup', this._gotKeyUp.bind(this));//*/
      this.bodydiv.addEventListener('mousedown', this._gotMouseDown.bind(this));
      this.bodydiv.addEventListener('click', this._gotMouseClick.bind(this));
      this.bodydiv.addEventListener('paste', this._gotPaste.bind(this));
      this.bodydiv.addEventListener('copy', this._gotCopy.bind(this));
      this.bodydiv.addEventListener('cut', this._gotCut.bind(this));
      this.bodydiv.addEventListener('dblclick', this._gotDoubleClick.bind(this));

      if (browser.getName() === "firefox")
        this.bodydiv.addEventListener('DOMNodeRemoved', this._gotDOMNodeRemoved.bind(this));
    }
  }

  _getImageDownloadURL() {
    return this.options.imgloadplaceholder || defaultimgplaceholder;
  }

  protected _createImageDownloadNode(): HTMLImageElement {
    return <img class="wh-rtd__img wh-rtd__img--uploading" src={this._getImageDownloadURL()} />;
  }

  _isStillImageDownloadNode(img) {
    return img.matches('.wh-rtd__img--uploading');
  }

  _gotPaste(event) {
    if (dompack.debugflags.rte)
      console.log('[rte] paste', this, event);

    this.gotPaste(event);
  }

  async gotPaste(event) {
    const preexistingstylenodes = this.qSA("style");

    // Wait for the paste to happen, then
    setTimeout(() => this.handlePasteDone(preexistingstylenodes), 1);
  }

  async handlePasteDone(preexistingstylenodes: HTMLElement[]) {
    //Check for and remove hostile nodes (but allow inside embbedded objects)
    this.qSA("script,style,head")
      .filter(node => !preexistingstylenodes.includes(node))
      .forEach(node => node.remove());

    let imgs = this.qSA<HTMLImageElement>('img');
    imgs = imgs
      .filter(img => !this.knownimages.includes(img.src) && !this._isStillImageDownloadNode(img) && img.isContentEditable)
      .filter(node => !node.closest(".wh-rtd-embeddedobject"));
    if (!imgs.length) //nothing to do
      return;

    const busylock = dompack.flagUIBusy();
    try {
      const replacementpromises = [];
      for (const img of imgs) {
        const downloadsrc = img.src;
        img.src = this._getImageDownloadURL();
        img.classList.add("wh-rtd__img--uploading");

        replacementpromises.push(getFormService().getImgFromRemoteURL(downloadsrc)
          .then(result => this._handleUploadedRemoteImage(img, result))
          .catch(result => this._handleUploadedRemoteImage(img, null)));
      }
      await Promise.all(replacementpromises);
    } finally {
      busylock.release();
    }
  }

  _handleUploadedRemoteImage(img, properurl) {
    img.classList.remove("wh-rtd__img--uploading");
    if (!properurl) {
      img.remove();
    } else {
      img.src = properurl;
      img.removeAttribute("width");
      img.removeAttribute("height");
      this.knownimages.push(img.src);
    }
  }
  /* Surround selection directly if there is a selection, otherwise delay surrounding the selection until there was something
     typed */
  DelayedSurroundSelection(elementinfo) {
    if (this.getSelectionRange().isCollapsed()) {
      //console.log('Delaying SurroundSelection');

      // If already on queue, see if canceling or repeating old action
      for (let i = 0; i < this.delayedsurrounds.length; ++i) {
        const info = this.delayedsurrounds[i];
        if (info.element === elementinfo.element) {
          if (info.wrapin === elementinfo.wrapin)
            return; // Already on queue

          // Canceling queued action by deleting it from the queue
          this.delayedsurrounds.splice(i, 1);
          //console.log('Currently '+this.delayedsurrounds.length+' surrounds delayed');
          this.stateHasChanged();
          return;
        }
      }
      // Add the action to the queue, execute it when there is a selection (i.e. when the user has typed something)
      this.delayedsurrounds.push(elementinfo);
      //console.log('Currently '+this.delayedsurrounds.length+' surrounds delayed');
      this.stateHasChanged();
    } else {
      // We have a selection, so execute the action immediately
      this._surroundSelection(elementinfo);
    }
  }

  ClearDelayedSurrounds() {
    //console.log('ClearDelayedSurrounds');console.trace();
    while (this.delayedsurrounds.length)
      this.delayedsurrounds.pop();
  }

  _createNodeFromElementInfo(elementinfo) {
    const newnode = document.createElement(elementinfo.element);
    if (elementinfo.attrs) {
      const attrnames = Object.keys(elementinfo.attrs).sort();
      for (let i = 0; i < attrnames.length; ++i)
        if (elementinfo.attrs[attrnames[i]] !== null)
          newnode.setAttribute(attrnames[i], elementinfo.attrs[attrnames[i]]);
    }
    return newnode;
  }

  _canWrapNode(elementinfo, node) {
    if (domlevel.isNodeBlockElement(node))
      return elementinfo.splitblockelements === true;
    return !(elementinfo.splitprohibits && elementinfo.splitprohibits.includes(node.nodeName.toLowerCase()));
  }

  private surroundRange(range, elementinfo) {
    //console.log('surroundrange start', richdebug.getStructuredOuterHTML(this.getBody(), range));
    //var result = domlevel.surroundRange(range, elementinfo);

    domlevel.removeNodesFromRange(range, this.getBody(), elementinfo.element, null);

    if (elementinfo.wrapin) {
      domlevel.wrapRange(range, () => this._createNodeFromElementInfo(elementinfo), { onCanWrapNode: node => this._canWrapNode(elementinfo, node) });
    }

    //console.log('surroundrange end', richdebug.getStructuredOuterHTML(this.getBody(), range));
  }

  private _surroundSelection(elementinfo) {
    const undolock = this.getUndoLock();

    const range = this.getSelectionRange();
    if (elementinfo.avoidwhitespace) {
      //Try to remove spaces at begin and end iterator
      while (range.start.element.nodeType === 3 && range.start.element.textContent[range.start.offset] === ' ' && range.start.compare(range.end) < 0)
        ++range.start.offset;
      while (range.end.element.nodeType === 3 && range.end.element.textContent[range.end.offset - 1] === ' ' && range.start.compare(range.end) < 0)
        --range.end.offset;
    }
    this.surroundRange(range, elementinfo);
    this.selectRange(range);

    undolock.close();
  }

  selectionHasChanged(selection) {
    //use this to update CSS etc after a selection change
  }

  stateHasChanged() { //ADDME check all code for superfluous calls (eg, invoking stateHasChange after invoking SetSelection which also did a stateHasChanged)
    //save state before firing the event. save on processing with multiple getSelectionState calls, and make sure we have a selection state after display:none on firefox
    this.lastselectionstate = this.getFormattingStateForRange(this.getSelectionRange());

    // Update all table editors as tables' positions or contents may have changed
    this.updateTableEditors();

    this._gotStateChange();
  }

  getSelectionState(forceupdate?: boolean) {
    if (forceupdate) {
      this.lastselectionstate = this.getFormattingStateForRange(this.getSelectionRange());
      this.updateTableEditors();
    }

    return this.lastselectionstate;
  }

  getTextStyleRecordFromNode(node) {
    let nodeName = node.nodeName.toLowerCase();
    if (nodeName === 'strong')
      nodeName = 'b';
    else if (nodeName === 'em')
      nodeName = 'i';
    else if (nodeName === 'a' && node.hasAttribute("href"))
      nodeName = "a-href";

    if (nodeName === 'b' && node.style.fontWeight === "normal")
      return null;// work around googledocs doing it

    return ({ nodeName: nodeName });
  }

  getAvailableBlockStyles(selstate) {
    return [];
  }
  getAvailableCellStyles(selstate) {
    return [];
  }

  getFormattingStateForRange(range) {
    if (Range.getLogLevel() & 16)
      console.log("gFSR received range", range, range.start, range.end);

    const formatting = new TextFormattingState();

    // Range might be null, when we have an uninitialized iframe
    if (!range)
      return formatting;

    // We're modifying range in here
    range = range.clone();

    /* Word's behaviour:
       if there is a selection:
         bold, italic and underline are true if all characters in the selection hves that state
       if there is no selection:
         look at the previous character?

       Our behaviour:
       if there is any hyperlink within the selection
         hyperlink is true
       no selection:
         hyperlink at current character?
    */

    let alignment = '';

    formatting.haveselection = !range.isCollapsed();

    const locator = range.start.clone();

    if (Range.getLogLevel() & 16)
      console.log('selected before ascend', richdebug.getStructuredOuterHTML(range.getAncestorElement(), range));

    //    console.log('selected after ascend', richdebug.getStructuredOuterHTML(range.getAncestorElement(), range));


    const anchornode = locator.element && locator.getNearestNode();

    //    if(this.options.log)
    //      console.log("Iterate parents");
    //    var anchornode = sel.Node();
    for (let curnode: HTMLElement = anchornode; curnode && curnode !== this.bodydiv; curnode = curnode.parentNode) {
      switch (curnode.nodeName.toUpperCase()) {
        case 'B': case 'STRONG': /* FIXME shouldn't generate STRONGs! */
        case 'I': case 'EM': /* FIXME shouldn't generate EMs! */
        case 'U':
        case 'SUP':
        case 'SUB':
        case 'STRIKE':
          {
            const style = this.getTextStyleRecordFromNode(curnode);
            if (style)
              formatting.textstyles.push(style);
          }
          break;
        case 'A':
          formatting.textstyles.push(this.getTextStyleRecordFromNode(curnode));
          formatting.hyperlink = true;
          break;
        case 'UL':
          formatting.bulletedlist = true;
          break;
        case 'OL':
          formatting.numberedlist = true;
          break;

        case 'CENTER':
          alignment = alignment || 'center';
          break;

        case 'TABLE':
          formatting.tables.push(curnode);
          formatting.tablestyle = this.structure?.lookupTableStyle(curnode as HTMLTableElement) || null;
          break;
      }
      if (curnode.getAttribute && curnode.getAttribute('align'))
        alignment = alignment || curnode.getAttribute('align');
      else if (curnode.style && curnode.style.textAlign)
        alignment = alignment || curnode.style.textAlign;
    }
    // Assuming left alignment when no other alignment is specified
    alignment = alignment || 'left';

    formatting.alignleft = alignment === 'left';
    formatting.aligncenter = alignment === 'center';
    formatting.alignright = alignment === 'right';
    formatting.alignjustified = alignment === 'justified';

    /* Action elements must be given back
       - first from within the range, DOM order
       - second from ancestor to root
    */

    let relevantnodes = range.querySelectorAll('*');

    // Filter out non-contenteditable nodes (allow embbeded objects within a contenteditable parent)
    relevantnodes = relevantnodes.filter(node => node.isContentEditable || (domlevel.isEmbeddedObject(node) && node.parentNode.isContentEditable));

    for (let curnode = range.getAncestorElement(); curnode && curnode !== this.bodydiv; curnode = curnode.parentNode)
      relevantnodes.push(curnode);

    if (Range.getLogLevel() & 16)
      console.log('all gfsfr relevantnodes', relevantnodes);

    for (let i = 0; i < relevantnodes.length; ++i) {
      const node = relevantnodes[i];

      switch (node.nodeName.toUpperCase()) {
        case 'A':
          formatting.hyperlink = true;
          break;
        case 'UL':
          formatting.bulletedlist = true;
          break;
        case 'OL':
          formatting.numberedlist = true;
          break;
        case 'DIV':
          if (node.classList.contains("wh-rtd-embeddedobject"))
            formatting.isblockwidget = true;
          break;
        case 'SPAN':
          if (node.classList.contains("wh-rtd-embeddedobject"))
            formatting.isinlinewidget = true;
          break;
      }

      if (!formatting.propstarget && node.matches(this.properties_selector))
        formatting.propstarget = node;
    }

    // check delayed surrounds
    for (let i = 0; i < this.delayedsurrounds.length; ++i) {
      const info = this.delayedsurrounds[i];
      let found = false;
      for (let pos = 0; pos < formatting.textstyles.length; ++pos) {
        if (formatting.textstyles[pos].nodeName === info.element) {
          formatting.textstyles.splice(pos, 1);
          found = true;
          break;
        }
      }
      if (info.wrapin)
        formatting.textstyles.push({ nodeName: info.element });
    }

    const listoptions = this.getAvailableListActions(range);

    const actionparent = domlevel.findParent(anchornode, ['ol', 'ul', 'td', 'th'], this.getBody());
    formatting.actionparent = actionparent;

    // When the cursor is at the start of the next block, correct the end position to the end of the previous block element.
    let end_locator = range.end.clone();
    end_locator.scanBackward(this.getBody(), { blocks: true, alwaysvisibleblocks: true });
    if (range.start.compare(end_locator) > 0) // Don't go past start
      end_locator = range.start;

    const startblock = this.getBlockAtNode(range.start.element).contentnode;
    const limitblock = this.getBlockAtNode(end_locator.element).contentnode;

    const tdparent = domlevel.findParent(anchornode, ['td', 'th'], this.getBody());
    formatting.cellparent = tdparent;

    const allow_td_actions = startblock === limitblock && tdparent;
    const tableeditor = allow_td_actions && tablesupport.getEditorForNode(tdparent.closest("table"));
    const tableactionstate = tableeditor && tableeditor.getActionState(tdparent);
    const allowwidgets = !formatting.tablestyle || formatting.tablestyle?.allowwidgets;

    formatting.actionstate =
    {
      "li-increase-level":
      {
        available: listoptions.canincrease
      },
      "li-decrease-level":
      {
        available: listoptions.candecrease
      },
      "a-href":
      {
        available: !range.isCollapsed() || formatting.hyperlink
      },
      "img":
      {
        available: true//formatting.hasTextStyle("img")
      },
      "action-properties":
      {
        available: formatting.propstarget
      },
      "object-insert": {
        available: allowwidgets
      },
      "object-video": {
        available: allowwidgets
      },
      "b":
      {
        available: true,
        active: formatting.hasTextStyle('b')
      },
      "i":
      {
        available: true,
        active: formatting.hasTextStyle('i')
      },
      "u":
      {
        available: true,
        active: formatting.hasTextStyle('u')
      },
      "strike":
      {
        available: true,
        active: formatting.hasTextStyle('strike')
      },
      "sub":
      {
        available: true,
        active: formatting.hasTextStyle('sub')
      },
      "sup":
      {
        available: true,
        active: formatting.hasTextStyle('sup')
      },
      "ol":
      {
        available: true,
        active: actionparent && actionparent.nodeName.toLowerCase() === 'ol'
      },
      "ul":
      {
        available: true,
        active: actionparent && actionparent.nodeName.toLowerCase() === 'ul'
      },
      "table-addrow-before": { available: allow_td_actions },
      "table-addrow-after": { available: allow_td_actions },
      "table-addpara-before": { available: allow_td_actions },
      "table-addpara-after": { available: allow_td_actions },
      "table-addcolumn-before": { available: allow_td_actions },
      "table-addcolumn-after": { available: allow_td_actions },
      "table-deleterow": { available: allow_td_actions && tableeditor && tableeditor.numrows !== 1 },
      "table-deletecolumn": { available: allow_td_actions && tableeditor && tableeditor.numcolumns !== 1 },
      "table-mergeright": tableactionstate && tableactionstate["table-mergeright"] || { available: false },
      "table-mergedown": tableactionstate && tableactionstate["table-mergedown"] || { available: false },
      "table-splitcols": tableactionstate && tableactionstate["table-splitcols"] || { available: false },
      "table-splitrows": tableactionstate && tableactionstate["table-splitrows"] || { available: false }
    };

    if (this.options.allowtags)
      this._stripDisallowedTags(formatting);
    return formatting;
  }

  _isActionAllowed(action) {
    if (!this.options.allowtags)
      return true;

    const actionlist =
      [
        { name: 'img', requiretags: ['img'] },
        { name: 'a-href', requiretags: ['a'] },
        { name: 'remove_hyperlink', requiretags: ['a'] },
        { name: 'anchor', requiretags: ['a'] },
        { name: 'insert_table', requiretags: ['table', 'tr', 'td'] },
        { name: 'ul', requiretags: ['ul', 'li'] },
        { name: 'ol', requiretags: ['ol', 'li'] },
        { name: 'li-increase-level', requiretags: ['li'] },
        { name: 'li-decrease-level', requiretags: ['li'] },
        { name: 'b', requiretags: ['b'] },
        { name: 'u', requiretags: ['u'] },
        { name: 'i', requiretags: ['i'] },
        { name: 'strike', requiretags: ['strike'] },
        { name: 'sub', requiretags: ['sub'] },
        { name: 'sup', requiretags: ['sup'] }
      ];

    let actiondata;
    for (let i = 0; i < actionlist.length; ++i)
      if (actionlist[i].name === action) {
        actiondata = actionlist[i];
        break;
      }

    // Ignore the action if not all required tags are in the tagfilter (when supplied)
    if (actiondata) {
      for (let i = 0; i < actiondata.requiretags.length; ++i)
        if (!this.options.allowtags.includes(actiondata.requiretags[i]))
          return false;
    }
    return true;
  }

  _stripDisallowedTags(formatting) {
    if (formatting && this.options.allowtags) {
      Object.keys(formatting.actionstate).forEach(key => {
        if (!this._isActionAllowed(key))
          formatting.actionstate[key].available = false;
      });
    }
  }

  async _gotCopy(event) {
  }

  async _gotCut(event) {
    // Check the dom after a cut
    this.scheduleCallbackOnInputOrDelay(this.checkDomStructure.bind(this), 'checkdom');
  }

  _gotSelectionChange(event) {
    if (this.selectingrange) // Currently within our own selection calls, ignore
      return;

    /* This function corrects selections that give problems when replacing. It restricts selections
       that start in a table cell to that cell.

       Also, if the selection starts outside a table, and ends within one, the table is removed from the selection
    */

    //console.log.apply(console, richdebug.getStructuredOuterHTML(null, { range: range, base: base }, { title: "OSC start", colorize: true }));
    const { changed, range } = this._constrainRangeCrossTDSelections(this.getSelectionRange());

    if (changed)
      this.selectRange(range);
  }

  // Used on FF only!
  _gotDOMNodeRemoved(event) {
    // Node removed that's a child of the content node? Check the dom!
    // Needed because of select all+delete in context menu in ff & no selection change events
    if (event.relatedNode === this.getBody())
      this.scheduleCallbackOnInputOrDelay(this.checkDomStructure.bind(this), 'checkdom');
  }

  SubtreeModified(target) {
    if (this.insubtreemod)
      return;

    this.insubtreemod = true;
    this.CleanupChildren(target);
    this.insubtreemod = false;
  }

  /** Check DOM structure
      @param range - Range (optional, if range not set, use (& restore!) current selection)
  */
  checkDomStructure(range, preservelocators) {
    // extension point for subclasses
  }

  tableEditorStateHasChanged() {
    // When the tableeditor triggers a state change, delay and coalesce the trigger
    // This because a state change triggers table editor updates again. Don't want to recurse them.
    if (!this.tableeditorstatechangedelay) {
      this.tableeditorstatechangedelay = setTimeout(() => {
        this.tableeditorstatechangedelay = null;
        this.stateHasChanged();
      }, 0);
    }
  }

  initializeTableEditor(tablenode, resizing) {
    let editor = tablesupport.getEditorForNode(tablenode);
    if (editor) {
      editor.updateResizers();
      return;
    }

    const options = { onStatechange: this.tableEditorStateHasChanged.bind(this), getUndoLock: () => this.getUndoLock() };
    options.resize_columns = true;
    options.resize_rows = true;
    options.resize_table = true;

    editor = new tablesupport.TableEditor(tablenode, this.getBody(), options);
    this.tableeditors.push(editor);
  }

  _getResizingOptionsForTable(tablenode) {
    return ['all'];
  }

  _getEditableTables() {
    const retval = [];
    for (const node of this.qSA("table")) {
      if (!node.isContentEditable)
        continue;
      const tableresizing = this._getResizingOptionsForTable(node);
      if (tableresizing)
        retval.push({ node, tableresizing });
    }
    return retval;
  }

  updateTableEditors() {
    // Get list of all editable tables
    const list = this._getEditableTables();
    list.forEach(listitem => this.initializeTableEditor(listitem.node, listitem.tableresizing));

    // Destroy editors that are no longer active (i.e. the associated table is no longer present in the DOM), update active
    // editors
    this.tableeditors = this.tableeditors.filter(editor => {
      const active = editor.isActive();
      if (!active)
        editor.destroy();
      return active;
    });

    // upon the first call we want to setup some measures to
    // be able to react to custom fonts having been loaded
    if (!this.__updateTableEditorsSetupDone) {
      this.__updateTableEditorsSetupDone = true;

      if (document.fonts && "onloadingdone" in document.fonts) //FF41+ and Chrome 35+ implement this
      {
        //whenever a font is loaded, resize table editors
        this.fontslistener = this.updateTableEditors.bind(this);
        document.fonts.addEventListener("loadingdone", this.fontslistener);
      } else // IE, Edge and Safari
      {
        // Keep updating the tableeditors for 5 seconds to give the rte time to load external css and fonts
        this.repeatupdatetableuntil = Date.now() + 5000;
      }
    }

    if (this.repeatupdatetableuntil && Date.now() < this.repeatupdatetableuntil && !this.scheduledupdatetableeditors) {
      //reschedule us on the next available frame after 200ms has passed
      this.scheduledupdatetableeditors = true;
      this.repeatupdatetabletimeout = setTimeout((function () { this.repeatupdatetableanimframe = requestAnimationFrame(this.rescheduledUpdateTableEditors.bind(this)); }).bind(this), 200);
    }
  }



  rescheduledUpdateTableEditors() {
    this.scheduledupdatetableeditors = false;
    this.updateTableEditors();
  }

  _executeDeleteByKey(forward) {
    return false; // let the browser handle it
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Event handling
  //

  _handleKeyCommand(event, names) {
    for (const keyname of names) {
      switch (keyname) {
        case "Accel+A": {
          event.preventDefault();
          event.stopPropagation();
          this.SelectAll();
        } return;
        case "Accel+B": { // apply bold
          event.preventDefault();
          event.stopPropagation();
          this.executeAction("b");
        } return;
        case "Accel+I": { // I: Apply italic
          event.preventDefault();
          event.stopPropagation();
          this.executeAction('i');
        } return;
        case "Accel+U": { // U: Apply underline
          event.preventDefault();
          event.stopPropagation();
          this.executeAction('u');
        } return;
        case "Shift+Enter": {
          event.preventDefault();
          event.stopPropagation();
          this.executeSoftEnter();
        } return;
        case "Enter": {
          if (!this.executeHardEnter()) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        } break;
        case "Tab":
        case "Shift+Tab": { //these can affect apps, just prevent them from bubbling up, they have meaning to us..
          event.stopPropagation();
        } break;
        case "Delete": {
          if (this._executeDeleteByKey(true)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        } break;
        case "Backspace": {
          if (this._executeDeleteByKey(false)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
        } break;
        case "F2": { this._inspectCursorPosition(); event.preventDefault(); event.stopPropagation(); return; }
      }
    }
  }

  _inspectCursorPosition() {
    const range = this.getSelectionRange();
    const b = range.start, e = range.end;

    const bres = b.scanForward(this.getBody(), {});
    const eres = e.scanBackward(this.getBody(), {});

    const br = range.start.clone(); br.moveRight(this.getBody());
    const el = range.end.clone(); el.moveLeft(this.getBody());

    console.log('inspectres', richdebug.getStructuredOuterHTML(this.getBody(), { range, b, e, br, el }, { indent: 1 }), bres, eres);
    console.log({ b, e, br, el });
  }

  _onStyleSwitch(event, style) {
    //TODO switch to h1 to h6 / p if allowed by allowedtag?  but for now just let it go through if we're not going to act on the keys...
  }

  _gotKeyDown(event) {
    if (!this.hasFocus()) {
      event.preventDefault();
      console.log("Received keydown without having focus");
      return; //this keydown shouldn't have gotten here!
    }

    // Firefox doesn't have anything like selectionchange, so we need to do that before keys arrive
    if (browser.getName() === "firefox")
      this._gotSelectionChange(null);

    // User input is being handled, handle input events now!
    this._detectedInputEvent(event);

    this._handleKeyCommand(event, KeyboardHandler.getEventKeyNames(event));

    // Something might be done with this press, schedule a state update
    setTimeout(() => {
      this._gotSelectionChange(event);
      this.stateHasChanged();
    }, 1);

    return true;
  }

  _gotKeyPress(event) //ADDME generalize/configurable key mappings. should this really be part of the whrte core anyway?
  {
    const eventdata = dompack.normalizeKeyboardEventData(event);
    if (eventdata.ctrlKey)
      return;

    this._gotSelectionChange(event);

    // enters keep delayed surrounds intact
    if (eventdata.key === "Enter")
      return;

    // Check the dom structure before applying the change. The cursor might be in an illegal place.
    this.checkDomStructure();

    const range = this.getSelectionRange();

    //console.log('keypressed', richdebug.getStructuredOuterHTML(this.getBody(), range));
    //console.log(range.isCollapsed(), this.delayedsurrounds.length);
    if (this.delayedsurrounds.length) {
      if (!range.isCollapsed() || eventdata.key.length !== 1)
        this.ClearDelayedSurrounds();
      else {
        // Insert the pressed character at the current cursor position
        //console.log('pre sst "' + String.fromCharCode(charCode) + '"', richdebug.getStructuredOuterHTML(this.getBody(), this.getSelectionRange()));
        this.insertTextAtCursor(eventdata.key);
        //console.log('post sst', richdebug.getStructuredOuterHTML(this.getBody(), this.getSelectionRange()));

        //console.log('onKeyPressed, delay, pre: ', this.getContentsHTML());

        // Execute delayed surrounds
        for (let i = 0; i < this.delayedsurrounds.length; ++i)
          this._surroundSelection(this.delayedsurrounds[i]);
        this.ClearDelayedSurrounds();

        //console.log('onKeyPressed, delay, post: ', this.getContentsHTML());

        // Set cursor directly after inserted text
        this.collapseSelection();
        //this.GetSelectionObject().Collapse();

        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    return true;
  }

  _gotKeyUp(event) {
    const eventdata = dompack.normalizeKeyboardEventData(event);

    // Don't clear delayed surrounds on enter, so they'll be transferred to the next line
    if (eventdata.key !== "Enter")
      this.ClearDelayedSurrounds();

    this._gotSelectionChange(event);
    this.stateHasChanged();
    return true;
  }

  _gotMouseDown(event) {
    this.ClearDelayedSurrounds();

    // When clicking on an image, or embedded object, select it
    if (event.target.matches('img, .wh-rtd-embeddedobject'))
      this.selectNodeOuter(event.target);

    this._gotSelectionChange(event);
    this.stateHasChanged();

    // Delay 1 ms to pick up text selection changes for context menus. Also delay the context menu by 1ms and everything will be ok
    window.setTimeout(() => {
      this._gotSelectionChange(event);
      this.stateHasChanged();
    }, 1);

    //Make sure we detect mouseup happening outside our window
    window.addEventListener('mouseup', this._mouseupcallback);
    return true;
  }

  _gotMouseUp(event) {
    window.removeEventListener('mouseup', this._mouseupcallback);

    this.ClearDelayedSurrounds();
    window.setTimeout(() => {
      this._gotSelectionChange(event);
      this.stateHasChanged();
    }, 1);
  }

  _gotMouseClick(event) {
    // extension point for subclasses
  }

  _gotDoubleClick(event) {
    if (!event.target || !this.isEditable())
      return;
    //ADDME should there be more doubleclickable?
    if (event.target && event.target.nodeName.toUpperCase() === "IMG") { //double click on an image should open the action props
      this.selectNodeOuter(event.target);
      this.executeAction('action-properties');
    }
    event.stopPropagation();
    event.preventDefault();
  }

  setInputEventAttach(attach) {
    if (this.attachedinputevents === attach)
      return;

    if (!this.inputeventfunction)
      this.inputeventfunction = this._detectedInputEvent.bind(this);

    if (attach) {
      document.addEventListener('selectionchange', this.inputeventfunction);
      this.getBody().addEventListener('input', this.inputeventfunction);
    } else {
      document.removeEventListener('selectionchange', this.inputeventfunction);
      this.getBody().removeEventListener('input', this.inputeventfunction);
    }

    this.attachedinputevents = attach;
  }

  scheduleCallbackOnInputOrDelay(callback, name) {
    if (this.activeinputhandler === name)
      return;

    for (let i = 0; i < this.oninputhandlers.length; ++i)
      if (this.oninputhandlers[i].name === name)
        return;

    if (!this.oninputhandlers.length) {
      this.setInputEventAttach(true);
      this._delayedDetectedInputEvent(null);
    }

    this.oninputhandlers.push({ name: name, callback: callback });
  }

  _delayedDetectedInputEvent(event) {
    if (event)
      Promise.resolve(true).then(() => this._detectedInputEvent(event));
    else
      setTimeout(() => this._detectedInputEvent(null), 1);
  }

  _detectedInputEvent(event) {
    // Currently inside range code, just ignore
    if (this.selectingrange)
      return;

    if (this.oninputhandlers.length) {
      //console.log('inputdelay activated by ' + (event ? 'event ' + event.type : 'timeout'));
      const copy = this.oninputhandlers.slice();
      this.oninputhandlers = [];
      this.setInputEventAttach(false);

      for (let i = 0; i < copy.length; ++i) {
        this.activeinputhandler = copy[i].name;
        copy[i].callback();
      }

      this.activeinputhandler = '';
    }
  }

  setShowFormatting(show) {
    this.getBody().classList.toggle('wh-rtd-formatting', Boolean(show));
    this.stateHasChanged();
  }

  getShowFormatting() {
    return this.getBody().classList.contains("wh-rtd-formatting");
  }
  executeDefaultPropertiesAction(event) {
    if (event.target.nodeName === 'A') {
      const url = prompt(this.GetLanguageText('prompt_hyperlink'), event.target.href);
      if (url)
        event.target.href = url;
      return;
    }
  }

  private async newUploadInsertImage(): Promise<void> {
    using lock = dompack.flagUIBusy();
    void (lock);

    const toUpload = await requestFile({ accept: ["image/png", "image/jpeg", "image/gif"] });
    if (!toUpload)
      return;

    const imgnode = this._createImageDownloadNode();
    this.replaceSelectionWithNode(imgnode, true);
    this.uploadImageToServer(toUpload, imgnode);
  }

  //Upload an image to the server, and then replace the src in the specified image node
  protected async uploadImageToServer(filetoupload: File, imgnode: HTMLImageElement) {
    /* TODO convert to the new uploader to avoid base64 encoding but might as well delay that until the server-side RTD code is also willing to deny uploads
            can we use the FormCode's FormSubmitter to negotiate uploading and keep responsibility for the images on the client until the server has actually
            recorded them (and traded them in for image cache urls?) as it would also be nice to not have the RTD code directly rely on the image cache/form service
    */
    using lock = dompack.flagUIBusy();
    void (lock);

    const properurl = await getFormService().getUploadedFileFinalURL(await getFileAsDataURL(filetoupload));
    imgnode.src = properurl;
    this.knownimages.push(imgnode.src);
    imgnode.classList.add("wh-rtd__img");

    //drop width/height form external images
    imgnode.removeAttribute("width");
    imgnode.removeAttribute("height");

    await loadImage(imgnode.src); //don't return until the upload is done!
  }
  //FIXME if we can select embeddedobjects, we can merge this into executeAction
  launchActionPropertiesForNode(node, subaction) {
    const action = {
      action: 'action-properties',
      actiontarget: { __node: node },
      subaction: subaction,
      rte: this
    };

    if (!dompack.dispatchCustomEvent(node, "wh:richeditor-action",
      {
        bubbles: true,
        cancelable: true,
        detail: action
      }))
      return;

    this.executeDefaultPropertiesAction({ target: node, detail: action });
  }
  executeAction(action: string | { action: string; size?: { x: number; y: number } }, actiontarget?: TargetInfo | null): void {
    //actiontarget describes the target, and is currently only set for context menu actions but probably every action route should add this

    // Fallback for single string argument call without extra parameters - apparently everyone but the 'table' action doe sthis
    if (typeof action === "string")
      action = { action: action };

    if (!this._isActionAllowed(action.action))
      return;

    let actionnode = this.container; //FIXME legacy! should just fire to the closest event possible for all actions (so actiontarget needs to include this info?)
    if (actiontarget) {
      action.actiontargetinfo = actiontarget;
    } else if (action) {
      if (!action.action)
        throw new Error("Expected an 'action' value");

      action.rte = this; //this is the RTE object

      if (action.action === 'a-href') {
        const selstate = this.getSelectionState();
        if (selstate.hyperlink) //inside a hyperlink
          action.action = 'action-properties'; //rewrite to a properties action
      }

      if (action.action === 'action-properties') {
        const selstate = this.getSelectionState();
        if (!selstate.propstarget)
          return;

        actionnode = selstate.propstarget;
        action.actiontarget = { __node: actionnode };
        //action.subaction = not needed yet on this route
      }
    }

    if (!dompack.dispatchCustomEvent(actionnode, "wh:richeditor-action",
      {
        bubbles: true,
        cancelable: true,
        detail: action
      }))
      return;


    // FIXME for custom butons
    switch (action.action) {
      case "img":
        this.newUploadInsertImage();
        break;
      case 'a-href':
        {
          const url = prompt(this.GetLanguageText('prompt_hyperlink'), "http://");
          this.takeFocus();
          if (url)
            this.insertHyperlink(url);
        } break;
      case 'remove_hyperlink':
        this.RemoveHyperlink();
        break;
      case 'table':
        if (!action.size)
          throw new Error("Expected size param for table action");
        this.insertTable(action.size.x, action.size.y);
        break;
      case 'ul':
        this._toggleBulletedList();
        break;
      case 'ol':
        this._toggleNumberedList();
        break;
      case 'li-increase-level':
        this.addListLevel();
        break;
      case 'li-decrease-level':
        this.removeListLevel();
        break;
      case 'align_left':
      case 'align_center':
      case 'align_right':
      case 'align_justified':
        this._setAlignment(action.action.substr(6));
        break;
      case 'undo':
        this._undo();
        break;
      case 'redo':
        this._redo();
        break;
      case 'action-clearformatting':
        if (confirm(this.GetLanguageText("messages_confirmclearformatting")))
          this._clearFormatting();
        break;
      case 'action-showformatting':
        this.setShowFormatting(!this.getShowFormatting());
        break;
      case 'action-properties':
        this.executeDefaultPropertiesAction({ target: actionnode, detail: action });
        break;

      case 'b':
      case 'u':
      case 'i':
      case 'strike':
        this.applyTextStyle(action.action, !this.getSelectionState().hasTextStyle(action.action));
        break;
      case 'sub': // sub & sup are mutually exclusive
      case 'sup':
        if (!this.getSelectionState().hasTextStyle(action.action))
          this.applyTextStyle((action.action === 'sub' ? 'sup' : 'sub'), false);
        this.applyTextStyle(action.action, !this.getSelectionState().hasTextStyle(action.action));
        break;

      case "table-addpara-before":
      case "table-addpara-after":
        {
          const node = this.getSelectionState().actionparent;
          const tablenode = node.closest("table");
          this.insertEmptyParagraph(tablenode, action.action === "table-addpara-after");
        } break;
      case "table-addrow-before":
      case "table-addrow-after":
      case "table-addcolumn-before":
      case "table-addcolumn-after":
      case "table-deletecolumn":
      case "table-deleterow":
      case "table-mergeright":
      case "table-mergedown":
      case "table-splitcols":
      case "table-splitrows":
        {
          const node = this.getSelectionState().actionparent;
          const tablenode = node.closest("table");
          const editor = tablesupport.getEditorForNode(tablenode);
          switch (action.action) {
            case "table-addrow-before":
            case "table-addrow-after": editor.insertRows(node, action.action === "table-addrow-before", 1, node.offsetHeight, { newcell_callback: this._initNewTableCell.bind(this) }); break;
            case "table-addcolumn-before":
            case "table-addcolumn-after": editor.insertColumns(node, action.action === "table-addcolumn-before", 1, 32, { newcell_callback: this._initNewTableCell.bind(this) }); break;
            case "table-deleterow": editor.deleteRows(node, 1); break;
            case "table-deletecolumn": editor.deleteColumns(node, 1); break;
            case "table-mergeright": editor.mergeRight(node); break;
            case "table-mergedown": editor.mergeDown(node); break;
            case "table-splitcols": editor.splitCols(node); break;
            case "table-splitrows": editor.splitRows(node); break;
          }
          break;
        }
    }
  }

  /** Initialize a new table cell created by table-addrow/table-addcolumn
      @param cellnode - Table cell node (td or th)
  */
  _initNewTableCell(cellnode) {
    // extension point for subclasses
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  //  Language texts
  //

  _getLangTexts() {
    if (!this._langtexts) {
      this._langtexts =
      {
        en: {
          buttonbar_bold: "Bold",
          buttonbar_italic: "Italic",
          buttonbar_underline: "Underline",
          buttonbar_insert_image: "Insert Image",
          buttonbar_insert_hyperlink: "Insert Hyperlink",
          buttonbar_remove_hyperlink: "Remove Hyperlink",
          buttonbar_anchor: "Bookmark",
          buttonbar_insert_table: "Insert Table",
          buttonbar_bulleted_list: "Bulleted List",
          buttonbar_numbered_list: "Numbered List",
          buttonbar_align_left: "Align left",
          buttonbar_align_center: "Center",
          buttonbar_align_right: "Align right",
          buttonbar_align_justified: "Justify",
          buttonbar_undo: "Undo",
          buttonbar_redo: "Redo",
          buttonbar_clear_formatting: "Clear Formatting",
          prompt_hyperlink: "Hyperlink URL",
          messages_openlink: "%1<br/><b>Shift + click to open in a new window</b>",
          messages_anchor: "Bookmark #%1",
          messages_confirmclearformatting: "Are you sure you want to discard all style?\n\nThis operation cannot be undone.",
          messages_confirmclearcontents: "Are you sure you want to delete all contents?\n\nThis operation cannot be undone."
        },
        nl: {
          buttonbar_bold: "Vet",
          buttonbar_italic: "Cursief",
          buttonbar_underline: "Onderstrepen",
          buttonbar_insert_image: "Afbeelding invoegen",
          buttonbar_insert_hyperlink: "Hyperlink invoegen",
          buttonbar_remove_hyperlink: "Hyperlink verwijderen",
          buttonbar_anchor: "Bladwijzer",
          buttonbar_insert_table: "Tabel invoegen",
          buttonbar_bulleted_list: "Lijst met opsommingstekens",
          buttonbar_numbered_list: "Genummerde lijst",
          buttonbar_align_left: "Links uitlijnen",
          buttonbar_align_center: "Centreren",
          buttonbar_align_right: "Rechts uitlijnen",
          buttonbar_align_justified: "Uitvullen",
          buttonbar_undo: "Ongedaan maken",
          buttonbar_redo: "Opnieuw",
          buttonbar_clear_formatting: "Opmaak verwijderen",
          prompt_hyperlink: "URL voor de hyperlink",
          messages_openlink: "%1<br/><b>Shift + klik om in een nieuw venster te openen</b>",
          messages_anchor: "Bladwijzer #%1",
          messages_confirmclearformatting: "Weet u zeker dat u alle opmaak wilt verwijderen?\n\nDeze operatie kan niet ongedaan gemaakt worden.",
          messages_confirmclearcontents: "Weet u zeker dat u alle inhoud wilt verwijderen?\n\nDeze operatie kan niet ongedaan gemaakt worden."
        }
      };
    }
    return this._langtexts;
  }

  GetLanguageText(name, param1, param2) {
    const langtexts = this._getLangTexts();
    if (langtexts[this.language] && langtexts[this.language][name])
      return (langtexts[this.language][name]).split('%1').join(param1).split('%2').join(param2);
    return "";
  }

  requireBottomParagraph() {
    // overridden by structured editor
  }

  getAvailableStyles(selstate: TextFormattingState) {
    const editor = this.getEditor();
    if (!editor)
      return [];

    return editor.getAvailableBlockStyles(selstate);
  }
}

export class TextFormattingState {
  hyperlink = false;
  bulletedlist = false;
  numberedlist = false;
  alignleft = false;
  aligncenter = false;
  alignright = false;
  alignjustified = false;
  haveselection = false;
  isblockwidget = false;
  isinlinewidget = false;

  textstyles = [];
  propstarget = null;

  actionstate: ActionState = {};
  actionparent = null; // nearest ol/ul/td/th

  tables: HTMLTableElement[] = [];
  tablestyle: BlockStyle | null = null;
  blockstyle: BlockStyle | null = null;

  cellparent: HTMLTableCellElement | null = null;

  hasTextStyle(nodeName) {
    return this.getTextStyleByNodeName(nodeName) !== null;
  }

  getTextStyleByNodeName(nodeName) {
    for (let i = 0; i < this.textstyles.length; ++i)
      if (this.textstyles[i].nodeName === nodeName)
        return this.textstyles[i];
    return null;
  }

}

EditorBase.TextFormattingState = TextFormattingState;
