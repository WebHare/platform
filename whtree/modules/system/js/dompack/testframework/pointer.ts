/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import * as domevents from '../src/events';
import * as domfocus from "../browserfix/focus";
import { getName, getPlatform } from "../extra/browser";
import { findElement, qSA } from '@webhare/test-frontend';
import { SimulatedFileSystemFileEntry, type RawDragItem } from './filesystem';
import { getRelativeBounds } from "@webhare/dompack";
import type { Selector } from '@mod-tollium/js/testframework';

const default_mousestate =
{
  cx: 0,
  cy: 0,
  downel: null,
  downelrect: null,
  downbuttons: [],
  samplefreq: 50,
  gesturequeue: [] as MouseGesture[],
  gesturetimeout: null,
  waitcallbacks: [],
  lastoverel: null,
  cursorel: null,
  lastdoc: null,
  lastwin: null,
  previousclicktime: null,
  previousclickpos: null,
  dndcandidate: null,
  dndstate: null as null | SimulatedDragDataStore
};

interface PointEventOptions extends ElementActionOptions {
  preventBubble: boolean;
}

export const toElement = Symbol("pointer.toElement");

const mousestate = { ...default_mousestate };
const browserPlatform = getPlatform();

function arrayCombine(a, b) {
  for (const elt of b)
    if (a.indexOf(elt) === -1)
      a.push(elt);
  return a;
}

function localWaitForGestures(callback) {
  if (mousestate.gesturequeue.length === 0)
    callback();
  else
    mousestate.waitcallbacks.push(callback);
}

if (typeof window !== "undefined") {
  if (window.waitForGestures) {
    console.error("waitForGestures already exists, multiple dompack versions loaded!!");
    const oldWaitForGestures = window.waitForGestures;
    window.waitForGestures = callback => localWaitForGestures(() => oldWaitForGestures(callback));
  } else
    window.waitForGestures = localWaitForGestures;
}

export class SimulatedDragDataStore {
  items = new Array<RawDragItem>;
  currentDragOperation: string;

  constructor(sourcenode, options?) {
    this._sourcenode = sourcenode;
    this._lasttarget = null;
    this._lasthandled = 0;
    this._sourcenode = sourcenode;

    this.items = [];
    this.currentDragOperation = "none";
    this.effectAllowed = 'uninitialized';
    this.dragimage = null;
    this.options = {}; // ctrl: false, meta: false, shift: false, alt: false
    updateDragOptions(this.options, options);
  }

  setDragImage(elt, x, y) {
    this.dragimage =
    {
      elt: elt,
      x: x,
      y: y
    };
  }

  addFile(file: File) {
    this.items.push({ kind: "File", type: file.type, data: file });
  }
}


class SimulatedDataTransferItem implements DataTransferItem {
  _dt;
  _item;

  constructor(dt: SimulatedDataTransfer, item: RawDragItem) {
    this._dt = dt;
    this._item = item;
  }

  valid() {
    return this._dt._dds && this._dt._dds.items.indexOf(this._item) >= 0;
  }

  get kind() { return this.valid() ? (this._item.kind === "Plain Unicode string" ? "string" : "file") : ""; }
  get type() { return this.valid() ? this._item.type : ""; }
  getAsString(callback: (data: string) => void) {
    if (!this.valid || this._item.kind !== "Plain Unicode string")
      return;
    void new Promise(resolve => resolve(this._item.data)).then(callback);
  }
  getAsFile() {
    if (!this.valid || this._item.kind !== "File")
      return null;

    return this._item.data;
  }
  webkitGetAsEntry(): FileSystemEntry | null {
    return this._item.kind === "File" ? new SimulatedFileSystemFileEntry(this._item) : null;
  }
}

class SimulatedDataTransferItemList {
  _dt;
  _length;
  _map;

  constructor(dt: SimulatedDataTransfer) {
    this._dt = dt;
    this._length = 0;
    this._map = new Map;
    this._update();
  }

  get length() {
    return this._dt._dds ? this._dt._dds.items.length : 0;
  }

  _update() {
    for (let i = 0; i < this._length; ++i)
      delete this[i];
    this._length = this.length;
    for (let i = 0; i < this.length; ++i) {
      const rawitem = this._dt._dds.items[i];
      let item = this._map.get(rawitem);
      if (!item) {
        item = new SimulatedDataTransferItem(this._dt, rawitem);
        this._map.set(rawitem, item);
      }
      this[i] = item;
    }
    if (this._dt && this._dt.files)
      this._dt.files._update();
  }

  add(data, type = "") {
    if (!this._dt._dds || this._dt._mode !== "read/write")
      return null;

    if (typeof data === "string") {
      this._dt._dds.items.push({ kind: "Plain Unicode string", type, data });
      this._update();
      return this[this.length - 1];

    } else if (typeof data === "object") {
      this._dt._dds.items.push({ kind: "File", type: data.type.toLowerCase(), data });
      this._update();
      return this[this.length - 1];
    } else
      throw new Error(`Cannot recognize first argument`);
  }

  clear() {
    if (!this._dt._dds || this._dt._mode !== "read/write")
      return;

    this._dt._dds.items = [];
    this._update();
  }
}

export class SimulatedFileList {
  constructor(dt) {
    this._dt = dt;
    this._length = 0;
    this._update();
  }

  get length() { return this._length; }

  _update() {
    for (let i = 0; i < this._length; ++i)
      delete this[i];

    const files = [];
    if (this._dt._dds && (this._dt._mode === "read/write" || this._dt._mode === "read"))
      for (const item of Array.from(this._dt._dds.items))
        if (item.kind === "File")
          files.push(item.data);

    this._length = files.length;
    for (let i = 0; i < this.length; ++i)
      this[i] = files[i];
  }
}

const effectAllowedValues = ["none", "copy", "copyLink", "copyMove", "link", "linkMove", "move", "all", "uninitialized"];

export class SimulatedDataTransfer {
  _dds;
  _mode;
  _items;
  _files;

  constructor(dds: SimulatedDragDataStore, mode, dropEffect) {
    this._dds = dds;
    this._mode = mode;
    this._items = new SimulatedDataTransferItemList(this);
    this._files = new SimulatedFileList(this);
    this._dropEffect = dropEffect;
    this._effectAllowed = dds.effectAllowed;

    if (!["read/write", "protected", "read"].includes(mode))
      throw new Error(`Invalid protection mode '${mode}'`);

    this.dragimage = null;
  }

  get items() { return this._items; }
  get files() { return this._files; }

  get dropEffect() { return this._dropEffect; }
  set dropEffect(value) { if (["none", "copy", "move", "link"].includes(value)) this._dropEffect = value; }

  get effectAllowed() { return this._dds ? this._dds.effectAllowed : this._effectAllowed; }
  set effectAllowed(value) { if (this._dds && this._mode === "read/write" && effectAllowedValues.includes(value)) { this._effectAllowed = this._dds.effectAllowed = value; } }

  get types() {
    const retval = [];
    for (const item of Array.from(this.items))
      if (item.kind !== "File")
        retval.push(item.type);
      else if (!retval.includes("Files"))
        retval.push("Files");
    return retval;
  }

  setDragImage(element, x, y) {
    if (this._dds && this._mode === "read/write")
      this._dds.dragimage = { element, x, y };
  }

  getData(format) {
    if (!this._dds || this._mode === "protected")
      return "";
    format = format.toLowerCase();
    let converttourl;
    if (format === "text")
      format = "text/plain";
    else if (format === "url") {
      format = "text/uri-list";
      converttourl = true;
    }
    const item = this._dds.items.find(i => i.kind === "Plain Unicode string" && i.type === format);
    if (!item)
      return "";

    console.warn('get data', format, item);

    return converttourl ? item.data.split(" ")[0] : item.data;
  }

