import * as dompack from 'dompack';
import { qS } from 'dompack';
import { RTE } from '@mod-tollium/web/ui/components/richeditor';
var richdebug = require('@mod-tollium/web/ui/components/richeditor/internal/richdebug');
require('./page.css');
require('./menu.scss');

function reparent_rte()
{
  var saveholder = document.getElementById('holder');
  var holderparent = document.getElementById('holder').parentNode;

  holderparent.removeChild(saveholder);
  window.setTimeout( () => holderparent.appendChild(saveholder), 0);
}

window.reparent_rte = reparent_rte;

window.givefocus = function()
{
  window.rte.takeFocus();
};

window.delayedhide = function()
{
  window.delayedhide.count=5;
  delayedhidestep();
};

window.delayedhideandshow = function()
{
  window.delayedhideandshow.count=20;
  delayedhideandshowstep();
};

function delayedhidestep()
{
  if(--window.delayedhide.count>0)
  {
    qS('#delayedhidespan').firstChild.nodeValue='hide delay (' + window.delayedhide.count + ')';
    window.setTimeout(delayedhidestep,1000);
    return;
  }
  qS('#delayedhidespan').firstChild.nodeValue='hide delay';
  qS('#holder').style.display='none';
}

function delayedhideandshowstep()
{
  console.log(window.delayedhideandshow.count);
  if(--window.delayedhideandshow.count>10)
  {
    if (window.delayedhideandshow.count > 15)
      qS('#delayedhideandshowspan').firstChild.nodeValue='hide delay (' + (window.delayedhideandshow.count - 15) + ')';
    else
      qS('#delayedhideandshowspan').firstChild.nodeValue='show delay (' + (window.delayedhideandshow.count - 10) + ')';
    if (window.delayedhideandshow.count == 15)
      qS('#holder').style.display='none';
    window.setTimeout(delayedhideandshowstep,1000);
    return;
  }
  qS('#delayedhideandshowspan').firstChild.nodeValue='hide&show delay';
  qS('#holder').style.display='';
}

window.loadstore = function()
{
  qS('#store').value = window.rte.getValue();
};

window.savestore = function()
{
  window.rte.setValue(qS('#store').value);
};

window.showrendered = function()
{
  var html = qS('#store').value;
  var cd = qS('#result').contentDocument;
  if(!cd)
    cd = qS('#result').contentWindow.document;

  if(cd.body)
    cd.body.innerHTML = html;
};

/*
function doaprops(targetid, target)
{
  if(window.apropshandler)
    return window.apropshandler(targetid,target);

  console.log('doaprops',targetid,target);
}*/

function getStructure(type)
{
  var alltextstyles=["i","u","b","sub","sup","a-href","strike","img"];
  var structure = { blockstyles: [ { tag: "CONTENTTAB" /* put this before p.normal to test scoring */
                                   , textstyles: []
                                   , containertag: "P"
                                   , importfrom: ["h2.tab"]
                                   }
                                 , { tag: "HEADING1"
                                   , title: "Kop 1"
                                   , textstyles: ["i","u"]
                                   //ADDME textclasses, objects
                                   , toolbarcss: "font:bold 16px Verdana; color:#000000;"
                                   , containertag: "H1"
                                   , nextblockstyle: "HEADING2"
                                   }
                                 , { tag: "HEADING2"
                                   , title: "Kop 2"
                                   , textstyles: ["i","u"]
                                   //ADDME textclasses, objects
                                   , toolbarcss: "font:bold 14px Verdana; color:#000000;"
                                   , containertag: "H2"
                                   , nextblockstyle: "NORMAL"
                                   }
                                 , { tag :"NORMAL"
                                   , title: "Normaal"
                                   , textstyles: alltextstyles
                                   , containertag: "P"
                                   }
                                 , { tag: "MYSTYLE"
                                   , title: "MyCustomStyle"
                                   /*, css: "font-weight:bold;color:#ff0000;" ADDME:
                                                                               is dit wel wijsheid? je kunt nu </b> niet meer gebruiken om af te sluiten
                                                                               misschien moet je dat soort dingen eerder als 'default' aangeven ipv expliciet
                                                                               aan te zetten. of misschien is het wel onzin om het op deze manier te speciferen,
                                                                               als je fontweight wil vastzetten, haal b dan ook maar uit de toegestaane stijlen?
                                                                            */
                                   , textstyles: alltextstyles
                                   , containertag: "P"
                                   }
                                 , { tag: 'ORDERED'
                                   , title: 'Genummerde lijst'
                                   , textstyles: alltextstyles
                                   , containertag: 'OL'
                                   }
                                 , { tag: 'UNORDERED'
                                   , title: 'Ongenummerde lijst'
                                   , textstyles: ["i","u"]
                                   , containertag: 'UL'
                                   }
                                 , { tag: 'TABLE'
                                   , title: 'Tabel'
                                   , containertag: 'TABLE'
                                   , tabledefaultblockstyle: "MYSTYLE"
                                   , type: 'table'
                                   //, tableresizing: ["table","columns"] // Defaults to ["all"]
                                   }
                                 , { tag: 'language-harescript'
                                   , title: 'HareScript'
                                   , textstyles: []
                                   , containertag: 'CODE'
                                   }
                                 ]
                  , blocktypes: [ { namespaceuri: "urn:blockns"
                                  , type: "blockie"
                                  }
                                ]
                  , defaultblockstyle: "NORMAL"
                  , cellstyles: [ { tag: "", title: "Normal cell" }
                                , { tag: "RED", title: "Red Cell" }
                                , { tag: "BLUE", title: "Blue Cell" }
                                ]
                  , contentareawidth: type == 'structured-contentarea' ? "450px" : null
                  };

  return structure;
}

