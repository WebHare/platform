import * as domtree from './tree';
import * as domevents from './events';

type RegistrationHandler = (node: Element, index?: number) => void;
type ComponentRegistration =
{
  selector: string;
  handler: RegistrationHandler;
  index: number;
  num: number;
  afterdomready: boolean;
};

let components: ComponentRegistration[] = [];
const map = new WeakMap();

//is a node completely in the dom? if we can find a sibling anywhere, it must be closed
function isNodeCompletelyInDom(node: Element | null)
{
  for(;node;node=node.parentElement)
    if(node.nextSibling)
      return true;
  return false;
}
function processRegistration(item: Element, reg: ComponentRegistration, domready: boolean)
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
function applyRegistration(reg: ComponentRegistration, startnode?: Element)
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
      if (e instanceof Error)
      {
        console.log(e,e.stack);
        if (window.onerror)
        {
          // Send to onerror to trigger exception reporting
          try
          {
            // @ts-ignore fileName, lineNumber and columnNumber are non-standard
            window.onerror(e.message, e.fileName || "", e.lineNumber || 1, e.columNumber || 1, e);
          }
          catch(e){}
        }
      }
      else
        console.log(e);
    }
  });
}

/* A focus implementation that allows the node to intercept focused, allowing eg
   radio/checkbox replacements to redirect focus but also explicitly preventing
   focus of a disabled element
   Returns true when the focus operation was successfull or handled by an event handler.
   @param node Node to focus
   @param options.preventScroll Prevent scroll to focused element
*/
export function focus(node: Element, options?: FocusOptions)
{
  if(!domevents.dispatchCustomEvent(node, 'dompack:takefocus', { bubbles: true, cancelable: true, detail: {options} }))
    return true;

  if(typeof (node as any).focus !== "function" || (node as HTMLInputElement).disabled)
    return false;

  (node as HTMLInputElement).focus(options);
  return true;
}

/** @deprecated invoke scrollIntoView directly  on the nodes */
export function scrollIntoView(node: Element, options: ScrollIntoViewOptions)
{
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

export function register(selector: string, handler: RegistrationHandler, options?: { afterdomready: boolean })
{
  const newreg: ComponentRegistration =
    { selector: selector
    , handler: handler
    , index: 0
    , num: components.length
    , afterdomready: !options || options.afterdomready
    };
  if(components.length==0 && !domtree.isDomReady()) //first component... we'll need a ready handler
    domtree.onDomReady(() => registerMissed());

  components.push(newreg);
  applyRegistration(newreg);
}

// register any components we missed on previous scans
export function registerMissed(startnode?: Element)
{
  let todo = components.slice(0);
  todo.forEach(item => applyRegistration(item, startnode));
}