  setData(format, data) {
    if (!this._dds || this._mode !== "read/write")
      return;

    if (typeof data !== "string")
      throw new Error(`Can only add strings`);

    if (format)
      this.clearData(format);

    this._items.add(data, format);
  }

  clearData(format) {
    if (!this._dds || this._mode !== "read/write")
      return "";
    format = (format || "").toLowerCase();
    if (format === "text")
      format = "text/plain";
    else if (format === "url")
      format = "text/uri-list";

    this._dds.items = this._dds.items.filter(i => i.kind !== "Plain Unicode string" || (format && i.type !== format));
    this._items._update();
    this._files._update();
  }

  _detach() {
    this._dds = null;
    this._items._update();
    this._files._update();
  }
}

// DND spec 8.7.5 pt. 1
function getDraggableElement(el) {
  for (; el; el = el.parentNode)
    if (el.getAttribute) {
      if (el.getAttribute('draggable') === 'true')
        return { el: el, type: 'draggable', dist: 1 };
      if (el.nodeName.toLowerCase() === 'img')
        return { el: el, type: 'img', dist: 20 };
      if (el.nodeName.toLowerCase() === 'a' && el.href)
        return { el: el, type: 'a', dist: 20 };
    }
  return null;
}

function setMouseCursor(x, y) {
  if (!mousestate.cursorel) {
    //FIXME reinstall mousecursor element into the dom if the page reloaded
    mousestate.cursorel = mousestate.lastdoc.createElement('div');
    mousestate.cursorel.style.cssText = 'position:fixed; pointer-events:none; z-index: 2147483647; width:14px; height:22px; pointer-events:none;top:0;left:0';

    mousestate.lastdoc.body.appendChild(mousestate.cursorel);
  }

  //FIXME data-url these images
  if (mousestate.dndstate) {
    switch (mousestate.dndstate.dropeffect) {
      case 'copy': mousestate.cursorel.style.background = 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAWCAYAAADwza0nAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH3QQMCywDcU9p3AAAAvBJREFUOMuN1F1IU2EYB/B/tePm2leHLR3KsqWWNs/EcsZsWRR9aezCy0BjtTaomPYBiV540ZfGGFp5oeDNwLsMvUgpzaSBmmEpYkUOHWe5E+iOSuc4NH27EIModH94rl5+PDwv7/ugqKjoUl5e3ku/3395aWkJhJC4aodMJnOMj49fnJ+fNzMMw9E0PU5RFLbK9lgshvz8fBiNxj1ut/vR0NCQHXFkh1wuP5ebm1tQfm0Nk1+XNW96Bw8zDBNJSkqa2LQjAKysrECaQMPpoaFUKtMrKioeh0KhC1vCjexMTIHDE4NOR6d5PB7v1NSUPS4IAMqde1F+XcTa2lrGnbuO+3Nzc8figgCgUqTj6u0lrC5rDlZVVTXOzs6eigsCgEaZhSs3Y+A4zlxdXe1bWFiwxQUBQK3IgPOWCI7jTLW1tT5RFI/EBQFglyobrjuriEajh+rq6p4KgmAFAMlm6MfsKHras6HR5IBlh9DZ2XlIo9E8KS4uvvcPZL9/BBsSYLUexdgIj7a2Nlgslt6+vr4XAGShUEihUqlif0F+cQIPqnjsN8lhtQK/VggyMzPR0tIyODAw8MzlckGr1SI5OXl9RqlUisWfk3j2UAKGMb/Wawv8n7+8h+3EPujTODQ3Nxfb7Xbr9PQ0SktL1y8nMTERw8PDaPYmIDU1daShoeFaf39/73AfA4XcAGO6Al1dXbmRSOQYTdPIyspahxKJBMFgEDqdbrS+vv62IAjf9Hr9h0Ag0PODW8TJsykwmUxob28/L4qi+c9cjY2NZ5uamh6xLHuGEILW1lYYjUYAuO52u8m7kRuksvoAKSwsJOFwuPLPR+7o6Ji0WCw9arU6CABjY2MwGAwoKSkRKYrau00WyMjO2Y3ItAE8z8vMZvMniqI4RKNRCILw3/Xg9XqvOp1O8m7kBqmpqSE2m42Ew2EPIWTzl6PT6QKCILztfq7CzMwMysrKurVa7SsA2LQjy7Lw+XynAfgdDkcrz/PHN85+A/medC4PxSI3AAAAAElFTkSuQmCC")'; break;
      case 'link': mousestate.cursorel.style.background = 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAWCAYAAADwza0nAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH3QQMCywo3fOQnAAAAv5JREFUOMuN1F1IU2EYB/B/upPbcWeTszM2PzbTyrJkM8tV4lxEJKVrlERgIKGYQoIG3YheeBOkIcOoG4VuBt6lnBuN0qYwWqJEiu2iNufUtlPty/IcZ36cLsSLKGx/eK/e58fD8/LywGKx3CkpKRlxOBwN6+vrEEUxqZMqlUrr5+fnb8fjcaPBYOBomp4nCAL/S0oikUBpaSny8/Nzm5ubH01NTdmQRFJJkrxSXFx81ntdgMwvZkxNuM8YDIaQRqPx7NsRADY3N3FQmYaNWwpQFHWkra3tcSAQsP4X7kWqScfStQ3QDH2otbW11+/325KCACDLprBU9Qs7OztH79xveBiJRCqSggBA6igEbdugDyhPtre3PwmHw5eSggAgz8vAF9sWOI4zdnR02FdXV81JQQAg9QoErdvgOK6oq6vLLgjCuaQgAMgPZyB0Q0Q0Gj3d3d39lOf5MgBIpSjqik6nO7tukvyFVj1hnJrQ4sSaHh6PByzLZsnl8lMqler7X9Xx2W9IcGvQVuZj7VMUg4PvYDKZxp1O5zAAaSAQkCsUisQfcM0Xx9ZzDul5cqASELd2UFBQgIGBgXdut/tZU1MTGIaBVqvdnTEtLQ3C8k8wL7ZhNBhel+WecUTefgFTrsOSMoz+/v4qm81Wtri4iJqamt3HkclkmJ6eRtZwCnJyct739fXdm5ycHD+/VACpNh2kToHR0dHiUChUQdM0CgsLd6FEIoHP54NarZ7t6el5wPP858zMzBmXyzWm8adDVZaDoqIiDA0NXRUEwbg3lqSlpWVEIpEIVqvVSdO0k2VZeL3ejwsLC6xlxnLp680MuNxz8LN+c21t7UWSJGcBIJVlWa/JZBpTKpU+AJibm4Ner0d1dbVAEETeh4jnKHVchWM/shGLxaRGo/EDQRAcotEoeJ7/53ro7e2929jYKFrGa8XOzk7RbDaLKysrraIo7v9z1Gq1i+f5ifI3eQgGg6irq3vJMMwrANi34/LyMux2+2UAjvr6+uexWOzC3t1vquVuu3JVftEAAAAASUVORK5CYII=")'; break;
      default: mousestate.cursorel.style.background = 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAWCAYAAADwza0nAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH3QQMCykAlTHMIwAAAwVJREFUOMuNlF9IUwEUxr/lvWy7bjqvu2y2fzpSkmxbmkuKXIQElrIH3wxELXSRoQ/1IL74UqSRw6iHFHoZ6JtxKTJKWwNBpxEpZkZzc0zdYO7eGd27geh6EB/6Q+2D83TOj8M55+PA4XC0VlZWvvJ4PNdSqRQymUxWkSOTydqXl5evJpNJq8ViidE0vUySJP6nI+l0GtXV1TCbzSaXy3Xf7/c7kYVyKIqqt9lsZzo4Dl8lEtW7ubnTFoslqtFoVv7ZEQB2d3dBqlS4RRBQKpXHenp6HoTD4cb/goeSabW4EY+Doeni7u7uh6FQyJkVCAC5ej2ux+PY398vvdPWdjeRSNRmBQJAnsEAF89jr6DgRG9v76Pt7e26rEAAKDSZ4EokEIvFrH19fe6dnZ3zWYEAoDIa0cHziMViFf39/W5RFGuyAgGAMZlwK5kEx3FVAwMDjwVBOAsAOUqlst5gMJw59xe3bASDmDAaES0txcrKCliWPapQKE4VFhbGid+Lg4EANlIp1J48iaVkEmNjY7Db7dNer/c5AFk4HFbk5eWlfwHj4TDu/fiB43I5agHsZTIoKyvD6Ojo3Ozs7JPOzk6o1WpotdqDGaVSKb5HInicmwuL1fpWW1PjWfzyBXVaLY5ubmJkZOSK0+k8u76+jqampoPlyOVyLCws4ElBAfR6/cfh4eGbPp9v+kNVFeQ6HUoUCkxOTtqi0WgtTdMoLy8/AAmCwNraGhiGWRwcHLwtCMK3oqKiDzMzM1MbEgnqNBpUVFRgYmLisiiK1sOxiK6urlcEQYiNjY1emqa9LMsiEAh8DgaD7JTDUddqMoGZnwcbCp1vbm6+SFHUIgDksCwbsNvtU/n5+WsAsLS0BKPRiIaGBpEkyZI9v7/UplJh02wGz/Myq9X6iSTJmITjOEilUlAU9ccdh4aGOlZXV59eE0W8LCmBz+fD+Ph4j06nG/6ncxiGmREE4f2L4mJsbW2hpaXltVqtfgMA4DgOgiD89SFFIhG43e5LADzt7e3PeJ6/cJj7CUfrVfEzIGP3AAAAAElFTkSuQmCC")'; break;
    }
  } else
    mousestate.cursorel.style.background = 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAWCAYAAADwza0nAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIGNIUk0AAHolAACAgwAA+f8AAIDpAAB1MAAA6mAAADqYAAAXb5JfxUYAAALXSURBVHjajJNBSFpxHMe/NB942DMrX+QhNx9ah3wZRW9joe0w1rYaXgYRAzeUREKoxQ4LPTSc5GuI4LYugQSBx0YdtrE5GiVjwoJZ0sVC5EkImdbhaRC8/07FYlv5hd/hx48Pv+8Pfl/09/c/7e7u/rC4uOisVqsghNRUV5RKpSOdTj8+PDw0d3Z2FhobG9MUReEy1R0fH6O3txcsy15zu93BZDJpQy3SarWR4eFhUiwWycjICBkYGMikUqlHl1mtA4CTkxM0NTVBEATQNG2YmJh4ncvlHl5o9c+mtbUVgiCgubn5+vj4eCibzdpqAgGAZVn4/X7Ismz0er2Bg4MDa00gABiNRszMzKBarXZMTU1FisXinZpAAOjo6EAwGEShUDB7vd7w0dGRpSYQANrb2xEIBFAoFEzT09PhSqVysyYQADiOQygUQqlU6hEE4a0kSbcAQHERlEwmsbCwALVaDVEUsbKy0qNWq98MDg6++gtcX19HNpuF3W7HxsYGYrEYeJ7/urq6+h6AMpfLXVWpVMfnrG5tbWFsbAzxeBynj9HW1ob5+fkfsVjsHU3TIY1G87KlpeXjFZqm7xsMhhscx2FychJ6vf5LQ0PDd1mWzVarFel0GplMRuVyubY8Ho+o0+nAMAzAsmzEYDAQm81GnE7nxv7+vpHjuCejo6OEEEL8fj/p6uoiOzs7L879qkKhwO7uLhiGSc3Ozj6XJCmj1Wp/JhKJ+NraGmw2G0wmE5aWlh5UKhXz2V2RSOTe3NxcUBTFAUIIotEoWJYFAI/b7SaEEBIIBEhfXx/J5/PPzoK8vLy8w/N8vL6+fhcANjc3odPpMDQ0VKEoSi/LspHneWxvb6NcLivNZvMviqIKKJVKkCTpn5kLhUKu01t9Ph+xWCwkn8+Pn+Xxf2IYJiFJ0jefz4e9vT3Y7fZPGo3mMwBcuFEURYTD4bsAFh0OR7RcLt8+nf0eAO8upcEtDpHVAAAAAElFTkSuQmCC")';

  mousestate.cursorel.style.left = x + 'px';
  mousestate.cursorel.style.top = y + 'px';
}

