import { WebHareBlob } from "@webhare/services/src/webhareblob.ts";
import { RichTextDocument, type RTDInlineItem, type RTDBuildBlock, rtdTextStyles, type RTDInlineItems, isValidRTDClassName, type RTDBlock, rtdBlockDefaultClass, type RTDParagraphType, rtdParagraphTypes, type WHFSInstance, buildWHFSInstance, type RTDListItems, rtdListTypes, type RTDAnonymousParagraph, type RTDParagraph, type RTDList, type RTDBaseInlineImageItem, type RTDBaseLink, type RTDImageFloat } from "@webhare/services/src/richdocument";
import { encodeString, generateRandomId, isTruthy, throwError } from "@webhare/std";
import { describeWHFSType } from "@webhare/whfs";
import type { WHFSTypeMember } from "@webhare/whfs/src/contenttypes";
import { Node, type Element } from "@xmldom/xmldom";
import { parseDocAsXML } from "@mod-system/js/internal/generation/xmlhelpers";
import type { RecursiveReadonly } from "@webhare/js-api-tools";
import { IntExtLink, ResourceDescriptor } from "@webhare/services";
import type { Rotation } from "@webhare/services/src/descriptor";
import { ComposedDocument } from "@webhare/services/src/composeddocument";

type BlockItemStack = Pick<RTDInlineItem, "bold" | "italic" | "underline" | "strikeThrough" | "link" | "target">;

type ReadonlyWidget = Omit<Readonly<WHFSInstance>, "export">;

export type HareScriptRTD = {
  htmltext: WebHareBlob;
  instances: Array<{
    data: { whfstype: string;[key: string]: unknown };
    instanceid: string;
  }>;
  embedded: Array<{
    contentid: string;
    mimetype: string;
    data: WebHareBlob;
    width: number;
    height: number;
    hash: string;
    filename: string;
    extension: string;
    rotation: Rotation;
    mirrored: boolean;
    refpoint: { x: number; y: number } | null;
    source_fsobject: number;
    dominantcolor: string;
  }>;
  links: Array<{
    tag: string;
    linkref: number;
  }>;
};


function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isSameLink(lhs: RecursiveReadonly<{ link?: IntExtLink; target?: string }>, rhs: RecursiveReadonly<{ link?: IntExtLink; target?: string }>): boolean {
  if (!lhs.link)
    return rhs.link ? false : true;
  if (!rhs.link)
    return false;
  return lhs.target === rhs.target && IntExtLink.isEqual(lhs.link, rhs.link);
}

function groupByLink(items: RecursiveReadonly<RTDInlineItems>): ReadonlyArray<(RTDBaseLink<"inMemory"> | { link?: never }) & { items: Array<RecursiveReadonly<RTDInlineItem>> }> {
  const blocks: Array<(RTDBaseLink<"inMemory"> | { link?: never }) & { items: Array<RecursiveReadonly<RTDInlineItem>> }> = [];
  for (const item of items) {
    if (blocks.length && isSameLink(blocks.at(-1)!, item)) {
      blocks.at(-1)!.items.push(item);
    } else {
      blocks.push({ link: item.link as IntExtLink | undefined, target: item.target, items: [item] });
    }
  }
  return blocks;
}

function parseXSList(input: string | null): string[] {
  if (!input)
    return [];

  return input.replaceAll(/\s+/g, ' ').split(' ').filter(isTruthy);
}

async function rebuildInstanceDataFromHSStructure(members: WHFSTypeMember[], data: Record<string, unknown>) {
  const outdata: Record<string, unknown> = {};
  for (const member of members) {
    if (member.name in data) {
      //We hope to receive RichTextDocument but some (legacy?) paths will pass a HareScript-encoded RTD here (eg recursive exportAsHareScriptRTD). If we see it, reconstruct as RTD
      if (member.type === "richTextDocument" && data[member.name] && "htmltext" in (data[member.name] as object)) {
        outdata[member.name] = await buildRTDFromHareScriptRTD(data[member.name] as HareScriptRTD);
      } else {
        outdata[member.name] = data[member.name];
      }
    }
  }
  return outdata;
}

