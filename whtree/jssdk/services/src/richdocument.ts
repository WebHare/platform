import { encodeString, generateRandomId, omit, throwError } from "@webhare/std";
import { WebHareBlob } from "./webhareblob";
import { describeWHFSType } from "@webhare/whfs";

/** Paragraph types supported by us */
export const rtdParagraphTypes: string[] = ["h1", "h2", "h3", "h4", "h5", "h6", "p"] as const;
/** Maps h1 etc to a default class if we're building RTDs wthout an explicit RTDType (needed for consistent output) */
export const RTDParagraphDefaults: Record<RTDParagraphType[number], string> = { "h1": "heading1", "h2": "heading2", "h3": "heading3", "h4": "heading4", "h5": "heading5", "p": "normal" } as const;

export type RTDParagraphType = `${typeof rtdParagraphTypes[number]}.${string}`;

/* The 'Build' flag indicates whether its a RTDBlock we will still parse and validate (building) or use as is (returned by RichTextDocument.blocks).
   The non-build version is generally stricter */

type RTDBaseBlock<Build extends boolean> = {
  [key in (Build extends true ? RTDBuildParagraphType : RTDParagraphType)]?: RTDBaseBlockItems<Build> | (Build extends true ? string : never);
} | { widget: RTDBaseWidget<Build> };

/** A rtd widget is a WHFS Instance with additional type and instanceid field. These are 'whfs' prefixed as that prefix is reserved */
type RTDBaseWidget<Build extends boolean> = {
  whfsType: string;
  whfsInstanceId?: string;
  [key: string]: unknown;
} & (Build extends true ? object : { whfsInstanceId: string });

/** The contents of text blocks */
type RTDBaseBlockItems<Build extends boolean> = Array<RTDBaseBlockItem<Build> | (Build extends true ? string : never)>;;

type RTDBaseBlockItem<Build extends boolean> = ({ text: string } | { widget: RTDBaseWidget<Build> }) & {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikeThrough?: boolean;
};

export type RTDBlock = RTDBaseBlock<false>;
export type RTDBlockItem = RTDBaseBlockItem<false>;
export type RTDBlockItems = RTDBlockItem[];
export type RTDWidget = RTDBaseWidget<false>;

export type RTDBuildParagraphType = "h1.heading1" | "h2.heading2" | "h3.heading3" | "h4.heading4" | "h5.heading5" | "h6.heading6" | "p.normal" | typeof rtdParagraphTypes[number] | RTDParagraphType;
export type RTDBuildBlock = RTDBaseBlock<true>;
export type RTDBuildBlockItem = RTDBaseBlockItem<true>;
export type RTDBuildBlockItems = RTDBuildBlockItem[];
export type RTDBuildWidget = RTDBaseWidget<true>;


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


export class RichTextDocument {
  #blocks = new Array<RTDBlock>;
  #instances = new Map<string, RTDWidget>;

  get blocks() {
    return this.#blocks;
  }

  //TODO should we still accept a string constructor now that a WebHareBlob is so easy to build?
  constructor() {
  }

  isEmpty(): boolean {
    return this.#blocks.length === 0;
  }

  //TODO if this becomes public, add proper option arg. and remember that textasblob only affects subrichdocs, not ourselves
  async #buildWidget(source: RTDBuildWidget): Promise<RTDWidget> {
    const typeinfo = await describeWHFSType(source.whfsType);
    if (typeinfo.metaType !== "widgetType") //TODO have describeWHFSType learn about widgetType - it can already enforce fileType/folderType selection
      throw new Error(`Type ${source.whfsType} is not a widget type`); //without this check we'd just be buildWHFSInstance - and maybe we should be?

    const widgetvalue: RTDWidget = {
      whfsType: typeinfo.namespace,
      whfsInstanceId: source.whfsInstanceId || generateRandomId()
    };

    for (const [key, value] of Object.entries(source)) {
      if (key.startsWith('whfs'))
        continue;

      const matchMember = typeinfo.members.find((m) => m.name === key);
      if (!matchMember)
        throw new Error(`Member '${key}' not found in ${source.whfsType}`);

      //FIXME validate types immediately - now we're just hoping setInstanceData will catch mismapping
      // if (matchMember.type === 'richDocument')
      //   widgetvalue[key] = await buildRTD(value as RTDBlock[]);
      // else
      widgetvalue[key] = value;
    }

    if (this.#instances.get(widgetvalue.whfsInstanceId))
      throw new Error(`Duplicate whfsInstanceId ${widgetvalue.inswhfsInstanceIdtanceId}`);

    this.#instances.set(widgetvalue.whfsInstanceId, widgetvalue);
    return widgetvalue;
  }