//like getElementFromPoint, but sees through shadow roots
function getDeepElementFromPoint(doc: Document | ShadowRoot, px: number, py: number) {
  const el = doc.elementFromPoint(px, py);
  if (!doc.contains(el)) //we got something outside this root
    return el; //then return it. this happens if the targetted item is inert
  if (el && el.shadowRoot?.elementFromPoint)
    return getDeepElementFromPoint(el.shadowRoot, px, py) ?? el;
  return el;
}

function deepContains(parent: Node, el: Node) {
  for (let findroot = el; findroot; findroot = findroot.parentNode ?? (findroot as unknown as ShadowRoot).host) //also walk out of shadowdoms
    if (findroot === parent)
      return true;
  return false;
}


/// Is the element still in the DOM (even if shadow?)
function isInDeepDom(el: Node) {
  if (!el.ownerDocument)
    return false;
  return deepContains(el.ownerDocument.documentElement, el)
}

export function getValidatedElementFromPoint(doc: Document, px: number, py: number, expectelement: boolean): Element | null {
  const scroll = { x: 0, y: 0 }; // actually breaks the ui.menu test.... var scroll = safe_id(doc.body).getScroll();
  const lookupx = /*Math.floor*/(px - scroll.x);
  const lookupy = /*Math.floor*/(py - scroll.y);

  // In Internet Explorer, elementFromPoint only returns elements that are actually within the browser viewport, so if we're
  // trying to lookup an element that is currently not visible, we'll scroll the main document so the iframe lookup position
  // is in view.
  // if (getName()=="ie" && doc.defaultView.frameElement) //doesn't this apply to all browsers ?
  {
    const maindoc = doc.defaultView.frameElement.ownerDocument;

    // Get the position of the iframe within the main window
    const docpos = doc.defaultView.frameElement.getBoundingClientRect();

    // Get the main window size and scroll position
    const docscroll = { x: maindoc.body.scrollLeft, y: maindoc.body.scrollTop };

    // The absolute lookup position (relative to the browser's top left corner)
    const abslookupx = lookupx + docpos.left - docscroll.x;
    const abslookupy = lookupy + docpos.top - docscroll.y;

    // If the lookup position is not located within the visible viewport, try to scroll it into view
    if (abslookupx < 0)
      docscroll.x += abslookupx;
    else if (abslookupx > maindoc.documentElement.clientWidth)
      docscroll.x += (abslookupx - maindoc.documentElement.clientWidth) + 1;
    if (abslookupy < 0)
      docscroll.y += abslookupy;
    else if (abslookupy > maindoc.documentElement.clientHeight)
      docscroll.y += (abslookupy - maindoc.documentElement.clientHeight) + 1;

    maindoc.body.scrollLeft = docscroll.x;
    maindoc.body.scrollTop = docscroll.y;
  }

  // Make sure mouse cursor element is hidden, so it doesn't interfere
  const el = getDeepElementFromPoint(doc, lookupx, lookupy);
  //console.log(px,py,lookupx,lookupy,el);

  if (!el && expectelement) {
    console.log("Unable to find element at location " + lookupx + "," + lookupy + " bodypos: " + px + "," + py + " with scroll " + scroll.x + "," + scroll.y);
    setMouseCursor(lookupx, lookupy);
  }
  if (el) {
    const bound = el.getBoundingClientRect();
    if (!(bound.top <= lookupy && lookupy < bound.bottom + 1 && bound.left <= lookupx && lookupx < bound.right + 1)) {
      console.log(lookupx, lookupy, bound, el, expectelement);
      console.warn("elementFromPoint lied to us!");
    }
    //console.log(el,bound,scroll.x,scroll.y);
  }
  return el;
}


