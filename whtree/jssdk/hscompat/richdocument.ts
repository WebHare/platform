import { WebHareBlob } from "@webhare/services/src/webhareblob.ts";
import { RichTextDocument, type RTDBlockItem, type RTDBuildBlock, type RTDBuildBlockItem, rtdTextStyles, type Widget, buildWidget, type RTDBlockItems, isValidRTDClassName, type RTDBlock, rtdBlockDefaultClass, type RTDBlockType, rtdBlockTypes } from "@webhare/services/src/richdocument";
import { encodeString, generateRandomId, isTruthy } from "@webhare/std";
import { describeWHFSType } from "@webhare/whfs";
import type { WHFSTypeMember } from "@webhare/whfs/src/contenttypes";
import { Node, type Element } from "@xmldom/xmldom";
import { parseDocAsXML } from "@mod-system/js/internal/generation/xmlhelpers";
import type { RecursiveReadonly } from "@webhare/js-api-tools";

type BlockItemStack = Pick<RTDBuildBlockItem, "bold" | "italic" | "underline" | "strikeThrough" | "link" | "target">;

type ReadonlyWidget = Omit<Readonly<Widget>, "export">;

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

function groupByLink(items: RecursiveReadonly<RTDBlockItems>): ReadonlyArray<{
  link?: string;
  target?: "_blank";
  items: Array<RecursiveReadonly<RTDBlockItem>>;
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

  async reconstructWidget(node: Element): Promise<Widget | null> {
    const matchinginstance = this.inrtd.instances.find(i => i.instanceid === node.getAttribute("data-instanceid"));
    if (!matchinginstance)
      return null;

    const typeinfo = await describeWHFSType(matchinginstance.data.whfstype, { allowMissing: true });
    if (!typeinfo)
      return null; //it must have existed, how can we otherwise have imported it ?

    const setdata = await rebuildInstanceDataFromHSStructure(typeinfo.members, matchinginstance.data);
    const widget = await buildWidget(matchinginstance.data.whfstype, setdata);
    this.outdoc.__hintInstanceId(widget, matchinginstance.instanceid);
    return widget;
  }

  async processInlineWidget(node: Element, state: BlockItemStack, outlist: RTDBlockItems) {
    const widget = await this.reconstructWidget(node);
    if (widget)
      outlist.push({ widget, ...state });
  }

  async processBlockItems(node: Node, state: BlockItemStack, outlist: RTDBlockItems) {
    for (let child = node.firstChild; child; child = child!.nextSibling) {
      if (isElement(child)) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'a' && child.getAttribute('href')) {
          const toSet: Pick<BlockItemStack, "link" | "target"> = {
            link: child.getAttribute('href') || ''
          };
          if (child.getAttribute('target') === '_blank')
            toSet.target = '_blank';

          await this.processBlockItems(child, { ...state, ...toSet }, outlist);
        } else if (tag in rtdTextStyles) {
          await this.processBlockItems(child, { ...state, [(rtdTextStyles as Record<string, string>)[tag]]: true }, outlist);
        } else if (tag === 'span' && child.hasAttribute("data-instanceid")) {
          await this.processInlineWidget(child, state, outlist);
        } else {
          await this.processBlockItems(child, state, outlist);
        }
      } else if (child.nodeType === Node.TEXT_NODE) {
        outlist.push({ text: child.textContent || '', ...state });
      }
    }
  }

  async getBlockItems(el: Element) {
    const items = new Array<RTDBlockItem>;
    await this.processBlockItems(el, {}, items);
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

      const useTag: RTDBlockType = (rtdBlockTypes as readonly string[]).includes(tag) ? tag as RTDBlockType : 'p';
      const setClass = classNames.length && isValidRTDClassName(classNames[0]) ? classNames[0] : '';
      const newblock: RTDBlock = { tag: useTag, items: await this.getBlockItems(child) };
      if (setClass && setClass !== rtdBlockDefaultClass[useTag]) //only set if not default
        newblock.className = setClass;

      blocks.push(newblock);
    }
    return blocks;
  }
}

export async function buildRTDFromHareScriptRTD(rtd: HareScriptRTD): Promise<RichTextDocument> {
  const importer = new HSRTDImporter(rtd);
  const doc = parseDocAsXML(await rtd.htmltext.text(), 'text/html');
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

  async function buildBlockItems(items: RecursiveReadonly<RTDBlockItems>) {
    let output = '';
    for (const linkitem of groupByLink(items)) {
      let linkpart = '';
      for (const item of linkitem.items) {
        let part: string = 'widget' in item ? await exportWidgetForHS(item.widget, false) : encodeString(item.text, 'html');
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
    return output;
  }

  let htmltext = '<html><body>';
  for (const block of rtd.blocks) {
    if ('widget' in block) {
      htmltext += await exportWidgetForHS(block.widget, true);
      continue;
    }

    const className = block.className || rtdBlockDefaultClass[block.tag];
    htmltext += `<${block.tag}${className ? ` class="${encodeString(className, "attribute")}"` : ""}>${await buildBlockItems(block.items)}</${block.tag}>`;
  }

  return {
    htmltext: WebHareBlob.from(htmltext + '</body></html>'),
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
