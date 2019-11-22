/** @require: var domtemplate = require('@mod-system/js/dom/template');
    @private FIXME we should probably get rid of this library, it's very custom and doesn't add much above <template> and JSX ?
*/
import * as dompack from 'dompack';
import * as whintegration from '@mod-system/js/wh/integration';

function setTextWithLinefeeds(node, message)
{
  message.split("\n").forEach(function(line,idx)
  {
    if(idx==0)
    {
      node.textContent=line;
    }
    else
    {
      node.appendChild(dompack.create("br"));
      node.appendChild(document.createTextNode(line));
    }
  });
}

// IE compatibility code

function cloneDeep(node, appendto)
{
  for(node=node.firstChild;node;node=node.nextSibling)
  {
    var clone = node.cloneNode(false);
    cloneDeep(node, clone);
    appendto.appendChild(clone);
  }
}

function getContent()
{
  var frag = this.ownerDocument.createDocumentFragment();
  cloneDeep(this, frag);
  return frag;
}

function iterateNode(data, node)
{
  var list = data[node.getAttribute('data-template-iterate')];
  node.removeAttribute('data-template-iterate');

  var copies=[];
  Array.from(list).forEach(function(item)
  {
    var copy = node.cloneNode(true);
    expandNode(item, copy);
    while(copy.firstChild)
    {
      copies.push(copy.firstChild);
      copy.removeChild(copy.firstChild);
    }
  });
  dompack.empty(node);
  copies.forEach(copy => node.appendChild(copy));
}
function repeatNode(data, node, isrepeat)
{
  var list = data[node.getAttribute('data-template-repeat')];
  node.removeAttribute('data-template-repeat');

  Array.from(list).forEach(function(item)
  {
    var copy = node.cloneNode(true);
    expandNode(item, copy);
    node.parentNode.insertBefore(copy,node);
  });
  node.parentNode.removeChild(node);
}

function decodeSets(instr, data)
{
  if(instr==="this")
    return data;
  if(typeof instr == "string")
    return data[instr];

  var retval = {};
  Object.keys(instr).forEach(key =>
  {
    var subval = decodeSets(instr[key], data);
    if(subval == undefined)
      return;
    retval[key] = subval;
  });
  return retval;
}

function expandTemplateContent(clonednode, data, __originalbasenode) //originalbasenode is not an official parameter
{
  if(! ("rangestart" in clonednode)) //receiving direct node
  {
    if(dompack.debugflags.tpl)
      console.log("[tpl] Instantiating node", __originalbasenode || clonednode,"with",data);
    expandNode(data, clonednode);
  }
  else
  {
    var next;
    if(dompack.debugflags.tpl)
      if(__originalbasenode)
        console.log("[tpl] Instantiating node",__originalbasenode,"with",data);
      else if(clonednode.rangelimit)
        console.log("[tpl] Instantiating range [",clonednode.rangestart,"-",clonednode.rangelimit,"[ with",data);
      else
        console.log("[tpl] Instantiating range [",clonednode.rangestart,"...] with",data);

    for(var node = clonednode.rangestart; node && node != clonednode.rangelimit; node = next)
    {
      next = node.nextSibling;
      expandNode(data,node);
    }
  }
}
function expandNode(data, node)
{
  if(node.hasAttribute)
  {
    //note, repeat runs BEFORE all other handlers, so a data-template-set combined with repeat refers to the iterated data, with iterate to the current data.
    if(node.hasAttribute('data-template-repeat'))
    {
      repeatNode(data, node);
      return;
    }
    if(node.hasAttribute('data-template-set'))
    {
      var instructions = dompack.getJSONAttribute(node, "data-template-set");
      var toset = decodeSets(instructions, data);
      if(toset.textContentBR) //apply with linefeeds
      {
        setTextWithLinefeeds(node, toset.textContentBR + '');//force to string incase of number
        delete toset.textContentBR;
      }
      ['style','dataset'].forEach(deepkey =>
      {
        if(toset[deepkey])
        {
          Object.assign(node[deepkey], toset[deepkey]);
          delete toset[deepkey];
        }
      });
      Object.assign(node, toset); //FIXME moo dependency!
      node.removeAttribute("data-template-set");
    }
    if(node.hasAttribute('data-template-if'))
    {
      var tocheck = node.getAttribute("data-template-if").split(" ");
      // If field is prefixed with "!", the field should NOT be present/filled
      if(tocheck.some(function(field) { return field && ((field[0] != "!" && !data[field])
                                                        || (field[0] == "!" && data[field.substr(1)])); }))
      {
        node.parentNode.removeChild(node);
        return;
      }
      else
        node.removeAttribute("data-template-if");
    }
    if(node.hasAttribute('data-template-store'))
      throw new Error("data-template-store is no longer supported");
    if(node.hasAttribute('data-template-iterate'))
      iterateNode(data, node);
  }

  var subnode = node.firstChild;
  while(subnode)
  {
    var nextnode = subnode.nextSibling;
    expandNode(data, subnode);
    subnode=nextnode;
  }

  if(node.hasAttribute && node.parentNode && node.hasAttribute('data-template-flatten'))
  {
    while(node.firstChild)
      node.parentNode.insertBefore(node.firstChild, node);
    node.parentNode.removeChild(node);
  }
}
function importTemplate(doc, templatenode)
{
  //ADDME: Use getContent directly if the polyfill hasn't been called yet (domready race)
  let content = templatenode.content;
  if (!content)
    content = getContent.apply(templatenode);
  return doc.importNode(content, true);
}
function instantiateTemplate(templatenode, data)
{
  var fragment = templatenode.ownerDocument.importNode(templatenode.content, true);
  expandTemplateContent({ rangestart: fragment.firstChild }, data, templatenode); //pass the original node for easier debugging
  return fragment;
}
function expandTemplate(templatenode, data, options)
{
  if(data instanceof Array) //ADDME create one big fragment and insert in one chunk
  {
    data.forEach(el => expandTemplate(templatenode, el, options));
    return;
  }

  let clone = templatenode.content.cloneNode(true);
  let toinform = null;
  let range;
  if(options && options.injectinto)
  {
    beforemarker = options.injectinto.lastChild;
    options.injectinto.appendChild(clone);
    toinform = options.injectinto;
    range = { rangestart: beforemarker ? beforemarker.nextSibling : options.injectinto.firstChild
            , rangelimit: beforemarker
            };
  }
  else
  {
    var beforemarker = templatenode.previousSibling;
    templatenode.parentNode.insertBefore(clone, templatenode);
    toinform = templatenode.parentNode;
    range = { rangestart: beforemarker ? beforemarker.nextSibling : templatenode.parentNode.firstChild
            , rangelimit: templatenode
            };
  }

  expandTemplateContent(range, data);

  dompack.dispatchCustomEvent(toinform, "wh:template-expandedchild", //replaceablecomponents listens for this
        { bubbles: false
        , cancelable: true
        });
}

module.exports = { importTemplate: importTemplate
                 , expandTemplate: expandTemplate
                 , expandTemplateContent: expandTemplateContent
                 , instantiate: instantiateTemplate
                 };

if(!whintegration.config.islive)
{
  console.warn("domtemplate.js has been deprecated and should not be used for new projects");
  console.log("We recommend using either content.cloneNode(true) on <template> (we auto polyfill that for IE11) or using JSX");
}
