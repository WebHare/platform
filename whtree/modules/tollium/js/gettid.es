import * as encoding from "dompack/types/text.es";
import * as domdebug from "dompack/src/debug.es";
import * as wh from "@mod-system/js/wh/integration.es";

/*
Supported debug flags:
  gtd Debug get(Rich)Tid
*/

let allTids = {};
let curLang = "";

function resolveTid(tid, params, options)
{
  if(curLang=='debug')
  {
    return '{' + tid + (params.length ? '|' + params.join('|') : '') + '}';
  }

  // Parse options
  options = Object.assign({ html: false }, options);

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

  let language = options.overridelanguage || getTidLanguage();
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

    // The context should be the resulting string by now, otherwise it's actually a textgroup
    if (typeof context != "string")
    {
      if (!wh.config.islive || domdebug.debugflags.gtd)
        console.warn("Found a textgroup instead of a text");
      return /*cannot find*/ text;
    }

    // Context contains the found text, set text
    text = context;

    // For optimization purposes, we'll assume the language text is well-formed
    let ifstack = [ { output: true, start: 0 } ];
    if (domdebug.debugflags.gtd)
      console.log("i = 0", text);
    for (let i = 0; i < text.length; ++i)
    {
      if (text[i] == "<")
      {
        // Assuming we won't find another tag within the tag (i.e. attributes are properly value-encoded) and there are no
        // special characters ("{p" or "{i") within the tag (cannot be specified in XML anyway)
        let tagEnd = text.indexOf(">", i);
        let tagName = text.substring(i + 1, tagEnd).split(" ")[0];
        let tagClose = tagName[0] == "/";
        if (tagClose)
          tagName = tagName.substr(1);

        if (!options.html || !["b","i","u","ul","ol","li"].includes(tagName))
        {
          if (domdebug.debugflags.gtd)
            console.log("Skipping tag '" + tagName + "'");
          text = text.substr(0, i) + text.substr(tagEnd + 1);

          // i now points at the first letter after the tag, decrease with 1 to advance to this letter again in the next
          // iteration
          --i;
        }
        else
        {
          if (domdebug.debugflags.gtd)
            console.log("Found tag '" + tagName + "'");

          text = text.substr(0, i) + "<" + (tagClose ? "/" : "") + tagName + ">" + text.substr(tagEnd + 1);
          // i now points at the tag start, point it to the tag end, so it points to the next character in the next iteration
          i += tagName.length + (tagClose ? 1 : 0);
        }

        if (domdebug.debugflags.gtd)
          console.log("i = " + i, text.substr(i+1));

        continue;
      }

      // Encode "\n" into <br/>
      if (text[i] == "\n" && options.html)
      {
        text = text.substr(0, i) + "<br/>" + text.substr(i + 1);
        // i now points at the br tag start, point it to the tag end, so it points to the next character in the next iteration
        i += 4;
        continue;
      }

      // If not a special character, continue
      if (text[i] != "{")
        continue;
      if (domdebug.debugflags.gtd)
        console.log("i = " + i, text.substr(i));

      // If we found a "{", there must be a next character
      switch (text[i + 1])
      {
        case "{":
        {
          if (domdebug.debugflags.gtd)
            console.log("Unescape '{{'");
          // Unescape "{{"
          text = text.substr(0, i) + text.substr(i + 1);

          // i now points at the second "{" and will advance to the next character
          if (domdebug.debugflags.gtd)
            console.log("i = " + i, text.substr(i+1));
          break;
        }
        case "p":
        {
          // Replace "{pn}" with params[n - 1]
          let n = parseInt(text[i + 2]);
          let param = (n >= 1 && n <= params.length) ? params[n - 1] : "(no such parameter:" + text[i + 2] + ")";
          if (domdebug.debugflags.gtd)
            console.log('<param p="' + n + '"/>',param);
          text = text.substr(0, i) + (options.html ? encoding.encodeTextNode(param) : param) + text.substr(i + 4);

          // i now points at the first letter of the replacement text, set it to the last letter, so it will advance correctly
          // in the next iteration
          i += ("" + param).length - 1;
          if (domdebug.debugflags.gtd)
            console.log("i = " + i, text.substr(i+1));
          break;
        }
        case "i":
        {
          // Close <ifparam> construction
          if (text[i + 2] == "}")
          {
            let part = ifstack.shift();

            // If skipping the else part, start with the part start
            let s = part.output ? i : part.start;
            if (domdebug.debugflags.gtd)
              console.log('</ifparam>', part.output ? "emit current part" : "skip current part");
            text = text.substr(0, s) + text.substr(i + 3);

            // i now points at the first letter after the "{i}", decrease with 1 to advance to this letter again in the next
            // iteration
            i = s - 1;
            if (domdebug.debugflags.gtd)
              console.log("i = " + i, text.substr(i+1));
            break;
          }

          // Resolve "{in="value"}true{e}false{i}" by checking if params[n] = "value"
          let before = text.substr(0, i);
          text = text.substr(i);
          let n = parseInt(text[2]);
          let param = (n >= 1 || n <= params.length) ? params[n - 1] : null;
          if (domdebug.debugflags.gtd)
            console.log('<ifparam p="' + n + '" value="' + param + '">');

          // Find the first '"' that is not preceded by a '\'
          let value = text.substr(4).match(/^"(([^"\\]|(\\["ntu]))*)"/);
          if (value)
          {
            // Value is surrounden with quotes, so we can JSON parse it
            let skiplen = value[0].length + 5; // {in=}
            value = JSON.parse(value[0]);

            if (param === value)
              ifstack.unshift({ output: true, start: 0 });
            else
              ifstack.unshift({ output: false, start: i });

            text = before + text.substr(skiplen);

            // i now points at the first letter after the "}", decrease with 1 to advance to this letter again in the next
            // iteration
            --i;
          }
          if (domdebug.debugflags.gtd)
            console.log("i = " + i, text.substr(i+1));
          break;
        }
        case "e":
        {
          // If skipping the else part, start with the part start
          let s = ifstack[0].output ? i : ifstack[0].start;
          if (domdebug.debugflags.gtd)
            console.log('<else>', ifstack[0].output ? "emit current part" : "skip current part");
          text = text.substr(0, s) + text.substr(i + 3);

          // Switch to the else part
          ifstack[0].output = !ifstack[0].output;

          // If skipping the else part, start at this position
          if (!ifstack[0].output)
            ifstack[0].start = i;

          // i now points at the first letter after the "}", decrease with 1 to advance to this letter again in the next
          // iteration
          i = s - 1;
          if (domdebug.debugflags.gtd)
            console.log("i = " + i, text.substr(i+1));
          break;
        }
      }
    }
    if (!options.html)
    {
      if (domdebug.debugflags.gtd)
        console.log("Decoding HTML entities", text);
      text = encoding.decodeValue(text);
    }
    if (domdebug.debugflags.gtd)
      console.info("getTid", `${module}:${tid}`, params, text);

    return text;
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
    curLang = document.documentElement.lang;

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
