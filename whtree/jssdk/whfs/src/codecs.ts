import type * as kysely from "kysely";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { uploadBlob } from "@webhare/whdb";
import { appendToArray, isPromise, Money, omit } from "@webhare/std";
import { encodeHSON, decodeHSON } from "@webhare/hscompat/hson.ts";
import { dateToParts, makeDateFromParts, } from "@webhare/hscompat/datetime.ts";
import { exportAsHareScriptRTD, type HareScriptRTD, buildRTDFromHareScriptRTD } from "@webhare/hscompat/richdocument.ts";
import type { IPCMarshallableData } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { ResourceDescriptor, addMissingScanData, decodeScanData } from "@webhare/services/src/descriptor";
import type { RichTextDocument } from "@webhare/services";
import type { WHFSInstance, WHFSTypeMember } from "./contenttypes";
import type { FSSettingsRow } from "./describe";
import { describeWHFSType } from "./describe";
import { getWHType } from "@webhare/std/quacks";

export type MemberType = "string" // 2
  | "dateTime" //4
  | "file" //5
  | "boolean" //6
  | "integer" //7
  | "float" // 8
  | "money" //9
  | "whfsRef" //11
  | "array" //12
  | "whfsRefArray" //13
  | "stringArray" //14
  | "richDocument" //15
  | "intExtLink" //16
  | "instance" //18
  | "url" //19
  | "composedDocument" //20
  | "hson" //21 (record in HareScript)
  | "formCondition" //22
  | "record" //23 (typedrecord in HareScript)
  | "image" //24
  | "date" //25
  ;

export type EncoderBaseReturnValue = EncodedFSSetting | EncodedFSSetting[] | null;
export type EncoderAsyncReturnValue = Promise<EncoderBaseReturnValue>;
export type EncoderReturnValue = EncoderBaseReturnValue | EncoderAsyncReturnValue;

