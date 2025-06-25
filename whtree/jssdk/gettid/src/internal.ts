import { decodeString, encodeString } from '@webhare/std';
import type { CompiledLanguageFile, GetTidHooks, LanguagePart, LanguageText, RecursiveLanguageTexts, TidParam } from './types';
import { getGetTidHooks } from './hooks';
import { debugFlags, dtapStage } from '@webhare/env';



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

export function getTidLanguage(): string {
  return ensureHooks().currentLanguage() || defaultLanguage;
}

export function setTidLanguage(newLanguage: string): void {
  ensureHooks().currentLanguage(newLanguage.toLowerCase());
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
        if (dtapStage !== "production" || debugFlags.gtd) {
          console.error(e);
        }
        const texts = compiled?.registered ?? new Map;
        compiled = { resource: "", fallbackLanguage: "", langCode, texts, registered: texts };
      }
      langFileCache[langkey] = compiled;
    }
  }
  if (!compiled && (dtapStage !== "production" || debugFlags.gtd)) {
    console.warn(`No language texts found for module '${module}' and language '${langCode}'`);
  }
  return compiled;
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any -- needed for generics
export type GetTidRenderFunc<Result extends object = object> = ((tag: keyof HTMLElementTagNameMap, props: { children?: any[]; href?: string }, ...childNodes: any[]) => Result);
export type GetTidOptions = { langCode?: string; render?: GetTidRenderFunc | "fragment" };

type GetTidArgumentTypes = [GetTidOptions?] | [TidParam[], GetTidOptions?] | [TidParam?, TidParam?, TidParam?, TidParam?];

function toHTMLNode(tag: string, props: { href?: string; children?: Array<string | Node> }): Node {
  const node = document.createElement(tag);
  if (props.href)
    node.setAttribute("href", props.href);
  if (props.children)
    node.append(...props.children);
  return node;
}

function wrapInFragment(children: Array<string | Node>): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(...children);
  return fragment;
}


function getTidInternal(tid: string, params: TidParam[], options?: GetTidOptions): string | Array<string | object> | DocumentFragment {
  if (tid === "") {
    return "";
  }

  if (tid.startsWith(":")) {
    return tid.substring(1);
  } else if (tid.startsWith("<>")) {
    return decodeString(tid.substring(2), "html");
  }

  const langCode = options?.langCode?.toLowerCase() || getTidLanguage();
  if (options?.render) {
    if (options.render === "fragment") {
      const nodes = calcTIDForLanguage(langCode, tid, params, true, toHTMLNode) as Array<string | Node>;
      return wrapInFragment(nodes);
    }
    return calcTIDForLanguage(langCode, tid, params, true, options.render);
  } else
    return calcTIDForLanguage(langCode, tid, params, false, null).join("");
}

export function getTid(tid: string, options?: GetTidOptions & { render?: undefined }): string;
export function getTid<VNode extends object>(tid: string, options?: GetTidOptions & { render?: GetTidRenderFunc<VNode> }): string | Array<string | VNode>;
export function getTid(tid: string, options?: GetTidOptions & { render?: "fragment" }): DocumentFragment;
export function getTid(tid: string, param: TidParam[], options?: GetTidOptions & { render?: undefined }): string;
export function getTid<VNode extends object>(tid: string, param: TidParam[], options?: GetTidOptions & { render?: GetTidRenderFunc<VNode> }): string | Array<string | VNode>;
export function getTid(tid: string, param: TidParam[], options?: GetTidOptions & { render?: "fragment" }): DocumentFragment;
export function getTid(tid: string, p1?: TidParam, p2?: TidParam, p3?: TidParam, p4?: TidParam): string;

export function getTid(tid: string, ...p: GetTidArgumentTypes): string | Array<string | object> | DocumentFragment {
  if (Array.isArray(p[0])) // case: param: TidParam[], options?: GetTidOptions)
    return getTidInternal(tid, p[0], p[1] as GetTidOptions);
  if (p[0] && typeof p[0] === "object") // case: options: GetTidOptions
    return getTidInternal(tid, [], p[0]);
  return getTidInternal(tid, p as Array<TidParam | undefined>, {});
}

export function getTidForLanguage(langCode: string, tid: string, p1: TidParam = null, p2: TidParam = null, p3: TidParam = null, p4: TidParam = null) {
  return getTidInternal(tid, [p1, p2, p3, p4], { langCode });
}

export function getHTMLTid(tid: string, ...params: TidParam[]): string {
  return getHTMLTidForLanguage(getTidLanguage(), tid, ...params);
}

export function getHTMLTidForLanguage(langCode: string, tid: string, ...params: TidParam[]): string {
  if (tid === "") {
    return "";
  }

  if (tid.startsWith(":")) {
    return encodeString(tid.substring(1), "html");
  } else if (tid.startsWith("<>")) {
    return tid.substring(2);
  }

  return calcTIDForLanguage(langCode, tid, params, true, null).join("");
}

