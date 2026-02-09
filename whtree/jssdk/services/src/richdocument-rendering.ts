import { litty, rawLitty, type Litty } from "@webhare/litty";
import { rtdBlockDefaultClass, rtdTextStyles, type RichTextDocument, type RTDAnonymousParagraph, type RTDBaseInlineImageItem, type RTDBlock, type RTDInlineItems } from "./richdocument";
import { appendToArray, encodeString, generateRandomId } from "@webhare/std";
import type { PagePartRequest } from "@webhare/router/src/siterequest";
import { groupByLink } from "@webhare/hscompat/src/richdocument";

export async function renderRTD(partRequest: PagePartRequest, rtd: RichTextDocument): Promise<Litty> {
  const linkmapping = rtd["__linkIds"];

  const links = new Map<string, number>();

  async function exportImageForHS(image: RTDBaseInlineImageItem<"inMemory">): Promise<Litty> {
    const classes = ["wh-rtd__img"];
    if (image.float === "left")
      classes.push("wh-rtd__img--floatleft");
    else if (image.float === "right")
      classes.push("wh-rtd__img--floatright");

    if ("externalImage" in image)
      return litty`<img class="${classes.join(" ")}" src="${image.externalImage}" alt="${image.alt || ''}"${image.width && image.height ? ` width="${image.width}" height="${image.height}"` : ''}>`;

    //FIXME use the right method
    const resized = image.image.toResized({ method: "none" });
    return litty`<img class="${classes.join(" ")}" src="${resized.link}" alt="${image.alt || ''}" width="${resized.width}" height="${resized.height}">`;
  }

  async function buildBlocks(blocks: Array<RTDBlock | RTDAnonymousParagraph>): Promise<Litty> {
    return litty`${await Promise.all(blocks.map(buildBlock))}`;
  }

  async function buildBlock(block: RTDBlock | RTDAnonymousParagraph): Promise<Litty> {
    const parts: Litty[] = [];
    if ("widget" in block)
      parts.push(await partRequest.renderWidget(block.widget));
    else if ("listItems" in block) {
      const className = block.className || rtdBlockDefaultClass[block.tag];
      parts.push(litty`<${block.tag}${className ? litty` class="${encodeString(className, "attribute")}"` : ""}>`);
      for (const item of block.listItems)
        parts.push(litty`<li>${await buildBlocks(item.li)}</li>`);
      parts.push(litty`</${block.tag}>`);
    } else if ("items" in block) {
      if (block.tag) {
        const className = block.className || rtdBlockDefaultClass[block.tag];
        parts.push(litty`<${block.tag}${className ? litty` class="${encodeString(className, "attribute")}"` : ""}>${await buildInlineItems(block.items)}</${block.tag}>`);
      } else {
        parts.push(await buildInlineItems(block.items));
      }
    } else {
      block satisfies never;
      throw new Error(`Unhandled block type: ${JSON.stringify(block)}`);
    }
    return litty`${parts}`;
  }

  async function buildInlineItems(items: RTDInlineItems): Promise<Litty> {
    const output: Litty[] = [];
    for (const linkitem of groupByLink(items)) {
      let linkpart: Litty[] = [];
      for (const item of linkitem.items) {
        let part: Litty;
        if ("inlineWidget" in item) {
          part = await partRequest.renderWidget(item.inlineWidget);
        } else if ("image" in item || "externalImage" in item) {
          part = await exportImageForHS(item as RTDBaseInlineImageItem<"inMemory">);
        } else {
          part = rawLitty(encodeString(item.text, 'html'));
        }

        //FIXME put in standard RTD render ordering. Both here and in richdocument.ts
        for (const [style, tag] of Object.entries(rtdTextStyles).reverse()) {
          if (item[tag])
            part = rawLitty(`<${style}>${part}</${style}>`);
        }

        linkpart.push(part);
      }

      if (linkitem.link) {
        let url: string;
        if (linkitem.link.internalLink) {
          //TODO keep hints too?
          const linkid = linkmapping.get(linkitem.link) || generateRandomId();
          links.set(linkid, linkitem.link.internalLink);
          url = `x-richdoclink:${linkid}${linkitem.link.append ?? ""}`;
        } else {
          url = linkitem.link.externalLink || '';
        }

        if (url)
          linkpart = [litty`<a href="${url}"${linkitem.target ? litty` target="${linkitem.target}"` : ""}>${linkpart}</a>`];
      }
      appendToArray(output, linkpart);
    }
    return litty`${output}`;
  }

  return await buildBlocks(rtd.blocks);
}
