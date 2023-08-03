import { Money } from '@webhare/std';
import { DataType, DataTypeOIDs, SmartBuffer } from './../vendor/postgresql-client/src/index';
import { numberBytesToString } from './../vendor/postgresql-client/src/data-types/numeric-type';
import { BoxedFloat } from '@mod-system/js/internal/whmanager/hsmarshalling';

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

export const Float8Type: DataType = {
  name: "float8",
  oid: DataTypeOIDs.float8,
  jsType: "number",

  parseBinary(v: Buffer): number {
    return v.readDoubleBE(0);
  },

  encodeBinary(buf: SmartBuffer, v: BoxedFloat | number | string): void {
    buf.writeDoubleBE(v instanceof BoxedFloat ? v.value : typeof v === "number" ? v : parseFloat(v));
  },

  parseText: parseFloat,

  isType(v: unknown): boolean {
    return typeof v === "number" || v instanceof BoxedFloat;
  },
};

export const ArrayFloat8Type: DataType = {
  ...Float8Type,
  name: "_float8",
  oid: DataTypeOIDs._float8,
  elementsOID: DataTypeOIDs.float8,
};
