import { isLive, debugFlags } from "@webhare/env";
import { encodeString } from "@webhare/std";

/*
Supported debug flags:
  gtd Debug get(Rich)Tid
*/

interface Tag {
  t: "tag";
  tag: string;
  subs: string | LanguagePart[]; // These subs are parsed by DecodeLanguageText, which may return a single string
}

interface Link {
  t: "a";
  link: string;
  linkparam: number;
  target: string;
  subs: string | LanguagePart[]; // These subs are parsed by DecodeLanguageText, which may return a single string
}

interface IfParam {
  t: "ifparam";
  p: number;
  value: string;
  subs: LanguagePart[]; // These subs are always an array of ParseTextNode results
  subselse: LanguagePart[]; // These subs are always an array of ParseTextNode results
}

// An object with tids or gids
type LanguageTexts = { [tid: string]: LanguageText };
// A text, an array of language text parts or an object with tids or gids
type LanguageText = string | LanguagePart[] | LanguageTexts;
// A text, a param or a tag, link or ifparam node
type LanguagePart = string | number | Tag | Link | IfParam;

interface CachedTids {
  [module: string]:
  {
    [language: string]: LanguageTexts;
  };
}

type TidParam = string | number | null;

const allTids: CachedTids = {};
let curLang = "";

function executeCompiledTidText(text: LanguageText, params: string[], rich: boolean) {
  if (typeof text === "object" && !Array.isArray(text))
    text = text?.[""] as string;
  if (text === null)
    return text;
  if (typeof text === "string")
    return rich ? encodeString(text, 'html') : text;

  let output = '';
  for (const tok of text) {
    if (typeof tok === "string") {
      output += rich ? encodeString(tok, 'html') : tok;
    } else if (typeof tok === "number") {
      if (tok >= 1) {
        const get_param = params?.[tok - 1];
        if (get_param) {
          output += rich ? encodeString(get_param, 'html') : get_param;
        }
      }
    } else if (tok.t === "tag") {
      const sub = executeCompiledTidText(tok.subs, params, rich);
      output += rich ? `<${tok.tag}>${sub}</${tok.tag}>` : sub;
    } else if (tok.t === "ifparam") {
      const get_param = params?.[tok.p - 1] || '';
      output += executeCompiledTidText(get_param.toUpperCase() === tok.value.toUpperCase() ? tok.subs : tok.subselse, params, rich);
    } else if (tok.t === "a") {
      const sub = executeCompiledTidText(tok.subs, params, rich);
      if (rich) {
        let link = tok.link;
        if (tok.linkparam > 0 && tok.linkparam <= params.length)
          link = params[tok.linkparam - 1];
        if (link)
          output += `<a href="${encodeString(link, 'attribute')}">${sub}</a>`;
        else
          output += sub;
      } else {
        output += sub;
      }
    }
  }
  return output;
}

function resolveTid(tid: string, params: Array<TidParam | undefined>, options?: { overridelanguage?: string; html?: boolean }): string {
  if (curLang === 'debug')
    return '{' + tid + (params.length ? '|' + params.join('|') : '') + '}';

  if (tid[0] === '~')
    tid = 'tollium:tilde.' + tid.substring(1);

  // Convert params to string
  const strparams: string[] = params.map(param => typeof param === "number" ? String(param) : param || "");

  // Initialize text with the 'cannot find text' message
  const text = debugFlags.sut ? "." + tid.split(".").pop() : "(cannot find text:" + tid + ")";

  // Check if the module is defined
  const module = tid.substring(0, tid.indexOf(":"));
  if (!module || !(module in allTids)) {
    if (!isLive || debugFlags.gtd)
      console.warn("No language texts found for module '" + module + "'");
    return /*cannot find*/ text;
  }

  const language = options?.overridelanguage || getTidLanguage();
  if (!(language in allTids[module])) {
    if (!isLive || debugFlags.gtd)
      console.warn("No language texts found for language '" + language + "'");
    return /*cannot find*/ text;
  }

  try {
    if (debugFlags.gtd) {
      console.group(`Resolving tid '${tid}'`);
      console.info({ tid, strparams, options, language, context: allTids[module][language] });
    }

    // Dig into the module gid structure
    let context: LanguageText = allTids[module][language];
    tid = tid.substring(module.length + 1);
    if (!tid.split(".").every(part => {
      if (typeof context === "string" || Array.isArray(context) || !(part in context)) {
        console.warn("Subpart '" + part + "' not found");
        return false; // If not found, break 'every' loop
      }
      context = context[part];
      return true;
    })) {
      return /*cannot find*/ text;
    }

    const executed = executeCompiledTidText(context, strparams, options?.html ?? false);
    if (executed === null) {
      if (debugFlags.gtd)
        console.warn(`Tid '${module}:${tid}'' is a group node`);
      return /*cannot find*/ text;
    }
    if (debugFlags.gtd)
      console.info("getTid", `${module}:${tid}`, strparams, executed);

    return executed;
  } finally {
    if (debugFlags.gtd)
      console.groupEnd();
  }
}

function getTid(tid: string, p1?: TidParam, p2?: TidParam, p3?: TidParam, p4?: TidParam) {
  return resolveTid(tid, [p1, p2, p3, p4]);
}

function getHTMLTid(tid: string, p1?: TidParam, p2?: TidParam, p3?: TidParam, p4?: TidParam) {
  return resolveTid(tid, [p1, p2, p3, p4], { html: true });
}

function getTidLanguage() {
  if (curLang)
    return curLang;

  // Read the document's language, if there is a DOM context
  if (typeof document !== "undefined")
    curLang = (document.documentElement.lang || '').substring(0, 2);

  return curLang;
}

function setTidLanguage(lang: string) {
  curLang = lang;
}

function tidMerge(readContext: LanguageTexts, writeContext: LanguageTexts) {
  for (const key of Object.keys(readContext)) {
    if (typeof readContext[key] !== "object" || Array.isArray(readContext[key])) { //a leaf, safe to copy
      writeContext[key] = readContext[key];
    } else {
      if (!(key in writeContext))
        writeContext[key] = {};
      tidMerge(readContext[key] as LanguageTexts, writeContext[key] as LanguageTexts);
    }
  }
}

function registerTexts(module: string, language: string, tids: LanguageTexts) {
  if (!(module in allTids)) {
    allTids[module] = {};
  }
  if (!(language in allTids[module])) {
    allTids[module][language] = tids;
    return;
  }
  tidMerge(tids, allTids[module][language]);
}

// Fill nodes with a data-texttid attribute with the translated text
function convertElementTids(scope = document.body) {
  // Only available in a DOM context and if the DOM is ready
  if (typeof document === "undefined" || !scope)
    return;
  Array.from(scope.querySelectorAll("*[data-texttid]")).forEach(function (node) {
    node.textContent = getTid(node.getAttribute("data-texttid") || "");
  });
}

// If this script is run within a DOM context, convert data-texttid attributes automatically
if (typeof document !== "undefined")
  document.addEventListener("DOMContentLoaded", () => convertElementTids());


// Define 'tidLanguage' as a property on the main export (so you can use getTid.tidLanguage)
Object.defineProperty(getTid, "tidLanguage", { get: getTidLanguage, set: setTidLanguage });
// Define 'html' as a method on the main export (so you can use getTid.html)
getTid.html = getHTMLTid;

// Export getTid as the default function, explicitly export getTid, getHTMLTid and registerTexts as well
export {
  getTid as default,
  getTid,
  getTidLanguage,
  setTidLanguage,
  getHTMLTid,
  convertElementTids,
  registerTexts
};
