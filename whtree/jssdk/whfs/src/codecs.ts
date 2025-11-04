import type * as kysely from "kysely";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { uploadBlob } from "@webhare/whdb";
import { appendToArray, isPromise, isTruthy, Money, omit, parseTyped, stringify, throwError } from "@webhare/std";
import { encodeHSON, decodeHSON } from "@webhare/hscompat/src/hson.ts";
import { dateToParts, makeDateFromParts, } from "@webhare/hscompat/src/datetime.ts";
import { buildRTDFromComposedDocument, exportRTDAsComposedDocument } from "@webhare/hscompat/src/richdocument.ts";
import type { IPCMarshallableData } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { ResourceDescriptor, addMissingScanData, decodeScanData, exportIntExtLink, importIntExtLink, isResourceDescriptor, mapExternalWHFSRef, unmapExternalWHFSRef } from "@webhare/services/src/descriptor";
import { IntExtLink, WebHareBlob, type RichTextDocument, type Instance } from "@webhare/services";
import type { InstanceData, InstanceExport, InstanceSource, WHFSTypeMember } from "./contenttypes";
import type { FSSettingsRow } from "./describe";
import { describeWHFSType } from "./describe";
import { getWHType, isTemporalInstant, isTemporalPlainDate } from "@webhare/std/src/quacks";
import { buildRTD, buildInstance, isRichTextDocument, isInstance, type RTDSource, type RTDExport } from "@webhare/services/src/richdocument";
import type { ExportedResource, ExportOptions } from "@webhare/services/src/descriptor";
import type { ExportedIntExtLink } from "@webhare/services/src/intextlink";
import { ComposedDocument, type ComposedDocumentType } from "@webhare/services/src/composeddocument";

/// Returns T or a promise resolving to T
type MaybePromise<T> = Promise<T> | T;

// can't declare this in @webhare/std until Temporal is part of core TS
export type TypedStringifyable = Money | Date | bigint | Temporal.Instant | Temporal.PlainDate | Temporal.PlainDateTime | Temporal.ZonedDateTime | string | number | boolean | null | TypedStringifyable[] | undefined | { [key: string]: TypedStringifyable };

//NOTE this is the *supported* subset of TypeMember (siteprofiles.ts)
export type MemberType = "string" // 2
  | "instant" //4
  | "file" //5
  | "boolean" //6
  | "integer" //7
  | "float" // 8
  | "money" //9
  | "whfsRef" //11
  | "array" //12
  | "whfsRefArray" //13
  | "stringArray" //14
  | "richTextDocument" //15
  | "intExtLink" //16
  | "instance" //18
  | "url" //19
  | "composedDocument" //20
  | "hson" //21 (record in HareScript). also handles legacy 22 (formCondition)
  | "record" //23 (typedrecord in HareScript)
  | "plainDate" //25
  | "json" // 26
  ;

export type EncoderBaseReturnValue = EncodedFSSetting | EncodedFSSetting[] | null;
export type EncoderAsyncReturnValue = Promise<EncoderBaseReturnValue>;
export type EncoderReturnValue = EncoderBaseReturnValue | EncoderAsyncReturnValue;

export type DecoderContext = {
  allsettings: readonly FSSettingsRow[];
  /* Creationdate code used for link generation */
  cc: number;
};

type ImportOptions = {
  addMissingMembers?: boolean;
};

export interface TypeCodec {
  encoder(value: unknown, member: WHFSTypeMember): EncoderReturnValue;
  decoder(settings: readonly FSSettingsRow[], member: WHFSTypeMember, context: DecoderContext & ExportOptions): unknown;
  importValue?(value: unknown, member: WHFSTypeMember, beforeEncode: boolean, options?: ImportOptions): unknown;
  exportValue?(value: unknown, member: WHFSTypeMember, afterDecode: boolean, options?: ExportOptions): unknown;
  isDefaultValue?(value: unknown): boolean;
  getType: string;
  setType?: string;
  exportType?: string;
}

function assertValidString(value: unknown) {
  if (typeof value !== "string")
    throw new Error(`Incorrect type. Wanted string, got '${describeType(value)}'`);
  if (Buffer.byteLength(value) >= 4096)
    throw new Error(`String too long (${value.length})`);
  return value;
}

function assertValidDate(value: unknown): asserts value is Date {
  if (!(value instanceof Date))
    throw new Error(`Incorrect type. Wanted a Date, got '${describeType(value)}'`);

  const t = value.getTime();
  if (isNaN(t))
    throw new Error(`Invalid date`);
  if (t < -30610224000000   // Date.UTC(1000,0,1)   // no dates before 1000-1-1
    || t >= 253402300800000)  // Date.UTC(10000,0,1)   // no dates on or after the year 10_000 UTC
    throw new Error(`Date out of range. The year must be between 1 and 9999, got '${value}'`);
}

