/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from 'dompack';
import { qS } from 'dompack';
import * as rteapi from '@mod-tollium/web/ui/components/richeditor';
import type { ExternalStructureDef } from '@mod-tollium/web/ui/components/richeditor/internal/parsedstructure';
import StructuredEditor from '@mod-tollium/web/ui/components/richeditor/internal/structurededitor';
const richdebug = require('@mod-tollium/web/ui/components/richeditor/internal/richdebug');
require('./page.css');
require('./menu.scss');

function reparent_rte() {
  const saveholder = document.getElementById('holder');
  const holderparent = document.getElementById('holder').parentNode;

  holderparent.removeChild(saveholder);
  window.setTimeout(() => holderparent.appendChild(saveholder), 0);
}

window.reparent_rte = reparent_rte;

window.givefocus = function () {
  window.rte.takeFocus();
};

window.delayedhide = function () {
  window.delayedhide.count = 5;
  delayedhidestep();
};

window.delayedhideandshow = function () {
  window.delayedhideandshow.count = 20;
  delayedhideandshowstep();
};

function delayedhidestep() {
  if (--window.delayedhide.count > 0) {
    qS('#delayedhidespan').firstChild.nodeValue = 'hide delay (' + window.delayedhide.count + ')';
    window.setTimeout(delayedhidestep, 1000);
    return;
  }
  qS('#delayedhidespan').firstChild.nodeValue = 'hide delay';
  qS('#holder').style.display = 'none';
}

function delayedhideandshowstep() {
  console.log(window.delayedhideandshow.count);
  if (--window.delayedhideandshow.count > 10) {
    if (window.delayedhideandshow.count > 15)
      qS('#delayedhideandshowspan').firstChild.nodeValue = 'hide delay (' + (window.delayedhideandshow.count - 15) + ')';
    else
      qS('#delayedhideandshowspan').firstChild.nodeValue = 'show delay (' + (window.delayedhideandshow.count - 10) + ')';
    if (window.delayedhideandshow.count === 15)
      qS('#holder').style.display = 'none';
    window.setTimeout(delayedhideandshowstep, 1000);
    return;
  }
  qS('#delayedhideandshowspan').firstChild.nodeValue = 'hide&show delay';
  qS('#holder').style.display = '';
}

window.loadstore = function () {
  qS('#store').value = window.rte.getValue();
};

window.savestore = function () {
  window.rte.setValue(qS('#store').value);
};

window.showrendered = function () {
  const html = qS('#store').value;
  let cd = qS('#result').contentDocument;
  if (!cd)
    cd = qS('#result').contentWindow.document;

  if (cd.body)
    cd.body.innerHTML = html;
};

function getStructure(type) {
  const params = new URL(location.href).searchParams;
  const alltextstyles = ["i", "u", "b", "sub", "sup", "a-href", "strike", "img"];
  const alllinks = type === "structured-all-links" ? ["a-href"] : [];
  const structure: ExternalStructureDef = {
    blockstyles: [
      {
        tag: "CONTENTTAB", /* put this before p.normal to test scoring */
        textstyles: alllinks,
        containertag: "P",
        importfrom: ["h2.tab"]
      },
      {
        tag: "HEADING1",
        title: "Kop 1",
        textstyles: ["i", "u", ...alllinks],
        //ADDME textclasses, objects
        containertag: "H1",
        nextblockstyle: "HEADING2"
      },
      {
        tag: "HEADING2",
        title: "Kop 2",
        textstyles: ["i", "u", ...alllinks],
        //ADDME textclasses, objects
        containertag: "H2",
        nextblockstyle: "NORMAL"
      },
      {
        tag: "HEADING2B",
        title: "Kop 2B",
        textstyles: ["b", "i", ...alllinks],
        //ADDME textclasses, objects
        containertag: "H2",
        nextblockstyle: "NORMAL"
      },
      {
        tag: "NORMAL",
        title: "Normaal",
        textstyles: alltextstyles,
        containertag: "P"
      },
      {
        tag: "MYSTYLE",
        title: "MyCustomStyle",
        /*, css: "font-weight:bold;color:#ff0000;" ADDME:
                                                    is dit wel wijsheid? je kunt nu </b> niet meer gebruiken om af te sluiten
                                                    misschien moet je dat soort dingen eerder als 'default' aangeven ipv expliciet
                                                    aan te zetten. of misschien is het wel onzin om het op deze manier te speciferen,
                                                    als je fontweight wil vastzetten, haal b dan ook maar uit de toegestaane stijlen?
                                                 */
        textstyles: alltextstyles,
        containertag: "P"
      },
      {
        tag: 'ORDERED',
        title: 'Genummerde lijst',
        textstyles: alltextstyles,
        containertag: 'OL'
      },
      {
        tag: 'UNORDERED',
        title: 'Ongenummerde lijst',
        textstyles: ["i", "u", ...alllinks],
        containertag: 'UL'
      },
      {
        type: 'table',
        tag: 'TABLE',
        title: 'Tabel',
        containertag: 'TABLE',
        tabledefaultblockstyle: "MYSTYLE",
        ...(params.get("limittablestyles") ? {
          allowstyles: ["NORMAL", "MYSTYLE"],
          allowwidgets: false
        } : {})
      },
      {
        tag: 'language-harescript',
        title: 'HareScript',
        textstyles: alllinks,
        containertag: 'CODE'
      }
    ],
    defaultblockstyle: "NORMAL",
    cellstyles: [
      { tag: "", title: "Normal cell" },
      { tag: "RED", title: "Red Cell" },
      { tag: "BLUE", title: "Blue Cell" }
    ],
    contentareawidth: type === 'structured-contentarea' ? "450px" : null
  };

  if (params.get("notablestyle"))
    structure.blockstyles = structure.blockstyles.filter(_ => _.type !== "table");

  return structure;
}

