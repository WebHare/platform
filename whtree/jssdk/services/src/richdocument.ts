import { omit, throwError, typedEntries, typedFromEntries } from "@webhare/std";
import { describeWHFSType } from "@webhare/whfs";
import type { InstanceExport, InstanceSource, TypedInstanceData, TypedInstanceExport, InstanceData, WHFSTypeName, WHFSTypeInfo, WHFSTypes } from "@webhare/whfs/src/contenttypes";
import { exportRTDToRawHTML } from "@webhare/hscompat/src/richdocument";
import { getWHType, isPromise } from "@webhare/std/src/quacks";
import { exportData, importData } from "@webhare/whfs/src/codecs";
import type * as test from "@webhare/test";
import { exportIntExtLink, importIntExtLink, isResourceDescriptor, ResourceDescriptor, type ExportedResource, type ExportOptions, type ImportOptions } from "./descriptor";
import { IntExtLink, type ExportedIntExtLink } from "./intextlink";
import type { DisallowExtraPropsRecursive } from "@webhare/js-api-tools/src/utility-types";

/* Due to the recursive nature of the RTD types, the recursive parts of exportable and buildable RTD types
    are defined separately, so TypeScript can verify that the export type is assignable to the build type,
    and that the inMemory type is assignable to the build type
*/

type RTDItemMode = "inMemory" | "export" | "build";

export type RTDImageFloat = "left" | "right";

/** Paragraph types supported by us */
export const rtdParagraphTypes = ["h1", "h2", "h3", "h4", "h5", "h6", "p"] as const;
/** List types supported by us */
export const rtdListTypes = ["ul", "ol"] as const;
/** Maps h1 etc to a default class if we're building RTDs wthout an explicit RTDType (needed for consistent output) */
export const rtdBlockDefaultClass: Record<RTDParagraphType[number], string> = { "h1": "heading1", "h2": "heading2", "h3": "heading3", "h4": "heading4", "h5": "heading5", "p": "normal", "ol": "ordered", "ul": "unordered" } as const;
/** Simple text styles and their order */
export const rtdTextStyles = { //Note that a-href is higher than all these styles. See also this.textstyletags in structurededitor
  "i": "italic",
  "b": "bold",
  "u": "underline",
  "strike": "strikeThrough",
  "sub": "subScript",
  "sup": "superScript",
} as const;

/* We need the `tag` property to be never in the OneProperty type, otherwise { tag: "p" } would match RTDBaseParagraph<"build">
   (specifically, it would match { tag: "p", items: ...[] } | Record<`p.${string}`, ...[]>. Don't know why.)
*/
type OneProperty<K extends string, V> = K extends string ? { [arg in K]: V } & { tag?: never } : never;

export type RTDParagraphType = typeof rtdParagraphTypes[number];
type RTDSourceParagraphType = `${typeof rtdParagraphTypes[number]}.${string}`;

export type RTDListType = typeof rtdListTypes[number];

type RTDBaseWidget<Mode extends RTDItemMode> = Mode extends "export" ? InstanceExport : Mode extends "inMemory" ? Instance : Instance | InstanceSource;

type BuildOnly<Mode extends RTDItemMode, V> = "build" extends Mode ? V : never;

/* The 'Build' flag indicates whether its a RTDBlock we will still parse and validate (building) or use as is (returned by RichTextDocument.blocks).
   The non-build version is generally stricter */

type RTDBaseParagraph<Mode extends RTDItemMode> = {
  /** Element type */
  tag: RTDParagraphType;
  className?: string;
  items: RTDBaseParagraphItems<Mode>;
} | //When building also allow a simpler h1: [items] or "h1.heading1": [items] syntax
  BuildOnly<Mode, OneProperty<RTDParagraphType | RTDSourceParagraphType, RTDBaseParagraphItems<Mode>>>;

type RTDBaseAnonymousParagraph<Mode extends RTDItemMode> = {
  tag?: never;
  className?: string;
  items: RTDBaseParagraphItems<Mode>;
};

type RTDBaseList<Mode extends RTDItemMode> = {
  tag: RTDListType;
  className?: string;
  listItems: RTDBaseListItems<Mode>;
};

type RTDBaseListItem<Mode extends RTDItemMode> = {
  li: RTDBaseListItemItems<Mode>;
};