async function encodeResourceDescriptor(value: ResourceDescriptor | ExportedResource, opts?: { fileName?: string }): Promise<EncoderBaseReturnValue> {
  const v = value as ResourceDescriptor;
  if (v.resource.size)
    await uploadBlob(v.resource);

  return {
    setting: await addMissingScanData(v, opts),
    fs_object: v.sourceFile,
    blobdata: v.resource
  };
}

function decodeResourceDescriptor(row: FSSettingsRow, context: DecoderContext) {
  const meta = {
    ...decodeScanData(row.setting),
    dbLoc: { source: 2, id: row.id, cc: context.cc },
    sourceFile: row.fs_object ?? null,
  };
  return new ResourceDescriptor(row.blobdata, meta);
}

async function encodeWHFSInstance(value: Instance | InstanceSource): Promise<EncoderBaseReturnValue> {
  const typeinfo = await describeWHFSType(value.whfsType);
  const data = isInstance(value) ? value.data as Record<string, unknown> : omit(value, ['whfsType']);
  return {
    instancetype: typeinfo.id,
    sub: await setData(typeinfo.members, data)
  };
}

async function decodeWHFSInstance(row: FSSettingsRow, context: DecoderContext) {
  const typeinfo = await describeWHFSType(row.instancetype!);
  const widgetdata = await getData(typeinfo.members, row.id, { ...context, export: false });
  return await buildInstance({ whfsType: typeinfo.namespace, data: widgetdata });
}

async function encodeComposedDocument(toSerialize: ComposedDocument, rootSetting: string): Promise<EncodedFSSetting[]> {
  const storetext = toSerialize.text; // isrtd ? newval.htmltext : newval.text;

  const settings: EncodedFSSetting[] = [];
  settings.push({
    setting: rootSetting,
    ordering: 0,
    blobdata: await uploadBlob(storetext),
    checkLink: Boolean(storetext.size),
  });

  for (const [contentid, image] of toSerialize.embedded) { //encode images
    settings.push({
      ...await encodeResourceDescriptor(image, { fileName: contentid }),
      ordering: 1,
    });
  }

  for (const [tag, linkref] of toSerialize.links) { //encode images
    settings.push({
      ordering: 2,
      setting: tag || "",
      fs_object: linkref,
    });
  }

  for (const [instanceid, instance] of toSerialize.instances) { //encode embedded instances
    /* Generate settings for the instance:
      - It needs a toplevel setting with:
          - ordering = 3
          - instancetype pointing to the actual WHFS Type Id
          - setting will contain the instanceid
      - Then we write the actual data as a settings (instancetype->__RecurseSetInstanceData(instanceid, 0, elementid ?? newelementid, newval, cursettings, remapper, orphansvisible))
        - parent = the toplevel setting id we just generated
      */

    settings.push({
      ...await encodeWHFSInstance(instance),
      setting: instanceid,
      ordering: 3,
    });
  }
  return settings;
}

async function decodeComposedDocument(settings: FSSettingsRow[], type: ComposedDocumentType, context: DecoderContext) {
  const outdoc = new ComposedDocument(type, settings[0].blobdata!);
  for (const img of settings.filter(s => s.ordering === 1 && s.blobdata)) {
    const decoded = decodeResourceDescriptor(img, context);
    if (decoded.fileName)
      outdoc.embedded.set(decoded.fileName, decoded);
  }

  for (const link of settings.filter(s => s.ordering === 2 && s.fs_object)) {
    outdoc.links.set(link.setting, link.fs_object!);
  }

  for (const settingInstance of settings.filter(s => s.ordering === 3)) {
    const typeinfo = await describeWHFSType(settingInstance.instancetype!);
    const widgetdata = await getData(typeinfo.members, settingInstance.id, { ...context, export: false });
    outdoc.instances.set(settingInstance.setting, await buildInstance({ whfsType: typeinfo.namespace, data: widgetdata }));
  }

  return outdoc;
}

function describeType(value: unknown): string {
  if (typeof value !== "object")
    return typeof value;
  if (!value)
    return "null";
  return getWHType(value) ?? value.constructor?.name ?? "object";
}