//var current_target = null;

function gotPropertiesEvent(event) {
  if (event.detail.actiontarget) {
    const affectednodeinfo = rteapi.getTargetInfo(event.detail.actiontarget);
    if (affectednodeinfo && affectednodeinfo.type === 'hyperlink') {
      event.preventDefault();
      if (window.apropshandler)
        return window.apropshandler(event.detail.targetid, event.target);

      const newurl = prompt("Update the url", affectednodeinfo.link);
      if (newurl !== null)
        event.detail.rte.updateTarget(event.detail.actiontarget, { link: newurl });
      return;
    }
    if (affectednodeinfo && affectednodeinfo.type === 'img') {
      event.preventDefault();
      if (window.imgpropshandler)
        return window.imgpropshandler(event.detail.targetid, event.target);

      console.log('doimgprops', event.detail.targetid, event.target);
      const newurl = prompt("Specify the new image url", event.target.src);
      if (newurl)
        window.rtecomp.getActionTarget(event.detail.targetid).src = newurl;
      return;
    }
  }
}

function onRTDAction(event) {
  if (event.detail.action === 'action-properties') {
    gotPropertiesEvent(event);
    return;
  }
}

function initRTE() {
  const editor = qS('#rtepart').getAttribute("data-editor");
  const allowtags = qS('#rtepart').getAttribute("data-allowtags").toLowerCase();

  qS('#copybutton').addEventListener("mousedown", evt => {
    console.log("COPY BUTTON");
    evt.preventDefault(); //don't steal focus
    document.execCommand("copy");
  });
  qS('#pastebutton').addEventListener("mousedown", evt => {
    console.log("PASTE BUTTON");
    evt.preventDefault(); //don't steal focus
    document.execCommand("paste");
  });

  const params = new URL(location.href).searchParams;
  const rteopts = {
    toolbarnode: document.getElementById('toolbar'),
    cssinstance: "wh-rtd-HASH",
    jslinks: [],
    htmlclass: "html-class",
    bodyclass: "body-class",
    allowundo: true,
    enabled: params.get("disabled") !== "true",
    propertiesaction: true
  };

  if (params.get("toolbarlayout")) {
    //lines separated by |, groups seperated by /, controls separated by ,
    rteopts.toolbarlayout = params.get("toolbarlayout").split('|').map(_ => _.split('/').map(_ => _.split(',')));
  }

  if (allowtags) {
    rteopts.allowtags = allowtags !== '-' ? allowtags.split(',') : [];
  }
  if (editor !== 'free') {
    rteopts.structure = getStructure(editor);
  } else {
    rteopts.edittables = true;
  }

  const node = qS('#holder');
  const rte = window.rte = rteapi.createRTE(node, rteopts);
  node.addEventListener("wh:richeditor-action", onRTDAction);

  window.sourcesyncer = new richdebug.SourceDebugger(rte, document.getElementById('sourcesync'), document.getElementById('rangebox'));
}

window.refreshdebug = function () {
  window.sourcesyncer.refresh();
};
//console.log("*** addevent");

dompack.register("#showbutton", node => node.addEventListener("click", event => {
  dompack.stop(event);
  document.getElementById('holder').style.display = '';
}));

dompack.register("#hidebutton", node => node.addEventListener("click", event => {
  dompack.stop(event);
  document.getElementById('holder').style.display = 'none';
}));

dompack.register("#delayedhidespan", node => node.addEventListener("click", event => {
  dompack.stop(event);
  window.delayedhide();
}));

dompack.register("#delayedhideandshowspan", node => node.addEventListener("click", event => {
  dompack.stop(event);
  window.delayedhideandshow();
}));

dompack.register("#reparentbutton", node => node.addEventListener("click", event => {
  dompack.stop(event);
  reparent_rte();
}));

dompack.register("#givefocusbutton", node => node.addEventListener("click", event => {
  dompack.stop(event);
  window.givefocus();
}));

dompack.register("#enablebutton", node => node.addEventListener("click", event => {
  dompack.stop(event);
  window.rte.setEnabled(true);
}));

dompack.register("#disablebutton", node => node.addEventListener("click", event => {
  dompack.stop(event);
  window.rte.setEnabled(false);
}));

dompack.register("#readonlybutton", node => node.addEventListener("click", event => {
  dompack.stop(event);
  window.rte.setReadonly(true);
}));

dompack.register("#readwritebutton", node => node.addEventListener("click", event => {
  dompack.stop(event);
  window.rte.setReadonly(false);
}));

dompack.register("#loadstorebutton", node => node.addEventListener("click", event => {
  dompack.stop(event);
  window.loadstore();
}));

dompack.register("#savestorebutton", node => node.addEventListener("click", event => {
  dompack.stop(event);
  window.savestore();
}));

dompack.register("#showrenderedbutton", node => node.addEventListener("click", event => {
  dompack.stop(event);
  window.showrendered();
}));

dompack.register("#refreshdebugbutton", node => node.addEventListener("click", event => {
  dompack.stop(event);
  window.refreshdebug();
}));

dompack.onDomReady(initRTE);