type RTDBaseBlock<Mode extends RTDItemMode> =
  RTDBaseParagraph<Mode> |
  RTDBaseList<Mode> |
  { widget: RTDBaseWidget<Mode> };


export type RTDBaseInlineImageItem<Mode extends RTDItemMode> = ({
  /** An image: refers to an image stored with a document */
  image: Mode extends "export" ? ExportedResource : Mode extends "inMemory" ? ResourceDescriptor : ExportedResource | ResourceDescriptor;
} | {
  /** A external image is a hyperlink to an image on eg a CDN */
  externalImage: string;
}) & {
  alt?: string;
  width?: number;
  height?: number;
  float?: RTDImageFloat;
};

export type RTDBaseLink<Mode extends RTDItemMode> = {
  link?: Mode extends "export" ? ExportedIntExtLink : Mode extends "inMemory" ? IntExtLink : ExportedIntExtLink | IntExtLink | string;
  target?: "_blank";
};

/** The contents of text blocks */
type RTDBaseInlineItem<Mode extends RTDItemMode> = (
  ( //base item that can receive styling - either text, widget or image ()
    { text: string }
    | { inlineWidget: RTDBaseWidget<Mode> }
    | RTDBaseInlineImageItem<Mode>
  ) & {
    [key in typeof rtdTextStyles[keyof typeof rtdTextStyles]]?: boolean;
  } & RTDBaseLink<Mode>
) | BuildOnly<Mode, string>;

/** The contents of a paragraph */
type RTDBaseParagraphItems<Mode extends RTDItemMode> = Array<RTDBaseInlineItem<Mode>> | BuildOnly<Mode, string>;

/** The items of a list (type of list.listItems) */
type RTDBaseListItems<Mode extends RTDItemMode> = Array<RTDBaseListItem<Mode>>;

/** The type of list.listItems[*].li. Allow a single anonymous paragraph as first item and lists following it, or
 * a mix of normal paragraphs and lists.
*/
type RTDBaseListItemItems<Mode extends RTDItemMode> = [RTDBaseAnonymousParagraph<Mode>, ...Array<RTDBaseList<Mode>>] | Array<RTDBaseParagraph<Mode> | RTDBaseList<Mode>>;

type RTDBaseBlocks<Mode extends RTDItemMode> = Array<RTDBaseBlock<Mode>>;

export type RTDBlock = RTDBaseBlock<"inMemory">;
export type RTDParagraph = RTDBaseParagraph<"inMemory">;
export type RTDAnonymousParagraph = RTDBaseAnonymousParagraph<"inMemory">;
export type RTDInlineItem = RTDBaseInlineItem<"inMemory">;
export type RTDInlineItems = RTDBaseParagraphItems<"inMemory">;
export type RTDList = RTDBaseList<"inMemory">;
export type RTDListItems = RTDBaseListItems<"inMemory">;
export type RTDListItemItems = RTDBaseListItemItems<"inMemory">;

// -------------
// RTDBaseBlock<"export"> isn't assignable to RTDBaseBlock<"build"> due to the recursive type, so we need make a separate
// copy for the export types
//

type RTDSourceList = {
  tag: RTDListType;
  className?: string;
  listItems: RTDSourceListItems;
};

type RTDSourceListItem = {
  li: RTDSourceListItemItems;
};

export type RTDSourceBlock =
  RTDBaseParagraph<"build"> |
  RTDSourceList |
  { widget: RTDBaseWidget<"build"> };

/** The items of a list (type of list.listItems) */
export type RTDSourceListItems = RTDSourceListItem[];

/** The type of list.listItems[*].liItems */
type RTDSourceListItemItems = [RTDBaseAnonymousParagraph<"build">, ...RTDSourceList[]] | Array<RTDBaseParagraph<"build"> | RTDSourceList>;

export type RTDSourceInlineItem = RTDBaseInlineItem<"build">;
export type RTDSourceInlineItems = RTDBaseParagraphItems<"build">;

/** The base RTD type accepted by buildRTD */
export type RTDSource = RTDSourceBlock[];

// -------------
// RTDBaseBlock<"export"> isn't assignable to RTDBaseBlock<"build"> due to the recursive type, so we need make a separate
// copy for the export types
//

type RTDExportList = {
  tag: RTDListType;
  className?: string;
  listItems: RTDExportListItems;
};