export const codecs = {
  "boolean": {
    getType: "boolean",

    encoder: (value: boolean) => {
      if (typeof value !== "boolean")
        throw new Error(`Incorrect type. Wanted boolean, got '${describeType(value)}'`);

      return value ? { setting: "1" } : null;
    },
    decoder: (settings: FSSettingsRow[]): boolean => {
      return ["1", "true"].includes(settings[0]?.setting);
    }
  },
  "integer": {
    getType: "number",

    encoder: (value: number) => {
      if (typeof value !== "number")
        throw new Error(`Incorrect type. Wanted number, got '${describeType(value)}'`);
      if (value < -2147483648 || value > 2147483647) //as long as we're HS compatible, this is the range to stick to
        throw new Error(`Value is out of range for a 32 bit signed integer`);

      return value ? { setting: String(value) } : null;
    },
    decoder: (settings: FSSettingsRow[]): number => {
      return parseInt(settings[0]?.setting) || 0;
    }
  },
  "float": {
    getType: "number",

    encoder: (value: number) => {
      if (typeof value !== "number")
        throw new Error(`Incorrect type. Wanted number, got '${describeType(value)}'`);

      return value ? { setting: String(value) } : null;
    },
    decoder: (settings: FSSettingsRow[]): number => {
      return parseFloat(settings[0]?.setting) || 0;
    }
  },
  "whfsRef": {
    getType: "number | null",
    setType: "string | number | null",
    exportType: "string | null",

    encoder: (value: number | null) => {
      if (typeof value !== "number" && value !== null)
        throw new Error(`Incorrect type. Wanted number (or null), got '${describeType(value)}'`);

      return value ? { fs_object: value } : null;
    },
    decoder: (settings: FSSettingsRow[]): number | null => {
      return settings[0]?.fs_object || null;
    },
    exportValue: (value: number | null, member: WHFSTypeMember, afterDecode: boolean, options: ExportOptions): MaybePromise<string | null> => {
      if (!value)
        return null;
      return mapExternalWHFSRef(value, options);
    },
    importValue: (value: string | number | null): MaybePromise<number | null> => {
      if (!value)
        return null;
      if (typeof value === "number")
        return value;
      if (typeof value !== "string")
        throw new Error(`Incorrect type. Wanted string or number (or null), got '${describeType(value)}'`);
      return unmapExternalWHFSRef(value);
    },
  },
  "whfsRefArray": {
    getType: "Array<number>",
    setType: "Array<string | number>",
    exportType: "Array<string>",

    encoder: (value: number[]) => {
      if (!Array.isArray(value))
        throw new Error(`Incorrect type. Wanted array, got '${describeType(value)}'`);

      const settings: Array<Partial<FSSettingsRow>> = [];
      let nextOrdering = 1;
      for (const val of value) {
        if (typeof val !== "number")
          throw new Error(`Incorrect type. Wanted number, got '${describeType(typeof val)}'`);
        if (!val)
          continue;

        settings.push({ fs_object: val, ordering: nextOrdering++ });
      }
      return settings;
    },
    decoder: (settings: FSSettingsRow[]): number[] => {
      return settings.map(s => s.fs_object).filter(s => s !== null);
    },
    isDefaultValue: (value: unknown) => {
      return Array.isArray(value) && value.length === 0;
    },
    exportValue: (value: number[], member: WHFSTypeMember, afterDecode: boolean, options: ExportOptions): MaybePromise<string[]> => {
      return Promise.all(value.map(v => mapExternalWHFSRef(v, options))).then(mapped => mapped.filter(isTruthy));
    },
    importValue: async (value: Array<string | number>): Promise<number[]> => {
      if (!Array.isArray(value))
        throw new Error(`Incorrect type. Wanted array, got '${describeType(value)}'`);

      const retval: number[] = [];
      for (const val of value) {
        const add = typeof val === "number" ? val : await unmapExternalWHFSRef(val);
        if (add)
          retval.push(add);
      }
      return retval;
    },
  },
  "plainDate": {
    getType: "Temporal.PlainDate | null",
    setType: "Temporal.PlainDate | Date | string | null",
    exportType: "string",

    encoder: (value: Temporal.PlainDate | null) => {
      if (value === null) //we accept nulls in datetime fields
        return null;
      if (!isTemporalPlainDate(value))
        throw new Error(`Incorrect type. Wanted Temporal.PlainDate (or null), got '${describeType(value)}'`);
      return { setting: value.toString().split("[")[0] };
    },
    decoder: (settings: FSSettingsRow[]): Temporal.PlainDate | null => {
      if (!settings[0]?.setting)
        return null;
      return Temporal.PlainDate.from(settings[0].setting.split("T")[0]);
    },
    exportValue(value: Temporal.PlainDate | null): MaybePromise<string> {
      return value ? value.toString().split("[")[0] : "";
    },
    importValue(value: Temporal.PlainDate | Date | string | null): Temporal.PlainDate | null {
      if (value === null || value === "" || isTemporalPlainDate(value))
        return value || null;
      if (typeof value === "string")
        return Temporal.PlainDate.from(value);

      assertValidDate(value);
      return Temporal.PlainDate.from(value.toISOString().split("T")[0]);
    }
  },
  "instant": {
    getType: "Temporal.Instant | null",
    setType: "Temporal.Instant | Date | string | null",
    exportType: "string",

    encoder: (value: Temporal.Instant | null) => {
      if (value === null) //we accept nulls in datetime fields
        return null;
      if (!isTemporalInstant(value))
        throw new Error(`Incorrect type. Wanted Temporal.Instant (or null), got '${describeType(value)}'`);
      const { days, msecs } = dateToParts(value);
      return days || msecs ? { setting: `${days}:${msecs}` } : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      const dt = settings[0]?.setting?.split(":") ?? null;
      return dt && dt.length === 2 ? makeDateFromParts(parseInt(dt[0]), parseInt(dt[1])).toTemporalInstant() : null;
    },
    exportValue(value, member, options) {
      return value ? value.toString() : null;
    },
    importValue(value: Temporal.Instant | Date | string | null): Temporal.Instant | null {
      if (value === null || value === "" || isTemporalInstant(value))
        return value || null;
      if (typeof value === "string")
        return Temporal.Instant.from(value);
      assertValidDate(value);
      return value.toTemporalInstant();
    }
  },
  "string": {
    getType: "string",

    encoder: (value: string) => {
      const strvalue = assertValidString(value);
      return strvalue ? { setting: strvalue } : null;
    },
    decoder: (settings: FSSettingsRow[]): string => {
      return settings[0]?.setting || "";
    }
  },
  "url": { //TODO identical to "string" at this moment, but we're not handling linkchecking yet
    getType: "string",

    encoder: (value: string) => {
      const strvalue = assertValidString(value);
      return strvalue ? { setting: strvalue, checkLink: true } : null;
    },
    decoder: (settings: FSSettingsRow[]): string => {
      return settings[0]?.setting || "";
    }
  },
  "hson": { //fs_member type 21 (hson) and 22 (formrecord, dropped in WH5.9)
    getType: "Record<string,unknown> | null",
    setType: "Record<string,unknown> | string | null",
    exportType: "string | null",

    encoder: (value: Record<string, unknown> | null) => {
      if (typeof value !== "object") //NOTE 'null' is an object too and acceptable here
        throw new Error(`Incorrect type. Wanted an object, got a '${describeType(value)}'`);
      if (!value) //null!
        return null; //nothing to store

      if (Object.getPrototypeOf(value).constructor.name !== "Object")
        throw new Error(`Incorrect type. Wanted a plain object but got a '${Object.getPrototypeOf(value).constructor.name}'`);

      const ashson = encodeHSON(value as IPCMarshallableData);
      if (Buffer.byteLength(ashson) > 4096) { //upload, requires async completion
        return (async (): EncoderAsyncReturnValue => {
          return { blobdata: await uploadBlob(WebHareBlob.from(ashson)) };
        })();
      }
      return { setting: ashson };
    },
    decoder: (settings: FSSettingsRow[]): MaybePromise<Record<string, unknown> | null> => {
      //If setting == FC1, this is a former <formcondition> (type 22) which would always overflow to a blob and store FC1 as setting - we didn't do a data conversion after dropping 22
      if (settings[0]?.setting && settings[0]?.setting !== "FC1")
        return decodeHSON(settings[0].setting) as Record<string, unknown>;
      else if (settings[0]?.blobdata)
        return settings[0]?.blobdata.text().then(text => decodeHSON(text) as Record<string, unknown>);
      return null;
    },
    exportValue(value: Record<string, unknown> | null): string | null {
      return value && encodeHSON(value as IPCMarshallableData) || null;
    },
    importValue(value: Record<string, unknown> | string | null): Record<string, unknown> | null {
      if (typeof value === "string")
        return decodeHSON(value) as Record<string, unknown>;
      return value;
    },
  },
  "json": { //fs_member type 26(json)
    getType: "TypedStringifyable",

    encoder: (value: TypedStringifyable) => {
      if (typeof value !== "object") //NOTE 'null' is an object too and acceptable here
        throw new Error(`Incorrect type. Wanted an object, got a '${describeType(value)}'`);
      if (!value) //null!
        return null; //nothing to store

      if (Object.getPrototypeOf(value).constructor.name !== "Object")
        throw new Error(`Incorrect type. Wanted a plain object but got a '${Object.getPrototypeOf(value).constructor.name}'`);

      const asjson = stringify(value, { typed: true });
      if (Buffer.byteLength(asjson) > 4096) { //upload, requires async completion
        return (async (): EncoderAsyncReturnValue => {
          return { blobdata: await uploadBlob(WebHareBlob.from(asjson)) };
        })();
      }
      return { setting: asjson };
    },
    decoder: (settings: FSSettingsRow[]): MaybePromise<TypedStringifyable | null> => {
      if (settings[0]?.setting)
        return parseTyped(settings[0].setting) as TypedStringifyable;
      else if (settings[0]?.blobdata)
        return settings[0]?.blobdata.text().then(text => parseTyped(text) as TypedStringifyable);
      return null;
    },
  },
  "stringArray": {
    getType: "string[]",

    encoder: (value: string[]) => {
      if (!Array.isArray(value))
        throw new Error(`Incorrect type. Wanted string array, got '${describeType(value)}'`);

      return value.length ? value.map((v, idx) => ({ setting: assertValidString(v), ordering: ++idx })) : null;
    },
    decoder: (settings: FSSettingsRow[]): string[] => {
      return settings.map(s => s.setting);
    },
    isDefaultValue: (value: unknown) => {
      return Array.isArray(value) && value.length === 0;
    }
  },
  "money": {
    getType: "Money",

    encoder: (value: Money) => {
      if (!Money.isMoney(value))
        throw new Error(`Incorrect type. Wanted Money, got '${describeType(value)}'`);
      return Money.cmp(value, "0") ? { setting: value.toString() } : null;
    },
    decoder: (settings: FSSettingsRow[]): Money => {
      return new Money(settings[0]?.setting || "0");
    },
    isDefaultValue: (value: Money) => {
      return Money.cmp(value, "0") === 0;
    },
    exportValue(value: Money): string {
      return value.toString();
    },
    importValue(value: string | number | Money): Money {
      if (typeof value === "number")
        return new Money(value.toString());
      if (typeof value === "string")
        return new Money(value);
      if (!Money.isMoney(value))
        throw new Error(`Incorrect type. Wanted string, number or Money, got '${describeType(value)}'`);
      return value;
    }
  },
  "file": {
    getType: "ResourceDescriptor | null",
    setType: "ResourceDescriptor | ExportedResource | null",
    exportType: "ExportedResource | null",

    encoder: (value: ResourceDescriptor | null) => {
      if (typeof value !== "object") //TODO test for an actual ResourceDescriptor
        throw new Error(`Incorrect type. Wanted a ResourceDescriptor, got '${describeType(value)}'`);
      if (!value)
        return null;

      //Return the actual work as a promise, so we can wait for uploadBlob
      return encodeResourceDescriptor(value);
    },
    decoder: (settings: FSSettingsRow[], member: WHFSTypeMember, context: DecoderContext): ResourceDescriptor | null => {
      if (!settings.length)
        return null;

      return decodeResourceDescriptor(settings[0], context);
    },
    exportValue: (value: ResourceDescriptor | null, member: WHFSTypeMember, afterDecode: boolean, options: ExportOptions): Promise<ExportedResource> | null => {
      return value?.export(options) ?? null;
    },
    importValue: (value: ResourceDescriptor | ExportedResource | null): MaybePromise<ResourceDescriptor | null> => {
      if (!value || isResourceDescriptor(value))
        return value;
      if (typeof value !== "object") //TODO test for an actual ResourceDescriptor
        throw new Error(`Incorrect type. Wanted a ResourceDescriptor, got '${describeType(value)}'`);
      return ResourceDescriptor.import(value);
    }
  },
  "record": { //NOTE: getType/setType are only queried for records/arrays without children
    getType: "Record<never, unknown> | null",

    encoder: (value: object | null, member: WHFSTypeMember) => {
      if (!value)
        return [];
      return (async (): EncoderAsyncReturnValue => {
        const toInsert = new Array<EncodedFSSetting>();
        toInsert.push({ ordering: 1, sub: await setData(member.children!, value) });
        return toInsert;
      })();
    },
    decoder: (settings: FSSettingsRow[], member: WHFSTypeMember, context: DecoderContext & ExportOptions) => {
      return settings.length ? getData(member.children || [], settings[0].id, context) : null;
    },
    exportValue(value: object | null, member, afterDecode, options) {
      // If afterDecode is true, the getData call will already have done the export conversion
      return value && !afterDecode ? exportData(member.children || [], value, options) : value;
    },
    importValue(value: object | null, member: WHFSTypeMember, beforeEncode, options): MaybePromise<InstanceData | null> {
      // encode will call getData which will call importValue on children, so no need to do that here
      return value && !beforeEncode ? importData(member.children || [], value, options) : value as InstanceData | null;
    }
  },
  "array": {  //NOTE: getType/setType are only queried for records/arrays without children
    getType: "Array<never>",

    encoder: (value: object[], member: WHFSTypeMember) => {
      if (!Array.isArray(value))
        throw new Error(`Incorrect type. Wanted array, got '${describeType(value)}'`);

      return (async (): EncoderAsyncReturnValue => {
        const toInsert = new Array<EncodedFSSetting>();
        for (const row of value)
          toInsert.push({ ordering: toInsert.length + 1, sub: await setData(member.children!, row) });
        return toInsert;
      })();
    },
    decoder: (settings: FSSettingsRow[], member: WHFSTypeMember, context: DecoderContext & ExportOptions): Promise<object[]> => {
      return Promise.all(settings.map(s => getData(member.children || [], s.id, context)));
    },
    exportValue(value: object[], member, afterDecode, options): Promise<object[]> | object[] {
      // If afterDecode is true, the getData call will already have done the export conversion
      return !afterDecode ? Promise.all(value.map(v => exportData(member.children || [], v, options))) : value;
    },
    importValue(value: object[], member, beforeEncode, options): Promise<object[]> | object[] {
      // encode will call getData which will call importValue on children, so no need to do that here
      return !beforeEncode ? Promise.all(value.map(v => importData(member.children || [], v, options))) : value;
    },
    isDefaultValue: (value: unknown) => {
      return Array.isArray(value) && value.length === 0;
    }
  },
  "richTextDocument": {
    getType: "RichTextDocument | null",
    setType: "RichTextDocument | RTDSource | null",
    exportType: "RTDExport | null",

    encoder: (value: RichTextDocument | null) => {
      if (value && !isRichTextDocument(value))
        throw new Error(`Incorrect type. Wanted a RichTextDocument, got '${describeType(value)}'`);
      if (!value || value.isEmpty())
        return null;

      //Return the actual work as a promise, so we can wait for uploadBlob
      return (async (): EncoderAsyncReturnValue => {
        //Don't recurse, we're encoding embedded instances ourselves
        const asComposed = await exportRTDAsComposedDocument(value, { recurse: false });
        const versionindicator = "RD1"; // isrtd ? "RD1" : "CD1:" || value.type;
        return await encodeComposedDocument(asComposed, versionindicator);

      })();
    },
    decoder: (settings: FSSettingsRow[], member: WHFSTypeMember, context: DecoderContext) => {
      if (!settings.length || !settings[0].blobdata)
        return null;

      // An RTD doesn't have a non-recursive .export(), so don't export recursively here and leave it to .exportValue
      return (async () => {
        const base = await decodeComposedDocument(settings, "platform:richtextdocument", context);
        return buildRTDFromComposedDocument(base);
      })();
    },
    exportValue: (value: RichTextDocument | null, member: WHFSTypeMember, afterDecode: boolean, options: ExportOptions) => {
      return value?.export() || null;
    },
    importValue: (value: RTDSource | RichTextDocument | null): MaybePromise<RichTextDocument | null> => {
      if (!value || isRichTextDocument(value))
        return value;
      if (!Array.isArray(value))
        throw new Error(`Incorrect type. Wanted a RichTextDocument or RTDSource, got '${describeType(value)}'`);
      return buildRTD(value);
    },
  },
  "instance": {
    getType: "Instance | null",
    setType: "Instance | InstanceSource | null",
    exportType: "InstanceExport | null",

    encoder: (value: Instance | null) => {
      if (!value)
        return null;
      if (!value.whfsType)
        throw new Error(`Missing whfsType in instance`);

      //Return the actual work as a promise - even when ignoring describeWHFSType, any member might be a promise too
      return encodeWHFSInstance(value);
    },
    decoder: (settings: FSSettingsRow[], member: WHFSTypeMember, context: DecoderContext): Promise<Instance> | null => {
      if (!settings.length)
        return null;

      // WHFSInstance .export() has no option to skip recursion, so leave export recursion to .exportValue
      return decodeWHFSInstance(settings[0], context);
    },
    exportValue: (value: Instance | null, member, afterDecode, options): Promise<InstanceExport> | null => {
      return value?.export(options) || null;
    },
    importValue(value: Instance | InstanceSource | null, member, beforeEncode, options): MaybePromise<Instance> | null {
      if (value && !value.whfsType)
        throw new Error(`Missing whfsType in instance`);

      if (value && !isInstance(value))  //looks like an ExportedWHFSInstance?
        return buildInstance(value);
      return value;
    },
  },
  "intExtLink": {
    getType: "IntExtLink | null",
    setType: "IntExtLink | ExportedIntExtLink | null",
    exportType: "ExportedIntExtLink | null",

    encoder: (value: IntExtLink | null) => {
      if (!value)
        return null;

      const data = value.internalLink ? value.append : value.externalLink;
      return { fs_object: value.internalLink || null, setting: data || "", checkLink: Boolean(data) };
    },
    decoder: (settings: FSSettingsRow[]): IntExtLink | null => {
      if (settings[0]?.fs_object)
        return new IntExtLink(settings[0]?.fs_object, { append: settings[0]?.setting || "" });
      if (settings[0]?.setting)
        return new IntExtLink(settings[0]?.setting);
      return null;
    },
    exportValue: (value: IntExtLink | null, member: WHFSTypeMember, afterDecode, options: ExportOptions): MaybePromise<ExportedIntExtLink | null> => {
      return exportIntExtLink(value, options);
    },
    importValue: (value: IntExtLink | null | ExportedIntExtLink, member: WHFSTypeMember): MaybePromise<IntExtLink | null> => {
      return importIntExtLink(value);
    }
  },
  "composedDocument": {
    getType: "ComposedDocument | null",
    // FIXME: export format!

    encoder: (value: ComposedDocument | null) => {
      if (!value)
        return null;
      if (value.type === "platform:formdefinition")
        return encodeComposedDocument(value, "CD1:publisher:formdefinition"); //HS used 'publisher:' prefix
      if (value.type === "platform:markdown")
        return encodeComposedDocument(value, "CD1:publisher:markdown"); //HS used 'publisher:' prefix
      throw new Error(`Unsupported composed document type '${value.type}'`);
    },
    decoder: (settings: FSSettingsRow[], member: WHFSTypeMember, context: DecoderContext): Promise<ComposedDocument> | null => {
      if (!settings.length || !settings[0].blobdata)
        return null;

      const type = settings[0].setting === "CD1:publisher:formdefinition" ? "platform:formdefinition"
        : settings[0].setting === "CD1:publisher:markdown" ? "platform:markdown"
          : throwError(`Unsupported composed document type indicator '${settings[0].setting}'`);

      return decodeComposedDocument(settings, type, context);
    }
  }
} satisfies { [key in MemberType]: TypeCodec };

