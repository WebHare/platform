import { decodeString, encodeString } from '@webhare/std';
import type { CompiledLanguageFile, GetTidHooks, LanguagePart, LanguageText, RecursiveLanguageTexts, TidParam } from './types';
import { getGetTidHooks } from './hooks';
import { debugFlags, isLive } from '@webhare/env';



let hooks: GetTidHooks | undefined;
let browserSetLanguage = ("document" in globalThis && document?.documentElement?.lang?.substring(0, 2).toLowerCase()) || "";
const defaultLanguage = "en";

function ensureHooks(): GetTidHooks {
  return hooks ??= getGetTidHooks?.() ?? {
    loader: null,
    currentLanguage: (lang) => {
      if (lang)
        browserSetLanguage = lang;
      return browserSetLanguage;
    }
  };
}

export function getTidLanguage() {
  return ensureHooks().currentLanguage();
}

export function setTidLanguage(newLanguage: string) {
  return ensureHooks().currentLanguage(newLanguage.toLowerCase());
}

const langFileCache: Record<string, CompiledLanguageFile> = {};

function getLanguageFile(module: string, langCode: string): CompiledLanguageFile | undefined {
  const langkey = `${module}:${langCode}`;
  let compiled = langFileCache[langkey];
  if (!compiled || !compiled.resource) {
    const loader = ensureHooks().loader;
    if (loader) {
      try {
        compiled = loader(module, langCode, compiled?.registered ?? new Map);
      } catch (e) {
        // loading failed, erase the loaded texts (keep the registered texts, though)
        if (!isLive || debugFlags.gtd) {
          console.error(e);
        }
        const texts = compiled?.registered ?? new Map;
        compiled = { resource: "", fallbackLanguage: "", langCode, texts, registered: texts };
      }
      langFileCache[langkey] = compiled;
    }
  }
  if (!compiled && (isLive || debugFlags.gtd)) {
    console.warn(`No language texts found for module '${module}' and language '${langCode}'`);
  }
  return compiled;
}

export function getTid(tid: string, p1: TidParam = null, p2: TidParam = null, p3: TidParam = null, p4: TidParam = null) {
  return getTidForLanguage(getTidLanguage() || defaultLanguage, tid, p1, p2, p3, p4);
}

export function getTidForLanguage(langcode: string, tid: string, p1: TidParam = null, p2: TidParam = null, p3: TidParam = null, p4: TidParam = null) {
  if (tid === "") {
    return "";
  }

  if (tid.startsWith(":")) {
    return tid.substring(1);
  } else if (tid.startsWith("<>")) {
    return decodeString(tid.substring(2), "html");
  }

  return calcTIDForLanguage(langcode.toLowerCase(), tid, [p1, p2, p3, p4], false);
}

export function getHTMLTid(tid: string, p1: TidParam = null, p2: TidParam = null, p3: TidParam = null, p4: TidParam = null) {
  return getHTMLTidForLanguage(getTidLanguage() || defaultLanguage, tid, p1, p2, p3, p4);
}

export function getHTMLTidForLanguage(langcode: string, tid: string, p1: TidParam = null, p2: TidParam = null, p3: TidParam = null, p4: TidParam = null) {
  if (tid === "") {
    return "";
  }

  if (tid.startsWith(":")) {
    return encodeString(tid.substring(1), "html");
  } else if (tid.startsWith("<>")) {
    return tid.substring(2);
  }

  return calcTIDForLanguage(langcode.toLowerCase(), tid, [p1, p2, p3, p4], true);
}