function importHSEmbeddedResource(resource: HareScriptRTD["embedded"][number]): ResourceDescriptor {
  return new ResourceDescriptor(resource.data, {
    dominantColor: resource.dominantcolor,
    fileName: resource.filename,
    mediaType: resource.mimetype,
    extension: resource.extension,
    hash: resource.hash,
    rotation: resource.rotation,
    mirrored: resource.mirrored,
    refPoint: resource.refpoint,
    height: resource.height,
    width: resource.width,
    sourceFile: resource.source_fsobject,
  });
}

function exportHSEmbeddedResource(resource: ResourceDescriptor, contentid: string): HareScriptRTD["embedded"][number] {
  return {
    dominantcolor: resource.dominantColor || '',
    data: resource.resource,
    filename: contentid,
    mimetype: resource.mediaType,
    extension: resource.extension ?? throwError("ResourceDescriptor must have an extension set"),
    hash: resource.hash ?? throwError("ResourceDescriptor must have a hash set"),
    rotation: resource.rotation ?? 0,
    mirrored: resource.mirrored ?? false,
    refpoint: resource.refPoint,
    width: resource.width || 0,
    height: resource.height || 0,
    contentid,
    source_fsobject: resource.sourceFile || 0
  };
}

class HSRTDImporter {
  outdoc = new RichTextDocument;

  constructor(private inrtd: ComposedDocument) {

  }

  async reconstructWidget(node: Element): Promise<WHFSInstance | null> {
    const instanceid = node.getAttribute("data-instanceid");
    if (!instanceid)
      return null;

    const widget = this.inrtd.instances.get(instanceid);
    if (!widget)
      return null;

    this.outdoc.__hintInstanceId(widget, instanceid);
    return widget;
  }

  async processInlineWidget(node: Element, state: BlockItemStack, outlist: RTDInlineItems) {
    const inlineWidget = await this.reconstructWidget(node);
    if (inlineWidget)
      outlist.push({ inlineWidget, ...state });
  }