/** Check if the encoder matches (decoder-returnvalue) => unknown and importValue matches (export-returnvalue | decoder-returnvalue) => encoder-inputvalue */
type Codecs = typeof codecs;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ResultTypes = { [Key in keyof Codecs]: kysely.Simplify<{ base: Awaited<ReturnType<Codecs[Key]["decoder"]>> } & (Codecs[Key] extends { exportValue: (...args: any) => any } ? { export: Awaited<ReturnType<Codecs[Key]["exportValue"]>> } : object)> };

type ExpectedCodecSignatures = {
  [Key in keyof ResultTypes]: (ResultTypes[Key] extends { export: unknown } ? {
    encoder: (data: ResultTypes[Key]["base"], member: WHFSTypeMember) => unknown;
    importValue: (data: ResultTypes[Key]["export"] | ResultTypes[Key]["base"], member: WHFSTypeMember, recursive: boolean, options?: ImportOptions) => MaybePromise<ResultTypes[Key]["base"]>;
  } : {
    encoder: (data: ResultTypes[Key]["base"], member: WHFSTypeMember) => unknown;
    importValue?: never;
  })
};

(codecs satisfies ExpectedCodecSignatures);

export type EncodedFSSetting = kysely.Updateable<PlatformDB["system.fs_settings"]> & {
  id?: number;
  fs_member?: number;
  sub?: EncodedFSSetting[];
  checkLink?: boolean;
};