export function getTIDListForLanguage(langcode: string, gid: string) {
  gid = getCanonicalTid(gid.toLowerCase());
  langcode = langcode.toLowerCase();

  const modsep = gid.indexOf(':');
  if (modsep === -1) {
    if (isLive || debugFlags.gtd)
      console.warn(`Missing module name in call for gid '${gid}'`);
    return `(cannot find textnode: ${gid})`;
  }

  const module = gid.substring(0, modsep);
  const lookup = gid.substring(modsep + 1).replace(/ /g, "_") + ".";

  const compiled = getLanguageFile(module, langcode);
  const result: string[] = [];
  if (compiled) {
    for (const key of compiled.texts.keys()) {
      if (key.startsWith(lookup) && key.indexOf(".", lookup.length) === -1)
        result.push(`${module}:${key}`);
    }
    if (compiled.fallbackLanguage) {
      const fallback = getLanguageFile(module, compiled.fallbackLanguage);
      if (fallback) {
        for (const key of fallback.texts.keys()) {
          if (key.startsWith(lookup) && key.indexOf(".", lookup.length) === -1 && !result.includes(`${module}:${key}`))
            result.push(`${module}:${key}`);
        }
      }
    }
  }

  return result;
}

function calcTIDForLanguage(langcode: string, tid: string, rawParams: Array<string | number | null>, rich: boolean) {
  tid = getCanonicalTid(tid.toLowerCase());
  if (tid === "tollium:tilde.locale.datetimestrings") {
    return getLanguageDatetimeStrings(langcode);
  }

  // convert null to "", numbers to strings
  const params = rawParams.map(p => (typeof p === "number" ? p.toString() : (p ?? "")));

  const modsep = tid.indexOf(':');
  if (modsep === -1) {
    if (isLive || debugFlags.gtd)
      console.warn(`Missing module name in call for tid '${tid}'`);
    return `(missing module name in tid: ${tid})`;
  }

  if (debugFlags.sut) {
    return tid.substring(tid.lastIndexOf("."));
  }

  const module = tid.substring(0, modsep);
  const lookup = tid.substring(modsep + 1).replace(/ /g, "_");
  tid = `${module}:${lookup}`;

  if (langcode === "debug") {
    const debugtid = `{${[tid, ...params].join("|")}}`;
    return rich ? encodeString(debugtid, "html") : debugtid;
  }

  const compiled = getLanguageFile(module, langcode);
  const match = compiled?.texts.get(lookup);
  if (!match && compiled?.fallbackLanguage) {
    const fallback = getLanguageFile(module, compiled.fallbackLanguage);
    const fallbackMatch = fallback?.texts.get(lookup);
    if (!fallbackMatch && (!isLive || debugFlags.gtd)) {
      console.warn(`Cannot find text ${tid} for language ${langcode}, also tried fallback language '${compiled.fallbackLanguage}'`);
    }
    return fallbackMatch ? executeCompiledTidText(fallbackMatch, params, rich) : `(cannot find text: ${tid})`;
  }
  if (!match && (!isLive || debugFlags.gtd)) {
    console.warn(`Cannot find text ${tid} for language ${langcode}, no fallback language`);
  }
  return match ? executeCompiledTidText(match, params, rich) : `(cannot find text: ${tid})`;
}

function getCanonicalTid(tid: string) {
  if (tid.startsWith("tollium:common.buttons.") || tid.startsWith("tollium:common.actions.") || tid.startsWith("tollium:common.labels.")) {
    return `tollium:tilde.${tid.substring(tid.indexOf(".") + 1)}`;
  } else if (tid.startsWith("~")) {
    return `tollium:tilde.${tid.substring(1)}`;
  }

  return tid;
}

function executeCompiledTidText(text: string | LanguagePart[], params: string[], rich: boolean) {
  if (typeof text === "string") {
    return rich ? encodeString(text, "html") : text;
  }

  let output = "";
  for (const tok of text) {
    if (typeof tok === "string") {
      output += rich ? encodeString(tok, "html") : tok;
    } else if (typeof tok === "number") {
      if (tok >= 1) {
        const get_param = params[tok - 1];
        if (get_param) {
          output += rich ? encodeString(get_param, "html") : get_param;
        }
      }
    } else if (tok.t === "tag") {
      const sub = executeCompiledTidText(tok.subs, params, rich);
      output += rich ? `<${tok.tag}>${sub}</${tok.tag}>` : sub;
    } else if (tok.t === "ifparam") {
      const get_param = params[tok.p - 1] || "";
      output += executeCompiledTidText(get_param.toUpperCase() === tok.value.toUpperCase() ? tok.subs : tok.subselse, params, rich);
    } else if (tok.t === "a") {
      const sub = executeCompiledTidText(tok.subs, params, rich);
      if (rich) {
        let link = tok.link;
        if (tok.linkparam > 0 && tok.linkparam <= params.length) {
          link = params[tok.linkparam - 1] || link;
        }
        if (link) {
          output += `<a href="${encodeString(link, "attribute")}">${sub}</a>`;
        } else {
          output += sub;
        }
      } else {
        output += sub;
      }
    }
  }
  return output;
}