export function getTIDListForLanguage(langcode: string, gid: string) {
  gid = getCanonicalTid(gid.toLowerCase());
  langcode = langcode.toLowerCase();

  const modsep = gid.indexOf(':');
  if (modsep === -1) {
    if (dtapStage !== "production" || debugFlags.gtd)
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

function cannotFind(tid: string) {
  if (debugFlags.sut)
    return [tid.substring(tid.lastIndexOf("."))];

  return [`(cannot find text: ${tid})`];
}
function calcTIDForLanguage(langcode: string, tid: string, rawParams: TidParam[], rich: boolean, render: null): string[];
function calcTIDForLanguage(langcode: string, tid: string, rawParams: TidParam[], rich: boolean, render: GetTidRenderFunc): Array<string | object>;


function calcTIDForLanguage(langcode: string, tid: string, rawParams: TidParam[], rich: boolean, render: GetTidRenderFunc | null): Array<string | object> {
  tid = getCanonicalTid(tid.toLowerCase());
  if (langcode.match(/^[a-z]{2}-/)) //truncate country codes from language identifiers (eg en-GB) until we have actual support for those, so we don't break when en-GB is passed straight from eg. document.documentElement.lang
    langcode = langcode.substring(0, 2);

  if (tid === "tollium:tilde.locale.datetimestrings") {
    return [getLanguageDatetimeStrings(langcode)];
  }

  // convert null to "", numbers to strings
  const params = rawParams.map(p => (typeof p === "number" ? p.toString() : (p ?? "")));

  const modsep = tid.indexOf(':');
  if (modsep === -1) {
    if (dtapStage !== "production" || debugFlags.gtd)
      console.warn(`Missing module name in call for tid '${tid}'`);
    return [`(missing module name in tid: ${tid})`];
  }

  const module = tid.substring(0, modsep);
  const lookup = tid.substring(modsep + 1).replace(/ /g, "_");
  tid = `${module}:${lookup}`;

  if (langcode === "debug") {
    const debugtid = `{${[tid, ...params].join("|")}}`;
    return [rich ? encodeString(debugtid, "html") : debugtid];
  }

  const compiled = getLanguageFile(module, langcode);
  const match = compiled?.texts.get(lookup);
  if (!match && compiled?.fallbackLanguage) {
    const fallback = getLanguageFile(module, compiled.fallbackLanguage);
    const fallbackMatch = fallback?.texts.get(lookup);
    if (!fallbackMatch && (dtapStage !== "production" || debugFlags.gtd)) {
      console.warn(`Cannot find text ${tid} for language ${langcode}, also tried fallback language '${compiled.fallbackLanguage}'`);
    }
    return fallbackMatch ? executeCompiledTidText(fallbackMatch, params, rich, render) : cannotFind(tid);
  }

  if (!match && (dtapStage !== "production" || debugFlags.gtd)) {
    console.warn(`Cannot find text ${tid} for language ${langcode}, no fallback language`);
  }
  return match ? executeCompiledTidText(match, params, rich, render) : cannotFind(tid);
}

function getCanonicalTid(tid: string) {
  if (tid.startsWith("tollium:common.buttons.") || tid.startsWith("tollium:common.actions.") || tid.startsWith("tollium:common.labels.")) {
    return `tollium:tilde.${tid.substring(tid.indexOf(".") + 1)}`;
  } else if (tid.startsWith("~")) {
    return `tollium:tilde.${tid.substring(1)}`;
  }

  return tid;
}

function renderString(tok: string, rich: boolean, render: GetTidRenderFunc | null) {
  return rich ?
    render ?
      tok.split(/(\n)/).map(part => part !== "\n" ? part : render("br", {})).filter(_ => _) :
      [encodeString(tok, "html")] :
    [tok];
}

function executeCompiledTidText(text: string | LanguagePart[], params: string[], rich: boolean, render: GetTidRenderFunc | null): Array<object | string> {
  if (typeof text === "string")
    return renderString(text, rich, render);

  const parts = new Array<object | string>;
  for (const tok of text) {
    if (typeof tok === "string") {
      parts.push(...renderString(tok, rich, render));
    } else if (typeof tok === "number") {
      if (tok >= 1) {
        const get_param = params[tok - 1];
        if (get_param) {
          parts.push(...renderString(get_param, rich, render));
        }
      }
    } else if (tok.t === "tag") {
      const sub = executeCompiledTidText(tok.subs, params, rich, render);
      if (rich && render)
        parts.push(render(tok.tag as keyof HTMLElementTagNameMap, { children: sub }));
      else
        parts.push(...(rich ? [`<${tok.tag}>`, ...sub, `</${tok.tag}>`] : sub));
    } else if (tok.t === "ifparam") {
      const get_param = params[tok.p - 1] || "";
      parts.push(...executeCompiledTidText(get_param.toUpperCase() === tok.value.toUpperCase() ? tok.subs : tok.subselse, params, rich, render));
    } else if (tok.t === "a") {
      const sub = executeCompiledTidText(tok.subs, params, rich, render);
      if (rich) {
        let link = tok.link;
        if (tok.linkparam > 0 && tok.linkparam <= params.length) {
          link = params[tok.linkparam - 1] || link;
        }
        if (link) {
          if (render)
            parts.push(render("a", { href: link, children: sub }));
          else
            parts.push(`<a href="${encodeString(link, "attribute")}">`, ...sub, `</a>`);
        } else {
          parts.push(...sub);
        }
      } else {
        parts.push(...sub);
      }
    }
  }
  return parts;
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