/** Recursively set the data
 * @param members - The set of members at his level
 * @param data - Data to apply at this level */
export async function setData(members: WHFSTypeMember[], data: object): Promise<EncodedFSSetting[]> {
  const toInsert = new Array<EncodedFSSetting>;
  for (const [key, value] of Object.entries(data as object)) {
    if (key === "fsSettingId") //FIXME though only invalid on sublevels, not toplevel!
      continue;

    const matchmember = members.find(_ => _.name === key);
    if (!matchmember)  //TODO orphan check, parent path, DidYouMean
      throw new Error(`Trying to set a value for the non-existing cell '${key}'`);

    try {
      const mynewsettings = new Array<Partial<FSSettingsRow>>;
      const codec: TypeCodec = codecs[matchmember.type];
      if (!codec)
        throw new Error(`Unsupported type ${matchmember.type}`);

      const setValue = codec.importValue ? codec.importValue(value, matchmember, true) : value;

      const encodedsettings: EncoderReturnValue = codec.encoder(isPromise(setValue) ? await setValue : setValue, matchmember);
      const finalsettings: EncoderBaseReturnValue = isPromise(encodedsettings) ? await encodedsettings : encodedsettings;

      if (Array.isArray(finalsettings))
        appendToArray(mynewsettings, finalsettings);
      else if (finalsettings)
        mynewsettings.push(finalsettings);

      for (let i = 0; i < mynewsettings.length; ++i) {
        toInsert.push({ fs_member: matchmember.id, ...mynewsettings[i] });
      }
    } catch (e) {
      if (e instanceof Error)
        e.message += ` (while setting '${matchmember.name}')`;
      throw e;
    }
  }
  return toInsert;
}