  async processInlineItem(child: Node, state: BlockItemStack, outlist: RTDInlineItems) {
    if (isElement(child)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'a' && child.getAttribute('href')) {
        const href = child.getAttribute('href');
        let link;
        //Links starting with x-richdoclink: should exist in the HS RTD's link array. Look it up (and also capture the append e.g #...)
        const richdoclinkmatch = href?.match(/^x-richdoclink:([^?#/]+)(.*)$/);
        if (richdoclinkmatch) {
          const linkid = richdoclinkmatch[1];
          const matchinglink = this.inrtd.links.get(linkid);
          if (matchinglink)
            link = new IntExtLink(matchinglink, { append: richdoclinkmatch[2] });
        } else if (href) { //assume an external link
          link = new IntExtLink(href);
        }

        if (link) { //wrap in link object if we found it
          const toSet: Pick<BlockItemStack, "link" | "target"> = { link };
          if (child.getAttribute('target') === '_blank')
            toSet.target = '_blank';

          await this.processInlineItems(child, { ...state, ...toSet }, outlist);
        } else {
          await this.processInlineItems(child, state, outlist);
        }
      } else if (tag in rtdTextStyles) {
        await this.processInlineItems(child, { ...state, [(rtdTextStyles as Record<string, string>)[tag]]: true }, outlist);
      } else if (tag === 'span' && child.hasAttribute("data-instanceid")) {
        await this.processInlineWidget(child, state, outlist);
      } else if (tag === 'img') {
        await this.processInlineImage(child, state, outlist);
      } else {
        await this.processInlineItems(child, state, outlist);
      }
    } else if (child.nodeType === Node.TEXT_NODE) {
      outlist.push({ text: child.textContent || '', ...state });
    }
  }

  async processInlineImage(node: Element, state: BlockItemStack, outlist: RTDInlineItems) {
    const float: RTDImageFloat | undefined = node.getAttribute("class")?.includes("wh-rtd__img--floatleft") ? "left" :
      node.getAttribute("class")?.includes("wh-rtd__img--floatright") ? "right" : undefined;

    const baseattributes = {
      alt: node.getAttribute("alt") || "",
      width: parseInt(node.getAttribute("width") || "0", 10) || undefined,
      height: parseInt(node.getAttribute("height") || "0", 10) || undefined,
      ...float ? { float } : {}
    };

    let outImg: RTDBaseInlineImageItem<"inMemory">;

    const img = node.getAttribute("src") || '';
    if (!img?.startsWith("cid:")) {
      outImg = { ...baseattributes, externalImage: img };
    } else {
      const contentid = img.substring(4);
      const matchingimage = this.inrtd.embedded.get(contentid);
      if (!matchingimage)
        throw new Error("Inline image not found, contentid: " + contentid);

      outImg = { ...baseattributes, image: matchingimage };
    }
    outlist.push({ ...outImg, ...state });
  }

  async processInlineItems(node: Node, state: BlockItemStack, outlist: RTDInlineItems) {
    for (let child = node.firstChild; child; child = child!.nextSibling)
      await this.processInlineItem(child, state, outlist);
    return outlist;
  }

  async getListItemItems(el: Element): Promise<[RTDAnonymousParagraph, ...RTDList[]]> {
    const anonParagraph: RTDAnonymousParagraph = { items: [] };
    const lists: RTDList[] = [];

    for (let child = el.firstChild; child; child = child!.nextSibling) {
      if (!isElement(child))
        await this.processInlineItem(child, {}, anonParagraph.items);
      else if (!(rtdListTypes as readonly string[]).includes(child.tagName.toLowerCase())) {
        await this.processInlineItems(child, {}, anonParagraph.items);
      } else {
        const classNames = parseXSList(child.getAttribute("class"));
        const setClass = classNames.length && isValidRTDClassName(classNames[0]) ? classNames[0] : '';
        const tag = child.tagName.toLowerCase() as typeof rtdListTypes[number];
        lists.push({
          tag,
          ...(setClass && setClass !== rtdBlockDefaultClass[tag] ? { className: setClass } : {}),
          listItems: await this.getListItems(child)
        });
      }
    }
    return [anonParagraph, ...lists];
  }

  async getListItems(el: Element): Promise<RTDListItems> {
    const items: RTDListItems = [];
    for (let child = el.firstChild; child; child = child!.nextSibling) {
      if (!isElement(child))
        continue;
      if (child.tagName.toLowerCase() !== 'li')
        continue;
      items.push({ li: await this.getListItemItems(child) });
    }
    return items;
  }

  async parseBlocks(node: Element): Promise<RTDBuildBlock[]> {
    const blocks = new Array<RTDBuildBlock>;
    for (let child = node.firstChild; child; child = child!.nextSibling) {
      if (!isElement(child))
        continue;

      const tag = child.tagName.toLowerCase();
      const classNames = parseXSList(child.getAttribute("class"));

      if (tag === "div" && classNames.includes("wh-rtd-embeddedobject")) { //FIXME only enter this path if it's actually an object
        const widget = await this.reconstructWidget(child);
        if (widget)
          blocks.push({ widget });
        continue;
      }

      const setClass = classNames.length && isValidRTDClassName(classNames[0]) ? classNames[0] : '';
      if ((rtdListTypes as readonly string[]).includes(tag)) {
        const newblock: RTDBlock = {
          tag: tag as typeof rtdListTypes[number],
          listItems: await this.getListItems(child)
        };
        if (setClass && setClass !== rtdBlockDefaultClass[tag]) //only set if not default
          newblock.className = setClass;
        blocks.push(newblock);
      } else {
        const useTag: RTDParagraphType = (rtdParagraphTypes as readonly string[]).includes(tag) ? tag as RTDParagraphType : 'p';
        const newblock: RTDParagraph = {
          tag: useTag,
          items: await this.processInlineItems(child, {}, [])
        };
        if (setClass && setClass !== rtdBlockDefaultClass[useTag]) //only set if not default
          newblock.className = setClass;
        blocks.push(newblock);
      }
    }
    return blocks;
  }
}


export async function buildRTDFromComposedDocument(rtd: ComposedDocument): Promise<RichTextDocument> {
  const importer = new HSRTDImporter(rtd);
  let text = await rtd.text.text();

  if (!text.startsWith("<html"))
    text = `<html><body>${text}</body></html>`; //If it doesn't start with <, we assume it's just a text block

  const doc = parseDocAsXML(text, 'text/html');
  const body = doc.getElementsByTagName("body")[0];
  if (body) {
    await importer.outdoc.addBlocks(await importer.parseBlocks(body));
  }
  return importer.outdoc;

}

export async function buildRTDFromHareScriptRTD(rtd: HareScriptRTD): Promise<RichTextDocument> {
  const cdoc = new ComposedDocument("platform:richtextdocument", rtd.htmltext);
  for (const inst of rtd.instances) {
    const typeinfo = await describeWHFSType(inst.data.whfstype, { allowMissing: true });
    if (!typeinfo)
      continue;

    const setdata = await rebuildInstanceDataFromHSStructure(typeinfo.members, inst.data);
    const widget = await buildWHFSInstance({ ...setdata, whfsType: inst.data.whfstype });
    cdoc.instances.set(inst.instanceid, widget);
  }

  for (const link of rtd.links)
    cdoc.links.set(link.tag, link.linkref);

  for (const embed of rtd.embedded)
    cdoc.embedded.set(embed.contentid, importHSEmbeddedResource(embed));

  return buildRTDFromComposedDocument(cdoc);
}

async function expandRTDValues(data: Record<string, unknown>) {
  const newobj: Record<string, unknown> = {};

  //TODO recurse to RTDs embedded in arrays ? but then we
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof RichTextDocument) {
      newobj[key] = await exportAsHareScriptRTD(value);
    } else if (Array.isArray(value)) {
      newobj[key] = [];
      for (const item of value) {
        if (item instanceof RichTextDocument) {
          (newobj[key] as unknown[]).push(await exportAsHareScriptRTD(item));
        } else {
          (newobj[key] as unknown[]).push(item);
        }
      }
    } else {
      newobj[key] = value;
    }
  }
  return newobj;
}