//var current_target = null;

function gotPropertiesEvent(event)
{
  if(event.detail.actiontarget)
  {
    let affectednodeinfo = event.detail.rte.getTargetInfo(event.detail.actiontarget);
    if(affectednodeinfo && affectednodeinfo.type == 'hyperlink' && !window.apropshandler)
    {
      event.preventDefault();
      let newurl = prompt("Update the url", affectednodeinfo.link);
      if(newurl !== null)
        event.detail.rte.updateTarget(event.detail.actiontarget, { link: newurl});
      return;
    }
  }

  var nodename = event.target.nodeName.toLowerCase();
  if(nodename == 'img')
  {
    event.preventDefault();
    if(window.imgpropshandler)
      return window.imgpropshandler(event.detail.targetid, event.target);

    console.log('doimgprops',event.detail.targetid, event.target);
    let newurl = prompt("Specify the new image url", event.target.src);
    if(newurl)
      window.rtecomp.getActionTarget(event.detail.targetid).src = newurl;
    return;
  }
  if(nodename == 'a')
  {
    event.preventDefault();
    if(window.apropshandler)
      return window.apropshandler(event.detail.targetid, event.target);

    console.log('doaprops', event.detail.targetid, event.target);
    return;
  }
}

window.destroy_rte = function()
{
  window.rte.destroy();
};

function onRTDAction(event)
{
  if(event.detail.action == 'action-properties')
  {
    gotPropertiesEvent(event);
    return;
  }
}

function initRTE()
{
  var editor = qS('#rtepart').getAttribute("data-editor");
  var allowtags = qS('#rtepart').getAttribute("data-allowtags").toLowerCase();

  qS('#copybutton').addEventListener("mousedown", evt =>
  {
    console.log("COPY BUTTON");
    evt.preventDefault(); //don't steal focus
    document.execCommand("copy");
  });
  qS('#pastebutton').addEventListener("mousedown", evt =>
  {
    console.log("PASTE BUTTON");
    evt.preventDefault(); //don't steal focus
    document.execCommand("paste");
  });

  //var csslinks = qS('#rtepart').getAttribute("data-rte-css").split(" ").include("editor.css");

/*  var actionopts =
      { allowed_objects:  (qS('#rtepart').getAttribute("data-allowedobjects") || '').split(' ')
      };*/

  const params = new URL(location.href).searchParams;
  var rteopts = { pageedit: editor == 'page'
                , selfedit: editor == 'self'
                , toolbarnode: document.getElementById('toolbar')
                , cssinstance: "wh-rtd-HASH"
                , jslinks: []
                , htmlclass: "html-class"
                , bodyclass: "body-class"
                , allowundo: true
                , enabled: params.get("disabled") != "true"
                , propertiesaction: true
                };

  if(params.get("toolbarlayout"))
  {
    //lines separated by |, groups seperated by /, controls separated by ,
    rteopts.toolbarlayout = params.get("toolbarlayout").split('|').map(_ => _.split('/').map(_ => _.split(',')));
  }

  if(allowtags)
  {
    rteopts.allowtags = allowtags!='-' ? allowtags.split(',') : [];
  }
  if(editor != 'free')
  {
    rteopts.structure = getStructure(editor);
  }
  else
  {
    rteopts.edittables = true;
  }
  if(editor == 'page')
  {
//    rteopts.
  }
  if(editor == 'self')
  {

  }

  var node = editor=="self" ? document.body : qS('#holder');
  let rte = window.rte = new RTE(node, rteopts);
  node.addEventListener("wh:richeditor-action", onRTDAction);

  window.sourcesyncer = new richdebug.SourceDebugger(rte, document.getElementById('sourcesync'), document.getElementById('rangebox'));
}

window.refreshdebug = function()
{
  window.sourcesyncer.refresh();
};
//console.log("*** addevent");

dompack.onDomReady(initRTE);