export async function getData(members: WHFSTypeMember[], elementSettingId: number | null, context: DecoderContext & ExportOptions): Promise<InstanceData> {
  const retval: Record<string, unknown> = {};

  for (const member of members) {
    const settings = context.allsettings.filter(_ => _.fs_member === member.id && _.parent === elementSettingId);
    let setval;

    try {
      const codec: TypeCodec = codecs[member.type];
      if (!codec)
        throw new Error(`Unsupported type '${member.type}' for member '${member.name}'`);

      setval = codec.decoder(settings, member, context);
      if (isPromise(setval))
        setval = await setval;
      if (context?.export) {
        if (codec.isDefaultValue ? codec.isDefaultValue(setval) : !setval)
          continue; //don't export default values
        if (codec.exportValue) {
          setval = codec.exportValue(setval, member, true, context);
          if (isPromise(setval))
            setval = await setval;
        }
      }
    } catch (e) {
      if (e instanceof Error)
        e.message += ` (while getting '${member.name}')`;
      throw e;
    }
    retval[member.name] = setval;
  }

  return retval as InstanceData;
}

export async function exportData(members: WHFSTypeMember[], data: object, options?: ExportOptions): Promise<{ [K in string]?: CodecExportMemberType }> {
  const retval: { [key in string]?: CodecExportMemberType } = {};

  for (const member of members) {
    let setval = (data as Record<string, unknown>)[member.name];
    if (setval === undefined)
      throw new Error(`Missing value for member '${member.name}'`);
    try {
      const codec: TypeCodec = codecs[member.type];
      if (!codec)
        throw new Error(`Unsupported type '${member.type}' for member '${member.name}'`);

      if (codec.isDefaultValue ? codec.isDefaultValue(setval) : !setval)
        continue; //don't export default values

      if (codec.exportValue) {
        setval = codec.exportValue(setval, member, false, options);
        if (isPromise(setval))
          setval = await setval;
      }
    } catch (e) {
      if (e instanceof Error)
        e.message += ` (while exporting '${member.name}')`;
      throw e;
    }
    retval[member.name] = setval as CodecExportMemberType;
  }

  return retval;
}

