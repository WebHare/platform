/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as domlevel from "./domlevel";
import { encodeString } from "@webhare/std";
import Range from './dom/range';

function getIndentedLineBreak(indent: number, incr?: number) {
  if (!indent) return '';
  indent += incr || 0;
  let result = '\n'; while (--indent) result += ' ';
  return result;
}

function getStructuredOuterHTML(node: Node, namedlocators: object, options?: number | boolean | { indent?: boolean; title?: string; colorize?: boolean }): string | string[] {
  if (typeof options === "number" || typeof options === "boolean")
    options = { indent: Boolean(options) };
  else
    options = options || {};

  const locators: Record<string, domlevel.Locator> = {};
  const indent = options?.indent ? 1 : 0;

  // Detect all locators & elements in namedlocators in the first 2 levels (array/record), move to single level object
  for (const [n, elt] of Object.entries(namedlocators)) {
    if (elt && typeof elt === "object") {
      if ("element" in elt)
        locators[n] = elt as domlevel.Locator;
      else if ("nodeType" in elt) {
        locators[n + '#elt'] = new domlevel.Locator(elt);
        locators[n + '#elt'].moveToParent();
      } else {
        for (const [m, subelt] of Object.entries(elt)) {
          if (subelt && typeof subelt === "object") {
            if ("element" in subelt)
              locators[n + '.' + m] = subelt as domlevel.Locator;
            else if ("nodeType" in subelt) {
              locators[n + '.' + m + '#elt'] = new domlevel.Locator(subelt);
              locators[n + '.' + m + '#elt'].moveToParent();
            } else {
              for (const [k, subsubelt] of Object.entries(subelt)) {
                if (subsubelt && typeof subsubelt === "object") {
                  if ("element" in subsubelt)
                    locators[n + '.' + m + '.' + k] = subsubelt as domlevel.Locator;
                  else if ("nodeType" in subsubelt) {
                    locators[n + '.' + m + '.' + k + '#elt'] = new domlevel.Locator(subsubelt as Node);
                    locators[n + '.' + m + '.' + k + '#elt'].moveToParent();
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (!node) {
    let min, max;
    for (const n of Object.keys(locators)) {
      const elt = locators[n];
      if (!min || min.compare(elt) > 0)
        min = elt;
      if (!max || max.compare(elt) < 0)
        max = elt;
    }
    if (!min || !max)
      throw new Error(`No locators provided`);
    const range = new Range(min, max);
    node = range.getAncestorElement();
  }

  let retval: string | string[] = '';
  if (node.parentNode) {
    const parent = node.parentNode;
    for (const n in locators)
      if (locators[n].element === parent && locators[n].offset < parent.childNodes.length && parent.childNodes[locators[n].offset] === node)
        retval += getLocatorText(n, locators[n]);
  }
  if (retval)
    retval += getIndentedLineBreak(indent);
  retval = retval + getStructuredOuterHTMLInternal(node, locators, indent);

  if (options.title)
    retval = options.title + " " + retval;
  if (options.colorize) {
    retval = ["%c" + retval.replace(/\(#/g, "%c(#").replace(/#\)/g, ")%c")];
    for (let i = 0, e = retval[0].split("%c").length - 1; i < e; ++i)
      retval.push((i % 2) === 0 ? "color:black;" : "color:red;");
  }
  return retval;
}

function getLocatorText(name, locator) {
  return '(#' + name + (locator.id ? '$' + locator.id + (locator.cc ? '/' + locator.cc : '') : '') + '#)';
}

function getNamedLocatorsText(namedlocators, node, offset, indent, incr) {
  let locatortext = '';
  for (const n in namedlocators)
    if (namedlocators[n].element === node && namedlocators[n].offset === offset)
      locatortext += getLocatorText(n, namedlocators[n]);

  if (locatortext && indent)
    locatortext = getIndentedLineBreak(indent, incr) + locatortext;

  return locatortext;
}

// Shows HTML structure, shows locators at their location
function getStructuredOuterHTMLInternal(node, namedlocators, indent) {
  if (!node)
    return '<undefined>';

  let retval = '';
  if (node.nodeType === 11 || node.nodeType === 9) {
    for (let i = 0; i < node.childNodes.length; ++i) {
      if (i !== 0 && !indent)
        retval += ' ';

      retval += getNamedLocatorsText(namedlocators, node, i, indent);
      retval += getIndentedLineBreak(indent);
      retval += getStructuredOuterHTMLInternal(node.childNodes[i], namedlocators, indent && indent + 1);
    }

    retval += getNamedLocatorsText(namedlocators, node, node.childNodes.length, indent);
    return retval;
  }
  if (node.nodeType === 1) {
    retval += '<' + encodeString(node.nodeName, 'attribute');
    for (let i = 0; i < node.attributes.length; ++i) {
      const attrvalue = String(node.attributes[i].value || node.attributes[i].nodeValue || '');
      if (attrvalue) {
        const attrname = String(node.attributes[i].nodeName);
        if (attrvalue.substr(0, 9) === "function (") // Readability for IE8
          continue;
        retval += ' ' + encodeString(attrname, 'attribute') + '="' + encodeString(attrvalue, 'attribute') + '"';
      }
    }

    if (node._xtest)
      retval += ':' + node._xtest;
    retval += '>';

    let nodecontents = '';
    for (let i = 0; i < node.childNodes.length; ++i) {
      if (i !== 0 && !indent)
        nodecontents += ' ';

      nodecontents += getNamedLocatorsText(namedlocators, node, i, indent, 1);
      nodecontents += getIndentedLineBreak(indent, 1);
      nodecontents += getStructuredOuterHTMLInternal(node.childNodes[i], namedlocators, indent && indent + 1);
    }

    nodecontents += getNamedLocatorsText(namedlocators, node, node.childNodes.length, indent, 1);

    retval += nodecontents;
    if (nodecontents)
      retval += getIndentedLineBreak(indent);
    return retval + '</' + encodeString(node.nodeName, 'attribute') + '>';
  }
  if (node.nodeType === 3 || node.nodeType === 4 || node.nodeType === 8) {
    if (node.nodeType === 3)
      retval += '#text:';
    if (node.nodeType === 4)
      retval += '#cdata:';
    if (node.nodeType === 8)
      retval += '#comment:';
    if (node._xtest)
      retval += node._xtest + ':';

    let text = '', intext = node.nodeValue; //use temp as accessing long nodeValues is slow on IE
    for (let i = 0; i < intext.length; ++i) {
      text += getNamedLocatorsText(namedlocators, node, i);
      text += intext.substr(i, 1);
    }
    text += getNamedLocatorsText(namedlocators, node, intext.length);
    const valenc = unescape(escape(encodeString(text, 'attribute')).split('%u').join('\\u').split('%A0').join('\\u00A0'));
    retval += '"' + valenc + '"';// + (valenc !== urienc ? ' - "' + urienc + '"' : '');
    return retval;
  }
  return node.nodeName;
}

function unstructureDom(node, locators) {
  locators = locators || [];
  let foundlocator = false;
  for (let i = 0; i < node.childNodes.length;) {
    const child = node.childNodes[i];

    if (child.nodeType !== 3) {
      unstructureDom(child, locators);
      ++i;
      continue;
    }

    const text = child.nodeValue;
    let result = null;
    let quoted = false;
    let locator = new domlevel.Locator(node, i);
    //var hadlocator = false;
    for (let a = 0; a < text.length;) {
      if (text.substr(a, 2) === '(*') {
        const endpos = text.indexOf('*)', a);

        const pos = parseInt(text.substring(a + 2, endpos));
        while (locators.length <= pos)
          locators.push(null);
        if (locators[pos])
          throw new Error("Included locator (*" + pos + "*) twice");
        locators[pos] = locator.clone();
        a = endpos + 2;
        foundlocator = true;
        continue;
      }
      if (text.substr(a, 1) === '"') {
        if (!quoted) {
          if (!(result === null)) {
            const next = child.nextSibling;
            const newnode = document.createTextNode(text.substr(a));
            if (next)
              node.insertBefore(newnode, next);
            else
              node.appendChild(newnode);
            break;
          }
          quoted = true;
          locator = new domlevel.Locator(child, 0);
          result = '';
        } else {
          quoted = false;
          locator = new domlevel.Locator(node, i + 1);
        }
        ++a;
        continue;
      }
      if (quoted) {
        result += text.substr(a, 1);
        ++locator.offset;
      } else
        throw new Error("Unquoted content! " + node.innerHTML);
      ++a;
    }

    if (quoted)
      throw new Error("Quotes not balanced: " + node.innerHTML);

    if (result === null)
      node.removeChild(child);
    else {
      child.nodeValue = result;
      ++i;
    }
  }

  // If we removed all the text content with the locators, add a br at the end of the node
  if (foundlocator && ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'blockquote', "li"].includes(node.nodeName.toLowerCase())) {
    const locator = new domlevel.Locator(node);
    const res = locator.scanForward(node, { whitespace: true }); // only whitespace?
    if (res.type === 'outerblock') {
      const br = node.ownerDocument.createElement('br');
      br.setAttribute("data-wh-rte", "bogus");
      locator.insertNode(br);
    }
  }

  return locators;
}

class SourceDebugger {
  constructor(rte, el, boxel) {
    this.rte = rte;
    this.el = el;
    this.boxel = boxel;
    this.editpr = null;
    this.rte.getBody().addEventListener("wh:richeditor-statechange", () => this.onStateChange());
  }
  refresh() {
    this.onStateChange(null);
  }
  onStateChange() {
    try {
      const editor = this.rte.getEditor();
      if (!editor)
        return;

      const range = editor.getSelectionRange();
      const orgrange = editor.debugGetRawSelectionRange() || range;

      const locators =
      {
        start: range.start,
        end: range.end
      };

      if (!orgrange.start.equals(range.start))
        locators.orgstart = orgrange.start;
      if (!orgrange.end.equals(range.end))
        locators.orgend = orgrange.end;

      const overlap = range.clone();
      if (overlap.start.compare(orgrange.start) > 0)
        overlap.start.assign(orgrange.start);
      if (overlap.end.compare(orgrange.end) < 0)
        overlap.end.assign(orgrange.end);

      this.el.value = getStructuredOuterHTML(overlap.getAncestorElement(), locators, true);

      const domrange = document.createRange();
      domrange.setStart(locators.start.element, locators.start.offset);
      domrange.setEnd(locators.end.element, locators.end.offset);
      const rangerect = domrange.getBoundingClientRect();
      const toshow = { left: rangerect.left, top: rangerect.top, right: rangerect.right, bottom: rangerect.bottom };
      this.boxel.value = JSON.stringify(toshow);
    } catch (e) {
      console.error(e);
      this.el.value = "Exception retrieving outerhtml " + e;
    }
  }
}


function getAllLocatorsInNode(node) {
  let list = [];
  if (node.nodeType === 3) {
    for (let i = 0; i <= node.nodeValue.length; ++i)
      list.push(new domlevel.Locator(node, i));
  } else {
    if (node.nodeName && ["br", "img", "svg"].includes(node.nodeName.toLowerCase()))
      return list;

    for (let i = 0; i <= node.childNodes.length; ++i) {
      list.push(new domlevel.Locator(node, i));
      if (node.childNodes[i])
        list = list.concat(getAllLocatorsInNode(node.childNodes[i]));
    }
  }
  return list;
}

function cloneNodeWithTextQuotesAndMarkedLocators(node, locators) {
  if (node.nodeType === 3) {
    let text = '"';
    for (let i = 0; i <= node.nodeValue.length; ++i) {
      for (let l = 0; l < locators.length; ++l)
        if (locators[l].element === node && locators[l].offset === i)
          text += '(*' + l + '*)';
      text += node.nodeValue.substr(i, 1);
    }
    return document.createTextNode(text + '"');
  }

  //  var nodes = [];
  const copy = node.cloneNode(false);
  if (domlevel.isEmbeddedObject(copy)) {
    copy.removeAttribute("contenteditable");
    return copy;
  }

  for (let i = 0; i <= node.childNodes.length; ++i) {
    for (let l = 0; l < locators.length; ++l)
      if (locators[l].element === node && locators[l].offset === i) {
        const text = '(*' + l + '*)';
        const textnode = document.createTextNode(text);
        copy.appendChild(textnode);
      }
    const child = node.childNodes[i];
    if (child)
      copy.appendChild(cloneNodeWithTextQuotesAndMarkedLocators(child, locators));
  }

  return copy;
}

export {
  getStructuredOuterHTML
  , SourceDebugger
  , unstructureDom
  , getAllLocatorsInNode
  , cloneNodeWithTextQuotesAndMarkedLocators
};