/** Returns the position from a part with an element and optionally x/y position within that element
    @return
    @cell return.x X-coordinate of selected position
    @cell return.y X-coordinate of selected position
    @cell return.relx X-coordinate relative to left top of element
    @cell return.rely Y-coordinate relative to left top of element
*/
function getPartPosition(part) {
  if (part.el.concat)
    throw new Error("el is an array, it must be a single element");

  const coords = part.el.getBoundingClientRect();
  let relx, rely;

  if (typeof part.x === 'undefined')
    relx = coords.width * 0.5;
  else if (typeof part.x === 'string' && part.x.at(-1) === '%')
    relx = coords.width * parseInt(part.x) / 100;
  else if (typeof part.x === 'number')
    relx = part.x;
  else
    throw new Error("Did not understand 'x'");

  if (typeof part.y === 'undefined')
    rely = coords.height * 0.5;
  else if (typeof part.y === 'string' && part.y.at(-1) === '%')
    rely = coords.height * parseInt(part.y) / 100;
  else if (typeof part.y === 'number')
    rely = part.y;
  else
    throw new Error("Did not understand 'y'");

  if (!isInDeepDom(part.el)) {
    console.error("The element we're looking for is no longer part of the DOM: ", part.el);
    throw new Error("The element we're looking for is no longer part of the DOM");
  }

  const clientx = coords.left + relx;
  const clienty = coords.top + rely;

  return { x: clientx, y: clienty, relx: relx, rely: rely };
}

function _onMouseDocUnload(event) {
  if (mousestate.cursorel && mousestate.cursorel.parentNode)
    mousestate.cursorel.parentNode.removeChild(mousestate.cursorel);
  mousestate.cursorel = null;
}

// Register unload event on the new target window, so on unload the cursor is removed
function _updateUnloadEvents(win) {
  if (mousestate.lastwin !== win) {
    if (mousestate.lastwin && mousestate.lastwin.removeEventListener)
      mousestate.lastwin.removeEventListener('pagehide', _onMouseDocUnload);

    mousestate.lastwin = win;
    if (mousestate.lastwin && mousestate.lastwin.addEventListener)
      mousestate.lastwin.addEventListener('pagehide', _onMouseDocUnload);
  }
}

/** Scrolls the part target into view, returns the client x/y of the final position
*/
function _processPartPositionTarget(part: MouseGesture) {
  // Calculate the position from
  let position;
  if (part.el) {
    // Get relative x/y within part.el
    position = getPartPosition(part);

    // Make sure requested point is in view, and recalculate the client position
    if (!canClick(part.el, { x: part.relx, y: part.rely })) {
      // console.log("scrolling into view", part, getRelativeBounds(part.el));
      part.el.scrollIntoView();
    }

    position = getPartPosition(part);
    //console.log("We think el",part.el,"is at",position.x,position.y);
  } else // apply relx/rely to the coordinates at the start of the part execution
    position = { x: part.startx! + (part.relx || 0), y: part.starty! + (part.rely || 0) };

  // If clientx/clienty is set, use that as override
  if (typeof part.clientx === 'number')
    position.x = /*Math.floor*/(part.clientx);
  if (typeof part.clienty === 'number')
    position.y = /*(Math.floor*/(part.clienty);

  return position;
}


export function _resolveToSingleElement(element: ValidElementTarget): HTMLElement {
  if (Array.isArray(element)) {
    //This is a SelectorPart[]
    const match = findElement(element);
    if (!match) {
      console.error("No element matches selector:", element);
      throw new Error("No element matches selector");
    }
    return match;
  }

  if (element instanceof NodeList) {
    if (element.length === 0)
      throw new Error("Passed an empty $$()");
    if (element.length > 1) {
      console.log(element);
      throw new Error("Passed multiple elements using $$(), make sure the selector only matches one!");
    }
    return element[0] as HTMLElement;
  } else if (typeof element === "string") {
    let elements = qSA(element);
    if (elements.length === 0) {
      elements = qSA(`*[id="${CSS.escape(element)}]`);
      if (elements.length !== 0) {
        console.error(`Invoking _resolveToSingleElement with an id '${element}'`);
        throw new Error(`Invoking _resolveToSingleElement with an id '${element}'`);
      }
    }
    if (elements.length === 0) {
      elements = qSA(`*[name="${CSS.escape(element)}"]`);
      if (elements.length !== 0) {
        console.error(`Invoking _resolveToSingleElement with a name '${element}'`);
        throw new Error(`Invoking _resolveToSingleElement with a name '${element}'`);
      }
    }
    if (elements.length === 0)
      throw new Error(`Selector '${element}' evaluated to no elements`);
    if (elements.length > 1) {
      console.log(elements);
      throw new Error(`Selector '${element}' evaluated to multiple elements, make sure the selector only matches one!`);
    }
    return elements[0];
  }

  if (!element) {
    throw new Error("Invalid (falsy) element passed");
  }
  return element as HTMLElement;
}

/* sending complex mouse gestures
   down/up: mouse button to press/depress. 0=standard (left), 1=middle, 2=context (right) .. */
export function sendMouseGesture(gestureparts: MouseGesture[]): Promise<void> {
  const stack = new Error;
  //Calculate execution time for the gestures
  let at = Date.now();
  for (let i = 0; i < gestureparts.length; ++i) {
    at += gestureparts[i].delay || 0;
    gestureparts[i].at = at;

    if (gestureparts[i].el?.[toElement])
      gestureparts[i].el = gestureparts[i].el[toElement]();
  }

  // Resolve this promise when the last gesture has been processed
  const retval = new Promise<void>(resolve => gestureparts.length
    ? gestureparts[gestureparts.length - 1].onexecuted = resolve
    : resolve());

  //Queue up the gestures
  mousestate.gesturequeue.push(...gestureparts.map(_ => ({ ..._, stack })));
  //Execute gestures now
  processGestureQueue();

  return retval;
}

function getBrowserFocusableElement(el) {
  return _getFocusableElement(el);
  /* FIXME is the IE workaround still needed ?
  if(getName()!="ie")
    return getFocusableElement(el);

  /* https://msdn.microsoft.com/en-us/library/ie/ms534654%28v=vs.85%29.aspx
The following elements can have focus by default but are not tab stops.
These elements can be set as tab stops by setting the tabIndex property to a positive integer. applet, div, frameSet, span, table, td.
* /
  for(;el;el=el.parentNode)
  {
    if($wh.isFocusableComponent(el))
      return el;
    if(el.nodeName && ['APPLET','DIV','FRAMESET','SPAN','TABLE','TD'].includes(el.nodeName.toUpperCase()))
      return el;
  }
  return null;
*/
}

export function _getFocusableElement(el) {
  for (; el; el = el.parentNode)
    if (domfocus.canFocusTo(el))
      return el;

  return null;
}

function convertbndrec(elt) {
  if (!elt.getBoundingClientRect)
    return 'n/a';
  const rec = elt.getBoundingClientRect();
  return JSON.stringify({ left: rec.left, top: rec.top, right: rec.right, bottom: rec.bottom });
}

