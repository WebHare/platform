
/* Regex to identify dimensionless style sttributes. copied from old version of preact/src/constants.js (MIT)
   meant to capture:
  { boxFlex:1, boxFlexGroup:1, columnCount:1, fillOpacity:1, flex:1, flexGrow:1,
    flexPositive:1, flexShrink:1, flexNegative:1, fontWeight:1, lineClamp:1, lineHeight:1,
    opacity:1, order:1, orphans:1, strokeOpacity:1, widows:1, zIndex:1, zoom:1
*/
const IS_NON_DIMENSIONAL = /acit|ex(?:s|g|n|p|$)|rph|ows|mnc|ntw|ine[ch]|zoo|^ord/i;

function generateInsertList(nodes)
{
  if(nodes.length==1)
    return typeof nodes[0]==='string' ? document.createTextNode(nodes[0]) : nodes[0];

  let frag = document.createDocumentFragment();
  nodes.forEach(node => frag.appendChild(typeof node === 'string' ? document.createTextNode(node) : node));
  return frag;
}

export function matches(node, selector)
{
  var tocall = node.matches || node.matchesSelector || node.msMatchesSelector || node.webkitMatchesSelector;
  //if none of the 'matches' was found, this might be a textnode or something. returning false is probably safest
  return tocall && tocall.apply(node, [selector]);
}
export function closest(node, selector)
{
  if(node.closest)
    return node.closest(selector);
  for(;node&&!matches(node,selector);node=node.parentElement)
    /*iterate*/;
  return node;
}
//implements contains. TODO we only really need this on IE11, which doesn't consider a text node a child, we can probably fall back to native elsewhere ?
export function contains(ancestor, child)
{
  for(;child;child=child.parentNode)
    if(child===ancestor)
      return true;
  return false;
}
//insert a range of nodes before a node: https://dom.spec.whatwg.org/#dom-childnode-before
export function before(node,...nodes)
{
  if(node.before)
  {
    node.before(...nodes);
    return;
  }
  if(node.parentNode)
    node.parentNode.insertBefore(generateInsertList(nodes), node);
}
//insert a range of nodes after a node: https://dom.spec.whatwg.org/#dom-childnode-after
export function after(node,...nodes)
{
  if(node.after)
  {
    node.after(...nodes);
    return;
  }
  if(node.parentNode)
    node.parentNode.insertBefore(generateInsertList(nodes), node.nextSibling);
}
//replace node with a set of nodes : https://dom.spec.whatwg.org/#dom-childnode-replacewith
export function replaceWith(node,...nodes)
{
  if(node.replaceWith)
  {
    node.replaceWith(...nodes);
    return;
  }
  if(node.parentNode)
    node.parentNode.replaceChild(generateInsertList(nodes), node);
}
//remove node with a set of nodes : https://dom.spec.whatwg.org/#dom-childnode-remove
export function remove(node)
{
  if(node.parentNode)
    node.parentNode.removeChild(node);
}
//insert nodes at start: https://dom.spec.whatwg.org/#dom-parentnode-prepend
export function prepend(node, ...nodes)
{
  node.insertBefore(generateInsertList(nodes), node.firstChild);
}
//insert nodes at end: https://dom.spec.whatwg.org/#dom-parentnode-append
export function append(node, ...nodes)
{
  node.appendChild(generateInsertList(nodes));
}
//replace all child nodes with a new list of child nodes: https://dom.spec.whatwg.org/#dom-parentnode-replacechildren
export function replaceChildren(node, ...nodes)
{
  node.innerHTML = "";
  append(node, ...nodes);
}

//offer toggleClass ourselves as IE11's native version is broken - does not understand the last parameter
/** Toggle a single class */
export function toggleClass(node, classname, settoggle)
{
  if (arguments.length === 2)
    node.classList.toggle(classname);
  else if (settoggle)
    node.classList.add(classname);
  else
    node.classList.remove(classname);
}

/** Toggle classes in a node
    @param node Node which classes to toggle
    @param toggles Object, all keys will be added/removed based on the truthyness of their values
*/
export function toggleClasses(node, toggles)
{
  if (typeof(toggles) !== "object")
    throw new Error("Expected an object with keys as classnames");
  Object.keys(toggles).forEach(key => node.classList[toggles[key] ? "add" : "remove"](key));
}

/* remove the contents of an existing node */
export function empty(node)
{
  //node.innerHTML=''; // this does NOT work for IE11, it destroys all nodes instead of unlinking them
  while(node.lastChild)
    node.removeChild(node.lastChild);
}

/** get the relative bound difference between two elements, and return a writable copy */
export function getRelativeBounds(node, relativeto)
{
  if(!relativeto)
    relativeto = node.ownerDocument.documentElement;

  var nodecoords = node.getBoundingClientRect();
  var relcoords = relativeto.getBoundingClientRect();
  return { top: nodecoords.top - relcoords.top
         , left: nodecoords.left - relcoords.left
         , right: nodecoords.right - relcoords.left
         , bottom: nodecoords.bottom - relcoords.top
         , width: nodecoords.width
         , height: nodecoords.height
         };
}

export function isDomReady()
{
  return document.readyState == "interactive" || document.readyState == "complete";
}

/* run the specified function 'on ready'. adds to DOMContentLoaded if dom is not ready yet. Exceptions from the ready handler will not be fatal to the rest of code execution */
export function onDomReady(callback)
{
  if(isDomReady())
  {
    try
    {
      callback();
    }
    catch(e)
    {
      console.error("Exception executing a domready handler");
      console.log(e,e.stack);

      if (window.onerror)
      {
        // Send to onerror to trigger exception reporting
        try
        {
          window.onerror(e.message, e.fileName || "", e.lineNumber || 1, e.columNumber || 1, e);
        }
        catch (e)
        {
        }
      }
    }
  }
  else
    document.addEventListener("DOMContentLoaded", callback);
}

//parse JSON data, throw with more info on parse failure
export function getJSONAttribute(node, attributename)
{
  try
  {
    return JSON.parse(node.getAttribute(attributename));
  }
  catch(e)
  {
    console.error("JSON parse failure on attribute '" +attributename+ "' of node", node);
    throw e;
  }
}

/** Get the base URI of the current document. IE11 doesn't implement document.baseURI
    @param doc Document to query. Defaults to window.document
*/
export function getBaseURI(doc)
{
  if(!doc)
    doc=window.document;
  if(doc.baseURI)
    return doc.baseURI;

  let base = doc.querySelector('base');
  if(base && base.href)
    return base.href;
  return doc.URL;
}

//queryselector quick wrapper
export function qS(node_or_selector, selector)
{
  if(typeof node_or_selector == 'string')
    return document.querySelector(node_or_selector);
  else
    return node_or_selector.querySelector(selector);
}

//queryselectorall quick wrapper
export function qSA(node_or_selector, selector)
{
  if(typeof node_or_selector == 'string')
    return Array.from(document.querySelectorAll(node_or_selector));
  else
    return Array.from(node_or_selector.querySelectorAll(selector));
}


/** Sets multiple styles on a node, automatically adding 'px' to numbers when appropriate
    (can be used as replacement for Mootools .setStyles)
*/
export function setStyles(node, value)
{
  if (!value || typeof value === 'string')
    node.style.cssText = value || '';
  else if (typeof value === 'object')
  {
    for (let i in value)
    {
      // for numbers, add 'px' if the constant isn't dimensionless (eg zIndex)
      node.style[i] = typeof value[i] === 'number' && IS_NON_DIMENSIONAL.test(i) === false
          ? value[i] + 'px'
          : value[i];
    }
  }
}
