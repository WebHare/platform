import { omit, throwError } from "@webhare/std";
import { describeWHFSType } from "@webhare/whfs";
import type { WHFSInstance, WHFSTypeInfo } from "@webhare/whfs/src/contenttypes";
import type { RecursiveReadonly } from "@webhare/js-api-tools";
import { exportRTDToRawHTML } from "@webhare/hscompat/richdocument";
import { getWHType } from "@webhare/std/quacks";

type RTDItemMode = "inMemory" | "export" | "build";

/** Paragraph types supported by us */
export const rtdBlockTypes = ["h1", "h2", "h3", "h4", "h5", "h6", "p"] as const;
/** Maps h1 etc to a default class if we're building RTDs wthout an explicit RTDType (needed for consistent output) */
export const rtdBlockDefaultClass: Record<RTDBlockType[number], string> = { "h1": "heading1", "h2": "heading2", "h3": "heading3", "h4": "heading4", "h5": "heading5", "p": "normal" } as const;
/** Simple text styles and their order */
export const rtdTextStyles = { //Note that a-href is higher than all these styles. See also this.textstyletags in structurededitor
  "i": "italic",
  "b": "bold",
  "u": "underline",
  "strike": "strikeThrough",
  "sub": "subScript",
  "sup": "superScript",
} as const;


export type RTDBlockType = typeof rtdBlockTypes[number];
type RTDBuildBlockType = `${typeof rtdBlockTypes[number]}.${string}`;

type RTDBaseWidget<Mode extends RTDItemMode> = Mode extends "export" ? WHFSInstance : Mode extends "inMemory" ? Readonly<WidgetInterface> : Readonly<WidgetInterface> | WHFSInstance;

/* The 'Build' flag indicates whether its a RTDBlock we will still parse and validate (building) or use as is (returned by RichTextDocument.blocks).
   The non-build version is generally stricter */

type RTDBaseBlock<Mode extends RTDItemMode> = {
  /** Element type */
  tag: RTDBlockType;
  className?: string;
  items: RTDBaseBlockItems<Mode>;
}
  |
{
  widget: RTDBaseWidget<Mode>;
} | (Mode extends "build" ? //When building also allow a simpler h1: [items] or "h1.heading1": [items] syntax
  {
    [key in RTDBlockType | RTDBuildBlockType]?: RTDBaseBlockItems<Mode>;
  } : never);

/** The contents of text blocks */
type RTDBaseBlockItems<Mode extends RTDItemMode> = Array<RTDBaseBlockItem<Mode> | (Mode extends "build" ? string : never)> | (Mode extends "build" ? string : never);

type RTDBaseBlockItem<Mode extends RTDItemMode> = ({ text: string } | { widget: RTDBaseWidget<Mode> }) & {
  [key in typeof rtdTextStyles[keyof typeof rtdTextStyles]]?: boolean;
} & { link?: string; target?: "_blank" };

export type RTDBlock = RTDBaseBlock<"inMemory">;
export type RTDBlockItem = RTDBaseBlockItem<"inMemory">;
export type RTDBlockItems = RTDBaseBlockItems<"inMemory">;

export type RTDExportBlock = RTDBaseBlock<"export">;

export type RTDBuildParagraphType = "h1.heading1" | "h2.heading2" | "h3.heading3" | "h4.heading4" | "h5.heading5" | "h6.heading6" | "p.normal" | typeof rtdBlockTypes[number] | RTDBlockType;
export type RTDBuildBlock = RTDBaseBlock<"build">;
export type RTDBuildBlockItem = RTDBaseBlockItem<"build">;
export type RTDBuildBlockItems = RTDBaseBlockItems<"build">;

/** The base RTD type accepted by buildRTD */
export type RTDBuildSource = RTDBuildBlock[];

export type ExportableRTD = RTDExportBlock[];

export function isValidRTDClassName(className: string): boolean {
  return className === "" || /^[a-z0-9]+$/.test(className);
}

function validateTagName(tag: string): asserts tag is RTDBlockType {
  if (!rtdBlockTypes.includes(tag as RTDBlockType))
    throw new Error(`Invalid tag name '${tag}'`);
}


class Widget {
  private static "__ $whTypeSymbol" = "Widget";

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