// Validate if the targeted element in part (if el is specitied) is the same as the at element hittested from the mouse cursor target
function validateMouseDownTarget(part: MouseGesture, elhere: Element, position) {
  let wantedtotarget = part.el;

  if (wantedtotarget && elhere !== wantedtotarget) { //we only need to validate on mousedown, mouseup is common to hit something different
    while (wantedtotarget && wantedtotarget.inert)
      wantedtotarget = wantedtotarget.parentNode; //if you're targeting an inert node, we should expect you to be targeting its first non-inert parent

    if (!deepContains(wantedtotarget, elhere)) {
      console.log("Wanted to target: ", wantedtotarget, " at " + position.x + "," + position.y, " but actual element is:", elhere, part);

      console.log("Original target", wantedtotarget, part.el.nodeName, part.el.className, convertbndrec(part.el));
      console.log("Final target", elhere, elhere.nodeName, elhere.className, convertbndrec(elhere));
      const fc = elhere.firstChild;
      if (fc)
        console.log("childtarget", fc, fc.nodeName, convertbndrec(fc));

      //        console.log('partel', part.el.innerHTML);
      //        console.log('elhere', elhere.innerHTML);

      const partel = wantedtotarget;
      setTimeout(function () {
        console.log("AFTER DELAY: Original target", partel, partel.nodeName, partel.getBoundingClientRect());
        console.log("AFTER DELAY: Final target", elhere, elhere.nodeName, elhere.getBoundingClientRect());
      }, 400);

      throw new Error("Final target element is not a child of the original target! Perhaps target was obscured at the time of the mouse action ? if this was intentional, add { validateTarget: false } to the gesture");
    }
  }
}


function fireDNDEvent(eventtype, cx, cy, el, button, relatedtarget, dragop) {
  if (!el)
    return true;

  // Handle current key stuff
  const ctrl = dragop.options.ctrl || (browserPlatform !== "mac" && dragop.options.cmd);
  const meta = dragop.options.meta || (browserPlatform === "mac" && dragop.options.cmd);

  // Calculate protection of datatransfer object
  let mode = 'protected';
  if (eventtype === 'dragstart')
    mode = 'read/write';
  else if (eventtype === 'drop')
    mode = 'read';

  if (eventtype !== 'dragstart' && dragop.effectAllowed === "uninitialized")
    dragop.effectAllowed = "all";

  const wantcopy = !dragop.options.shift && (browserPlatform === "mac" ? dragop.options.meta : dragop.options.ctrl);
  const wantlink = dragop.options.shift && (browserPlatform === "mac" ? dragop.options.meta : dragop.options.ctrl);

  let dropEffect = "none";
  if (eventtype === "drop" || eventtype === "dragend")
    dropEffect = dragop.currentDragOperation;
  else if (eventtype === "dragenter" || eventtype === "dragover") {
    switch (dragop.effectAllowed) {
      case "none": dropEffect = "none"; break;
      case "copy": dropEffect = "copy"; break;
      case "copyLink": dropEffect = wantlink ? "link" : "copy"; break;
      case "copyMove": dropEffect = wantcopy ? "copy" : "move"; break;
      case "all": dropEffect = wantcopy ? "copy" : wantlink ? "link" : "move"; break;
      case "link": dropEffect = "link"; break;
      case "linkMove": dropEffect = wantlink ? "link" : "move"; break;
      case "move": dropEffect = "move"; break;
      case "uninitialized": dropEffect = wantcopy ? "copy" : wantlink ? "link" : "move"; break;
    }
  }

  const dataTransfer = new SimulatedDataTransfer(dragop, mode, dropEffect);

  // Calc effectallowed / dropeffect
  // FIXME: figure out how these actually work & interact with event returns & setting of dropEffect/effectAllowed
  if (['dragenter', 'dragover', 'drop', 'dragend'].includes(eventtype)) {
    if (getName() === "chrome") {
      //dataTransfer.dropEffect = 'none';
      //dataTransfer.effectAllowed = ctrl ? dragop.options.shift ? "link" : "copy" : "all";
    } else if (getName() === "safari") {
      dataTransfer.dropEffect = 'none';
      dataTransfer.effectAllowed = ctrl ? dragop.options.shift ? "link" : "copy" : "all";
    } else if (getName() === "firefox") {
      dataTransfer.dropEffect = ctrl ? dragop.options.shift ? "link" : "copy" : "move";
    }
  }

  // detect document by testing for defaultview
  const doc = el.defaultView ? el : el.ownerDocument;
  let result = true;

  if (doc.contains && !doc.contains(el))
    return result;

  // Create a mousevent to get correctly filled contents
  const mouseevent = doc.createEvent("MouseEvent");
  const cancelable = !["dragend", "dragexit", "dragleave"].includes(eventtype);
  mouseevent.initMouseEvent(eventtype, true, cancelable, doc.defaultView, 0/*clickcount? is 0 correct?*/, cx + 25, cy + 25, cx, cy,
    ctrl || false, dragop.options.alt || false, dragop.options.shift || false, meta || false,
    button, null, dataTransfer);

  // Can't update the dataTransfer attr, though. Create a htmlevent, and place all mousevent attrs in it
  // That one can be fired!
  const event = doc.createEvent("HTMLEvents");
  event.initEvent(eventtype, true, true);

  const keys = Object.keys(mouseevent);

  // Browsers won't enumerate the event properties.
  arrayCombine(keys,
    [
      "altKey", "bubbles", "button", "buttons", "cancelBubble", "cancelable",
      "clientX", "clientY", "ctrlKey", "currentTarget", "dataTransfer",
      "defaultPrevented", "detail", "eventPhase",
      "layerX", "layerY",
      "metaKey",
      "pageX", "pageY",
      "relatedTarget", "screenX", "screenY", "shiftKey", "target", "timeStamp",
      "view", "which"
    ]);

  if (getName() === "firefox") {
    arrayCombine(keys,
      [
        "explicitOriginalTarget", "isChar", "isTrusted", "mozInputSource", "mozMovementX", "mozMovementY", "mozPressure",
        "rangeOffset", "rangeParent", "region"
      ]);
  } else if (getName() === "ie") {
    arrayCombine(keys,
      ["isTrusted", "srcElement", "toElement", "x", "y"]);
  } else if (getName() === "chrome") {
    arrayCombine(keys,
      [
        "fromElement", "keyCode", "movementX", "movementY", "offsetX", "offsetY", "returnValue", "srcElement",
        "toElement", "webkitMovementX", "webkitMovementY", "x", "y"
      ]);
  }

  for (let i = 0; i < keys.length; ++i) {
    try { event[keys[i]] = mouseevent[keys[i]]; } catch (e) { } //ignore 'cannot set' errors
  }

  event.dataTransfer = dataTransfer;
  result = checkedDispatchEvent(el, event);

  if (eventtype === "dragover" && !result) { // dragover event is cancelled
    if (dataTransfer.dropEffect === "copy" && ["uninitialized", "copy", "copyLink", "copyMove", "all"].includes(dragop.effectAllowed))
      dragop.currentDragOperation = "copy";
    else if (dataTransfer.dropEffect === "link" && ["uninitialized", "link", "copyLink", "linkMove", "all"].includes(dragop.effectAllowed))
      dragop.currentDragOperation = "link";
    else if (dataTransfer.dropEffect === "move" && ["uninitialized", "move", "copyMove", "linkMove", "all"].includes(dragop.effectAllowed))
      dragop.currentDragOperation = "move";
    else
      dragop.currentDragOperation = "none";
  }

  return result;
}

