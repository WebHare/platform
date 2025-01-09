import { rtdParagraphTypes, type HareScriptRTD, RichTextDocument, type RTDBlockItem, type RTDBuildBlock, type RTDBuildBlockItem, type RTDBuildBlockItems, type RTDBuildWidget, rtdTextStyles } from "@webhare/services/src/richdocument";
import { omit } from "@webhare/std";
import { describeWHFSType } from "@webhare/whfs";
import type { WHFSTypeMember } from "@webhare/whfs/src/contenttypes";
import { DOMParser, Node, type Element } from "@xmldom/xmldom";

type BlockItemStack = Pick<RTDBuildBlockItem, "bold" | "italic" | "underline" | "strikeThrough">;

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

async function rebuildInstanceDataFromHSStructure(members: WHFSTypeMember[], data: Record<string, unknown>) {
  const outdata = { ...data };
  for (const member of members) {
    if (member.name in outdata) {
      if (member.type === "richDocument" && outdata[member.name]) {
        const hs = outdata[member.name] as HareScriptRTD;
        outdata[member.name] = await buildRTDFromHSStructure(hs);
      }
    }
  }
  return outdata;
}

class HSRTDImporter {
  outdoc = new RichTextDocument;

  constructor(private inrtd: HareScriptRTD) {

  }

  async reconstructWidget(node: Element): Promise<RTDBuildWidget | null> {
    const matchinginstance = this.inrtd.instances.find(i => i.instanceid === node.getAttribute("data-instanceid"));
    if (!matchinginstance)
      return null;

    const typeinfo = await describeWHFSType(matchinginstance.data.whfstype, { allowMissing: true });
    if (!typeinfo)
      return null; //it must have existed, how can we otherwise have imported it ?

    const setdata = await rebuildInstanceDataFromHSStructure(typeinfo.members, omit(matchinginstance.data, ["whfstype"]));

    return {
      whfsType: matchinginstance.data.whfstype,
      whfsInstanceId: matchinginstance.instanceid,
      ...setdata
    };
  }

  async processInlineWidget(node: Element, state: BlockItemStack, outlist: RTDBuildBlockItems) {
    const widget = await this.reconstructWidget(node);
    if (widget)
      outlist.push({ widget, ...state });
  }

  async processBlockItems(node: Node, state: BlockItemStack, outlist: RTDBuildBlockItems) {
    for (let child = node.firstChild; child; child = child!.nextSibling) {
      if (isElement(child)) {
        const tag = child.tagName.toLowerCase();
        if (tag in rtdTextStyles) {
          await this.processBlockItems(child, { ...state, [(rtdTextStyles as Record<string, string>)[tag]]: true }, outlist);
        } else if (tag === 'span') {
          if (child.hasAttribute("data-instanceid"))
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

      if (tag === "div") {
        const widget = await this.reconstructWidget(child);
        if (widget)
          blocks.push({ widget });
        continue;
      }

      const className = child.getAttribute("class") || '';

      if (rtdParagraphTypes.includes(tag)) {
        const outputtag = className ? `${tag}.${className}` : tag;
        blocks.push({ [outputtag]: await this.getBlockItems(child) });
      };
    }
    return blocks;
  }
}

export async function buildRTDFromHSStructure(rtd: HareScriptRTD): Promise<RichTextDocument> {
  const importer = new HSRTDImporter(rtd);
  const doc = (new DOMParser).parseFromString(await rtd.htmltext.text(), 'text/html');
  const body = doc.getElementsByTagName("body")[0];
  if (body) {
    await importer.outdoc.addBlocks(await importer.parseBlocks(body));
  }

  return importer.outdoc;
}
