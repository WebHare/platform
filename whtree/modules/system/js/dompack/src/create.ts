import { append, setStyles } from './tree';

declare global
{
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX
  {
    interface IntrinsicElements
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [eleName: string]: any;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CreateElementFunction = (attributes: { [key: string]: any }, _1?: null, _2?: null) => HTMLElement;

function flattenArray<T>(list: T[]): T[]
{
  return list.reduce((acc: T[], elt) => acc.concat(Array.isArray(elt) ? flattenArray(elt) : elt), []);
}

function setClassName(node: Element, value?: string | Array<string> | { [key: string]: boolean })
{
  if (!value)
    node.className = '';
  if (typeof value === 'string')
    node.className = value || '';
  else if (Array.isArray(value))
    node.className = value.filter(elt => elt && typeof elt === 'string').join(" ");
  else if (value instanceof Object)
  {
    let str = "";
    Object.keys(value).forEach((key, idx) => { if (value[key]) str += (idx ? " " : "") + key; });
    node.className = str;
  }
}

/**
     Matches non-first uppercase characters
    (when the second char is uppercases, the first char is passed too)
 */
const MATCH_UPCASE = /([A-Z])/g;
const MATCH_DASH_AND_CHAR = /-([a-zA-Z])/g;

/**
 Convert a camelCased identifier to a dashed string
 *
 * @param value identifier to convert
 */
export function toDashed(value: string)
{
  if (value)
    return (value.substring(0, 1) + value.substring(1).replace(MATCH_UPCASE, "-$1")).toLowerCase();
  return "";
}

/**
 Convert a dashed string to a camelCase identifier
 *
 * @param value identifier to convert
 */
export function toCamel(value: string)
{
  return value.replace(MATCH_DASH_AND_CHAR, (_, match_1) => match_1.toUpperCase());
}

function attrHasBooleanValue(propname: string)
{
  return ['disabled','checked','selected','readonly','multiple','ismap'].includes(propname);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createElement(elementname: string, attributes: { [key: string]: any }, toattrs: boolean)
{
  const node = document.createElement(elementname);
  if(attributes)
  {
    Object.keys(attributes).forEach(attrname =>
    {
      if(attrname == 'events')
        throw new Error("Use 'on' instead of 'events' in dompack.create");
      if(attrname == 'styles')
        throw new Error("Use 'style' instead of 'styles' in dompack.create");
      if(attrname == 'children')
      {
        // allow null 'children' property for jsxcreate, property delete is detrimental to performance.
        if (attributes[attrname])
          throw new Error("Use 'childNodes' instead of 'children' in dompack.create");
        return;
      }

      const value = attributes[attrname];

      if (attrname == 'on') //create event listeners
        return void Object.keys(value).forEach(eventname => node.addEventListener(eventname, value[eventname], false));
      else if (attrname.startsWith("on"))
        return void node.addEventListener(toDashed(attrname.substring(2)), value, false);

      if (attrname == "className" || attrname == "class")
      {
        if(node.className) // already modified the class?
          throw new Error("Specify either 'className' or 'class' to dompack.create, but not both");
        setClassName(node, value);
        return;
      }

      if(attrname == 'style')
        return void setStyles(node, value);

      if(attrname == 'dataset') //explicitly assign
        return void Object.assign(node[attrname], value);

      if(attrname == 'childNodes') //append as children
        return void append(node, ...attributes.childNodes.filter((child: Node | string | number | boolean | null) => child != null && child !== true && child !== false));

      if(toattrs && attrHasBooleanValue(attrname))
      {
        if(value)
          node.setAttribute(attrname,"");
        else
          node.removeAttribute(attrname);
        return;
      }

      if (toattrs && !attrname.startsWith("prop"))
      {
        if (value != null) // matches not null and not undefined
        {
          if (value && typeof value == "object")
            throw new Error("Cannot store non-null objects in attributes, use a property starting with 'prop'");
          node.setAttribute(attrname, attributes[attrname]);
        }
      }
      else
        node[attrname] = attributes[attrname];
    });
  }
  return node;
}

/* create elements. sets properties (not attributes!) immediately.
   everything inside 'on' is added as an addEventListener without capture
   everything inside 'childNodes' is appended to the node. nulls are ignored inside childNodes

   Examples:
   domtools.create("input", { type:"file", className: "myupload", style: { display: "none" }));

*/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function create(elementname: string, attributes: { [key: string]: any })
{
  return createElement(elementname, attributes, false);
}

/**
 Function to create for jsx, create elements directly (instead of virtual dom nodes).
 
    import * as dompack from 'dompack';
 
    /* @jsx dompack.jsxcreate *\/
    /* @jsxFrag dompack.jsxfragment *\/
    your code
 *
 * @param element Name of the element to create
 * @param {...any} childNodes Any child nodes to add immediately
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsxcreate(element: string | CreateElementFunction, attributes: { [key: string]: any }, ...childNodes: (Node | string | number)[])
{
  // Ensure attributes
  attributes = attributes || {};
  // Flatten childnodes arrays, convert numbers to strings. Also support children property (React uses that)
  let parts: (Node | string | number)[] = (attributes.childNodes || []).concat(attributes.children || []).concat(childNodes);
  if (attributes.children)
    attributes.children = null;
  parts = flattenArray(parts);
  parts = parts.map((elt) => typeof elt === "number" ? String(elt) : elt);
  // Create the element
  attributes.childNodes = parts;
  if (typeof element === "function")
    return element(attributes, null, null);
  return createElement(element, attributes, true);
}

export function jsxfragment(inp: Node)
{
  const frag = document.createDocumentFragment();
  frag.append(...inp.childNodes);
  return frag;
}
