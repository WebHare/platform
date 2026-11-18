import { litty, rawLitty, type Litty } from "@webhare/litty";
import { rtdBlockDefaultClass, rtdTextStyles, type RichTextDocument, type RTDAnonymousParagraph, type RTDBaseInlineImageItem, type RTDBaseTable, type RTDBaseTableCell, type RTDBlock, type RTDInlineItems } from "./richdocument";
import { appendToArray, encodeString, maybePromiseAll } from "@webhare/std";
import type { PagePartRequest } from "@webhare/router/src/siterequest";
import { groupByLink } from "@webhare/hscompat/src/richdocument";
import type { IntExtLink } from "./intextlink";
import { isResizableImage } from "./descriptor";
import type { CSPRTDStructure } from "@webhare/whfs/src/siteprofiles";
import { lookupRTDBlockStyle } from "./richdocument-styles";

export type RTDRenderingOptions = {
  maxImageWidth?: number;
  resolveLink?: (link: IntExtLink) => Promise<string | null>;
  /** Structure of the RTD type to render with. Blocks get the tag and class of their block style in this RTD type, like HareScript does.
      Without a structure blocks are rendered with their own tag and class */
  structure?: CSPRTDStructure | null;
};

const listTags = ["ul", "ol"];

/** The text styles (eg 'b', 'a-href', 'img') a block style allows, and the tags to render bold and italic with. Null if all text styles are allowed */
type TextStyleFilter = { allowed: string[]; tagB: string; tagI: string } | null;

