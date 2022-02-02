import * as encoding from "dompack/types/text.es";
import * as domdebug from "dompack/src/debug.es";
import * as wh from "@mod-system/js/wh/integration.es";

/*
Supported debug flags:
  gtd Debug get(Rich)Tid
*/

let allTids = {};
let curLang = "";

function encodeHTML(input)
{
  return input.split('&').join('&amp;')
              .split('<').join('&lt;')
              .split('>').join('&gt;')
              .split('\n').join('<br/>');
}

function executeCompiledTidText(text, params, rich)
{
  if(typeof text == "object" && !Array.isArray(text))
    text = text?.[""];
  if (text == null)
    return text;
  if(typeof text == "string")
    return rich ? encodeHTML(text) : text;

  let output = '';
  for(let tok of text)
  {
    if(typeof tok == "string")
    {
      output += rich ? encodeHTML(tok) : tok;
    }
    else if (typeof tok == "number")
    {
      if (tok >= 1)
      {
        let get_param = params?.[tok-1];
        if(get_param)
        {
          output += rich ? encodeHTML(get_param) : get_param;
        }
      }
    }
    else if(tok.t == "tag")
    {
      let sub = executeCompiledTidText(tok.subs, params, rich);
      output += rich ? `<${tok.tag}>${sub}</${tok.tag}>` : sub;
    }
    else  if(tok.t == "ifparam")
    {
      let get_param = params?.[tok.p-1] || '';
      output += executeCompiledTidText(get_param.toUpperCase() == tok.value.toUpperCase() ? tok.subs : tok.subselse, params, rich);
    }
    else if(tok.t == "a")
    {
      let sub = executeCompiledTidText(tok.subs, params, rich);
      if(rich)
      {
        let link = tok.link;
        if(tok.linkparam > 0 && tok.linkparam <= params.length)
          link = params[tok.linkparam - 1];
        if(link)
          output += `<a href="${encoding.encodeValue(link)}">${sub}</a>`;
        else
          output += sub;
      }
      else
      {
        output += sub;
      }
    }
  }
  return output;
}

function resolveTid(tid, params, options)
{
  if(curLang=='debug')
  {
    return '{' + tid + (params.length ? '|' + params.join('|') : '') + '}';
  }

  // Make sure we have 4 string params
  for (let i = 0; i < 4; ++i)
    if (params.length == i)
      params.push("");
    else if (typeof params[i] == "number")
      params[i] = "" + params[i];
    else if (!params[i])
      params[i] = "";
  params = params.slice(0, 4);

  // Initialize text with the 'cannot find text' message
  let text = domdebug.debugflags.sut ? "." + tid.split(".").pop() : "(cannot find text:" + tid + ")";

  // Check if the module is defined
  let module = tid.substr(0, tid.indexOf(":"));
  if (!module || !(module in allTids))
  {
    if (!wh.config.islive || domdebug.debugflags.gtd)
      console.warn("No language texts found for module '" + module + "'");
    return /*cannot find*/ text;
  }

  let language = options?.overridelanguage || getTidLanguage();
  if (!(language in allTids[module]))
  {
    if (!wh.config.islive || domdebug.debugflags.gtd)
      console.warn("No language texts found for language '" + language + "'");
    return /*cannot find*/ text;
  }

  try
  {
    if (domdebug.debugflags.gtd)
    {
      console.group(`Resolving tid '${tid}'`);
      console.info(tid, params, options, language);
    }

    // Dig into the module gid structure
    let context = allTids[module][language];
    tid = tid.substr(module.length + 1);
    if (!tid.split(".").every(part =>
      {
        let found = part in context;
        if (found)
          context = context[part];
        else if (domdebug.debugflags.gtd)
          console.warn("Subpart '"+ part + "' not found");

        return found; // If not found, break 'every' loop
      }))
    {
      return /*cannot find*/ text;
    }

    const executed = executeCompiledTidText(context, params, options?.html);
    if (executed == null)
    {
      if (domdebug.debugflags.gtd)
        console.warn(`Tid '${module}:${tid}'' is a group node`);
      return /*cannot find*/ text;
    }
    if (domdebug.debugflags.gtd)
      console.info("getTid", `${module}:${tid}`, params, executed);

    return executed;
  }
  finally
  {
    if (domdebug.debugflags.gtd)
      console.groupEnd();
  }
}

function getTid(tid, p1, p2, p3, p4)
{
  return resolveTid(tid, Array.prototype.slice.call(arguments, 1));
}

function getHTMLTid(tid, p1, p2, p3, p4)
{
  return resolveTid(tid, Array.prototype.slice.call(arguments, 1), { html: true });
}

function getTidLanguage()
{
  if (curLang)
    return curLang;

  // Read the document's language, if there is a DOM context
  if (typeof document != "undefined")
    curLang = (document.documentElement.lang||'').substr(0,2);

  return curLang;
}

function setTidLanguage(lang)
{
  curLang = lang;
}

function tidMerge(readContext, writeContext)
{
  for (let key of Object.keys(readContext))
  {
    if (typeof readContext[key] == "string")
      writeContext[key] = readContext[key];
    else
    {
      if (!(key in writeContext))
        writeContext[key] = {};
      tidMerge(readContext[key], writeContext[key]);
    }
  }
}

function registerTexts(module, language, tids)
{
  if (!(module in allTids))
  {
    allTids[module] = {};
  }
  if (!(language in allTids[module]))
  {
    allTids[module][language] = tids;
    return;
  }
  tidMerge(tids, allTids[module][language]);
}

// Fill nodes with a data-texttid attribute with the translated text
function convertElementTids(scope = document.body)
{
  // Only available in a DOM context and if the DOM is ready
  if (typeof document == "undefined" || !scope)
    return;
  Array.from(scope.querySelectorAll("*[data-texttid]")).forEach(function(node)
  {
    node.textContent = getTid(node.getAttribute("data-texttid"));
  });
}

// If this script is run within a DOM context, convert data-texttid attributes automatically
if (typeof document != "undefined")
  document.addEventListener("DOMContentLoaded", event => convertElementTids());


// Define 'tidLanguage' as a property on the main export (so you can use getTid.tidLanguage)
Object.defineProperty(getTid, "tidLanguage", { get: getTidLanguage, set: setTidLanguage });
// Define 'html' as a method on the main export (so you can use getTid.html)
getTid.html = getHTMLTid;

// Export getTid as the default function, explicitly export getTid, getHTMLTid and registerTexts as well
export { getTid as default
       , getTid
       , getTidLanguage
       , getHTMLTid
       , convertElementTids
       , registerTexts
       };