type RTDExportListItem = {
  li: RTDExportListItemItems;
};

export type RTDExportBlock =
  RTDBaseParagraph<"export"> |
  RTDExportList |
  { widget: RTDBaseWidget<"export"> };

/** The items of a list (type of list.listItems) */
export type RTDExportListItems = RTDExportListItem[];

/** The type of list.listItems[*].liItems */
type RTDExportListItemItems = [RTDBaseAnonymousParagraph<"export">, ...RTDExportList[]] | Array<RTDBaseParagraph<"export"> | RTDExportList>;

export type RTDExport = RTDExportBlock[];



export function isValidRTDClassName(className: string): boolean {
  return className === "" || /^[a-z0-9]+$/.test(className);
}

function validateTagName(tag: string): asserts tag is RTDParagraphType {
  if (!rtdParagraphTypes.includes(tag as RTDParagraphType))
    throw new Error(`Invalid tag name '${tag}'`);
}

function validateListTagName(tag: string): asserts tag is RTDListType {
  if (!rtdListTypes.includes(tag as RTDListType))
    throw new Error(`Invalid list tag name '${tag}'`);
}

export function isRichTextDocument(value: unknown): value is RichTextDocument {
  return Boolean(value && getWHType(value) === "RichTextDocument");
}

export function isInstance(value: unknown): value is Instance {
  return Boolean(value && getWHType(value) === "Instance");
}


class Instance {
  private static "__ $whTypeSymbol" = "Instance";

  #typeInfo: WHFSTypeInfo;
  #data: InstanceData;

  constructor(typeinfo: WHFSTypeInfo, data: InstanceData) {
    this.#typeInfo = typeinfo;
    this.#data = data;
  }

  get whfsType(): string {
    return this.#typeInfo.scopedType ?? this.#typeInfo.namespace;
  }

  get data(): InstanceData {
    return this.#data;
  }

  async export(options?: ExportOptions): Promise<InstanceExport> {
    const data = await exportData(this.#typeInfo.members, this.#data, options);
    return {
      whfsType: this.whfsType,
      ...(Object.keys(data).length ? { data } : {}),
    };
  }

  is<Type extends WHFSTypeName>(type: Type | string): this is TypedInstance<Type> {
    return this.#typeInfo.scopedType === type || this.#typeInfo.namespace === type;
  }

  as<Type extends WHFSTypeName>(type: Type): Instance & TypedInstance<Type> {
    if (this.is<Type>(type))
      return this as never; // using 'as never' to avoid a very costly type check in TS;
    throw new Error(`Instance is not of type ${type}`);
  }

  assertType<Type extends WHFSTypeName>(type: Type): asserts this is TypedInstance<Type> {
    if (!this.is<Type>(type))
      throw new Error(`Instance is not of type ${type}`);
  }
}

interface TypedInstanceImpl<Type extends WHFSTypeName> extends Instance {
  get whfsType(): Type;
  get data(): TypedInstanceData<Type>;
  export(options?: ExportOptions): Promise<TypedInstanceExport<Type>>;
}

// Distribute over WHFSTypeName
export type TypedInstance<Type extends WHFSTypeName> = Type extends WHFSTypeName ? TypedInstanceImpl<Type> : never;

function isTagEntry<E extends [string, unknown], T extends string>(entry: E, tags: readonly T[]): entry is E & [(T | `${T}.${string}`), unknown] {
  return tags.includes(entry[0].split('.')[0] as T);
}

function splitBuildTag<T extends string>(tag: T): { tag: T extends `${infer Tag}.${string}` ? Tag : T; className?: string } {
  let [tagName, className, extra] = tag.split('.');
  const defaultClass = rtdBlockDefaultClass[tagName];
  if (extra !== undefined)
    throw new Error(`Invalid tag name '${tag}'`);
  if (className && !isValidRTDClassName(className))
    throw new Error(`Invalid class name '${className}'`);
  else {
    className ||= defaultClass;
    if (!className)
      throw new Error(`No default class for tag '${tagName}'`);
  }
  return {
    tag: tagName as (T extends `${infer Tag}.${string}` ? Tag : T),
    ...(className !== defaultClass ? { className } : {})
  };
}

function getArrayPromise<T>(array: T[]): MaybePromise<Array<Awaited<T>>> {
  const resolved: Array<Awaited<T>> = [];
  for (const item of array) {
    if (isPromise(item))
      return Promise.all(array);
    resolved.push(item as Awaited<T>);
  }
  return resolved;
}

type MaybePromise<T> = T | Promise<T>;

function mapMaybePromise<T, U>(value: T | Promise<T>, cb: (arg: T) => U): U | Promise<U> {
  return isPromise(value) ? value.then(t => cb(t)) : cb(value);
}

type DistributedKeys<T extends object> = T extends object ? keyof T : never;
type OmitDefaults<T extends object, K extends DistributedKeys<T>> = T extends object ? Omit<T, K> & Partial<Pick<T, K>> : never;
function omitFalsy<T extends object, K extends DistributedKeys<T>>(obj: T, keys: K[]): OmitDefaults<T, K> {
  return typedFromEntries(typedEntries(obj).filter(([k, v]) => !keys.includes(k as K) || v)) as unknown as OmitDefaults<T, K>;
}

/** @deprecated use Instance instead */
type WidgetInterface = { whfsType: string; data: InstanceData; export(): Promise<InstanceExport> };


/** A Rich Text Document (RTD) */

export class RichTextDocument {
  private static "__ $whTypeSymbol" = "RichTextDocument";