export async function importData(members: WHFSTypeMember[], data: object, options?: ImportOptions): Promise<{ [K in string]: CodecGetMemberType }> {
  const retval: { [key in string]: CodecGetMemberType } = {};

  for (let [key, setval] of Object.entries(data)) {
    if (key === "whfsType" || setval === undefined)
      continue;
    const member = members.find(m => m.name === key);
    if (!member)
      throw new Error(`Trying to set a value for the non-existing cell '${key}'`);
    try {
      const codec: TypeCodec = codecs[member.type];
      if (!codec)
        throw new Error(`Unsupported type '${member.type}' for member '${member.name}'`);

      if (setval === undefined)
        setval = codec.decoder([], member, { allsettings: [], cc: 0, export: false }); //get default value
      else if (codec.importValue)
        setval = codec.importValue(setval, member, false, options);
      if (isPromise(setval))
        setval = await setval;
    } catch (e) {
      if (e instanceof Error)
        e.message += ` (while importing '${member.name}')`;
      throw e;
    }
    retval[member.name] = setval;
  }
  if (options?.addMissingMembers) {
    for (const member of members) {
      if (retval[member.name] === undefined) {
        const codec: TypeCodec = codecs[member.type];
        if (!codec)
          throw new Error(`Unsupported type '${member.type}' for member '${member.name}'`);
        let setval = codec.decoder([], member, { allsettings: [], cc: 0, export: false }); //get default value
        if (isPromise(setval))
          setval = await setval;
        retval[member.name] = setval as CodecGetMemberType;
      }
    }
  }
  return retval;
}