function initDrag() {
  const dragop = new SimulatedDragDataStore(mousestate.dndcandidate.draggable.el, mousestate.dndcandidate.part);
  if (fireDNDEvent("dragstart", mousestate.dndcandidate.cx, mousestate.dndcandidate.cy, mousestate.dndcandidate.draggable.el, 0, null, dragop)) {
    const ctrl = mousestate.dndcandidate.part.ctrl || (browserPlatform !== "mac" && mousestate.dndcandidate.part.cmd);
    const shift = mousestate.dndcandidate.part.shift;

    dragop.dropeffect = ctrl ? shift ? "link" : "copy" : "move";
    mousestate.dndstate = dragop;

    handleRunningDrag(mousestate.dndcandidate.part);
  }
  mousestate.dndcandidate = null;
}

function updateDragOptions(options, newoptions) {
  if (newoptions) {
    if ("shift" in newoptions) options.shift = newoptions.shift;
    if ("alt" in newoptions) options.alt = newoptions.alt;
    if ("ctrl" in newoptions) options.ctrl = newoptions.ctrl;
    if ("meta" in newoptions) options.meta = newoptions.meta;
    if ("cmd" in newoptions) options.cmd = newoptions.cmd;
  }
}

function handleRunningDrag(options) {
  // Process options
  updateDragOptions(mousestate.dndstate.options, options);
  mousestate.dndstate._lasthandled = new Date();

  //console.log('handleRunningDrag', mousestate.lastoverel);
  if (fireDNDEvent("drag", mousestate.cx, mousestate.cy, mousestate.dndstate._sourcenode, 0, null, mousestate.dndstate)) {
    //    console.log('drag not cancelled');
    const lasttarget = mousestate.dndstate._lasttarget;
    if (mousestate.dndstate._lasttarget !== mousestate.lastoverel) {
      if (mousestate.dndstate._lasttarget) {
        fireDNDEvent("dragexit", mousestate.cx, mousestate.cy, mousestate.dndstate._lasttarget, 0, null, mousestate.dndstate);
      }

      if (!fireDNDEvent("dragenter", mousestate.cx, mousestate.cy, mousestate.lastoverel, 0, null, mousestate.dndstate)) {
        //        console.log('dragenter cancelled');
        mousestate.dndstate._lasttarget = mousestate.lastoverel;
      } else {
        //        console.log('dragenter not cancelled');
        // FIXME: dropzone stuff

        fireDNDEvent("dragenter", mousestate.cx, mousestate.cy, document.body, 0, null, mousestate.dndstate);
        mousestate.dndstate._lasttarget = document.body;
      }
    }
    if (lasttarget && lasttarget !== mousestate.dndstate._lasttarget) {
      fireDNDEvent("dragleave", mousestate.cx, mousestate.cy, lasttarget, 0, null, mousestate.dndstate);
    }

    if (fireDNDEvent("dragover", mousestate.cx, mousestate.cy, mousestate.lastoverel, 0, null, mousestate.dndstate)) {
      //      console.log('dragover cancelled');
      // dropeffect stuff

    }
    //    else console.log('dragover not cancelled');
  } else {
    mousestate.dndstate.currentDragOperation = "none";
    console.error('drag cancelled');
    finishCurrentDrag(true, options);
  }
}

// DnD
function finishCurrentDrag(cancel, options) {
  // Process options
  updateDragOptions(mousestate.dndstate.options, options);

  if (cancel) {
    if (mousestate.lastoverel) {
      fireDNDEvent("dragleave", mousestate.cx, mousestate.cy, mousestate.lastoverel, 0, null, mousestate.dndstate);
    }
  } else {
    if (fireDNDEvent("drop", mousestate.cx, mousestate.cy, mousestate.lastoverel, 0, null, mousestate.dndstate)) {

    }
  }
  fireDNDEvent("dragend", mousestate.cx, mousestate.cy, mousestate.dndstate._sourcenode, 0, null, mousestate.dndstate);
  mousestate.dndstate = null;
}

function mouseFocusTo(el: Element) {
  let tofocus = getBrowserFocusableElement(el);
  if (tofocus?.tagName === "LABEL") {
    tofocus = tofocus.ownerDocument.getElementById((tofocus as HTMLLabelElement).htmlFor);
  }
  const lastfocus = domfocus.getCurrentlyFocusedElement();

  if (dompack.debugflags.testfw)
    console.log("[testfw] Simulate focus events: blur to ", lastfocus, " focus to ", tofocus, " we have focus?", lastfocus?.ownerDocument.hasFocus());

  if (tofocus !== lastfocus) {

    if (lastfocus && !lastfocus.ownerDocument.hasFocus()) { //we need to simulate focus events as browser dont fire them on unfocused docs (even though activeElement will change!)
      domevents.dispatchDomEvent(lastfocus, 'blur', { bubbles: false, cancelable: false, relatedTarget: tofocus || undefined });
      domevents.dispatchDomEvent(lastfocus, 'focusout', { bubbles: true, cancelable: false, relatedTarget: tofocus || undefined });
    }

    if (tofocus) {
      tofocus.focus();
      if (!tofocus.ownerDocument.hasFocus()) { //we need to simulate focus events as browser dont fire them on unfocused docs (even though activeElement will change!)
        domevents.dispatchDomEvent(tofocus, 'focus', { bubbles: false, cancelable: false, relatedTarget: lastfocus });
        domevents.dispatchDomEvent(tofocus, 'focusin', { bubbles: true, cancelable: false, relatedTarget: lastfocus });
      }
    }
  }
}