  #blocks = new Array<RTDBlock>;
  //need to expose this for hscompat APIs
  private __instanceIds = new WeakMap<Readonly<Instance>, string>;
  private __imageIds = new WeakMap<Readonly<RTDBaseInlineImageItem<"inMemory">>, string>;
  private __linkIds = new WeakMap<Readonly<IntExtLink>, string>;

  get blocks(): RTDBlock[] {
    return this.#blocks;
  }

  //TODO should we still accept a string constructor now that a WebHareBlob is so easy to build?
  constructor() {
  }

  isEmpty(): boolean {
    return this.#blocks.length === 0;
  }

  private async fixLink<T>(item: T & RTDBaseLink<"build">, options: ImportOptions): Promise<T & RTDBaseLink<"inMemory">> {
    if (typeof item.link === "string")  // convert to IntExtLink
      item = { ...item, link: new IntExtLink(item.link) };
    else if (item.link && ("internalLink" in item.link || "externalLink" in item.link))
      item = { ...item, link: await importIntExtLink(item.link, options) || undefined };

    return item as T & { link?: IntExtLink };
  }

  async #buildParagraphItems(blockitems: RTDSourceInlineItems | string, options: ImportOptions): Promise<RTDInlineItems> {
    if (typeof blockitems === 'string')
      blockitems = [{ text: blockitems }];

    const outitems = new Array<RTDInlineItem>;
    for (const item of blockitems) {
      if (typeof item === 'string') {
        outitems.push({ text: item });
        continue;
      }
      const linkFixed = await this.fixLink(item, options);
      if ("text" in linkFixed) {
        outitems.push(linkFixed);
      } else if ("image" in linkFixed || "externalImage" in linkFixed) {
        outitems.push(await this.addImage(linkFixed, options));
      } else if ("inlineWidget" in linkFixed) {
        outitems.push({ ...linkFixed, inlineWidget: await this.addWidget(linkFixed.inlineWidget, options) });
      } else if ("widget" in linkFixed) {
        throw new Error(`Toplevel widgets not allowed in paragraphs, use 'inlineWidget' instead`);
      } else
        throw new Error(`Invalid paragraph item ${JSON.stringify(linkFixed)}`);
    }
    return outitems;
  }

  async #buildListItemItems(listItemItems: RTDBaseListItemItems<"build">, options: ImportOptions): Promise<RTDBaseListItemItems<"inMemory">> {
    let anonymousParagraph: RTDBaseAnonymousParagraph<"inMemory"> | undefined;
    const outitems: RTDBaseListItemItems<"inMemory"> = [];

