/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import './dompackexample.scss';

import * as dompack from "@webhare/dompack";
import Pulldown from "dompack/components/pulldown/index";
import AutoSuggest from "dompack/components/autosuggest/index";
import StaticSuggestionList from "dompack/components/autosuggest/staticlist";
import * as dialog from 'dompack/components/dialog/index';
import * as dialogapi from 'dompack/api/dialog';
import OverlayManager from "@webhare/dompack-overlays";

const dompackTestApi = {
  getLocal: dompack.getLocal,
  setLocal: dompack.setLocal,
  setSession: dompack.setSession,
  getSession: dompack.getSession,
  isStorageIsolated: dompack.isStorageIsolated,
  getCookie: dompack.getCookie,
  setCookie: dompack.setCookie,
  deleteCookie: dompack.deleteCookie,
  listCookies: dompack.listCookies,
  flagUIBusy: dompack.flagUIBusy,
  setupBusyModal: dompack.setupBusyModal
};

export type DompackTestApi = typeof dompackTestApi;

declare global {
  interface Window {
    __testApi: DompackTestApi;
  }
}
window.__testApi = dompackTestApi;

function fillRidiculous() {
  dompack.qR('#ridiculous').replaceChildren(dompack.create("option", { selected: true, disabled: true, textContent: 'Many' }));
  for (let i = 1; i < 360; ++i) {
    const node = dompack.create("option", { value: i, textContent: "item " + i });
    dompack.qS('#ridiculous').appendChild(node);
  }
}
function refillJustenough() {
  dompack.empty(dompack.qS('#justenoughselect'));
  dompack.qS('#justenoughselect').appendChild(dompack.create('option', {
    selected: true,
    disabled: true,
    textContent: 'Just Enough'
  }));
  ["can't", "get", "it", "though"].forEach(function (text) {
    dompack.qS('#justenoughselect').appendChild(dompack.create('option', { value: text, textContent: text }));
  });
}
function makeScrollable() {
  console.log("makeScrollable");
  document.body.style.height = (window.innerHeight * 3) + 'px';
}
function toggleClass() {
  console.log("toggleClass");
  dompack.qS("#togglethisclass").classList.toggle("copytoggle");
}
function pageinit() {
  if (dompack.qS('#refill_justenough')) {
    dompack.qS('#refill_justenough').addEventListener("click", refillJustenough);
    dompack.qS('#fillridiculous').addEventListener("click", fillRidiculous);
    dompack.qS('#scrollable').addEventListener("click", makeScrollable);
    if (dompack.qS('#toggleclass'))
      dompack.qS('#toggleclass').addEventListener("click", toggleClass);
  }
}


function onDirectSuggest(inword) {
  if (inword.includes('-'))
    return [];
  return "123456789_.".split("").map(char => inword + char);
}

const regcountmaps = { item: [], current: [] };

function updateRegCount(type, node) {
  //strip any reg# from the text, so we have a unique key into our regcounts;
  const text = node.textContent.split(' reg#')[0];
  if (!regcountmaps[type][text])
    regcountmaps[type][text] = 0;

  const idx = ++regcountmaps[type][text];
  const counter = document.createElement("span");
  counter.className = "example__regcounter";
  counter.textContent = ' req#' + idx + " (" + type + ')';
  node.appendChild(counter);
}

if (location.href.includes('addseqnr=1')) {
  dompack.register(".selectlist__item", node => {
    if (!node.closest('.selectlist__area')) { //ensure that we have a predictable dom location
      console.error("Registering node in an unexpected dom location!", node);
      throw new Error(".selectlist__item not a child of selectlist__area!");
    }
    updateRegCount('item', node);
  });
  dompack.register(".selectlist__current", node => {
    if (!node.closest('.selectlist__control')) { //ensure that we have a predictable dom location
      console.error("Registering node in an unexpected dom location!", node);
      throw new Error(".selectlist__item not a child of selectlist__control!");
    }
    updateRegCount('current', node);
  });
}


dompack.register('select', node => new Pulldown(node));
dompack.register('input.directsuggest', node => new AutoSuggest(node, onDirectSuggest, { immediateresuggest: true }));
dompack.register('input.staticlistsuggest', node =>
  new AutoSuggest(node
    , new StaticSuggestionList(["Aap", "Alfa", "Noot", "Mies", "Spatie "], { casesensitive: ["1", "true"].includes(node.dataset.casesensitive) })
    , {
      minlength: parseInt(node.dataset.minlength),
      triminput: !["0", "false"].includes(node.dataset.triminput)
    }));

dompack.register('input.titleslistsuggest', node =>
  new AutoSuggest(node
    , new StaticSuggestionList([
      { value: "Do", append: "(waarop je 'n deksel doet)" },
      { value: "Re", append: "(die vind je in het woud)" },
      { value: "Mi", append: "(die steeds maar werken moet)" }
    ])
    , { minlength: 0 }));