function processGestureQueue() {
  if (mousestate.gesturetimeout) {
    clearTimeout(mousestate.gesturetimeout);
    mousestate.gesturetimeout = null;
  }

  const now = Date.now();

  while (mousestate.gesturequeue.length) {
    // Get the current part in the queueu
    const part = mousestate.gesturequeue[0];
    if (!part.start) {
      // First time we see this part, register the starting time and cursor position
      part.start = now;
      part.startx = mousestate.cx;
      part.starty = mousestate.cy;
    }

    // Calculate the position from
    const position = _processPartPositionTarget(part);

    // Determine in which document we are working
    const currentdoc: Document | null = (part.doc || (part.el ? part.el.ownerDocument : mousestate.lastdoc));
    if (!currentdoc)
      throw new Error("Lost track of document");
    mousestate.lastdoc = currentdoc;

    // Need to remove the cursor when the window unloads, so register event listeners
    const win = currentdoc.defaultView;
    _updateUnloadEvents(win);

    //Make sure the point is visible, but only if we're going to click on it
    let elhere: Element | null = getValidatedElementFromPoint(currentdoc, position.x, position.y, true);
    if (!elhere) {
      elhere = currentdoc.documentElement;
      console.error("Unable to find element at location " + position.x + "," + position.y);
    } else if (part.validateTarget === true || (part.validateTarget !== false && typeof part.down === 'number')) //by default we validate on mousedown only,  mouseup is common to hit something different
      validateMouseDownTarget(part, elhere, position);

    const targetdoc = elhere.ownerDocument;

    //console.log("Get element@" + position.x + "," + position.y + " ",elhere.nodeName,elhere, " was ",part.el.nodeName,part.el, targetdoc&&targetdoc.defaultView?targetdoc.defaultView.getScroll().y:'-');

    const target = {
      view: targetdoc.defaultView,
      cx: position.x,
      cy: position.y,
      el: elhere
    };

    //interpolate mousemove events
    if (mousestate.cx !== target.cx || mousestate.cy !== target.cy) {
      let progress = Math.min(1, part.at > part.start ? (now - part.start) / (part.at - part.start) : 1);
      if (typeof part.transition === "function")
        progress = part.transition(progress);
      //console.log("start=" + part.start + ", at=" + part.at + ", now=" + now + ", progress=" + progress);

      mousestate.cx = part.startx + progress * (target.cx - part.startx);
      mousestate.cy = part.starty + progress * (target.cy - part.starty);

      //console.log("requesting element at " + reqx + "," + reqy);
      elhere = getValidatedElementFromPoint(currentdoc, mousestate.cx, mousestate.cy, false);
      if (!elhere)
        elhere = targetdoc.documentElement;

      //console.log("progress " + progress + "  target: " + target.cx + "," + target.cy + " cur: " +mousestate.cx+ "," + mousestate.cy + " elhere=",elhere);

      if (mousestate.dndcandidate && Math.abs(mousestate.cx - mousestate.dndcandidate.cx) + Math.abs(mousestate.cy - mousestate.dndcandidate.cy) > mousestate.dndcandidate.draggable.dist)
        initDrag();

      // DnD suppresses mouseout/over/move events
      if (mousestate.dndstate) {
        mousestate.lastoverel = elhere;

        if (now - mousestate.dndstate._lasthandled > 350)
          handleRunningDrag(part);
      } else {
        let elchanged = mousestate.lastoverel !== elhere;

        if (mousestate.lastoverel !== elhere || elchanged) {
          if (mousestate.lastoverel && mousestate.lastoverel.ownerDocument && mousestate.lastoverel.ownerDocument.defaultView) { // don't fire events for nonexisting documents
            let canfire = true;
            // Edge causes permission denied throws when accessing a freed window
            try { mousestate.lastoverel.ownerDocument.defaultView.onerror; } catch (e) { canfire = false; }

            if (canfire) {
              fireMouseEvent("mouseout", mousestate.cx, mousestate.cy, mousestate.lastoverel, 0, elhere, part);
              if ("onmouseenter" in window)
                fireMouseEventsTree("mouseleave", mousestate.cx, mousestate.cy, mousestate.lastoverel, 0, elhere, { preventBubble: true, ...part });
            } else
              mousestate.lastoverel = null;
          }

          fireMouseEvent("mouseover", mousestate.cx, mousestate.cy, elhere, 0, mousestate.lastoverel, part);
          if ("onmouseenter" in window)
            fireMouseEventsTree("mouseenter", mousestate.cx, mousestate.cy, elhere, 0, mousestate.lastoverel, { preventBubble: true, ...part });
          mousestate.lastoverel = elhere;
        }

        fireMouseEvent("mousemove", mousestate.cx, mousestate.cy, elhere, 0, null, part);
      }
    }
    //console.log("mouse now at " + mousestate.cx + "," + mousestate.cy);
    setMouseCursor(mousestate.cx, mousestate.cy);

    if (part.at > now) { //in the future
      mousestate.gesturetimeout = setTimeout(processGestureQueue, 1000 / mousestate.samplefreq);
      return;
    }

    if (typeof part.down === 'number') {
      if (mousestate.downbuttons.includes(part.down))
        throw new Error("Invalid mouse gesture - sending down for button #" + part.down + " when it is aleady down");
      if (part.down === 0) {
        mousestate.downel = target.el;
        mousestate.downelrect = target.el ? target.el.getBoundingClientRect() : null;
      }

      if (!mousestate.dndstate) {
        const mousedown_dodefault = fireMouseEvent("mousedown", target.cx, target.cy, target.el, part.down, null, part);
        if (mousedown_dodefault) {
          mouseFocusTo(target.el);  //mousedown was not prevented, set focus

          if (part.down === 2) { //RMB
            fireMouseEvent("contextmenu", target.cx, target.cy, target.el, part.down, null, part);
          }

          if (part.down === 0) { // DND
            const draggable = getDraggableElement(target.el); // FIXME text selections?
            if (draggable)
              mousestate.dndcandidate =
              {
                draggable: draggable,
                cx: target.cx,
                cy: target.cy,
                part: part
              };
          }
        }
      }

      //ADDME discover cancellation etc and properly handle those
      mousestate.downbuttons.push(part.down);
    } else if (typeof part.up === 'number') {
      if (!mousestate.downbuttons.includes(part.up))
        throw new Error("Invalid mouse gesture - sending up for button #" + part.up + " when it is not down");

      //FIXME see above for missing event parameters

      if (!mousestate.dndstate)
        fireMouseEvent("mouseup", target.cx, target.cy, target.el, part.up, null, part);
      if (mousestate.downbuttons.includes(part.up))
        mousestate.downbuttons.splice(mousestate.downbuttons.indexOf(part.up), 1);

      /* Is this a click?
         originally: (start and end is same element. ADDME doesn't work this way if drag is triggered, ie on button: mousedown,move,up = click, on link: mousedown,move,up = dragging)
         events spec (https://w3c.github.io/uievents/#event-type-click)
         ..in general SHOULD fire click and dblclick events when the event target of the associated mousedown and mouseup events is the same element with no mouseout or mouseleave events
         intervening, and SHOULD fire click and dblclick events on the nearest common inclusive ancestor when the associated mousedown and mouseup event targets are different...
      */
      if (part.up === 0) {
        mousestate.dndcandidate = null;
        if (!mousestate.dndstate && mousestate.downel) {
          const toclick = commonAncestor(mousestate.downel, target.el);
          if (toclick) { //if no common ancestor, one of the nodes is outside the DOM
            if (toclick !== target.el) //TODO hide this behind a debug flag as a console.log? but only if we finished updating tests and no longer care about this warning
              console.warn("[testfw] Sending click to common ancestor %o instead of mousedown target %o or mouseup target %o", toclick, mousestate.downel, target.el);

            let clickcount = 1;
            if ((Date.now() - mousestate.previousclicktime) < 100
              && (Math.abs(mousestate.previousclickpos.cx - target.cx) <= 2)
              && (Math.abs(mousestate.previousclickpos.cy - target.cy) <= 2)) {
              clickcount = mousestate.previousclickpos.clickcount + 1;
            }

            mousestate.previousclicktime = Date.now();
            mousestate.previousclickpos = { cx: target.cx, cy: target.cy, clickcount: clickcount };

            //if element leaves dom, it should no longer receive clicks (confirmed at least for chrome in tollium testautosuggest
            if (isInDeepDom(toclick))
              fireMouseEvent("click", target.cx, target.cy, toclick, part.up, null, part);

            //TODO these probably shouldn't be in the same gesture/tick?
            if (isInDeepDom(toclick) && clickcount === 2)
              fireMouseEvent("dblclick", target.cx, target.cy, toclick, part.up, null, { clickcount: clickcount });
            mousestate.downel = null;
          }
        } else if (mousestate.dndstate) {
          handleRunningDrag(part);
          finishCurrentDrag(false, part);
        }
      }
    }

    // Update drag state at the end of a gesture
    if (mousestate.dndstate)
      handleRunningDrag(part);

    if (mousestate.gesturequeue[0].onexecuted)
      mousestate.gesturequeue[0].onexecuted();
    mousestate.gesturequeue.splice(0, 1); //pop front gesture
  }

  const callbacks = mousestate.waitcallbacks;
  mousestate.waitcallbacks = [];
  callbacks.forEach(callback => callback());
}

function getParents(el: Element) {
  const elparents = [];
  for (; el && el.nodeType === 1; el = el.parentNode)
    elparents.unshift(el);
  return elparents;
}

function commonAncestor(el1: Element, el2: Element) {
  if (el1 === el2) //common case
    return el1;

  const parents1 = getParents(el1);
  const parents2 = getParents(el2);
  return parents1.findLast(p => parents2.includes(p));
}

