import { WebHareBlob } from "@webhare/services/src/webhareblob.ts";
import { RichTextDocument, type RTDInlineItem, type RTDBuildBlock, rtdTextStyles, type RTDInlineItems, isValidRTDClassName, type RTDBlock, rtdBlockDefaultClass, type RTDParagraphType, rtdParagraphTypes, type WHFSInstance, buildWHFSInstance, type RTDListItems, rtdListTypes, type RTDAnonymousParagraph, type RTDParagraph, type RTDList } from "@webhare/services/src/richdocument";
import { encodeString, generateRandomId, isTruthy } from "@webhare/std";
import { describeWHFSType } from "@webhare/whfs";
import type { WHFSTypeMember } from "@webhare/whfs/src/contenttypes";
import { Node, type Element } from "@xmldom/xmldom";
import { parseDocAsXML } from "@mod-system/js/internal/generation/xmlhelpers";
import type { RecursiveReadonly } from "@webhare/js-api-tools";

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
    rotation: number;
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

function groupByLink(items: RecursiveReadonly<RTDInlineItems>): ReadonlyArray<{
  link?: string;
  target?: "_blank";
  items: Array<RecursiveReadonly<RTDInlineItem>>;
}> {
  const blocks = [];
  for (const item of items) {
    if (blocks.length && blocks.at(-1)!.link === item.link && blocks.at(-1)!.target === item.target) {
      blocks.at(-1)!.items.push(item);
    } else {
      blocks.push({ link: item.link, target: item.target, items: [item] });
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
      //We hope to receive RichDocument but some (legacy?) paths will pass a HareScript-encoded RTD here (eg recursive exportAsHareScriptRTD). If we see it, reconstruct as RTD
      if (member.type === "richDocument" && data[member.name] && "htmltext" in (data[member.name] as object)) {
        outdata[member.name] = await buildRTDFromHareScriptRTD(data[member.name] as HareScriptRTD);
      } else {
        outdata[member.name] = data[member.name];
      }
    }
  }
  return outdata;
}

class HSRTDImporter {
  outdoc = new RichTextDocument;

  constructor(private inrtd: HareScriptRTD) {

  }

  async reconstructWidget(node: Element): Promise<WHFSInstance | null> {
    const matchinginstance = this.inrtd.instances.find(i => i.instanceid === node.getAttribute("data-instanceid"));
    if (!matchinginstance)
      return null;

    const typeinfo = await describeWHFSType(matchinginstance.data.whfstype, { allowMissing: true });
    if (!typeinfo)
      return null; //it must have existed, how can we otherwise have imported it ?

    const setdata = await rebuildInstanceDataFromHSStructure(typeinfo.members, matchinginstance.data);
    const widget = await buildWHFSInstance({ ...setdata, whfsType: matchinginstance.data.whfstype });
    this.outdoc.__hintInstanceId(widget, matchinginstance.instanceid);
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
        const toSet: Pick<BlockItemStack, "link" | "target"> = {
          link: child.getAttribute('href') || ''
        };
        if (child.getAttribute('target') === '_blank')
          toSet.target = '_blank';

        await this.processInlineItems(child, { ...state, ...toSet }, outlist);
      } else if (tag in rtdTextStyles) {
        await this.processInlineItems(child, { ...state, [(rtdTextStyles as Record<string, string>)[tag]]: true }, outlist);
      } else if (tag === 'span' && child.hasAttribute("data-instanceid")) {
        await this.processInlineWidget(child, state, outlist);
      } else {
        await this.processInlineItems(child, state, outlist);
      }
    } else if (child.nodeType === Node.TEXT_NODE) {
      outlist.push({ text: child.textContent || '', ...state });
    }
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



export async function buildRTDFromHareScriptRTD(rtd: HareScriptRTD): Promise<RichTextDocument> {
  const importer = new HSRTDImporter(rtd);
  let text = await rtd.htmltext.text();

  if (!text.startsWith("<html"))
    text = `<html><body>${text}</body></html>`; //If it doesn't start with <, we assume it's just a text block

  const doc = parseDocAsXML(text, 'text/html');
  const body = doc.getElementsByTagName("body")[0];
  if (body) {
    await importer.outdoc.addBlocks(await importer.parseBlocks(body));
  }
  return importer.outdoc;
}

/** Build a HareScript record structure RTD. Necessary to communicatee with HareScript (directly and through database storage)
 *  @param recurse - If true, recursively encode embedded widgets. This is usually needed when sending the data off to a HareScript API, but our encoders (WHFS/WRD) will recurse by themselves
*/
export async function exportAsHareScriptRTD(rtd: RichTextDocument, { recurse } = { recurse: true }): Promise<HareScriptRTD> {
  const instances: HareScriptRTD["instances"] = [];
  const embedded: HareScriptRTD["embedded"] = [];
  const links: HareScriptRTD["links"] = [];
  const instancemapping = (rtd as unknown as { __instanceIds: WeakMap<ReadonlyWidget, string> }).__instanceIds;

  async function exportWidgetForHS(widget: ReadonlyWidget, block: boolean) {
    const tag = block ? 'div' : 'span';
    const data: Record<string, unknown> & { whfstype: string } = {
      whfstype: widget.whfsType,
      ...widget.data
    };

    if (recurse) //Encode embedded RTDs. Needed when serializing to HareScript the language, but not by TS instance codev
      for (const [key, value] of Object.entries(data)) {
        if (value instanceof RichTextDocument)
          data[key] = await exportAsHareScriptRTD(value, { recurse });
      }

    // TODO do we need to record these ids? but what if the same widget appears twice? then we still need to unshare the id
    const instanceid = instancemapping.get(widget) || generateRandomId();

    if (instances.find((i) => i.instanceid === instanceid)) //FIXME ensure we never have duplicate instances, in such. fix but make sure we have testcases dealing with 2 identical Widgets with same hinted instance id
      throw new Error(`internal erro0- duplicate instanceid ${instanceid}`);

    instances.push({ data, instanceid });
    return `<${tag} class="wh-rtd-embeddedobject" data-instanceid="${encodeString(instanceid, 'attribute')}"></${tag}>`;
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

      if (linkitem.link)
        linkpart = `<a href="${encodeString(linkitem.link, 'attribute')}"${linkitem.target ? ` target="${encodeString(linkitem.target, 'attribute')}"` : ""}>${linkpart}</a>`;

      output += linkpart;
    }
    if (!gotNonWhitespace)
      output += `<br data-wh-rte="bogus"/>`;
    return output;
  }

  const htmlText = `<html><body>${await buildBlocks(rtd.blocks)}</body></html>`;

  return {
    htmltext: WebHareBlob.from(htmlText),
    instances,
    embedded,
    links
  };
}

/** Get the raw HTML for a RTD (ie <html><body>...) as HareScript would export it */
export async function exportRTDToRawHTML(rtd: RichTextDocument): Promise<string | null> {
  /* we mirror __getRawHTML but that's more of a hack in practice anywyay */
  if (!rtd.blocks.length)
    return null;

  return (await exportAsHareScriptRTD(rtd)).htmltext.text();
}
