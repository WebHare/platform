/* This is an experimental API to build new Rich documents from scratch. It may go away in the future. "Build one to throw away".
*/

import { WebHareBlob } from "@webhare/services";
import { encodeString } from "@webhare/std";
import { __RichDocumentInternal } from "./richdocument";

export interface RTDParagraph {
  blockType: "h1" | "h2" | "h3" | "h4" | "h5" | "p";
  contents: string;
}

export type RTDBlock = RTDParagraph; // | RTDTable etc..

export type RTD = RTDBlock[];

//FIXME: embedded, links, instances
export type HSRichDoc = { htmltext: WebHareBlob };

function createBlock(block: RTDBlock) {
  //default RTD classes
  const className = { "h1": "heading1", "h2": "heading2", "h3": "heading3", "h4": "heading4", "h5": "heading5", "p": "normal" }[block.blockType] ?? "";
  return `<${block.blockType} class="${encodeString(className, 'html')}">${encodeString(block.contents, 'html')}</${block.blockType}>`;
}

export async function createRichDocument(blocks: RTD) {
  const html = `<html><body>${blocks.map(b => createBlock(b)).join("")}</body></html>`;
  return new __RichDocumentInternal(html);
}

export async function createRichDocumentFromHTML(html: Document | HTMLElement | string) {
  return new __RichDocumentInternal(typeof html === "string" ? html : `<html><body>${"documentElement" in html ? html.body.innerHTML : html.outerHTML}</body></html>`);
}

export async function createRichDocumentFromHSRichDoc(richdoc: HSRichDoc) {
  return new __RichDocumentInternal(await richdoc.htmltext.text());
}