    itemloop:
    for (const item of listItemItems) {
      if ("items" in item) {
        if (!item.tag) {
          if (anonymousParagraph || outitems.length)
            throw new Error(`Anonymous paragraphs can only be the first item in a list item`);
          anonymousParagraph = { items: await this.#buildParagraphItems(item.items, options) };
        } else {
          if (anonymousParagraph)
            throw new Error(`Cannot mix anonymous paragraphs with named paragraphs in a list item`);
          // paragraph
          outitems.push({
            ...item,
            items: await this.#buildParagraphItems(item.items, options)
          });
        }
      } else if ("listItems" in item) {
        // list
        outitems.push({
          ...item,
          listItems: await this.#buildListItems(item.listItems, options)
        });
      } else {
        // handle build shortcuts
        for (const entry of typedEntries(item)) {
          if (isTagEntry(entry, rtdParagraphTypes)) {
            if (anonymousParagraph)
              throw new Error(`Cannot mix anonymous paragraphs with named paragraphs in a list item`);
            outitems.push({
              ...splitBuildTag(entry[0]),
              items: await this.#buildParagraphItems(entry[1], options)
            });
            continue itemloop;
          }
        }
        // Build shortcuts handled, test nothing is left
        item as Exclude<typeof item, OneProperty<RTDParagraphType | RTDSourceParagraphType, RTDBaseParagraphItems<"build">>> satisfies never;
        throw new Error(`Invalid list item ${JSON.stringify(item)}`);
      }
    }
    if (anonymousParagraph) {
      // Code has already ensured that outitems only contains list items at this point
      return [anonymousParagraph, ...outitems] as RTDBaseListItemItems<"inMemory">;
    }
    return outitems;
  }

  async #buildListItems(listItems: RTDSourceListItems, options: ImportOptions): Promise<RTDListItems> {
    const outitems: RTDListItems = [];

    for (const item of listItems) {
      outitems.push({ li: await this.#buildListItemItems(item.li, options) });
    }
    return outitems;
  }

  async addBlock(tag: string, className: string | undefined, items?: RTDSourceInlineItems, options?: ImportOptions) {
    validateTagName(tag);

    const useclass = className || rtdBlockDefaultClass[tag] || throwError(`No default class for tag '${tag}'`);
    if (!isValidRTDClassName(useclass))
      throw new Error(`Invalid class name '${className}'`);

    const newblock: RTDBlock = { tag, items: items?.length ? await this.#buildParagraphItems(items, options || {}) : [] };
    if (useclass !== rtdBlockDefaultClass[tag]) {
      newblock.className = useclass;
    }
    this.#blocks.push(newblock);
  }

  private async addImage(node: RTDBaseInlineItem<"build"> & object & RTDBaseInlineImageItem<"build">, options?: ImportOptions): Promise<RTDBaseInlineItem<"inMemory">> {
    if (node && "image" in node && !isResourceDescriptor(node.image))
      node = { ...node, image: await ResourceDescriptor.import(node.image, options) };
    return node as RTDBaseInlineItem<"inMemory">;
  }

  private async addWidget(widget: RTDBaseWidget<"build">, options?: ImportOptions): Promise<RTDBaseWidget<"inMemory">> {
    if (isInstance(widget)) //we just keep the widget as is
      return widget;

    if ("whfsType" in widget)
      return await buildInstance(widget, options);

    throw new Error(`Invalid widget data: ${JSON.stringify(widget)}`);
  }

  async addList(tag: string, className: string | undefined, listItems: RTDSourceListItems, options?: ImportOptions) {
    validateListTagName(tag);

    const useclass = className || rtdBlockDefaultClass[tag] || throwError(`No default class for tag '${tag}'`);
    if (!isValidRTDClassName(useclass))
      throw new Error(`Invalid class name '${className}'`);


    const newblock: RTDBlock = { tag, listItems: await this.#buildListItems(listItems, options || {}) };
    if (useclass !== rtdBlockDefaultClass[tag]) {
      newblock.className = useclass;
    }
    this.#blocks.push(newblock);
  }

  async addBlocks(blocks: RTDSourceBlock[], options?: ImportOptions): Promise<void> {
    //TODO validate, import disk objects etc
    for (const block of blocks) {
      if ("items" in block) {
        await this.addBlock(block.tag, block.className, block.items, options);
        continue;
      } else if ("listItems" in block) {
        await this.addList(block.tag, block.className, block.listItems, options);
        continue;
      }

      const entries = typedEntries(block);
      if (entries.length === 0)
        throw new Error(`Block is empty`);
      if (entries.length > 1)
        throw new Error(`Only one key per block allowed, got: ${entries.map(_ => _[0]).join(', ')}`);
      const entry = entries[0];

      if (entry[0] === 'widget') {
        this.#blocks.push({ widget: await this.addWidget(entry[1], options) });
        continue;
      }

      if (isTagEntry(entry, rtdParagraphTypes)) {
        this.#blocks.push({
          ...splitBuildTag(entry[0]),
          items: await this.#buildParagraphItems(entry[1], options || {})
        });
        continue;
      }
      entry satisfies ["tag", undefined]; // artefact of the OneProperty type
      throw new Error(`Invalid block entry: ${JSON.stringify(entry)}`);
    }
  }

  private async exportLink<T>(item: T & RTDBaseLink<"inMemory">, options: ExportOptions): Promise<T & RTDBaseLink<"export">> {
    if (!item.link)
      return item as T & RTDBaseLink<"export">;
    const expLink = await exportIntExtLink(item.link, options);
    return expLink ? { ...item, link: expLink } : omit(item, ["link"]) as T & RTDBaseLink<"export">;
  }

  #exportInlineItems(block: Array<RTDBaseInlineItem<"inMemory">>, options: ExportOptions): MaybePromise<Array<RTDBaseInlineItem<"export">>> {
    return getArrayPromise(block.map(async item => {
      item = await this.exportLink(item, options);
      if ("inlineWidget" in item)
        return { ...item, inlineWidget: await item.inlineWidget.export(options) satisfies InstanceExport } as RTDBaseInlineItem<"export">;
      if ("image" in item) {
        return { ...omitFalsy(item, ["alt", "width", "height", "float"]), image: await item.image.export(options) satisfies ExportedResource } as RTDBaseInlineItem<"export">;
      }
      return item as RTDBaseInlineItem<"export">;
    }));
  }