// Possible member types that can be return by getData
export type CodecGetMemberType =
  null |
  boolean |
  number |
  number[] |
  string |
  string[] |
  { [K in string]: CodecGetMemberType } |
  Array<{ [K in string]: CodecGetMemberType }> |
  ComposedDocument |
  Instance |
  IntExtLink |
  Money |
  Record<string, unknown> |
  ResourceDescriptor |
  RichTextDocument |
  Temporal.Instant |
  Temporal.PlainDate |
  TypedStringifyable;

// Possible member types that can be returned by exportData
export type CodecExportMemberType =
  null |
  boolean |
  number |
  string |
  string[] |
  Array<{ [K in string]?: CodecExportMemberType }> |
  ComposedDocument |
  IntExtLink |
  Money |
  { [K in string]?: CodecExportMemberType } |
  RTDExport |
  ExportedResource |
  InstanceExport |
  ExportedIntExtLink |
  TypedStringifyable;

// Possible member types that are accepted by setData/importData
export type CodecImportMemberType =
  null |
  boolean |
  number |
  string |
  string[] |
  { [K in string]?: CodecImportMemberType } |
  Array<{ [K in string]?: CodecImportMemberType }> |
  Array<string | number> |
  ComposedDocument |
  Date |
  Date |
  ExportedIntExtLink |
  ExportedResource |
  Instance |
  InstanceSource |
  IntExtLink |
  Money |
  Record<string, unknown> |
  ResourceDescriptor |
  RichTextDocument |
  RTDSource |
  Temporal.Instant |
  Temporal.PlainDate |
  TypedStringifyable;
