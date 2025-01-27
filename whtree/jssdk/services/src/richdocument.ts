import { throwError } from "@webhare/std";
import { describeWHFSType } from "@webhare/whfs";
import type { WHFSTypeInfo } from "@webhare/whfs/src/contenttypes";
import type { RecursiveReadonly } from "@webhare/js-api-tools";
import { exportRTDToRawHTML } from "@webhare/hscompat";

/** Paragraph types supported by us */
export const rtdParagraphTypes: string[] = ["h1", "h2", "h3", "h4", "h5", "h6", "p"] as const;
/** Maps h1 etc to a default class if we're building RTDs wthout an explicit RTDType (needed for consistent output) */
export const RTDParagraphDefaults: Record<RTDParagraphType[number], string> = { "h1": "heading1", "h2": "heading2", "h3": "heading3", "h4": "heading4", "h5": "heading5", "p": "normal" } as const;
/** Simple text styles and their order */
export const rtdTextStyles = { //Note that a-href is higher than all these styles. See also this.textstyletags in structurededitor
  "i": "italic",
  "b": "bold",
  "u": "underline",
  "strike": "strikeThrough",
  "sub": "subScript",
  "sup": "superScript",
} as const;


export type RTDParagraphType = `${typeof rtdParagraphTypes[number]}.${string}`;

/* The 'Build' flag indicates whether its a RTDBlock we will still parse and validate (building) or use as is (returned by RichTextDocument.blocks).
   The non-build version is generally stricter */

type RTDBaseBlock<Build extends boolean> = {
  [key in (Build extends true ? RTDBuildParagraphType : RTDParagraphType)]?: RTDBaseBlockItems<Build> | (Build extends true ? string : never);
} | { widget: Readonly<WidgetInterface> };

/** The contents of text blocks */
type RTDBaseBlockItems<Build extends boolean> = Array<RTDBaseBlockItem | (Build extends true ? string : never)>;;

type RTDBaseBlockItem = ({ text: string } | { widget: Readonly<WidgetInterface> }) & {
  [key in typeof rtdTextStyles[keyof typeof rtdTextStyles]]?: boolean;
};

export type RTDBlock = RTDBaseBlock<false>;
export type RTDBlockItem = RTDBaseBlockItem;
export type RTDBlockItems = RTDBlockItem[];

export type RTDBuildParagraphType = "h1.heading1" | "h2.heading2" | "h3.heading3" | "h4.heading4" | "h5.heading5" | "h6.heading6" | "p.normal" | typeof rtdParagraphTypes[number] | RTDParagraphType;
export type RTDBuildBlock = RTDBaseBlock<true>;
export type RTDBuildBlockItem = RTDBaseBlockItem;
export type RTDBuildBlockItems = RTDBuildBlockItem[];

export function isValidRTDClassName(className: string): boolean {
  return className === "" || /^[a-z0-9]+$/.test(className);
}


class Widget {
  #typeInfo: WHFSTypeInfo;
  #data: Record<string, unknown>;

  constructor(typeinfo: WHFSTypeInfo, data: Record<string, unknown>) {
    this.#typeInfo = typeinfo;
    this.#data = data;
  }

  get whfsType() {
    return this.#typeInfo.namespace;
  }

  get data() {
    return this.#data;
  }
}

///build separate type as Widget isn't currently constructable. The 'export type' trick won't work with private members
type WidgetInterface = Pick<Widget, "whfsType" | "data">;

export class RichTextDocument {
  #blocks = new Array<RTDBlock>;
  //need to expose this for hscompat APIs
  private __instanceIds = new WeakMap<Readonly<Widget>, string>;

  get blocks(): RecursiveReadonly<RTDBlock[]> {
    return this.#blocks;
  }

  //TODO should we still accept a string constructor now that a WebHareBlob is so easy to build?
  constructor() {
  }

  isEmpty(): boolean {
    return this.#blocks.length === 0;
  }

  // //TODO if this becomes public, add proper option arg. and remember that textasblob only affects subrichdocs, not ourselves
  // async #buildWidget(source: RTDBuildWidget): Promise<RTDWidget> {
  //   const typeinfo = await describeWHFSType(source.whfsType);
  //   if (typeinfo.metaType !== "widgetType") //TODO have describeWHFSType learn about widgetType - it can already enforce fileType/folderType selection
  //     throw new Error(`Type ${source.whfsType} is not a widget type`); //without this check we'd just be buildWHFSInstance - and maybe we should be?

