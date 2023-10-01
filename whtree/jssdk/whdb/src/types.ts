import { Money } from '@webhare/std';
import { DataType, DataTypeOIDs, SmartBuffer } from './../vendor/postgresql-client/src/index';
import { numberBytesToString } from './../vendor/postgresql-client/src/data-types/numeric-type';

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