  async export(): Promise<WHFSInstance> {
    const retval: WHFSInstance = {
      whfsType: this.whfsType,
    };

    for (const member of this.#typeInfo.members) {
      //TODO Array recursion, ResourceDescriptors,...
      if (member.type === "richDocument")
        retval[member.name] = (await (this.#data[member.name] as RichTextDocument | null)?.export()) || null;
      else
        retval[member.name] = this.#data[member.name];
    }
    return retval;
  }
}

///build separate type as Widget isn't currently constructable. The 'export type' trick won't work with private members
type WidgetInterface = Pick<Widget, "whfsType" | "data" | "export">;

export class RichTextDocument {
  private static "__ $whTypeSymbol" = "RichTextDocument";

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

  async #buildBlockItems(blockitems: RTDBuildBlockItems | string): Promise<RTDBlockItems> {
    if (typeof blockitems === 'string')
      blockitems = [{ text: blockitems }];

    const outitems = new Array<RTDBlockItem>;
    for (const item of blockitems) {
      if (typeof item === 'string') {
        outitems.push({ text: item });
        continue;
      } else if ("widget" in item) {
        outitems.push({ ...item, widget: await this.addWidget(item.widget) });
        continue;
      }

      outitems.push(item);
    }
    return outitems;
  }

  async addBlock(tag: string, className: string | undefined, items: RTDBuildBlockItems) {
    validateTagName(tag);

    const useclass = className || rtdBlockDefaultClass[tag] || throwError(`No default class for tag '${tag}'`);
    if (!isValidRTDClassName(useclass))
      throw new Error(`Invalid class name '${className}'`);

    const newblock: RTDBlock = { tag, items: await this.#buildBlockItems(items) };
    if (useclass !== rtdBlockDefaultClass[tag]) {
      newblock.className = useclass;
    }
    this.#blocks.push(newblock);
  }

  private async addWidget(widget: RTDBaseWidget<"build">): Promise<RTDBaseWidget<"inMemory">> {
    if (getWHType(widget) === "Widget") //we just keep the widget as is
      return widget as WidgetInterface;

    if ("whfsType" in widget)
      return await buildWidget(widget.whfsType, omit(widget, ["whfsType"]));

    throw new Error(`Invalid widget data: ${JSON.stringify(widget)}`);
  }

  async addBlocks(blocks: RTDBuildBlock[]): Promise<void> {
    //TODO validate, import disk objects etc
    for (const block of blocks) {
      if ("tag" in block) {
        //Normal block (tag:), not a build block (eg h2:)
        await this.addBlock(block.tag, block.className, block.items);
        continue;
      }

      const entries = Object.entries(block);
      if (entries.length === 0)
        throw new Error(`Block is empty`);
      if (entries.length > 1)
        throw new Error(`Only one key per block allowed, got: ${entries.map(_ => _[0]).join(', ')}`);

      const key: string = entries[0][0];
      const data = entries[0][1];
      if (key === 'widget') {
        this.#blocks.push({ widget: await this.addWidget(data) });
        continue;
      }

      //If we get here, it has to be one of the H1s etc
      const [tag, className, extra] = key.split('.');
      if (extra !== undefined)
        throw new Error(`Invalid tag name '${key}'`);

      await this.addBlock(tag, className, data);
    }
  }

  /** Export as buildable RTD */
  async export(): Promise<ExportableRTD> { //TODO RTDBuildSource is wider than what we'll build, eg it allows Widget objects
    const out: ExportableRTD = [];
    for (const block of this.#blocks) {
      if ("widget" in block) {
        out.push({ widget: await block.widget.export() satisfies WHFSInstance });
        continue;
      }

      if ("items" in block && block.items?.length) {
        const outBlock: RTDExportBlock = {
          ...block,
          items: []
        };
        for (const item of block.items) {
          if ("widget" in item)
            outBlock.items.push({ ...item, widget: await item.widget.export() satisfies WHFSInstance });
          else
            outBlock.items.push(item);
        }
        out.push(outBlock);
        continue;
      }
      throw new Error(`Block ${JSON.stringify(block)} has no export definition`);
    }
    return out;
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

export async function buildRTD(source: RTDBuildSource): Promise<RichTextDocument> {
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
