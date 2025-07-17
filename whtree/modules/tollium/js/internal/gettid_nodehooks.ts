import { toFSPath } from "@webhare/services";
import type { CompiledLanguageFile, IfParam, LanguagePart, LanguageText } from "../../../../jssdk/gettid/src/types";
import { existsSync, readFileSync } from "node:fs";
import { addResourceChangeListener } from "@webhare/services/src/hmrinternal";
import type { Node, Element } from "@xmldom/xmldom";
import type { CodeContextTidStorage, GetTidHooks } from "@webhare/gettid/src/types";
import { getScopedResource, setScopedResource } from "@webhare/services/src/codecontexts";
import { tidLanguage } from "@webhare/services/src/symbols";
import { parseDocAsXML } from "@mod-system/js/internal/generation/xmlhelpers";


function parseIfParam(node: Element) {
  const retval: IfParam = {
    t: "ifparam",
    p: parseInt(node.getAttribute("p") ?? "0", 10),
    value: node.getAttribute("value") ?? "",
    subs: [],
    subselse: [],
  };

  let inElse = false;
  for (let part = node.firstChild; part; part = part.nextSibling) {
    if (part.nodeName === "else") {
      inElse = true;
    } else if (inElse) {
      retval.subselse.push(parseTextNode(part));
    } else {
      retval.subs.push(parseTextNode(part));
    }
  }

  return retval;
}

function isElement(node: Node): node is Element {
  return node.nodeType === node.ELEMENT_NODE;
}

function parseTextNode(node: Node): LanguagePart {
  if (node.nodeType === node.TEXT_NODE || node.nodeType === node.CDATA_SECTION_NODE) {
    return node.textContent ?? "";
  }

  if (!isElement(node)) {
    throw new Error(`Unexpected node ${node.nodeName}`);
  }

  const localname = node.localName;
  const ns = node.namespaceURI;
  if (ns === "http://www.webhare.net/xmlns/tollium/screens") {
    switch (localname) {
      case "br":
        return "\n";
      case "param":
        return parseInt(node.getAttribute("p") ?? "0", 10);
      case "ifparam":
        return parseIfParam(node);
      default:
        throw new Error(`Unexpected screens node ${localname}`);
    }
  }

  if (ns === "http://www.w3.org/1999/xhtml") {
    switch (localname) {
      case "b":
      case "i":
      case "u":
        return {
          t: "tag",
          tag: localname,
          subs: decodeLanguageText(node),
        };
      case "br":
        return "\n";
      case "a":
        return {
          t: "a",
          link: node.getAttribute("href") ?? "",
          linkparam: parseInt(node.getAttribute("data-href-param") ?? "0", 10),
          target: node.getAttribute("target") ?? "",
          subs: decodeLanguageText(node),
        };
      default:
        throw new Error(`Unexpected HTML node ${localname}`);
    }
  }

  throw new Error(`Unexpected node {${ns}}${localname}`);
}

function decodeLanguageText(node: Element) {
  const outparts: LanguagePart[] = [];
  for (let part = node.firstChild; part; part = part.nextSibling) {
    outparts.push(parseTextNode(part));
  }

  if (outparts.length === 0) {
    return "";
  }

  if (outparts.length === 1 && typeof outparts[0] === "string") {
    return outparts[0];
  }

  return outparts;
}

function readLanguageTexts(element: Element, pathsofar: string, texts: Map<string, LanguageText>) {
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (!isElement(node))
      continue;
    if (node.nodeName === "textgroup") {
      const name = (node.getAttribute("gid") ?? "").toLowerCase();
      readLanguageTexts(node, pathsofar + name + ".", texts);
    } else if (node.nodeName === "text") {
      const name = (node.getAttribute("tid") ?? "").toLowerCase();
      texts.set(pathsofar + name, decodeLanguageText(node));
    }
  }
}

function compileLanguageFile(input: string, texts: Map<string, LanguageText>) {
  //Remove BOM, current XMLDOC no longer ignores it
  if (input.startsWith("\uFEFF"))
    input = input.substring(1);

  const doc = parseDocAsXML(input, 'text/xml');
  if (!doc.documentElement)
    throw new Error("No document element found in language file");

  const fallbackLanguage = doc.documentElement.getAttribute("fallbacklanguage")?.toLowerCase() ?? "";
  const langCode = doc.documentElement.getAttribute("xml:lang")?.toLowerCase() ?? "";
  readLanguageTexts(doc.documentElement, "", texts);
  return { fallbackLanguage, langCode, texts };
}

export function getCompiledLanguageFile(moduleName: string, langcode: string, registered: Map<string, LanguageText>) {
  const texts = new Map(registered);
  const resource = `mod::${moduleName}/language/${langcode}.xml`;
  const resname = toFSPath(resource);
  let retval: CompiledLanguageFile;
  if (!existsSync(resname)) {
    const fallbackresname = toFSPath(`mod::${moduleName}/language/default.xml`);
    const fallbackdata = readFileSync(fallbackresname, 'utf-8');
    if (fallbackdata.length === 0) {
      throw new Error(`Cannot find '${resname}' or the fallback file '${fallbackresname}'`);
    }
    retval = { resource: fallbackresname, ...compileLanguageFile(fallbackdata, texts), registered };
  } else {
    const resdata = readFileSync(resname, 'utf-8');
    retval = { resource: resname, ...compileLanguageFile(resdata, texts), registered };
  }
  addResourceChangeListener(module, retval.resource, () => {
    retval.resource = "";
    retval.texts.clear();
  });
  return retval;
}

export function getGetTidNodeHooks(): GetTidHooks {
  return {
    loader: getCompiledLanguageFile,
    currentLanguage: (language) => {
      if (language)
        setScopedResource<CodeContextTidStorage>(tidLanguage, { language });
      return getScopedResource<CodeContextTidStorage>(tidLanguage)?.language ?? "";
    }
  };
}