dompack.onDomReady(pageinit);


///////////////////////////////////////////////////////////////////
//
// Dialogs
//
let dialogcount = 0;

dialogapi.setupDialogs(options => dialog.createDialog('mydialog', options));

async function doOpenDialog(evt, { noinputs, allowcancel } = {}) {
  dompack.stop(evt);

  const dialog = dialogapi.createDialog({ allowcancel: allowcancel !== false });
  const mydialognr = ++dialogcount;
  dialog.contentnode.innerHTML = `
    <div data-dialog-counter="${mydialognr}">
      <p>Dialog: <span class="dialogcounter">${mydialognr}</span> ${noinputs ? "" : `<input id="textedit${mydialognr}">`}</p>
      <button id="button_return1_${mydialognr}" class="return1">Return 1</button>
      <button id="button_returnyeey_${mydialognr}" class="returnyeey">Return 'yeey'</button>
      <button id="button_opendialog_${mydialognr}" class="opendialog">Open another!</button>
    </div>`;

  dialog.contentnode.querySelector('.return1').addEventListener("click", () => dialog.resolve(1));
  dialog.contentnode.querySelector('.returnyeey').addEventListener("click", () => dialog.resolve("yeey"));

  const response = await dialog.runModal();
  dompack.qS("#dialoglog").innerHTML += `<div class="dialoglogentry" data-for-dialog="${mydialognr}">Dialog ${mydialognr}: <span class="dialogresponse" data-for-dialog="${mydialognr}">${JSON.stringify(response)}</div>`;
}

//use mousedown so the buttons wont affect focus
dompack.register('.opendialog', node => node.addEventListener("mousedown", evt => doOpenDialog(evt)));
dompack.register('.opendialognoinputs', node => node.addEventListener("mousedown", evt => doOpenDialog(evt, { noinputs: true })));
dompack.register('.opendialognocancel', node => node.addEventListener("mousedown", evt => doOpenDialog(evt, { allowcancel: false })));


///////////////////////////////////////////////////////////////////
//
// Overlays
//

dompack.register(".withoverlays", (node, idx) => {
  const mybounds = { left: 0, top: 0, right: node.clientWidth - 1, bottom: node.clientHeight - 1 };
  const overlaymgr = new OverlayManager(node, "myoverlay", { bounds: mybounds, allowcreate: true });

  node.addEventListener('dompack:overlay-selectionchange', event => {
    dompack.qS('#selection').textContent = overlaymgr.getSelection().map(node => node.getContentNode().textContent).join(', ');
  });

  node.addEventListener('dompack:overlay-selectionchange', event => {
    const node = dompack.qS('#selectionchanges' + (event.detail.useraction ? 'user' : ''));
    node.textContent = (parseInt(node.textContent) || 0) + 1;
  });
  node.addEventListener('dompack:overlay-areachange', event => {
    const node = dompack.qS('#areachanges' + (event.detail.useraction ? 'user' : ''));
    node.textContent = (parseInt(node.textContent) || 0) + 1;
  });
  node.addEventListener('dompack:overlay-created', event => {
    const node = dompack.qS('#created');
    node.textContent = (parseInt(node.textContent) || 0) + 1;
  });

  const amiga = overlaymgr.addRectangle({ left: 5, top: 50, width: 50, height: 150 });
  amiga.getContentNode().append(dompack.create("span", { className: "overlaytitle", textContent: "Amiga" }));

  const apple = overlaymgr.addRectangle({ left: 45, top: 250, width: 400, height: 50 });
  apple.getContentNode().append(dompack.create("span", { className: "overlaytitle", textContent: "Apple" }));

  const atari = overlaymgr.addRectangle({ left: 380, top: 30, width: 80, height: 250 });
  atari.getContentNode().append(dompack.create("span", { className: "overlaytitle", textContent: "Atari" }));

  overlaymgr.setSelection([amiga]);

  window.overlaytests = { overlaymgr, amiga, apple, atari }; //allow tests to access us
  /*


    let myoverlay1 = new ResizeableOverlay(node, "myoverlays",
          { enabled: true
          , left: 5, top: 50, width: 50, height: 150, selected: true, title: "Amiga", bounds: mybounds
          });

    let myoverlay2 = new ResizeableOverlay(node, "myoverlays",
          { enabled: true
          , left: 45, top: 250, width: 400, height: 50, title: "Apple", bounds: mybounds
          });

    let myoverlay3 = new ResizeableOverlay(node, "myoverlays",
          { enabled: true
          , left: 380, top: 30, width: 80, height: 250, title: "Atari", bounds: mybounds, enabled: false
          });*/
});
