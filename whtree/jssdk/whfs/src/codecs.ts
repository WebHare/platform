import { Selectable, uploadBlob } from "@webhare/whdb";
import type { PlatformDB } from "@mod-system/js/internal/generated/whdb/platform";
import { Money } from "@webhare/std";
import { dateToParts, encodeHSON, decodeHSON, makeDateFromParts } from "@webhare/hscompat";
import { IPCMarshallableData } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { ResourceDescriptor, addMissingScanData, decodeScanData } from "@webhare/services/src/descriptor";
import { RichDocument, WebHareBlob } from "@webhare/services";
import { __RichDocumentInternal } from "@webhare/services/src/richdocument";

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

type FSSettingsRow = Selectable<PlatformDB, "system.fs_settings">;

export type EncoderBaseReturnValue = Partial<FSSettingsRow> | Array<Partial<FSSettingsRow>> | null;
export type EncoderAsyncReturnValue = Promise<EncoderBaseReturnValue>;
export type EncoderReturnValue = EncoderBaseReturnValue | EncoderAsyncReturnValue;

interface TypeCodec {
  encoder(value: unknown): EncoderReturnValue;
  decoder(settings: FSSettingsRow[], cc: number): unknown;
}

function assertValidString(value: unknown) {
  if (typeof value !== "string")
    throw new Error(`Incorrect type. Wanted string, got '${typeof value}'`);
  if (Buffer.byteLength(value) >= 4096)
    throw new Error(`String too long (${value.length})`);
  return value;
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
      if (!(value instanceof Date))
        throw new Error(`Incorrect type. Wanted a Date, got '${typeof value}'`);

      //return Date as YYYY-MM-DD
      const yyyy_mm_dd = `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
      return { setting: yyyy_mm_dd };
    },
    decoder: (settings: FSSettingsRow[]) => {
      return settings[0]?.setting ? new Date(settings[0].setting) : null;
    }
  },
  "dateTime": {
    encoder: (value: unknown) => {
      if (value === null) //we accept nulls in datetime fields
        return null;
      if (!(value instanceof Date))
        throw new Error(`Incorrect type. Wanted a Date, got '${typeof value}'`);

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
  "richDocument": {
    encoder: (value: RichDocument | null) => {
      if (typeof value !== "object") //TODO test for an actual RichDocument
        throw new Error(`Incorrect type. Wanted a RichDocument, got '${typeof value}'`);
      if (!value)
        return null;

      //Return the actual work as a promise, so we can wait for uploadBlob
      return (async (): EncoderAsyncReturnValue => {
        const v = value as RichDocument;
        const settings: Array<Partial<FSSettingsRow>> = [];
        const text = WebHareBlob.from(await v.__getRawHTML());
        await uploadBlob(text);

        settings.push({
          setting: "RD1",
          ordering: 0,
          blobdata: text,
        });

        return settings;
      })();
    },
    decoder: (settings: FSSettingsRow[]) => {
      if (!settings.length || !settings[0].blobdata)
        return null;

      return new __RichDocumentInternal(settings[0].blobdata);
    }
  }
};