  //   const widgetvalue: RTDWidget = {
  //     whfsType: typeinfo.namespace,
  //     whfsInstanceId: source.whfsInstanceId || generateRandomId()
  //   };

  //   for (const [key, value] of Object.entries(source)) {
  //     if (key.startsWith('whfs'))
  //       continue;

  //     const matchMember = typeinfo.members.find((m) => m.name === key);
  //     if (!matchMember)
  //       throw new Error(`Member '${key}' not found in ${source.whfsType}`);

  //     //FIXME validate types immediately - now we're just hoping setInstanceData will catch mismapping
  //     // if (matchMember.type === 'richDocument')
  //     //   widgetvalue[key] = await buildRTD(value as RTDBlock[]);
  //     // else
  //     widgetvalue[key] = value;
  //   }

  //   if (this.#instances.get(widgetvalue.whfsInstanceId))
  //     throw new Error(`Duplicate whfsInstanceId ${widgetvalue.inswhfsInstanceIdtanceId}`);

  //   this.#instances.set(widgetvalue.whfsInstanceId, widgetvalue);
  //   return widgetvalue;
  // }

  async #buildBlockItems(blockitems: RTDBuildBlockItems | string): Promise<RTDBlockItems> {
    if (typeof blockitems === 'string')
      blockitems = [{ text: blockitems }];

    const outitems = new Array<RTDBlockItem>;
    for (const item of blockitems) {
      if (typeof item === 'string') {
        outitems.push({ text: item });
        continue;
      }

      // if ('widget' in item) {
      //   outitems.push({ ...item, widget: await this.#buildWidget(item.widget) });
      // } else {
      outitems.push(item);
      // }
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
        // const subdoc = await this.#buildWidget(data as RTDBuildWidget);
        this.#blocks.push({ widget: data });
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
      if (!isValidRTDClassName(useclass))
        throw new Error(`Invalid class name '${className}'`);

      this.#blocks.push(({ [`${tag}.${useclass}`]: await this.#buildBlockItems(data!) }));
    }
    //   rdoc.htmltext += `<${tag} class="${encodeString(className || defaultClass[tag], 'attribute')}">`;
    //   addToDoc(rdoc, await encodeContent(data, textasblob));
    //   rdoc.htmltext += `</${tag}>`;
    // }
    // rdoc.htmltext += '</body></html>';
    // if (textasblob)
    //   rdoc.htmltext = WebHareBlob.from(rdoc.htmltext as string);
  }

  /** @deprecated Use exportRTDToRawHTML in hscompat */
  async __getRawHTML(): Promise<string> {
    return (await exportRTDToRawHTML(this)) || '';
  }

  __hintInstanceId(widget: WidgetInterface, instanceId: string) {
    if (this.__instanceIds.get(widget))
      this.__instanceIds.set(widget, instanceId);
  }
}

export async function buildRTD(source: RTDBuildBlock[]): Promise<RichTextDocument> {
  //TODO validate, import disk objects etc
  const outdoc = new RichTextDocument;
  await outdoc.addBlocks(source);
  return outdoc;
}

export async function buildWidget(ns: string, data?: object): Promise<WidgetInterface> {
  const typeinfo = await describeWHFSType(ns);
  if (typeinfo.metaType !== "widgetType") //TODO have describeWHFSType learn about widgetType - it can already enforce fileType/folderType selection
    throw new Error(`Type ${ns} is not a widget type`); //without this check we'd just be buildWHFSInstance - and maybe we should be?

  const widgetValue: Record<string, unknown> = {};
  if (data)
    for (const [key, value] of Object.entries(data)) {
      const matchMember = typeinfo.members.find((m) => m.name === key);
      if (!matchMember)
        throw new Error(`Member '${key}' not found in ${ns}`);

      //FIXME validate types immediately - now we're just hoping setInstanceData will catch mismapping
      widgetValue[key] = value;
    }


  return new Widget(typeinfo, widgetValue);
}

export type { WidgetInterface as Widget };