export async function renderRTD(partRequest: PagePartRequest, rtd: RichTextDocument, options?: RTDRenderingOptions): Promise<Litty> {
  /** Get the tag, class and allowed text styles to render a paragraph or list with */
  function getBlockRendering<Tag extends keyof typeof rtdBlockDefaultClass>(tag: Tag, className: string | undefined): { tag: string; className: string; textStyles: TextStyleFilter } {
    const useClassName = className || rtdBlockDefaultClass[tag];
    const style = options?.structure ? lookupRTDBlockStyle(options.structure, tag, useClassName) : null;
    const textStyles = style && options?.structure ? { allowed: style.textstyles, tagB: options.structure.tag_b || "b", tagI: options.structure.tag_i || "i" } : null;
    //Only take the style if it keeps a list a list and a paragraph a paragraph. HareScript can't change those either while rendering
    if (style && style.type === "text" && listTags.includes(style.containertag.toLowerCase()) === listTags.includes(tag))
      return { tag: style.containertag.toLowerCase(), className: style.tag.toLowerCase(), textStyles };
    return { tag, className: useClassName, textStyles };
  }

  function getTableClass(className: string | undefined): string {
    const useClassName = className || rtdBlockDefaultClass.table;
    const style = options?.structure ? lookupRTDBlockStyle(options.structure, "table", useClassName) : null;
    return style?.type === "table" ? style.tag.toLowerCase() : useClassName;
  }

  async function exportImageForHS(image: RTDBaseInlineImageItem<"inMemory">): Promise<Litty> {
    const classes = ["wh-rtd__img"];
    if (image.float === "left")
      classes.push("wh-rtd__img--floatleft");
    else if (image.float === "right")
      classes.push("wh-rtd__img--floatright");

    if ("externalImage" in image)
      return litty`<img class="${classes.join(" ")}" src="${image.externalImage}" alt="${image.alt || ''}"${image.width && image.height ? ` width="${image.width}" height="${image.height}"` : ''}>`;

    //Like HS, render only the alt text for images we can't resize, such as SVGs or images without known dimensions
    if (!isResizableImage(image.image))
      return litty`${image.alt || ''}`;

    //FIXME use the right method
    let setWidth = image.width ?? image.image.width;
    if (options?.maxImageWidth && setWidth && setWidth > options.maxImageWidth)
      setWidth = options.maxImageWidth;

    const resized = image.image.toResized(setWidth ? { method: "scale", width: setWidth } : { method: "none" });
    return litty`<img class="${classes.join(" ")}" src="${resized.link}" alt="${image.alt || ''}" width="${resized.width}" height="${resized.height}">`;
  }

  /** Render blocks
      @param listTextStyles - Text styles allowed in the anonymous paragraphs of the list items we're rendering. Like HareScript, these use the list's block style */
  async function buildBlocks(blocks: Array<RTDBlock | RTDAnonymousParagraph>, listTextStyles: TextStyleFilter = null): Promise<Litty> {
    const rendered: Litty[] = [];
    // Use a for loop to prevent multiple buildBlock processes from running simultaneously
    for (const block of blocks)
      rendered.push(await buildBlock(block, listTextStyles));
    return litty`${rendered}`;
  }

  async function buildBlock(block: RTDBlock | RTDAnonymousParagraph, listTextStyles: TextStyleFilter): Promise<Litty> {
    const parts: Litty[] = [];
    if ("widget" in block)
      parts.push(await partRequest.renderWidget(block.widget));
    else if ("listItems" in block) {
      const { tag, className, textStyles } = getBlockRendering(block.tag, block.className);
      parts.push(litty`<${tag}${className ? litty` class="${className}"` : ""}>`);
      for (const item of block.listItems)
        parts.push(litty`<li>${await buildBlocks(item.li, textStyles)}</li>`);
      parts.push(litty`</${tag}>`);
    } else if ("items" in block) {
      if (block.tag) {
        const { tag, className, textStyles } = getBlockRendering(block.tag, block.className);
        parts.push(litty`<${tag}${className ? litty` class="${className}"` : ""}>${await buildInlineItems(block.items, textStyles)}</${tag}>`);
      } else {
        parts.push(await buildInlineItems(block.items, listTextStyles));
      }
    } else if (block.tag === "table") {
      parts.push(await buildTable(block));
    } else {
      block satisfies never;
      throw new Error(`Unhandled block type: ${JSON.stringify(block)}`);
    }
    return litty`${parts}`;
  }

  /** Render inline items, leaving out the text styles, links and images the block style doesn't allow (like HareScript does) */
  async function buildInlineItems(items: RTDInlineItems, textStyles: TextStyleFilter): Promise<Litty> {
    const isAllowed = (style: string) => !textStyles || textStyles.allowed.includes(style);
    const output: Litty[] = [];
    for (const linkitem of groupByLink(items)) {
      let linkpart: Litty[] = [];
      for (const item of linkitem.items) {
        let part: Litty;
        if ("inlineWidget" in item) {
          part = await partRequest.renderWidget(item.inlineWidget);
        } else if ("image" in item || "externalImage" in item) {
          part = isAllowed("img") ? await exportImageForHS(item as RTDBaseInlineImageItem<"inMemory">) : litty`${item.alt || ''}`;
        } else {
          part = rawLitty(encodeString(item.text, 'html'));
        }

        //FIXME put in standard RTD render ordering. Both here and in richdocument.ts
        for (const [style, tag] of Object.entries(rtdTextStyles).reverse()) {
          if (item[tag] && isAllowed(style)) {
            const useTag = style === "b" ? textStyles?.tagB ?? "b" : style === "i" ? textStyles?.tagI ?? "i" : style;
            part = litty`<${useTag}>${part}</${useTag}>`;
          }
        }

        linkpart.push(part);
      }

      if (linkitem.link && isAllowed("a-href")) {
        const url = options?.resolveLink ? await options.resolveLink(linkitem.link) : await linkitem.link.resolve();
        if (url)
          linkpart = [litty`<a href="${url}"${linkitem.target ? litty` target="${linkitem.target}"` : ""}>${linkpart}</a>`];
      }
      appendToArray(output, linkpart);
    }
    if (!output.length)
      return litty`<br>`; //ensure an empty paragraph has height
    return litty`${output}`;
  }

  async function buildTableCell(cell: RTDBaseTableCell<"inMemory">): Promise<Litty> {
    //We're building a raw string here, so we need to manually encoe too
    let prefix = cell.scope ? `<th scope="${encodeString(cell.scope, "attribute")}"` : `<td`;
    const className = ("wh-rtd__tablecell " + (cell.className || "")).trim();
    prefix += ` class="${encodeString(className, "attribute")}"`;
    if (cell.colSpan && cell.colSpan > 1)
      prefix += ` colspan="${cell.colSpan}"`;
    if (cell.rowSpan && cell.rowSpan > 1)
      prefix += ` rowspan="${cell.rowSpan}"`;
    prefix += `>`;

    return litty`${[rawLitty(prefix), await buildBlocks(cell.cellItems), rawLitty(cell.scope ? `</th>` : `</td>`)]}`;
  }

  async function buildTableRow(row: RTDBaseTable<"inMemory">["rowGroups"][number]["rows"][number]): Promise<Litty> {
    const cells = await maybePromiseAll(row.cells.map(cell => buildTableCell(cell)));
    let className = '';
    if (row.cells.some(_ => _.scope === "col"))
      className += " wh-rtd--hascolheader";
    if (row.cells.some(_ => _.scope === "row"))
      className += " wh-rtd--hasrowheader";

    return litty`<tr${className ? litty` class="${className.trim()}"` : ""}>${cells}</tr>`;
  }

  async function buildTable(table: RTDBaseTable<"inMemory">): Promise<Litty> {
    const colgroups = table.colGroups.map(colgroup => litty`<colgroup>${colgroup.cols.map(col => litty`<col style="width: ${col.width}px;">`)}</colgroup>`);
    const rowgroups = (await maybePromiseAll(table.rowGroups.map(rowgroup => maybePromiseAll(rowgroup.rows.map(buildTableRow))))).flat();

    const tableClass = getTableClass(table.className);
    const wrapperClassName = `wh-rtd__tablewrap ${tableClass}`;
    const className = `wh-rtd__table ${tableClass}`;
    return litty`<div class="${wrapperClassName}"><table class="${className}">${table.caption ? litty`<caption class="wh-rtd__tablecaption">${table.caption}</caption>` : ""}${colgroups}<tbody>${rowgroups}</tbody></table></div>`;
  }

  return await buildBlocks(rtd.blocks);
}