function fireMouseEventsTree(eventtype: string, cx: number, cy: number, el: Element, button: 0 | 1 | 2, relatedtarget: HTMLElement | null, options: PointEventOptions) {
  if (!el)
    return;

  /* eventtype==mouseleave:
     - walk elparts upwards until we hit one of the relatedparents
     eventtype==mouseenter:
     - find the intersecting parent, walk downards to elparts
     */
  const elparents = getParents(el);
  const relatedparents = getParents(relatedtarget);
  let eventlist = [];

  // Skip all parents that are in relatedtarget's parent list
  elparents.forEach(function (parent) {
    if (relatedparents.includes(parent) || parent.nodeType !== 1)
      return;
    eventlist.push(parent);
  });

  if (eventtype === "mouseenter") {
    eventlist = eventlist.reverse();
  }

  for (const subel of eventlist) {
    try {
      fireMouseEvent(eventtype, cx, cy, subel, button, relatedtarget, options);
    } catch (e) {
      console.log("Error while firing mouse event", e);
      console.log(`${eventtype} on %o (${cx},${cy}) scheduled from %o`, el, options.stack);
      throw e;
    }
  }
}

export function checkedDispatchEvent(el, event) {
  const win = (el.ownerDocument ? el.ownerDocument.defaultView : null) || window;
  const saveonerror = win.onerror;

  //Save and pass on errors during event
  let eventerror;
  win.onerror = function (msg, file, line, col, error) {
    console.warn("checkedDispatchEvent error", msg, error);
    if (saveonerror)
      saveonerror.apply(win, arguments);
    eventerror = { msg, error };
  };

  const result = el.dispatchEvent(event);
  win.onerror = saveonerror;

  if (eventerror) {
    if (eventerror.error)
      throw eventerror.error;
    throw new Error("Error during event handler: " + eventerror.msg);
  }
  return result;
}


function fireMouseEvent(eventtype: string, cx: number, cy: number, el: Element, button: 0 | 1 | 2, relatedtarget: HTMLElement | null, options: PointEventOptions) {
  if (!el)
    return false;

  //https://developer.mozilla.org/en-US/docs/DOM/event.initMouseEvent
  //console.log("FireMouseEvent",eventtype,cx,cy,el,button,relatedtarget,options);
  const ctrl = options.ctrl || (navigator.platform !== "MacIntel" && options.cmd);
  const meta = options.meta || (navigator.platform === "MacIntel" && options.cmd);
  const canBubble = !options.preventBubble;

  if (el.disabled)
    return true;

  const doc = el.ownerDocument || el;
  const evt = doc.createEvent("MouseEvent");

  //find a valid target for mouse events
  while (el.closest('inert'))
    el = el.closest('inert'); //jump out of any inert parts

  while (el && (el.nodeType === 1 && getComputedStyle(el).pointerEvents === 'none'))
    el = el.parentNode;

  //console.log(arguments,typeof doc, typeof el, typeOf(doc), typeOf(el));
  //console.trace();
  evt.initMouseEvent(eventtype, canBubble, true, doc.defaultView, options.clickcount || 1, cx + 25, cy + 25, cx, cy,
    ctrl || false, options.alt || false, options.shift || false, meta || false,
    button, relatedtarget || null);
  return checkedDispatchEvent(el, evt);
}

export interface CastableToElement {
  [toElement]: () => Element;
};
export type ValidElementTarget = Element | string | SelectorPart[];
export type ElementTargetOptions = {
  /** X coordinate to target. A number is interpreted as a pixel coordinate relative tot the top left corner, a string is interpreted as a percentage of the full width. If not set, defaults to 50% */
  x?: number | string;
  /** X coordinate to target. A number is interpreted as a pixel coordinate relative tot the top left corner, a string is interpreted as a percentage of the full height. If not set, defaults to 50% */
  y?: number | string;
  /** Validate the target? By default only done in 'down' is set  */
  validateTarget?: boolean;
};
export type MouseButton = 0 | 1 | 2;

type ElementActionOptions = ElementTargetOptions & {
  cmd?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export type ElementClickOptions = ElementTargetOptions & ElementActionOptions & {
  button?: MouseButton;
};

export type MouseGesture = ElementTargetOptions & ElementActionOptions & {
  el?: Element | CastableToElement;
  down?: MouseButton;
  up?: MouseButton;
  delay?: number;
  relx?: number;
  rely?: number;
  clientx?: number; //absolute position X (overrides el/relx)
  clienty?: number; //absolute position X (overrides el/rely)
  transition?: (t: number) => number;

  //NOTE below fields are set during gesture execution and should not be visible/settable in the API
  start?: number; //Date.now when to start this gesture
  startx?: number; //Mouse position X at start
  starty?: number; //Mouse position Y at start
};

export function click(element: ValidElementTarget, options?: ElementClickOptions) {
  element = _resolveToSingleElement(element);

  const x = options && "x" in options ? options.x : "50%";
  const y = options && "y" in options ? options.y : "50%";
  const button: MouseButton = options?.button ?? 0;

  sendMouseGesture([
    { el: element, down: button, cmd: options && options.cmd, shift: options && options.shift, alt: options && options.alt, ctrl: options && options.ctrl, meta: options && options.meta, x: x, y: y },
    { up: button, cmd: options && options.cmd, shift: options && options.shift, alt: options && options.alt, ctrl: options && options.ctrl, meta: options && options.meta }
  ]);
}

export function focus(target: ValidElementTarget) { //focus could have gone into either pointer.es or keyboard.es ... but we have _resolveToSingleElement
  const element = _resolveToSingleElement(target);
  if (!canClick(element)) {
    element.scrollIntoView();
    if (!canClick(element)) {
      console.error("Cannot focus nonclickable element", element);
      throw new Error("Cannot focus nonclickable element - scrolling didn't help");
    }
  }
  if (!domfocus.canFocusTo(element)) {
    console.error("Cannot focus element that fails canFocusTo", element);
    throw new Error("Cannot focus unfocusable element");
  }
  element.focus();
}

export function canClick(element: ValidElementTarget, options?: ElementTargetOptions) {
  let x: string | number = "50%", y: string | number = "50%";
  if (typeof arguments[1] === 'number') { // receiving old style x,y coordinates
    x = arguments[1];
    y = arguments[2] || "50%";
    console.warn("Deprecated canClick syntax, use {x,y} as option parameters in WH5.5+");
  } else {
    x = options?.x ?? "50%";
    y = options?.y ?? "50%";
  }

  element = _resolveToSingleElement(element);

  const atpos = getPartPosition({ el: element, x: x, y: y });

  // Make sure mouse cursor element is hidden, so it doesn't interfere
  const elhere = getDeepElementFromPoint(element.ownerDocument, atpos.x, atpos.y);

  //console.log('canClick', element,atpos,elhere,element.getBoundingClientRect(), elhere && elhere.getBoundingClientRect());
  return deepContains(element, elhere);
}

/** Simulate an incoming external file drag */
export function startExternalFileDrag(file: File): void {
  mousestate.dndstate = new SimulatedDragDataStore(null);

  const files = [].concat(file); // convert to array
  for (const file of files)
    mousestate.dndstate.addFile(file);

  // ensure button 0 is down
  if (!mousestate.downbuttons.includes(0))
    mousestate.downbuttons.push(0);
}

/** Returns the current drag data store
    @return(object SimulatedDragDataStore) Drag data storage
*/
export function getCurrentDragDataStore() {
  return mousestate.dndstate;
}

/** Cancels the current drag
    @param options
    @cell(boolean) options.ctrl Whether 'ctrl' key is pressed
    @cell(boolean) options.meta Whether 'meta' key is pressed
    @cell(boolean) options.alt Whether 'alt' key is pressed
    @cell(boolean) options.shift Whether 'shift' key is pressed
*/
export function cancelDrag(options) {
  finishCurrentDrag(true, options);
}