function flattenRecursiveLanguageTexts(text: RecursiveLanguageTexts, pathsofar: string, result: Map<string, LanguageText>): void {
  if (typeof text === "string" || Array.isArray(text))
    result.set(pathsofar, text);
  else
    for (const [name, value] of Object.entries(text))
      flattenRecursiveLanguageTexts(value, `${pathsofar}${pathsofar && name ? "." : ""}${name}`, result);
}

export function registerTexts(module: string, langCode: string, tids: RecursiveLanguageTexts) {
  const langkey = `${module}:${langCode}`;
  let compiledFile = langFileCache[langkey];
  if (!compiledFile) {
    const texts = new Map;
    langFileCache[langkey] = compiledFile = { resource: "", fallbackLanguage: "", langCode, texts, registered: texts };
  }
  flattenRecursiveLanguageTexts(tids, "", compiledFile.registered);
  if (compiledFile.texts !== compiledFile.registered) {
    for (const [key, value] of compiledFile.registered)
      compiledFile.texts.set(key, value);
  }
}

function getLanguageDatetimeStrings(langCode: string) {
  switch (langCode.substring(0, 2)) {
    case "nl": return "am;pm;januari;februari;maart;april;mei;juni;juli;augustus;september;oktober;november;december;maandag;dinsdag;woensdag;donderdag;vrijdag;zaterdag;zondag;jan;feb;mrt;apr;mei;jun;jul;aug;sep;okt;nov;dec;ma;di;wo;do;vr;za;zo";
    case "de": return "am;pm;Januar;Februar;März;April;Mai;Juni;Juli;August;September;Oktober;November;Dezember;Montag;Dienstag;Mittwoch;Donnerstag;Freitag;Samstag;Sonntag;Jan.;Febr.;März;Apr.;Mai;Juni;Juli;Aug.;Sept.;Okt.;Nov.;Dez.;Mo;Di;Mi;Do;Fr;Sa;So";
    case "fr": return "am;pm;Janvier;Février;Mars;Avril;Mai;Juin;Juillet;Août;Septembre;Octobre;Novembre;Décembre;Lundi;Mardi;Mercredi;Jeudi;Vendredi;Samedi;Dimanche;Janv;Févr;Mars;Avril;Mai;Juin;Juil;Août;Sept;Oct;Nov;Déc;Lun;Mar;Mer;Jeu;Ven;Sam;Dim";
    case "jp": {
      return Buffer.from("5Y2I5YmNO+WNiOW+jDvvvJHmnIg777yS5pyIO++8k+aciDvvvJTmnIg777yV5pyIO++8luaciDvvvJfmnIg777yY5pyIO++8meaciDvvvJHvvJDmnIg777yR77yR5pyIO++8ke+8kuaciDvmnIjmm5zml6U754Gr5puc5pelO+awtOabnOaXpTvmnKjmm5zml6U76YeR5puc5pelO+Wcn+abnOaXpTvml6Xmm5zml6U777yR5pyIO++8kuaciDvvvJPmnIg777yU5pyIO++8leaciDvvvJbmnIg777yX5pyIO++8mOaciDvvvJnmnIg777yR77yQ5pyIO++8ke+8keaciDvvvJHvvJLmnIg75pyIO+eBqzvmsLQ75pyoO+mHkTvlnJ875pel", "base64").toString();
    }
  }

  // "en" is the default
  return "am;pm;January;February;March;April;May;June;July;August;September;October;November;December;Monday;Tuesday;Wednesday;Thursday;Friday;Saturday;Sunday;Jan;Feb;Mar;Apr;May;Jun;Jul;Aug;Sep;Oct;Nov;Dec;Mon;Tue;Wed;Thu;Fri;Sat;Sun";
}