interface TypeCodec {
  encoder(value: unknown, member: WHFSTypeMember): EncoderReturnValue;
  decoder(settings: readonly FSSettingsRow[], cc: number, member: WHFSTypeMember, allsettings: readonly FSSettingsRow[]): unknown;
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

export const codecs: { [key: string]: TypeCodec } = {
  "boolean": {
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
    encoder: (value: unknown) => {
      if (typeof value !== "number")
        throw new Error(`Incorrect type. Wanted number, got '${typeof value}'`);

      return value ? { fs_object: value } : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      return settings[0]?.fs_object || null;
    }
  },
  "whfsRefArray": {
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
    }
  },
  "date": {
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
  "dateTime": {
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
    encoder: (value: unknown) => {
      const strvalue = assertValidString(value);
      return strvalue ? { setting: strvalue } : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      return settings[0]?.setting || "";
    }
  },
  "url": { //TODO identical to "string" at this moment, but we're not handling linkchecking yet
    encoder: (value: unknown) => {
      const strvalue = assertValidString(value);
      return strvalue ? { setting: strvalue } : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      return settings[0]?.setting || "";
    }
  },
  "hson": {
    //FIXME Overlong record support (TODO record automatically triggers blob download and parsing, so any future "JSON" type should be smarter than that)
    /*
              IF (NOT CanCastTypeTo(TYPEID(newval), TYPEID(RECORD)))
                THROW NEW WHFSException("OTHER","Incorrect type for field '" || memberrec.name || "' in type " || this->namespace ||
                    ", got type '" || GetTypeName(TYPEID(newval)) || "', but wanted 'RECORD'");

              IF (NOT RecordExists(newval))
              {
                killsettings := killsettings CONCAT current_member_settings;
              }
              ELSE
              {
                STRING data := EncodeHSON(newval);
                RECORD newset;

                IF (Length(data) <= 4096)
                  newset := [ setting := data, blobdata := DEFAULT BLOB ];
                ELSE
                  newset := [ setting := "", blobdata := StringToBlob(data) ];

                IF (Length(current_member_settings) = 1)
                {
                  UPDATE system.fs_settings SET setting := newset.setting, blobdata := newset.blobdata WHERE id = current_member_settings[0].id;
                }
                ELSE
                {
                  killsettings := killsettings CONCAT current_member_settings;

                  INTEGER newid := MakeAutoNumber(system.fs_settings, "id");
                  INSERT INTO system.fs_settings(id, fs_instance, fs_member, setting, blobdata, parent)
                         VALUES(newid, instanceid, memberrec.id, newset.setting, newset.blobdata, cursetting);
                }

                */
    encoder: (value: unknown) => {
      if (typeof value !== "object") //NOTE 'null' is an object too and acceptable here
        throw new Error(`Incorrect type. Wanted an object`);
      if (!value) //null!
        return null; //nothing to store

      if (Object.getPrototypeOf(value).constructor.name !== "Object")
        throw new Error(`Incorrect type. Wanted a plain object but got a '${Object.getPrototypeOf(value).constructor.name}'`);

      const ashson = encodeHSON(value as IPCMarshallableData);
      if (Buffer.byteLength(ashson) > 4096)
        throw new Error(`Overlong records not yet implemtened (${ashson.length})`);

      return { setting: ashson };
    },
    decoder: (settings: FSSettingsRow[]) => {
      if (!settings.length)
        return null;

      return decodeHSON(settings[0].setting);
    }
  },
  "stringArray": {
    encoder: (value: unknown) => {
      if (!Array.isArray(value))
        throw new Error(`Incorrect type. Wanted string array, got '${typeof value}'`);

      return value.length ? value.map((v, idx) => ({ setting: assertValidString(v), ordering: ++idx })) : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      return settings.map(s => s.setting);
    }
  },
  "money": {
    encoder: (value: unknown) => {
      if (typeof value === "number")
        return value ? { setting: String(value) } : null;
      if (Money.isMoney(value))
        return Money.cmp(value, "0") ? { setting: value.toString() } : null;
      throw new Error(`Incorrect type. Wanted number or Money, got '${typeof value}'`);
    },
    decoder: (settings: FSSettingsRow[]) => {
      return new Money(settings[0]?.setting || "0");
    }
  },
  "file": {
    encoder: (value: unknown) => {
      if (typeof value !== "object") //TODO test for an actual ResourceDescriptor
        throw new Error(`Incorrect type. Wanted a ResourceDescriptor, got '${typeof value}'`);
      if (!value)
        return null;

      //Return the actual work as a promise, so we can wait for uploadBlob
      return (async (): EncoderAsyncReturnValue => {
        const v = value as ResourceDescriptor;
        if (v.resource.size)
          await uploadBlob(v.resource);

        return {
          setting: await addMissingScanData(v),
          fs_object: v.sourceFile,
          blobdata: v.resource
        };
      })();
    },
    decoder: (settings: FSSettingsRow[], cc: number) => {
      if (!settings.length)
        return null;

      const meta = {
        ...decodeScanData(settings[0].setting),
        dbLoc: { source: 2, id: settings[0].id, cc }
      };
      return new ResourceDescriptor(settings[0].blobdata, meta);
    }
  },
  "record": {
    encoder: (value: object, member: WHFSTypeMember) => {
      return (async (): EncoderAsyncReturnValue => {
        const toInsert = new Array<EncodedFSSetting>();
        toInsert.push({ ordering: 1, sub: await recurseSetData(member.children!, value) });
        return toInsert;
      })();
    },
    decoder: (settings: FSSettingsRow[], cc: number, member: WHFSTypeMember, allsettings: readonly FSSettingsRow[]) => {
      return settings.length ? recurseGetData(allsettings, member.children || [], settings[0].id, cc) : null;
    }
  },
  "array": {
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
    decoder: (settings: FSSettingsRow[], cc: number, member: WHFSTypeMember, allsettings: readonly FSSettingsRow[]) => {
      return Promise.all(settings.map(s => recurseGetData(allsettings, member.children || [], s.id, cc)));
    }
  },
  "richDocument": {
    encoder: (value: RichTextDocument | null) => {
      if (value && getWHType(value) !== "RichTextDocument")
        throw new Error(`Incorrect type. Wanted a RichTextDocument, got '${getWHType(value) ?? typeof value}'`);
      if (!value || value.isEmpty())
        return null;

      //Return the actual work as a promise, so we can wait for uploadBlob
      return (async (): EncoderAsyncReturnValue => {
        const toSerialize = await exportAsHareScriptRTD(value);
        const versionindicator = "RD1"; // isrtd ? "RD1" : "CD1:" || value.type;
        const storetext = toSerialize.htmltext; // isrtd ? newval.htmltext : newval.text;

        const settings: EncodedFSSetting[] = [];
        settings.push({
          setting: versionindicator,
          ordering: 0,
          blobdata: await uploadBlob(storetext),
        });

        for (const instance of toSerialize.instances) {
          /* Generate settings for the instance:
            - It needs a toplevel setting with:
                - ordering = 3
                - instancetype pointing to the actual WHFS Type Id
                - setting will contain the instanceid
            - Then we write the actual data as a settings (instancetype->__RecurseSetInstanceData(instanceid, 0, elementid ?? newelementid, newval, cursettings, remapper, orphansvisible))
              - parent = the toplevel setting id we just generated
            */
          const typeinfo = await describeWHFSType(instance.data.whfstype);

          settings.push({
            instancetype: typeinfo.id,
            setting: instance.instanceid,
            ordering: 3,
            sub: await recurseSetData(typeinfo.members, omit(instance.data, ["whfstype"]))
          });
        }
        return settings;
      })();
    },
    decoder: (settings: FSSettingsRow[], cc: number, member: WHFSTypeMember, allsettings: readonly FSSettingsRow[]) => {
      if (!settings.length || !settings[0].blobdata)
        return null;

      return (async () => {
        const instances: HareScriptRTD["instances"] = [];
        for (const settingInstance of settings.filter(s => s.ordering === 3)) {
          const typeinfo = await describeWHFSType(settingInstance.instancetype!);
          const widgetdata = await recurseGetData(allsettings, typeinfo.members, settingInstance.id, cc);

          instances.push({
            instanceid: settingInstance.setting,
            data: { whfstype: typeinfo.namespace, ...widgetdata }
          });
        }

        return buildRTDFromHareScriptRTD({ htmltext: settings[0].blobdata!, instances, embedded: [], links: [] });
      })();
    }
  },
  "instance": {
    encoder: (value: WHFSInstance) => {
      if (!value)
        return null;
      if (!value.whfsType)
        throw new Error(`Missing whfsType in instance`);

      //Return the actual work as a promise - even when ignoring describeWHFSType, any member might be a promise too
      return (async (): EncoderAsyncReturnValue => {
        const typeinfo = await describeWHFSType(value.whfsType);
        return {
          instancetype: typeinfo.id,
          sub: await recurseSetData(typeinfo.members, omit(value, ["whfsType"]))
        };
      })();
    },
    decoder: (settings: FSSettingsRow[], cc: number, member: WHFSTypeMember, allsettings: readonly FSSettingsRow[]) => {
      if (!settings.length)
        return null;

      return (async () => {
        const typeinfo = await describeWHFSType(settings[0].instancetype!);
        const widgetdata = await recurseGetData(allsettings, typeinfo.members, settings[0].id, cc);

        return { whfsType: typeinfo.namespace, ...widgetdata };
      })();
    }
  },
  "intExtLink": {
    encoder: (value: object) => {
      throw new Error(`intExtLink type not yet implemented`);
    },
    decoder: (settings: FSSettingsRow[], cc: number, member: WHFSTypeMember, allsettings: readonly FSSettingsRow[]) => {
      return null;
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
      if (!codecs[matchmember.type])
        throw new Error(`Unsupported type ${matchmember.type}`);

      const encodedsettings: EncoderReturnValue = codecs[matchmember.type].encoder(value, matchmember);
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

export async function recurseGetData(cursettings: readonly FSSettingsRow[], members: WHFSTypeMember[], elementSettingId: number | null, cc: number) {
  const retval: { [key: string]: unknown } = {};

  for (const member of members) {
    const settings = cursettings.filter(_ => _.fs_member === member.id && _.parent === elementSettingId);
    let setval;

    try {
      if (!codecs[member.type])
        throw new Error(`Unsupported type '${member.type}' for member '${member.name}'`);

      setval = codecs[member.type].decoder(settings, cc, member, cursettings);
      if (isPromise(setval))
        setval = await setval;
    } catch (e) {
      if (e instanceof Error)
        e.message += ` (while getting '${member.name}')`;
      throw e;
    }
    retval[member.name] = setval;
  }

  return retval;
}
