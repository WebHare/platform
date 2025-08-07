import { Money } from '@webhare/std';
import { type DataMappingOptions, type DataType, DataTypeOIDs, type SmartBuffer, parseDateTime } from './../vendor/postgrejs/src/index';
import { numberBytesToString } from './../vendor/postgrejs/src/data-types/numeric-type';
import { defaultDateTime, maxDateTime } from '@webhare/hscompat/datetime';

// const NUMERIC_NEG = 0x4000;
const NUMERIC_NAN = 0xc000;
// const DEC_DIGITS = 4;
// const ROUND_POWERS = [0, 1000, 100, 10];

export const MoneyType: DataType = {
  name: "numeric",
  oid: DataTypeOIDs.numeric,
  jsType: "number",

  parseBinary(v: Buffer): Money {
    const len = v.readInt16BE();
    const weight = v.readInt16BE(2);
    const sign = v.readInt16BE(4);
    const scale = v.readInt16BE(6);

    if (sign === NUMERIC_NAN)
      throw new Error(`Unparseable Money value in database: ${JSON.stringify({ len, weight, sign, scale })}`);

    const digits: number[] = [];
    for (let i = 0; i < len; i++) {
      digits[i] = v.readInt16BE(8 + i * 2);
    }

    const numString = numberBytesToString(digits, scale, weight, sign);
    return new Money(numString);
  },

  encodeText(v: Money): string {
    return v.value;
  },

  parseText(v: unknown): Money | null {
    if (typeof v === "string")
      return new Money(v);
    throw new Error(`Unparseable Money value in database: '${String(v)}'`);
  },

  isType(v: unknown): boolean {
    return Money.isMoney(v);
  },
};

export const ArrayMoneyType: DataType = {
  ...MoneyType,
  name: "_numeric",
  oid: DataTypeOIDs._numeric,
  elementsOID: DataTypeOIDs.numeric,
};

export const Float8Type: DataType = {
  name: "float8",
  oid: DataTypeOIDs.float8,
  jsType: "number",

  parseBinary(v: Buffer): number {
    return v.readDoubleBE(0);
  },

  encodeBinary(buf: SmartBuffer, v: number | string): void {
    buf.writeDoubleBE(typeof v === "number" ? v : parseFloat(v));
  },

  parseText: parseFloat,

  isType(v: unknown): boolean {
    return typeof v === "number";
  },
};

export const ArrayFloat8Type: DataType = {
  ...Float8Type,
  name: "_float8",
  oid: DataTypeOIDs._float8,
  elementsOID: DataTypeOIDs.float8,
};

export interface Tid {
  block: number;
  offset: number;
}

const TID_PATTERN = /^\((\d+),(\d+)\)$/;

export const TidType: DataType = {
  name: "tid",
  oid: DataTypeOIDs.tid,
  jsType: "object",

  parseBinary(v: Buffer): Tid {
    return {
      block: v.readUint32BE(0),
      offset: v.readUint16BE(4),
    };
  },

  encodeBinary(buf: SmartBuffer, v: Tid): void {
    buf.writeUInt32BE(v.block);
    buf.writeUInt16BE(v.offset);
  },

  parseText(v: string): Tid | undefined {
    const m = v.match(TID_PATTERN);
    if (!m) return undefined;
    return {
      block: parseInt(m[1]),
      offset: parseInt(m[2]),
    };
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isType(v: any): boolean {
    return (
      v &&
      typeof v === "object" &&
      Object.keys(v).length === 2 &&
      typeof v.block === "number" &&
      typeof v.offset === "number"
    );
  },
};

export const ArrayTidType: DataType = {
  ...TidType,
  name: "_tid",
  oid: DataTypeOIDs._tid,
  elementsOID: DataTypeOIDs.tid,
};


//We patch the TimestampType to map -Inf and +Inf to defaultDateTime and maxDateTime
//TODO Only do this for existing and marked datefields, allow more native semantics for future JS-only used datetime fields  (and probably use the proper TIMESTAMP type)

const timeShift = 946684800000;
const timeMul = 4294967296;

export const WHTimestampType: DataType = {
  name: "timestamp",
  oid: DataTypeOIDs.timestamp,
  jsType: "Date",

  parseBinary(v: Buffer, options: DataMappingOptions): Date | number | string {
    const fetchAsString = options.fetchAsString && options.fetchAsString.includes(DataTypeOIDs.timestamp);
    const hi = v.readInt32BE();
    const lo = v.readUInt32BE(4);
    if (lo === 0xffffffff && hi === 0x7fffffff) return fetchAsString ? "infinity" : maxDateTime;
    if (lo === 0x00000000 && hi === -0x80000000) return fetchAsString ? "-infinity" : defaultDateTime;

    // Shift from 2000 to 1970
    let d = new Date((lo + hi * timeMul) / 1000 + timeShift);
    if (fetchAsString || !options.utcDates)
      d = new Date(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        d.getUTCHours(),
        d.getUTCMinutes(),
        d.getUTCSeconds(),
        d.getUTCMilliseconds()
      );
    return fetchAsString ? dateToTimestampString(d) : d;
  },

  encodeBinary(buf: SmartBuffer, v: Date | number | string, options: DataMappingOptions): void {
    if (typeof v === "string") v = parseDateTime(v, true, false, options.utcDates);
    if (v === Infinity || v === maxDateTime) {
      buf.writeInt32BE(0x7fffffff); // hi
      buf.writeUInt32BE(0xffffffff); // lo
      return;
    }
    if (v === -Infinity || v === defaultDateTime) {
      buf.writeInt32BE(-0x80000000); // hi
      buf.writeUInt32BE(0x00000000); // lo
      return;
    }
    if (!(v instanceof Date)) v = new Date(v);
    // Postgresql ignores timezone data so we are
    let n = options.utcDates ? v.getTime() : v.getTime() - v.getTimezoneOffset() * 60 * 1000;
    n = (n - timeShift) * 1000;
    const hi = Math.floor(n / timeMul);
    const lo = n - hi * timeMul;
    buf.writeInt32BE(hi);
    buf.writeUInt32BE(lo);
  },

  parseText(v: string, options: DataMappingOptions): Date | number | string {
    if (options.fetchAsString && options.fetchAsString.includes(DataTypeOIDs.timestamp)) return v;
    return parseDateTime(v, true, false, options.utcDates);
  },

  isType(v: unknown): boolean {
    return v instanceof Date;
  }
};

function padZero(v: number): string {
  return v < 9 ? "0" + v : String(v);
}

function dateToTimestampString(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    padZero(d.getMonth() + 1) +
    "-" +
    padZero(d.getDate()) +
    " " +
    padZero(d.getHours()) +
    ":" +
    padZero(d.getMinutes()) +
    ":" +
    padZero(d.getSeconds())
  );
}

export const ArrayWHTimestampType: DataType = {
  ...WHTimestampType,
  name: "_timestamp",
  oid: DataTypeOIDs._timestamp,
  elementsOID: DataTypeOIDs.timestamp,
};