  async #buildBlockItems(blockitems: RTDBuildBlockItems | string): Promise<RTDBlockItems> {
    if (typeof blockitems === 'string')
      blockitems = [{ text: blockitems }];

    const outitems = new Array<RTDBlockItem>;
    for (const item of blockitems) {
      if (typeof item === 'string') {
        outitems.push({ text: item });
        continue;
      }

      if ('widget' in item) {
        outitems.push({ ...item, widget: await this.#buildWidget(item.widget) });
      } else {
        outitems.push(item);
      }
    }
    return outitems;
  }

  async addBlocks(blocks: RTDBuildBlock[]): Promise<void> {
    //TODO validate, import disk objects etc
    for (const block of blocks) {
      const entries = Object.entries(block);
      if (entries.length === 0)
        throw new Error(`Block is empty`);
      if (entries.length > 1)
        throw new Error(`Only one key per block allowed, got: ${entries.map(_ => _[0]).join(', ')}`);

      const key: string = entries[0][0];
      const data = entries[0][1];
      if (key === 'widget') {
        const subdoc = await this.#buildWidget(data as RTDBuildWidget);
        this.blocks.push({ widget: subdoc });
        // rdoc.htmltext += subdoc.htmltext;
        // rdoc.instances.push(...subdoc.instances);
        continue;
      }

      //If we get here, it has to be one of the H1s etc
      const [tag, className, extra] = key.split('.');
      if (extra !== undefined)
        throw new Error(`Invalid tag name '${key}'`);
      if (!['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'].includes(tag))
        throw new Error(`Invalid tag name '${key}'`);

      const useclass = className || RTDParagraphDefaults[tag] || throwError(`No default class for tag '${tag}'`);
      if (!useclass.match(/^[a-z0-9]+$/))
        throw new Error(`Invalid class name '${className}'`);

      this.blocks.push(({ [`${tag}.${useclass}`]: await this.#buildBlockItems(data!) }));
    }
    //   rdoc.htmltext += `<${tag} class="${encodeString(className || defaultClass[tag], 'attribute')}">`;
    //   addToDoc(rdoc, await encodeContent(data, textasblob));
    //   rdoc.htmltext += `</${tag}>`;
    // }
    // rdoc.htmltext += '</body></html>';
    // if (textasblob)
    //   rdoc.htmltext = WebHareBlob.from(rdoc.htmltext as string);
  }

  async exportAsHareScriptRTD(): Promise<HareScriptRTD> {
    const instances: HareScriptRTD["instances"] = [];
    const embedded: HareScriptRTD["embedded"] = [];
    const links: HareScriptRTD["links"] = [];

    async function buildWidget(widget: RTDWidget, block: boolean) {
      const tag = block ? 'div' : 'span';
      const data: Record<string, unknown> & { whfstype: string } = {
        whfstype: widget.whfsType,
        ...omit(widget, ["whfsType", "whfsInstanceId"])
      };
      //Encode embedded RTDs
      for (const [key, value] of Object.entries(data)) {
        if (value instanceof RichTextDocument)
          data[key] = await value.exportAsHareScriptRTD();
      }

      instances.push({
        data,
        instanceid: widget.whfsInstanceId
      });
      return `<${tag} class="wh-rtd-embeddedobject" data-instanceid="${encodeString(widget.whfsInstanceId, 'attribute')}"></${tag}>`;
    }

    async function buildBlockItems(items: RTDBlockItems) {
      let output = '';
      for (const item of items) {
        let part: string = 'widget' in item ? await buildWidget(item.widget, false) : encodeString(item.text, 'html');
        //FIXME put in standard RTD render ordering
        if (item.underline)
          part = `<u>${part}</u>`;
        if (item.italic)
          part = `<i>${part}</i>`;
        if (item.bold)
          part = `<b>${part}</b>`;
        output += part;
      }
      return output;
    }

    let htmltext = '<html><body>';
    for (const block of this.blocks) {
      if ('widget' in block) {
        htmltext += await buildWidget(block.widget, true);
        continue;
      }

      const key = Object.keys(block)[0] as `${string}.${string}`;
      const [tag, className] = key.split('.');
      htmltext += `<${tag}${className ? ` class="${encodeString(className, "attribute")}"` : ""}>${await buildBlockItems(block[key]!)}</${tag}>`;
    }

    return {
      htmltext: WebHareBlob.from(htmltext + '</body></html>'), instances, embedded, links
    };
  }

  async __getRawHTML(): Promise<string> {
    if (!this.blocks.length)
      return '';
    return await (await this.exportAsHareScriptRTD()).htmltext.text();
  }
}

export async function buildRTD(source: RTDBuildBlock[]): Promise<RichTextDocument> {
  //TODO validate, import disk objects etc
  const outdoc = new RichTextDocument;
  await outdoc.addBlocks(source);
  return outdoc;
}