/** Build a HareScript record structure RTD. Necessary to communicate with HareScript (directly and through database storage)
 * @param rtd - RTD to export
*/
export async function exportAsHareScriptRTD(rtd: RichTextDocument): Promise<HareScriptRTD> {
  const exp = await exportRTDAsComposedDocument(rtd, { recurse: false });

  const instances: HareScriptRTD["instances"] = [];
  for (const [instanceid, instance] of exp.instances) {
    instances.push({
      instanceid,
      data: {
        whfstype: instance.whfsType,
        ...await expandRTDValues(instance.data)
      }
    });
  }

  const embedded: HareScriptRTD["embedded"] = [...exp.embedded.entries()].map(([contentid, val]) => exportHSEmbeddedResource(val, contentid));
  const links: HareScriptRTD["links"] = [...exp.links.entries()].map(([tag, val]) => ({ linkref: val, tag }));

  return {
    htmltext: exp.text,
    instances,
    embedded,
    links
  };
}

/** Build a composed document structure RTD. Necessary to communicate with HareScript (directly and through database storage)
 * @param rtd - RTD to export
 * @param options - Options
 * @param options.recurse - If true, recursively encode embedded widgets. This is usually needed when sending the data off to a HareScript API, but our encoders (WHFS/WRD) will recurse by themselves
*/
export async function exportRTDAsComposedDocument(rtd: RichTextDocument, { recurse } = { recurse: true }): Promise<ComposedDocument> {
  const instancemapping = (rtd as unknown as { __instanceIds: WeakMap<ReadonlyWidget, string> }).__instanceIds;
  const imagemapping = (rtd as unknown as { __imageIds: WeakMap<RTDBaseInlineImageItem<"inMemory">, string> }).__imageIds;
  const linkmapping = (rtd as unknown as { __linkIds: WeakMap<IntExtLink, string> }).__linkIds;

  const instances = new Map<string, WHFSInstance>();
  const embedded = new Map<string, ResourceDescriptor>();
  const links = new Map<string, number>();

  async function exportWidgetForHS(widget: ReadonlyWidget, block: boolean) {
    const tag = block ? 'div' : 'span';
    // TODO do we need to record these ids? but what if the same widget appears twice? then we still need to unshare the id
    const instanceid = instancemapping.get(widget) || generateRandomId();

    if (instances.has(instanceid)) //FIXME ensure we never have duplicate instances, in such. fix but make sure we have testcases dealing with 2 identical Widgets with same hinted instance id
      throw new Error(`internal erro0- duplicate instanceid ${instanceid}`);

    instances.set(instanceid, widget as WHFSInstance);
    return `<${tag} class="wh-rtd-embeddedobject" data-instanceid="${encodeString(instanceid, 'attribute')}"></${tag}>`;
  }

  async function exportImageForHS(image: RTDBaseInlineImageItem<"inMemory">) {
    const classes = ["wh-rtd__img"];
    if (image.float === "left")
      classes.push("wh-rtd__img--floatleft");
    else if (image.float === "right")
      classes.push("wh-rtd__img--floatright");

    let link: string;
    if ("externalImage" in image) {
      link = image.externalImage;
    } else {
      const contentid = imagemapping.get(image) || generateRandomId();
      embedded.set(contentid, image.image);
      link = `cid:${contentid}`;
    }
    return `<img class="${classes.join(" ")}" src="${encodeString(link, 'attribute')}" alt="${encodeString(image.alt || '', 'attribute')}"${image.width && image.height ? ` width="${image.width}" height="${image.height}"` : ''}/>`;
  }

  async function buildBlocks(blocks: RecursiveReadonly<Array<RTDBlock | RTDAnonymousParagraph>>) {
    let htmlText = '';
    for (const item of blocks)
      htmlText += await buildBlock(item);
    return htmlText;
  }

  async function buildBlock(block: RecursiveReadonly<RTDBlock | RTDAnonymousParagraph>) {
    let htmlText = '';
    if ("widget" in block)
      htmlText += await exportWidgetForHS(block.widget, true);
    else if ("listItems" in block) {
      const className = block.className || rtdBlockDefaultClass[block.tag];
      htmlText += `<${block.tag}${className ? ` class="${encodeString(className, "attribute")}"` : ""}>`;
      for (const item of block.listItems)
        htmlText += `<li>${await buildBlocks(item.li)}</li>`;
      htmlText += `</${block.tag}>`;
    } else if ("items" in block) {
      if (block.tag) {
        const className = block.className || rtdBlockDefaultClass[block.tag];
        htmlText += `<${block.tag}${className ? ` class="${encodeString(className, "attribute")}"` : ""}>${await buildInlineItems(block.items)}</${block.tag}>`;
      } else {
        htmlText += await buildInlineItems(block.items);
      }
    } else {
      block satisfies never;
      throw new Error(`Unhandled block type: ${JSON.stringify(block)}`);
    }
    return htmlText;
  }

  async function buildInlineItems(items: RecursiveReadonly<RTDInlineItems>) {
    let gotNonWhitespace = false;
    let output = '';
    for (const linkitem of groupByLink(items)) {
      let linkpart = '';
      for (const item of linkitem.items) {
        let part: string;
        if ("inlineWidget" in item) {
          gotNonWhitespace = true;
          part = await exportWidgetForHS(item.inlineWidget, false);
        } else if ("image" in item || "externalImage" in item) {
          gotNonWhitespace = true;
          part = await exportImageForHS(item as RTDBaseInlineImageItem<"inMemory">);
        } else {
          part = encodeString(item.text, 'html');
          if (!gotNonWhitespace && part.trim())
            gotNonWhitespace = true;
        }

        //FIXME put in standard RTD render ordering
        for (const [style, tag] of Object.entries(rtdTextStyles).reverse()) {
          if (item[tag])
            part = `<${style}>${part}</${style}>`;
        }

        linkpart += part;
      }

      if (linkitem.link) {
        let url: string;
        if (linkitem.link.internalLink) {
          //TODO keep hints too?
          const linkid = linkmapping.get(linkitem.link) || generateRandomId();
          links.set(linkid, linkitem.link.internalLink);
          url = `x-richdoclink:${linkid}${linkitem.link.append}`;
        } else {
          url = linkitem.link.externalLink || '';
        }

        if (url)
          linkpart = `<a href="${encodeString(url, 'attribute')}"${linkitem.target ? ` target="${encodeString(linkitem.target, 'attribute')}"` : ""}>${linkpart}</a>`;
      }

      output += linkpart;
    }
    if (!gotNonWhitespace)
      output += `<br data-wh-rte="bogus"/>`;
    return output;
  }

  const htmlText = `<html><body>${await buildBlocks(rtd.blocks)}</body></html>`;

  return new ComposedDocument("platform:richtextdocument", WebHareBlob.from(htmlText), {
    instances,
    embedded,
    links
  });
}

/** Get the raw HTML for a RTD (ie <html><body>...) as HareScript would export it */
export async function exportRTDToRawHTML(rtd: RichTextDocument): Promise<string | null> {
  /* we mirror __getRawHTML but that's more of a hack in practice anywyay */
  if (!rtd.blocks.length)
    return null;

  return (await exportAsHareScriptRTD(rtd)).htmltext.text();
}
