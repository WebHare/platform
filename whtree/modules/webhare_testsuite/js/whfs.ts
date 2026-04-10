/* WHFS helpers */

import * as test from "@mod-webhare_testsuite/js/wts-backend.ts";
import * as whfs from "@webhare/whfs";
import { XMLSerializer, type Document } from "@xmldom/xmldom";
import { buildContentPageRequest, type CPageRequest } from "@webhare/router/src/siterequest";
import { IncomingWebRequest } from "@webhare/router/src/request";
import { elements, parseDocAsXML } from "@mod-system/js/internal/generation/xmlhelpers";
import type { WHConfigScriptData } from "@webhare/frontend/src/init";
import { throwError } from "@webhare/std";

export function getWHConfig(parseddoc: Document): WHConfigScriptData {
  const config = parseddoc.getElementById("wh-config");
  if (!config)
    throw new Error("No wh-config element found");
  return JSON.parse(config.textContent || "");
}

export function parseResponse(responsetext: string) {
  const doc = parseDocAsXML(responsetext, 'text/html');
  const config = getWHConfig(doc);
  const htmlClasses = doc.documentElement?.getAttribute("class")?.split(" ") ?? [];
  const body = doc.getElementsByTagName("body")[0];
  const contentdiv = doc.getElementById("content");
  const contentElements = contentdiv ? elements(contentdiv.childNodes).
    map(e => new XMLSerializer().serializeToString(e)).
    map(s => s.replaceAll(" xmlns=\"http://www.w3.org/1999/xhtml\"", "")) : [];
  const bodyElements = body ? elements(body.childNodes).
    map(e => new XMLSerializer().serializeToString(e)).
    map(s => s.replaceAll(" xmlns=\"http://www.w3.org/1999/xhtml\"", "")) : [];

  const metaTags = new Map(elements(doc.getElementsByTagName("meta")).filter(m => m.getAttribute("name")).map(m => [m.getAttribute("name") || "", m.getAttribute("content") || ""]));
  const openGraph = test.extractOpenGraphData(doc);
  const schemaOrg = test.extractSchemaOrgData(doc);

  return { responsetext, doc, body, contentElements, bodyElements, htmlClasses, config, metaTags, openGraph, schemaOrg };
}

/** Get the file inline (running its builders in the current script, often easier to debug) */
export async function getAsDoc(whfspath: string) {
  const whfsobj = await whfs.openFile(whfspath);
  const sitereq = await buildContentPageRequest(new IncomingWebRequest(whfsobj.link!), whfsobj);
  const builder = await (sitereq as CPageRequest).getPageRenderer();
  if (!builder)
    throw new Error(`No builder found for this page`);

  const response = await builder(sitereq);

  return { response, ...parseResponse(await response.text()) };
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
export async function fetchPreviewAsDoc(whfspath: string, urlVars: Record<string, string> = {}) {
  const whfsobj = await whfs.openFile(whfspath);
  const link = new URL(await whfsobj.getPreviewLink());
  for (const [key, value] of Object.entries(urlVars))
    link.searchParams.set(key, value);

  console.log(`Fetching preview link for ${whfspath}: ${link}`);
  const fetchResult = await fetch(link);
  test.assert(fetchResult.ok, `Failed to fetch preview link: ${fetchResult.status} ${fetchResult.statusText}`);

  return parseResponse(await fetchResult.text());
}
