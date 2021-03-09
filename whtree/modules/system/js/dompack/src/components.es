import * as domtree from './tree.es';
import * as domevents from './events.es';

let components = [];
const map = new WeakMap();


//is a node completely in the dom? if we can find a sibling anywhere, it must be closed
function isNodeCompletelyInDom(node)
{
  for(;node;node=node.parentNode)
    if(node.nextSibling)
      return true;
  return false;
}
function processRegistration(item, reg, domready)
{
  if(!domready && !isNodeCompletelyInDom(item))
    return; //not safe to register

  if (!map.has(item))
    map.set(item, [ reg.num ]);
  else
  {
    let list = map.get(item);
    if (list.includes(reg.num))
      return;
    list.push(reg.num);
  }
  reg.handler(item, reg.index++); //note: if an exception is reported from Object.handler,
}
function applyRegistration(reg, startnode)
{
  let domready = domtree.isDomReady();
  if(reg.afterdomready && !domready)
    return;

  let items = Array.from( (startnode || document).querySelectorAll(reg.selector));
  if(startnode && domtree.matches(startnode,reg.selector))
    items.unshift(startnode);

  items.forEach(item =>
  {
    try
    {
      processRegistration(item, reg, domready);
    }
    catch(e)
    {
      console.error("Exception handling registration of",item,"for rule",reg.selector);
      console.log("Registration",reg);
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
  });
}

/** getBoundingClientRect, but as a plain copyable object.. Debugging and other code often needs this
    @param node Node to query
    @param srcret Offset rectangle
    @return top,bottom,left,right,width,height like getBCR, but spreadable/assignable/copyable etc*/
export function getRect(node, srcrect)
{
  const bcr = node.getBoundingClientRect();
  let rect = { top: bcr.top
             , bottom: bcr.bottom
             , left: bcr.left
             , right: bcr.right
             , width: bcr.width
             , height: bcr.height
             };

  if(srcrect)
  {
    rect.top = rect.top - srcrect.top;
    rect.bottom = rect.bottom - srcrect.top;
    rect.left = rect.left - srcrect.left;
    rect.right = rect.right - srcrect.left;
  }
  return rect;
}

/* A focus implementation that allows the node to intercept focused, allowing eg
   radio/checkbox replacements to redirect focus but also explicitly preventing
   focus of a disabled element
   Returns true when the focus operation was successfull or handled by an event handler.
   @param node Node to focus
   @param options.preventScroll Prevent scroll to focused element
*/
export function focus(node, options)
{
  if(!domevents.dispatchCustomEvent(node, 'dompack:takefocus', { bubbles: true, cancelable: true, detail: {options} }))
    return true;

  if(node.disabled)
    return false;

  // IE likes to throw errors when setting focus
  try
  {
    node.focus(options);
  }
  catch(e)
  {
    return false;
  }
  return true;
}

/** A scrollintoview implementation that allows the scroll to be intercepted
    @return False if the event was cancelled, true otherwise */
export function scrollIntoView(node, options)
{
  options = {...options};
  let debugusingflag = options.debugusingflag;
  delete options.debugusingflag; //too bad we don't have destructuring yet ...

  if(debugusingflag)
    console.log(`[${debugusingflag}] dompack:scrollintoview event for node`,node,'at',getRect(node) ,'with options',options,' passed on to browser');

  if(!domevents.dispatchCustomEvent(node, 'dompack:scrollintoview', { bubbles: true, cancelable: true, detail: {options} }))
  {
    if(debugusingflag)
      console.log(`[${debugusingflag}] dompack:scrollintoview event was cancelled`);
    return false; //NOTE we used to return true if intereceptd or undefined if not, but the value was undocumented and it didn't really make sense that way... so now DOCUMTEND and FALSE...
  }

  if(debugusingflag)
    console.log(`[${debugusingflag}] dompack:scrollintoview event default action: node.scrollIntoView`);
  node.scrollIntoView(options);
  return true;
}

/** @short Register a component for auto-initialization.
    @param selector Selector the component must match
    @param handler Handler
    @param options Any unrecognized options are passed to the handler

    The handler will be invoked with two parameters
    - the node to register
    - the index of the node (a unique counter for this selector - first is 0) */

export function register(selector, handler, options)
{
  let newreg = { selector: selector
               , handler: handler
               , index: 0
               , num: components.length
               , afterdomready: !options || options.afterdomready
               };
  if(components.length==0 && !domtree.isDomReady()) //first component... we'll need a ready handler
    domtree.onDomReady(() => registerMissed());

  components.push(newreg);
  applyRegistration(newreg, null);
}

// register any components we missed on previous scans
export function registerMissed(startnode)
{
  let todo = components.slice(0);
  todo.forEach(item => applyRegistration(item, startnode));
}
