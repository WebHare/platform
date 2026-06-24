/* WHFS helpers */

import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import * as whfs from "@webhare/whfs";
import type { Document } from "@xmldom/xmldom";
import { createContentPageRequest, type CPageRequest } from "@webhare/router/src/siterequest";
import { IncomingWebRequest } from "@webhare/router/src/request";
import { elements, parseDocAsXML, xmlToJS } from "@mod-system/js/internal/generation/xmlhelpers";
import type { WHConfigScriptData } from "@webhare/frontend/src/init";
import { attempt, throwError } from "@webhare/std";
import { decodeHSONorJSONRecord } from "@webhare/hscompat";
import type { PageMetadata } from "@webhare/router/src/metadata";
import { CodeContext } from "@webhare/services/src/codecontexts";

export function getWHConfig(parseddoc: Document): WHConfigScriptData {
  const config = parseddoc.getElementById("wh-config");
  if (!config)
    throw new Error("No wh-config element found");
  return JSON.parse(config.textContent || "");
}

export function parseResponse(responsetext: string) {
  const doc = parseDocAsXML(responsetext, 'text/html', { rewriteHTML: true });
  const config = attempt(() => getWHConfig(doc), null);
  const htmlClasses = doc.documentElement?.getAttribute("class")?.split(" ") ?? [];
  const body = doc.getElementsByTagName("body")[0];
  const contentNode = doc.getElementById("content");
  const contentDiv = contentNode ? xmlToJS(contentNode) : null;
  //eliminate empty toplevel nodes:
  const contentElements = contentDiv?.children.filter(child => typeof child === "object" || child.trim()) || [];
  const bodyElements = body ? xmlToJS(body).children.filter(child => typeof child === "object" || child.trim()) : [];
  const metaTags = new Map(elements(doc.getElementsByTagName("meta")).filter(m => m.getAttribute("name")).map(m => [m.getAttribute("name") || "", m.getAttribute("content") || ""]));
  const linkTags = elements(doc.getElementsByTagName("link")).map(m => ({ rel: m.getAttribute("rel") || '', href: m.getAttribute("href") || '' }));
  const linkMap = Map.groupBy(linkTags, tag => tag.rel);
  const openGraph = test.extractOpenGraphData(doc);
  const schemaOrg = test.extractSchemaOrgData(doc);

  const consilioFieldElement = doc.getElementById("wh-consiliofields");
  //TODO HS & TS should both switch to <meta name="consilio.xxx" /> fields and avoid HSON in JS paths
  const consilioFields = consilioFieldElement ? decodeHSONorJSONRecord(consilioFieldElement.textContent || "") as PageMetadata["consilioFields"] : {};

  return { responsetext, contentDiv, doc, body, contentElements, bodyElements, htmlClasses, config, metaTags, openGraph, schemaOrg, linkTags, linkMap, consilioFields };
}

/** Get the file inline (running its builders in the current script, often easier to debug) */
export async function getAsDoc(whfspath: string) {
  await using cc = new CodeContext("getAsDoc", { whfspath });
  const { response, link } = await cc.run(async () => {
    const whfsobj = await whfs.openFile(whfspath);
    const sitereq = await createContentPageRequest(whfsobj, { webRequest: new IncomingWebRequest(whfsobj.link!) });
    sitereq.applyToCurrentContext();

    const builder = await (sitereq as CPageRequest).getPageRenderer();
    if (!builder)
      throw new Error(`No builder found for this page`);

    return { response: await builder(sitereq), link: whfsobj.link };
  });
  return { response, ...parseResponse(await response.text()), url: link };
}

/** Fetch the final version of a file */
export async function fetchAsDoc(whfspath: string, urlVars: Record<string, string> = {}) {
  const whfsobj = await whfs.openFile(whfspath);
  const link = new URL(whfsobj.link || throwError(`File ${whfspath} has no link`));
  for (const [key, value] of Object.entries(urlVars))
    link.searchParams.set(key, value);

  console.log(`Fetching ${whfspath}: ${link}`);
  const fetchResult = await fetch(link);
  test.assert(fetchResult.ok, `Failed to fetch ${whfspath}: ${fetchResult.status} ${fetchResult.statusText}`);

  return parseResponse(await fetchResult.text());
}

/** Fetch the preview for a file */
export async function fetchPreviewAsDoc(toPreview: string | number, urlVars: Record<string, string> = {}) {
  const whfsobj = await whfs.openFile(toPreview, { allowHistoric: true });
  const link = new URL(await whfsobj.getPreviewLink());
  for (const [key, value] of Object.entries(urlVars))
    link.searchParams.set(key, value);

  console.log(`Fetching preview link for ${toPreview}: ${link}`);
  const fetchResult = await fetch(link);
  test.assert(fetchResult.ok, `Failed to fetch preview link: ${fetchResult.status} ${fetchResult.statusText}`);

  return { ...parseResponse(await fetchResult.text()), headers: fetchResult.headers, url: link.toString() };
}

export async function listObjHistory(id: number) {
  return await (await whfs.openFileOrFolder(id)).listHistory();
}
