import { Selectable } from "@webhare/whdb";
import type { WebHareDB } from "@mod-system/js/internal/generated/whdb/webhare";
import { Money } from "@webhare/std";
import { dateToParts, encodeHSON, decodeHSON, makeDateFromParts } from "@webhare/hscompat";
import { IPCMarshallableData } from "@mod-system/js/internal/whmanager/hsmarshalling";

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
  | "record" //21
  | "formCondition"; //22

type FSSettingsRow = Selectable<WebHareDB, "system.fs_settings">;

interface TypeCodec {
  encoder(value: unknown): Partial<FSSettingsRow> | Array<Partial<FSSettingsRow>> | null;
  decoder(settings: FSSettingsRow[]): unknown;
}

function assertValidString(value: unknown) {
  if (typeof value !== "string")
    throw new Error(`Incorrect type. Wanted string, got '${typeof value}'`);
  if (value.length >= 4096) //TODO byte length not UTF16 length for HS compatibility
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
      return dt && dt.length == 2 ? makeDateFromParts(parseInt(dt[0]), parseInt(dt[1])) : null;
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
  "record": {
    //FIXME Overlong record support (TODO record automatically triggers blob download and parsing, so any future "JSON" type should be smarter than that)
    encoder: (value: unknown) => {
      if (typeof value !== "object") //NOTE 'null' is an object too and acceptable here
        throw new Error(`Incorrect type. Wanted an object`);
      if (!value) //null!
        return null; //nothing to store

      if (Object.getPrototypeOf(value).constructor.name !== "Object")
        throw new Error(`Incorrect type. Wanted a plain object but got a '${Object.getPrototypeOf(value).constructor.name}'`);

      const ashson = encodeHSON(value as IPCMarshallableData);
      if (ashson.length > 4096)
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

      return value.length ? value.map(v => ({ setting: assertValidString(v) })) : null;
    },
    decoder: (settings: FSSettingsRow[]) => {
      return settings.map(s => s.setting);
    }
  },
  "money": {
    encoder: (value: unknown) => {
      if (typeof value == "number")
        return value ? { setting: String(value) } : null;
      if (Money.isMoney(value))
        return Money.cmp(value, "0") ? { setting: value.toString() } : null;
      throw new Error(`Incorrect type. Wanted number or Money, got '${typeof value}'`);
    },
    decoder: (settings: FSSettingsRow[]) => {
      return new Money(settings[0]?.setting || "0");
    }
  }
};