  #exportRTDParagraph(block: RTDBaseParagraph<"inMemory">, options: ExportOptions): MaybePromise<RTDBaseParagraph<"export">> {
    const convertedItems = this.#exportInlineItems(block.items, options);
    return mapMaybePromise(convertedItems, items => ({ ...block, items }));
  }

  async #exportRTDWidget(widget: { widget: RTDBaseWidget<"inMemory"> }, options: ExportOptions): Promise<{ widget: RTDBaseWidget<"export"> }> {
    return { widget: await widget.widget.export(options) };
  }

  #exportRTDAnonymousParagraph(block: RTDBaseAnonymousParagraph<"inMemory">, options: ExportOptions): MaybePromise<RTDBaseAnonymousParagraph<"export">> {
    const convertedItems = this.#exportInlineItems(block.items, options);
    return mapMaybePromise(convertedItems, items => ({ ...block, items }));
  }

  #exportRTDListItem(block: RTDBaseListItem<"inMemory">, options: ExportOptions): MaybePromise<RTDBaseListItem<"export">> {
    const convertedItems = block.li.map(item => {
      if ("items" in item) {
        if ("tag" in item && item.tag)
          return this.#exportRTDParagraph(item, options);
        else
          return this.#exportRTDAnonymousParagraph(item, options);
      } else if ("listItems" in item) {
        return this.#exportRTDList(item, options);
      } else {
        item satisfies never;
        throw new Error(`Invalid list item ${JSON.stringify(item)}`);
      }
    });
    // Casting to RTDBaseListItem<"export"> to avoid a lot of code duplkication due to the [ anonymousparagraph, ...Array<RTDBaseList> ] type
    // Rob: can't think of a way to write a map function and a conversion function that work with the type system to preserve the format
    return mapMaybePromise(getArrayPromise(convertedItems), li => ({ li })) as RTDBaseListItem<"export">;
  }

  #exportRTDList(block: RTDBaseList<"inMemory">, options: ExportOptions): MaybePromise<RTDBaseList<"export">> {
    const convertedItems = block.listItems.map(item => this.#exportRTDListItem(item, options));
    return mapMaybePromise(getArrayPromise(convertedItems), items => ({ ...block, listItems: items }));
  }

  #exportRTDBlocks(blocks: RTDBlock[], options: ExportOptions): MaybePromise<RTDExport> {
    return getArrayPromise(blocks.map(block => {
      if ("items" in block)
        return this.#exportRTDParagraph(block, options) satisfies MaybePromise<RTDExport[number]>;
      else if ("listItems" in block) {
        return this.#exportRTDList(block, options) satisfies MaybePromise<RTDExport[number]>;
      } else if ("widget" in block)
        return this.#exportRTDWidget(block, options) satisfies MaybePromise<RTDExport[number]>;
      else
        block satisfies never;
      throw new Error(`Block ${JSON.stringify(block)} has no export definition`);
    }));
  }

  /** Export as buildable RTD */
  async export(options?: ExportOptions): Promise<RTDExport> { //TODO RTDSource is wider than what we'll build, eg it allows Widget objects
    return await this.#exportRTDBlocks(this.#blocks, { export: true, ...options });
  }

  /** @deprecated Use exportRTDToRawHTML in hscompat */
  async __getRawHTML(): Promise<string> {
    return (await exportRTDToRawHTML(this)) || '';
  }

  __hintInstanceId(widget: Instance, instanceId: string) {
    if (this.__instanceIds.get(widget))
      this.__instanceIds.set(widget, instanceId);
  }
  __hintImageId(image: RTDBaseInlineImageItem<"inMemory">, imageId: string) {
    if (this.__imageIds.get(image))
      this.__imageIds.set(image, imageId);
  }
}

