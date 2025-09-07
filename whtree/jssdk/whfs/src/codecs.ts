import type * as kysely from "kysely";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { uploadBlob } from "@webhare/whdb";
import { appendToArray, isPromise, isTruthy, Money, omit, throwError } from "@webhare/std";
import { encodeHSON, decodeHSON } from "@webhare/hscompat/src/hson.ts";
import { dateToParts, makeDateFromParts, } from "@webhare/hscompat/src/datetime.ts";
import { buildRTDFromComposedDocument, exportRTDAsComposedDocument } from "@webhare/hscompat/src/richdocument.ts";
import type { IPCMarshallableData } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { ResourceDescriptor, addMissingScanData, decodeScanData, exportIntExtLink, importIntExtLink, isResourceDescriptor, mapExternalWHFSRef, unmapExternalWHFSRef } from "@webhare/services/src/descriptor";
import { IntExtLink, WebHareBlob, type RichTextDocument, type WHFSInstance } from "@webhare/services";
import type { WHFSInstanceData, WHFSTypeMember } from "./contenttypes";
import type { FSSettingsRow } from "./describe";
import { describeWHFSType } from "./describe";
import { getWHType } from "@webhare/std/src/quacks";
import { buildRTD, buildWHFSInstance, isRichTextDocument, isWHFSInstance, type RTDBuildSource } from "@webhare/services/src/richdocument";
import type { ExportedResource, ExportOptions } from "@webhare/services/src/descriptor";
import type { ExportedIntExtLink } from "@webhare/services/src/intextlink";
import { ComposedDocument, type ComposedDocumentType } from "@webhare/services/src/composeddocument";

/// Returns T or a promise resolving to T
type MaybePromise<T> = Promise<T> | T;

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
  ;

export type EncoderBaseReturnValue = EncodedFSSetting | EncodedFSSetting[] | null;
export type EncoderAsyncReturnValue = Promise<EncoderBaseReturnValue>;
export type EncoderReturnValue = EncoderBaseReturnValue | EncoderAsyncReturnValue;

export type DecoderContext = ExportOptions & {
  allsettings: readonly FSSettingsRow[];
  /* Creationdate code used for link generation */
  cc: number;
};

interface TypeCodec {
  encoder(value: unknown, member: WHFSTypeMember): EncoderReturnValue;
  decoder(settings: readonly FSSettingsRow[], member: WHFSTypeMember, context: DecoderContext): unknown;
  importValue?(value: unknown): unknown;
  exportValue?(value: unknown, options?: ExportOptions): unknown;
  isDefaultValue?(value: unknown): boolean;
  getType: string;
  setType?: string;
  exportType?: string;
}

function assertValidString(value: unknown) {
  if (typeof value !== "string")
    throw new Error(`Incorrect type. Wanted string, got '${typeof value}'`);
  if (Buffer.byteLength(value) >= 4096)
    throw new Error(`String too long (${value.length})`);
  return value;
}

