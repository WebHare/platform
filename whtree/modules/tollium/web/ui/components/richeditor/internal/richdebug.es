import * as domlevel from "./domlevel";
import * as texttype from 'dompack/types/text';

function getIndentedLineBreak(indent, incr)
{
  if (!indent) return '';
  indent += incr || 0;
  var result = '\n';while(--indent)result+=' ';
  return result;
}

function getStructuredOuterHTML(node, namedlocators, options)
{
  if (typeof options === "number")
    options = { indent: options };
  else
    options = options || {};

  var locators = {};
  var indent = options.indent?1:0;

  // Detect all locators & elements in namedlocators in the first 2 levels (array/record), move to single level object
  for (var n in namedlocators)
  {
    let elt = namedlocators[n];
    if (elt && typeof elt == "object")
    {
      if (elt.element)
        locators[n] = elt;
      else if (elt.nodeType)
      {
        locators[n+'#elt'] = new domlevel.Locator(elt);
        locators[n+'#elt'].moveToParent();
      }
      else
      {
        for (var m in elt)
        {
          if (elt[m] && typeof elt[m] == "object")
          {
            if (elt[m].element)
              locators[n+'.'+m] = elt[m];
            else if (elt[m].nodeType)
            {
              locators[n+'.'+m+'#elt'] = new domlevel.Locator(elt[m]);
              locators[n+'.'+m+'#elt'].moveToParent();
            }
            else
            {
              var subelt = elt[m];
              for (var k in subelt)
              {
                if (subelt[k] && typeof subelt[k] == "object")
                {
                  if (subelt[k].element)
                    locators[n+'.'+m+'.'+k] = subelt[k];
                  else if (subelt[k].nodeType)
                  {
                    locators[n+'.'+m+'.'+k+'#elt'] = new domlevel.Locator(subelt[k]);
                    locators[n+'.'+m+'.'+k+'#elt'].moveToParent();
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (!node)
  {
    var min, max;
    for (let n in locators)
    {
      let elt = locators[n];
      if (!min || min.compare(elt) > 0)
        min = elt;
      if (!max || max.compare(elt) < 0)
        max = elt;
    }
    var range = new domlevel.Range(min, max);
    node = range.getAncestorElement();
  }

  var retval = '';
  if (node.parentNode)
  {
    var parent = node.parentNode;
    for (let n in locators)
      if (locators[n].element == parent && locators[n].offset < parent.childNodes.length && parent.childNodes[locators[n].offset] == node)
        retval += getLocatorText(n, locators[n]);
  }
  if (retval)
    retval += getIndentedLineBreak(indent);
  retval = retval + getStructuredOuterHTMLInternal(node, locators, indent);

  if (options.title)
    retval = options.title + " " + retval;
  if (options.colorize)
  {
    retval = [ "%c" + retval.replace(/\(#/g, "%c(#").replace(/#\)/g, ")%c") ];
    for (var i = 0, e = retval[0].split("%c").length-1; i < e; ++i)
      retval.push((i %2) == 0 ? "color:black;" : "color:red;");
  }
  return retval;
}

function getLocatorText(name, locator)
{
  return '(#' + name + (locator.id?'$'+locator.id+(locator.cc?'/'+locator.cc:''):'') + '#)';
}

function getNamedLocatorsText(namedlocators, node, offset, indent, incr)
{
  var locatortext = '';
  for (var n in namedlocators)
    if (namedlocators[n].element == node && namedlocators[n].offset == offset)
      locatortext += getLocatorText(n, namedlocators[n]);

  if (locatortext && indent)
    locatortext = getIndentedLineBreak(indent, incr) + locatortext;

  return locatortext;
}

  // Shows HTML structure, shows locators at their location
function getStructuredOuterHTMLInternal(node, namedlocators, indent)
{
  if(!node)
    return '<undefined>';

  var retval = '';
  if(node.nodeType==11 || node.nodeType == 9)
  {
    for (var i=0;i<node.childNodes.length;++i)
    {
      if (i != 0 && !indent)
        retval += ' ';

      retval += getNamedLocatorsText(namedlocators, node, i, indent);
      retval += getIndentedLineBreak(indent);
      retval += getStructuredOuterHTMLInternal(node.childNodes[i], namedlocators, indent && indent + 1);
    }

    retval += getNamedLocatorsText(namedlocators, node, node.childNodes.length, indent);
    return retval;
  }
  if(node.nodeType==1)
  {
    retval += '<' + texttype.encodeValue(node.nodeName);
    for(let i=0;i<node.attributes.length;++i)
    {
      var attrvalue = String(node.attributes[i].value || node.attributes[i].nodeValue || '');
      if (attrvalue)
      {
        var attrname = node.attributes[i].nodeName + '';
        if (attrvalue.substr(0,9) == "function(") // Readability for IE8
          continue;
        retval += ' ' + texttype.encodeValue(attrname) + '="' + texttype.encodeValue(attrvalue) + '"';
      }
    }

    if (node._xtest)
      retval += ':' + node._xtest;
    retval += '>';

    var nodecontents = '';
    for (let i=0;i<node.childNodes.length;++i)
    {
      if (i != 0 && !indent)
        nodecontents += ' ';

      nodecontents += getNamedLocatorsText(namedlocators, node, i, indent, 1);
      nodecontents += getIndentedLineBreak(indent, 1);
      nodecontents += getStructuredOuterHTMLInternal(node.childNodes[i], namedlocators, indent && indent + 1);
    }

    nodecontents += getNamedLocatorsText(namedlocators, node, node.childNodes.length, indent, 1);

    retval += nodecontents;
    if (nodecontents)
      retval += getIndentedLineBreak(indent);
    return retval + '</' + texttype.encodeValue(node.nodeName) + '>';
  }
  if(node.nodeType==3 || node.nodeType==4 || node.nodeType == 8)
  {
    if(node.nodeType == 3)
      retval += '#text:';
    if (node.nodeType == 4)
      retval += '#cdata:';
    if (node.nodeType == 8)
      retval += '#comment:';
    if (node._xtest)
      retval += node._xtest + ':';

    var text = '', intext=node.nodeValue; //use temp as accessing long nodeValues is slow on IE
    for (i = 0; i < intext.length; ++i)
    {
      text += getNamedLocatorsText(namedlocators, node, i);
      text += intext.substr(i, 1);
    }
    text += getNamedLocatorsText(namedlocators, node, intext.length);
    var valenc = unescape(escape(texttype.encodeValue(text)).split('%u').join('\\u').split('%A0').join('\\u00A0'));
    retval += '"' + valenc + '"';// + (valenc != urienc ? ' - "' + urienc + '"' : '');
    return retval;
  }
  return node.nodeName;
}

function unstructureDom(win, node, locators)
{
  locators = locators || [];
  var foundlocator = false;
  for (var i = 0; i < node.childNodes.length;)
  {
    var child = node.childNodes[i];

    if (child.nodeType != 3)
    {
      unstructureDom(win, child, locators);
      ++i;
      continue;
    }

    var text = child.nodeValue;
    var result = null;
    var quoted = false;
    let locator = new domlevel.Locator(node, i);
    //var hadlocator = false;
    for (var a = 0; a < text.length;)
    {
      if (text.substr(a, 2) == '(*')
      {
        var endpos = text.indexOf('*)', a);

        var pos = parseInt(text.substring(a+2,endpos));
        while (locators.length <= pos)
          locators.push(null);
        if (locators[pos])
          throw new Error("Included locator (*" + pos + "*) twice");
        locators[pos] = locator.clone();
        a = endpos + 2;
        foundlocator = true;
        continue;
      }
      if (text.substr(a, 1) == '"')
      {
        if (!quoted)
        {
          if (!(result === null))
          {
            let next = child.nextSibling;
            let newnode = document.createTextNode(text.substr(a));
            if (next)
              node.insertBefore(newnode, next);
            else
              node.appendChild(newnode);
            break;
          }
          quoted = true;
          locator = new domlevel.Locator(child, 0);
          result = '';
        }
        else
        {
          quoted = false;
          locator = new domlevel.Locator(node, i + 1);
        }
        ++a;
        continue;
      }
      if (quoted)
      {
        result += text.substr(a, 1);
        ++locator.offset;
      }
      else
        throw new Error("Unquoted content! " + node.innerHTML);
      ++a;
    }

    if (quoted)
      throw new Error("Quotes not balanced: " + node.innerHTML);

    if (result === null)
      node.removeChild(child);
    else
    {
      child.nodeValue = result;
      ++i;
    }
  }

  // If we removed all the text content with the locators, add a br at the end of the node
  if (foundlocator && [ 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'blockquote', "li" ].includes(node.nodeName.toLowerCase()))
  {
    let locator = new domlevel.Locator(node);
    var res = locator.scanForward(node, { whitespace: true }); // only whitespace?
    if (res.type == 'outerblock')
    {
      var br = node.ownerDocument.createElement('br');
      br.setAttribute("data-wh-rte", "bogus");
      locator.insertNode(br);
    }
  }

  return locators;
}

class SourceDebugger
{
  constructor(rte,el,boxel)
  {
    this.rte = rte;
    this.el = el;
    this.boxel = boxel;
    this.editpr = null;
    this.rte.getContainer().addEventListener("wh:rtd-statechange", () => this.onStateChange());
  }
  refresh()
  {
    this.onStateChange(null);
  }
  onStateChange()
  {
    try
    {
      let editor = this.rte.getEditor();
      if (!editor)
        return;

      var range = editor.getSelectionRange();
      var orgrange = editor.debugGetRawSelectionRange() || range;

      let locators =
          { start: range.start
          , end: range.end
          };

      if (!orgrange.start.equals(range.start))
        locators.orgstart = orgrange.start;
      if (!orgrange.end.equals(range.end))
        locators.orgend = orgrange.end;

      var overlap = range.clone();
      if (overlap.start.compare(orgrange.start) > 0)
        overlap.start.assign(orgrange.start);
      if (overlap.end.compare(orgrange.end) < 0)
        overlap.end.assign(orgrange.end);

      this.el.value = getStructuredOuterHTML(overlap.getAncestorElement(), locators, true);

      const domrange = document.createRange();
      domrange.setStart(locators.start.element, locators.start.offset);
      domrange.setEnd(locators.end.element, locators.end.offset);
      const rangerect = domrange.getBoundingClientRect();
      let toshow = { left: rangerect.left, top: rangerect.top, right: rangerect.right, bottom: rangerect.bottom };
      this.boxel.value = JSON.stringify(toshow);
    }
    catch(e)
    {
      console.error(e);
      this.el.value = "Exception retrieving outerhtml " + e;
    }
  }
}


function getAllLocatorsInNode (node)
{
  var list = [];
  if (node.nodeType == 3)
  {
    for (let i = 0; i <= node.nodeValue.length; ++i)
      list.push(new domlevel.Locator(node, i));
  }
  else
  {
    if (node.nodeName && [ "br", "img", "svg" ].includes(node.nodeName.toLowerCase()))
      return list;

    for (let i = 0; i <= node.childNodes.length; ++i)
    {
      list.push(new domlevel.Locator(node, i));
      if (node.childNodes[i])
        list = list.concat(this.getAllLocatorsInNode(node.childNodes[i]));
    }
  }
  return list;
}

function cloneNodeWithTextQuotesAndMarkedLocators (node, locators)
{
  if (node.nodeType == 3)
  {
    let text = '"';
    for (let i = 0; i <= node.nodeValue.length; ++i)
    {
      for (let l = 0; l < locators.length; ++l)
        if (locators[l].element == node && locators[l].offset == i)
          text += '(*' + l + '*)';
      text += node.nodeValue.substr(i, 1);
    }
    return document.createTextNode(text + '"');
  }

//  var nodes = [];
  var copy = node.cloneNode(false);
  if (domlevel.isEmbeddedObject(copy))
  {
    copy.removeAttribute("contenteditable");
    return copy;
  }

  for (let i = 0; i <= node.childNodes.length; ++i)
  {
    for (let l = 0; l < locators.length; ++l)
      if (locators[l].element == node && locators[l].offset == i)
      {
        let text = '(*' + l + '*)';
        var textnode = document.createTextNode(text);
        copy.appendChild(textnode);
      }
    var child = node.childNodes[i];
    if (child)
      copy.appendChild(cloneNodeWithTextQuotesAndMarkedLocators(child, locators));
  }

  return copy;
}

export
    { getStructuredOuterHTML
    , SourceDebugger
    , unstructureDom
    , getAllLocatorsInNode
    , cloneNodeWithTextQuotesAndMarkedLocators
    };