export async function buildRTD(source: RTDSource, options?: ImportOptions): Promise<RichTextDocument> {
  //TODO validate, import disk objects etc
  const outdoc = new RichTextDocument;
  await outdoc.addBlocks(source, options);
  return outdoc;
}

/* The `[Type] extends [symbol] ? Type : ....;` pattern makes sure the Type argument captures the type of the argument , but
   the actual type the argument is checked against is the second part of the conditional - without the actual type influencing the check.
*/

/** Constructs an Instance from source data. If the whfsType is a constant, an instance of that type is returned. The source data won't
 * be type-checked at compile-time if the whfsType has type 'string'.
 */
export async function buildInstance<
  const Type extends string,
  Data extends object,
>(data: ([NoInfer<Type>] extends [symbol] ?
  { whfsType: Type; data?: Data } :
  (string extends NoInfer<Type> ?
    InstanceSource : {
      whfsType: WHFSTypeName;
      data?: ([NoInfer<Type>] extends [WHFSTypeName] ?
        DisallowExtraPropsRecursive<Data, WHFSTypes[NoInfer<Type>]["SetFormat"]> :
        InstanceSource["data"]);
    })),
  options?: ImportOptions): Promise<[NoInfer<Type>] extends [WHFSTypeName] ? TypedInstance<NoInfer<Type>> : Instance> {
  const typeinfo = await describeWHFSType(data.whfsType);
  for (const key of (Object.keys(data)))
    if (key !== "whfsType" && key !== "data")
      throw new Error(`Invalid key '${key}' in instance source, only 'whfsType' and 'data' allowed`);
  return new Instance(typeinfo, await importData(typeinfo.members, data.data || {}, { ...options, addMissingMembers: true })) as [Type] extends [WHFSTypeName] ? TypedInstance<NoInfer<Type>> : Instance;
}

/** @deprecated use buildInstance */
export async function buildWidget(ns: string, data?: object): Promise<WidgetInterface> {
  return buildInstance({ whfsType: ns, data } as InstanceSource);
}

export type { WidgetInterface as Widget, Instance };

// Check types in the source code, so not everything has to be exported
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function verifyTypes() {
  // The separate declarations of the types for build/export mode and the parameterized type should be equal
  true satisfies test.Equals<RTDSource, RTDBaseBlocks<"build">>;
  true satisfies test.Equals<RTDExport, RTDBaseBlocks<"export">>;
  true satisfies test.Equals<RTDBlock[], RTDBaseBlocks<"inMemory">>;

  // The export type and inMemory type should be assignable to the build type
  true satisfies test.Assignable<RTDSource, RTDBaseBlocks<"export">>;
  true satisfies test.Assignable<RTDSource, RTDBaseBlocks<"inMemory">>;

  // another test for the widget type
  ({} as RTDBaseWidget<"inMemory"> satisfies RTDBaseWidget<"build">); //type check
  ({} as RTDBaseWidget<"export"> satisfies RTDBaseWidget<"build">); //type check
  ({} as RTDBaseInlineItem<"export"> satisfies RTDBaseInlineItem<"build">); //type check
  const x = {} as RTDBaseInlineItem<"export">;
  const y: RTDBaseInlineItem<"build"> = x;
  console.log(y);

  ({} as RTDExport) satisfies RTDSource;

}
