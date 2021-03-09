import './dompackexample.scss';

import * as dompack from "dompack";
import Pulldown from "dompack/components/pulldown/index.es";
import AutoSuggest from "dompack/components/autosuggest/index.es";
import StaticSuggestionList from "dompack/components/autosuggest/staticlist.es";
import * as dialog from 'dompack/components/dialog/index.es';
import * as dialogapi from 'dompack/api/dialog.es';

function fillRidiculous()
{
  dompack.empty(dompack.qS('#ridiculous'));
  dompack.qS('#ridiculous').appendChild(dompack.create("option", { selected: true, disabled: true, textContent:'Many' }));
  for(var i = 1; i < 360; ++i)
  {
    let node = dompack.create("option", { value: i, textContent: "item " + i});
    dompack.qS('#ridiculous').appendChild(node);
  }
}
function refillJustenough()
{
  dompack.empty(dompack.qS('#justenoughselect'));
  dompack.qS('#justenoughselect').appendChild(dompack.create('option', { selected: true
                                                               , disabled: true
                                                               , textContent: 'Just Enough'
                                                               }));
  ["can't","get","it","though"].forEach(function(text)
  {
    dompack.qS('#justenoughselect').appendChild(dompack.create('option', { value:text, textContent: text}));
  });
}
function makeScrollable()
{
  console.log("makeScrollable");
  document.body.style.height = (window.innerHeight*3)+'px';
}
function toggleClass()
{
  console.log("toggleClass");
  dompack.qS("#togglethisclass").classList.toggle("copytoggle");
}
function pageinit()
{
  if(dompack.qS('#refill_justenough'))
  {
    dompack.qS('#refill_justenough').addEventListener("click", refillJustenough);
    dompack.qS('#fillridiculous').addEventListener("click", fillRidiculous);
    dompack.qS('#scrollable').addEventListener("click", makeScrollable);
    if(dompack.qS('#toggleclass'))
      dompack.qS('#toggleclass').addEventListener("click", toggleClass);
  }

/*
  dompack.qS('#ridiculousbottom').empty();
  dompack.qS('#ridiculousbottom').adopt(new Element("option", { selected: 'selected'
                                                    , disabled: 'disabled'
                                                    , text:'Many'}));
  for(var i = 1; i < 30; i++)
  {
    dompack.qS('#ridiculousbottom').adopt(new Element("option", { value: i
                                                  , text: "item " + i}));
  }
  dompack.qS('#ridiculousbottom').fireEvent('wh-refresh');
*/
}


function onDirectSuggest(inword)
{
  if(inword.includes('-'))
    return [];
  return "123456789_.".split("").map(char => inword + char);
}

var regcountmaps = { item: [], current: [] };

function updateRegCount(type, node)
{
  //strip any reg# from the text, so we have a unique key into our regcounts;
  let text = node.textContent.split(' reg#')[0];
  if(!regcountmaps[type][text])
    regcountmaps[type][text] = 0;

  let idx = ++regcountmaps[type][text];
  let counter = document.createElement("span");
  counter.className="example__regcounter";
  counter.textContent = ' req#' + idx + " (" + type + ')';
  node.appendChild(counter);
}

dompack.initDebug();

if(location.href.includes('addseqnr=1'))
{
  dompack.register(".selectlist__item", node =>
    {
      if(!dompack.closest(node, '.selectlist__area'))
      { //ensure that we have a predictable dom location
        console.error("Registering node in an unexpected dom location!",node);
        throw new Error(".selectlist__item not a child of selectlist__area!");
      }
      updateRegCount('item',node);
    });
  dompack.register(".selectlist__current", node =>
    {
      if(!dompack.closest(node, '.selectlist__control'))
      { //ensure that we have a predictable dom location
        console.error("Registering node in an unexpected dom location!",node);
        throw new Error(".selectlist__item not a child of selectlist__control!");
      }
      updateRegCount('current',node);
    });
}


dompack.register('select', node => new Pulldown(node));
dompack.register('input.directsuggest', node => new AutoSuggest(node, onDirectSuggest, { immediateresuggest: true }));
dompack.register('input.staticlistsuggest', node =>
  new AutoSuggest(node
                 , new StaticSuggestionList(["Aap","Alfa","Noot","Mies","Spatie "], { casesensitive: ["1","true"].includes(node.dataset.casesensitive) })
                 , { minlength: parseInt(node.dataset.minlength)
                   , triminput: !["0","false"].includes(node.dataset.triminput)
                   } ));

dompack.register('input.titleslistsuggest', node =>
  new AutoSuggest(node
                 , new StaticSuggestionList([ { value: "Do", append: "(waarop je 'n deksel doet)" }
                                            , { value: "Re", append: "(die vind je in het woud)" }
                                            , { value: "Mi", append: "(die steeds maar werken moet)" }
                                            ])
                 , { minlength: 0
                   } ));
dompack.onDomReady(pageinit);


///////////////////////////////////////////////////////////////////
//
// Dialogs
//
let dialogcount = 0;

dialogapi.setupDialogs(options => dialog.createDialog('mydialog', options));

dompack.register('.opendialog', node => node.addEventListener("click", async function(evt)
  {
    dompack.stop(evt);

    let dialog = dialogapi.createDialog();
    let mydialognr = ++dialogcount;
    dialog.contentnode.innerHTML = `
      <div data-dialog-counter="${mydialognr}">
        <p>Dialog: <span class="dialogcounter">${mydialognr}</span> <input name="textedit${mydialognr}"/></p>
        <button class="return1">Return 1</button>
        <button class="returnyeey">Return 'yeey'</button>
        <button class="opendialog">Open another!</button>

      </div>`;

    dialog.contentnode.querySelector('.return1').addEventListener("click", () => dialog.resolve(1));
    dialog.contentnode.querySelector('.returnyeey').addEventListener("click", () => dialog.resolve("yeey"));

    let response = await dialog.runModal();
    dompack.qS("#dialoglog").innerHTML += `<div class="dialoglogentry" data-for-dialog="${mydialognr}">Dialog ${mydialognr}: <span class="dialogresponse" data-for-dialog="${mydialognr}">${JSON.stringify(response)}</div>`;
  }));