function assertValidDate(value: unknown): asserts value is Date {
  if (!(value instanceof Date))
    throw new Error(`Incorrect type. Wanted a Date, got '${typeof value}'`);

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

async function encodeWHFSInstance(value: WHFSInstance | WHFSInstanceData): Promise<EncoderBaseReturnValue> {
  const typeinfo = await describeWHFSType(value.whfsType);
  const data = isWHFSInstance(value) ? value.data as Record<string, unknown> : omit(value, ['whfsType']);
  return {
    instancetype: typeinfo.id,
    sub: await recurseSetData(typeinfo.members, data)
  };
}

async function decodeWHFSInstance(row: FSSettingsRow, context: DecoderContext) {
  const typeinfo = await describeWHFSType(row.instancetype!);
  const widgetdata = await recurseGetData(typeinfo.members, row.id, context);

  return await buildWHFSInstance({ whfsType: typeinfo.namespace, ...widgetdata });
}

async function encodeComposedDocument(toSerialize: ComposedDocument, rootSetting: string): Promise<EncodedFSSetting[]> {
  const storetext = toSerialize.text; // isrtd ? newval.htmltext : newval.text;

  const settings: EncodedFSSetting[] = [];
  settings.push({
    setting: rootSetting,
    ordering: 0,
    blobdata: await uploadBlob(storetext),
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

  for (const [instanceid, instance] of toSerialize.instances) { //encode embedded instanes
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
    const widgetdata = await recurseGetData(typeinfo.members, settingInstance.id, context);
    outdoc.instances.set(settingInstance.setting, await buildWHFSInstance({ whfsType: typeinfo.namespace, ...widgetdata }));
  }

  return outdoc;
}

export const codecs: { [key in MemberType]: TypeCodec } = {
  "boolean": {
    getType: "boolean",

    encoder: (value: unknown) => {
      if (typeof value !== "boolean")
        throw new Error(`Incorrect type. Wanted boolean, got '${typeof value}'`);

      return value ? { setting: "1" } : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      return ["1", "true"].includes(settings[0]?.setting);
    }
  },
  "integer": {
    getType: "number",

    encoder: (value: unknown) => {
      if (typeof value !== "number")
        throw new Error(`Incorrect type. Wanted number, got '${typeof value}'`);
      if (value < -2147483648 || value > 2147483647) //as long as we're HS compatible, this is the range to stick to
        throw new Error(`Value is out of range for a 32 bit signed integer`);

      return value ? { setting: String(value) } : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      return parseInt(settings[0]?.setting) || 0;
    }
  },
  "float": {
    getType: "number",

    encoder: (value: unknown) => {
      if (typeof value !== "number")
        throw new Error(`Incorrect type. Wanted number, got '${typeof value}'`);

      return value ? { setting: String(value) } : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      return parseFloat(settings[0]?.setting) || 0;
    }
  },
  "whfsRef": {
    getType: "number | null",
    setType: "string | number | null",
    exportType: "string | null",

    encoder: (value: unknown) => {
      if (typeof value !== "number")
        throw new Error(`Incorrect type. Wanted number, got '${typeof value}'`);

      return value ? { fs_object: value } : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      return settings[0]?.fs_object || null;
    },
    exportValue: (value: number | null, options: ExportOptions): MaybePromise<string | null> => {
      if (!value)
        return null;
      return mapExternalWHFSRef(value, options);
    },
    importValue: (value: string | number | null): MaybePromise<number | null> => {
      if (!value)
        return null;
      if (typeof value === "number")
        return value;
      return unmapExternalWHFSRef(value);
    },
  },
  "whfsRefArray": {
    getType: "Array<number>",
    setType: "Array<string | number>",
    exportType: "Array<string>",

    encoder: (value: unknown) => {
      if (!Array.isArray(value))
        throw new Error(`Incorrect type. Wanted array, got '${typeof value}'`);

      const settings: Array<Partial<FSSettingsRow>> = [];
      let nextOrdering = 1;
      for (const val of value) {
        if (typeof val !== "number")
          throw new Error(`Incorrect type. Wanted number, got '${typeof val}'`);
        if (!val)
          continue;

        settings.push({ fs_object: val, ordering: nextOrdering++ });
      }
      return settings;
    },
    decoder: (settings: FSSettingsRow[]) => {
      return settings.map(s => s.fs_object).filter(s => s !== null);
    },
    isDefaultValue: (value: unknown) => {
      return Array.isArray(value) && value.length === 0;
    },
    exportValue: (value: number[], options: ExportOptions): MaybePromise<string[]> => {
      return Promise.all(value.map(v => mapExternalWHFSRef(v, options))).then(mapped => mapped.filter(isTruthy));
    },
    importValue: async (value: Array<string | number>): Promise<number[]> => {
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
    setType: "Temporal.PlainDate | Date | null",

    encoder: (value: unknown) => {
      if (value === null) //we accept nulls in datetime fields
        return null;

      assertValidDate(value);

      //return Date as YYYY-MM-DD
      const yyyy_mm_dd = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
      return { setting: yyyy_mm_dd };
    },
    decoder: (settings: FSSettingsRow[]) => {
      if (!settings[0]?.setting)
        return null;
      const dt = new Date(settings[0].setting);
      dt.setUTCHours(0, 0, 0, 0); //truncate to a UTC Date
      return dt;
    }
  },
  "instant": {
    getType: "Temporal.Instant | null",
    setType: "Temporal.Instant | Date | null",

    encoder: (value: unknown) => {
      if (value === null) //we accept nulls in datetime fields
        return null;

      assertValidDate(value);

      const { days, msecs } = dateToParts(value);
      return days || msecs ? { setting: `${days}:${msecs}` } : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      const dt = settings[0]?.setting?.split(":") ?? null;
      return dt && dt.length === 2 ? makeDateFromParts(parseInt(dt[0]), parseInt(dt[1])) : null;
    }
  },
  "string": {
    getType: "string",

    encoder: (value: unknown) => {
      const strvalue = assertValidString(value);
      return strvalue ? { setting: strvalue } : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      return settings[0]?.setting || "";
    }
  },
  "url": { //TODO identical to "string" at this moment, but we're not handling linkchecking yet
    getType: "string",

    encoder: (value: unknown) => {
      const strvalue = assertValidString(value);
      return strvalue ? { setting: strvalue } : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      return settings[0]?.setting || "";
    }
  },
  "hson": { //fs_member type 21 (hson) and 22 (formrecord, dropped in WH5.9)
    getType: "Record<string,unknown> | null",

    encoder: (value: unknown) => {
      if (typeof value !== "object") //NOTE 'null' is an object too and acceptable here
        throw new Error(`Incorrect type. Wanted an object`);
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
    decoder: (settings: FSSettingsRow[]) => {
      //If setting == FC1, this is a former <formcondition> (type 22) which would always overflow to a blob and store FC1 as setting - we didn't do a data conversion after dropping 22
      if (settings[0]?.setting && settings[0]?.setting !== "FC1")
        return decodeHSON(settings[0].setting);
      else if (settings[0]?.blobdata)
        return settings[0]?.blobdata.text().then(text => decodeHSON(text));
      return null;
    }
  },
  "stringArray": {
    getType: "string[]",

    encoder: (value: unknown) => {
      if (!Array.isArray(value))
        throw new Error(`Incorrect type. Wanted string array, got '${typeof value}'`);

      return value.length ? value.map((v, idx) => ({ setting: assertValidString(v), ordering: ++idx })) : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      return settings.map(s => s.setting);
    },
    isDefaultValue: (value: unknown) => {
      return Array.isArray(value) && value.length === 0;
    }
  },
  "money": {
    getType: "Money",

    encoder: (value: unknown) => {
      if (typeof value === "number")
        return value ? { setting: String(value) } : null;
      if (Money.isMoney(value))
        return Money.cmp(value, "0") ? { setting: value.toString() } : null;
      throw new Error(`Incorrect type. Wanted number or Money, got '${typeof value}'`);
    },
    decoder: (settings: FSSettingsRow[]) => {
      return new Money(settings[0]?.setting || "0");
    },
    isDefaultValue: (value: Money) => {
      return Money.cmp(value, "0") === 0;
    }
  },
  "file": {
    getType: "ResourceDescriptor | null",
    setType: "ResourceDescriptor | ExportedResource | null",
    exportType: "ExportedResource | null",

    encoder: (value: ResourceDescriptor | ExportedResource | null) => {
      if (typeof value !== "object") //TODO test for an actual ResourceDescriptor
        throw new Error(`Incorrect type. Wanted a ResourceDescriptor, got '${typeof value}'`);
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
    exportValue: (value: ResourceDescriptor, options: ExportOptions): Promise<ExportedResource> | null => {
      return value?.export(options) ?? null as unknown as ExportedResource;
    },
    importValue: (value: ResourceDescriptor | ExportedResource | null): MaybePromise<ResourceDescriptor | null> => {
      if (!value || isResourceDescriptor(value))
        return value;
      return ResourceDescriptor.import(value);
    }
  },
  "record": { //NOTE: getType/setType are only queried for records/arrays without children
    getType: "Record<never, unknown> | null",

    encoder: (value: object, member: WHFSTypeMember) => {
      return (async (): EncoderAsyncReturnValue => {
        const toInsert = new Array<EncodedFSSetting>();
        toInsert.push({ ordering: 1, sub: await recurseSetData(member.children!, value) });
        return toInsert;
      })();
    },
    decoder: (settings: FSSettingsRow[], member: WHFSTypeMember, context: DecoderContext) => {
      return settings.length ? recurseGetData(member.children || [], settings[0].id, context) : null;
    }
  },
  "array": {  //NOTE: getType/setType are only queried for records/arrays without children
    getType: "Array<never>",

    encoder: (value: object[], member: WHFSTypeMember) => {
      if (!Array.isArray(value))
        throw new Error(`Incorrect type. Wanted array, got '${typeof value}'`);

      return (async (): EncoderAsyncReturnValue => {
        const toInsert = new Array<EncodedFSSetting>();
        for (const row of value)
          toInsert.push({ ordering: toInsert.length + 1, sub: await recurseSetData(member.children!, row) });
        return toInsert;
      })();
    },
    decoder: (settings: FSSettingsRow[], member: WHFSTypeMember, context: DecoderContext) => {
      return Promise.all(settings.map(s => recurseGetData(member.children || [], s.id, context)));
    },
    isDefaultValue: (value: unknown) => {
      return Array.isArray(value) && value.length === 0;
    }
  },
  "richTextDocument": {
    getType: "RichTextDocument | null",
    setType: "RichTextDocument | RTDBuildSource | null",
    exportType: "ExportableRTD | null",

    encoder: (value: RichTextDocument | null) => {
      if (value && !isRichTextDocument(value))
        throw new Error(`Incorrect type. Wanted a RichTextDocument, got '${getWHType(value) ?? typeof value}'`);
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

      return (async () => {
        const base = await decodeComposedDocument(settings, "platform:richtextdocument", context);
        return buildRTDFromComposedDocument(base);
      })();
    },
    importValue: (value: RTDBuildSource | RichTextDocument | null): MaybePromise<RichTextDocument | null> => {
      if (!value || isRichTextDocument(value))
        return value;
      else
        return buildRTD(value as RTDBuildSource);
    },
    exportValue: (value: RichTextDocument | null, options: ExportOptions) => {
      return value?.export() || null;
    }
  },
  "instance": {
    getType: "WHFSInstance | null",
    setType: "WHFSInstance | WHFSInstanceData | null",

    encoder: (value: WHFSInstance | WHFSInstanceData) => {
      if (!value)
        return null;
      if (!value.whfsType)
        throw new Error(`Missing whfsType in instance`);

      //Return the actual work as a promise - even when ignoring describeWHFSType, any member might be a promise too
      return encodeWHFSInstance(value);
    },
    decoder: (settings: FSSettingsRow[], member: WHFSTypeMember, context: DecoderContext) => {
      if (!settings.length)
        return null;

      return decodeWHFSInstance(settings[0], context);
    }
  },
  "intExtLink": {
    getType: "IntExtLink | null",
    setType: "IntExtLink | ExportedIntExtLink | null",

    encoder: (value: IntExtLink | null) => {
      if (!value)
        return null;

      const data = value.internalLink ? value.append : value.externalLink;
      return { fs_object: value.internalLink || null, setting: data || "" };
    },
    decoder: (settings: FSSettingsRow[], member: WHFSTypeMember, context: DecoderContext) => {
      if (settings[0]?.fs_object)
        return new IntExtLink(settings[0]?.fs_object, { append: settings[0]?.setting || "" });
      if (settings[0]?.setting)
        return new IntExtLink(settings[0]?.setting);
      return null;
    },
    exportValue: (value: IntExtLink | null, options: ExportOptions): MaybePromise<ExportedIntExtLink | null> => {
      return exportIntExtLink(value, options);
    },
    importValue: (value: IntExtLink | null | ExportedIntExtLink): MaybePromise<IntExtLink | null> => {
      return importIntExtLink(value);
    }
  },
  "composedDocument": {
    getType: "ComposedDocument | null",

    encoder: (value: ComposedDocument | null) => {
      if (!value)
        return null;
      if (value.type === "platform:formdefinition")
        return encodeComposedDocument(value, "CD1:publisher:formdefinition"); //HS used 'publisher:' prefix
      if (value.type === "platform:markdown")
        return encodeComposedDocument(value, "CD1:publisher:markdown"); //HS used 'publisher:' prefix
      throw new Error(`Unsupported composed document type '${value.type}'`);
    },
    decoder: (settings: FSSettingsRow[], member: WHFSTypeMember, context: DecoderContext) => {
      if (!settings.length || !settings[0].blobdata)
        return null;

      const type = settings[0].setting === "CD1:publisher:formdefinition" ? "platform:formdefinition"
        : settings[0].setting === "CD1:publisher:markdown" ? "platform:markdown"
          : throwError(`Unsupported composed document type indicator '${settings[0].setting}'`);

      return decodeComposedDocument(settings, type, context);
    }
  }
};

export type EncodedFSSetting = kysely.Updateable<PlatformDB["system.fs_settings"]> & {
  id?: number;
  fs_member?: number;
  sub?: EncodedFSSetting[];
};

/** Recursively set the data
 * @param members - The set of members at his level
 * @param data - Data to apply at this level */
export async function recurseSetData(members: WHFSTypeMember[], data: object): Promise<EncodedFSSetting[]> {
  const toInsert = new Array<EncodedFSSetting>;
  for (const [key, value] of Object.entries(data as object)) {
    if (key === "fsSettingId") //FIXME though only invalid on sublevels, not toplevel!
      continue;

    const matchmember = members.find(_ => _.name === key);
    if (!matchmember)  //TODO orphan check, parent path, DidYouMean
      throw new Error(`Trying to set a value for the non-existing cell '${key}'`);

    try {
      const mynewsettings = new Array<Partial<FSSettingsRow>>;
      const encoder = codecs[matchmember.type];
      if (!codecs[matchmember.type])
        throw new Error(`Unsupported type ${matchmember.type}`);

      const setValue = encoder?.importValue ? await encoder.importValue(value) : value;

      const encodedsettings: EncoderReturnValue = codecs[matchmember.type].encoder(setValue, matchmember);
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

export async function recurseGetData(members: WHFSTypeMember[], elementSettingId: number | null, context: DecoderContext) {
  const retval: { [key: string]: unknown } = {};

  for (const member of members) {
    const settings = context.allsettings.filter(_ => _.fs_member === member.id && _.parent === elementSettingId);
    let setval;

    try {
      if (!codecs[member.type])
        throw new Error(`Unsupported type '${member.type}' for member '${member.name}'`);

      setval = codecs[member.type].decoder(settings, member, context);
      if (isPromise(setval))
        setval = await setval;
      if (context?.export && codecs[member.type].exportValue) {
        setval = codecs[member.type].exportValue!(setval, context);
        if (isPromise(setval))
          setval = await setval;
      }
    } catch (e) {
      if (e instanceof Error)
        e.message += ` (while getting '${member.name}')`;
      throw e;
    }
    retval[member.name] = setval;
  }

  return retval;
}
