import { WebHareBlob } from "@webhare/services/src/webhareblob";
import { DataTypeOids, type Codec } from "@webhare/postgrease";
import { uploadedblobs } from "./blobbase";
import { pgTypeOid_int8, pgTypeOid_text } from "./oids";
import { createPGBlobByBlobRec } from "./blobs";
import { isDate } from "@webhare/std/src/quacks";
import { defaultDateTime, maxDateTime } from "@webhare/hscompat";
import { buildArrayCodec } from "@webhare/postgrease/src/codec-support";
import { Money } from "@webhare/std";


const timeShiftMs = 946_684_800_000n;
const minInt64 = -9223372036854775808n;
const maxInt64 = 9223372036854775807n;

export const DataTypeWHTimeStamp: Codec<Date, Date> = {
  name: "timestamp",
  oid: DataTypeOids.timestamp,
  encodeBinary: (builder, v: Date | number) => {
    if (!(v instanceof Date) && typeof v !== "number")
      throw new Error(`Invalid timestamp value ${v}`);

    builder.alloc(8);
    if (v === Infinity || v === maxDateTime) {
      builder.idx = builder.buffer.writeInt32BE(0x7fffffff, builder.idx); // hi
      builder.idx = builder.buffer.writeUInt32BE(0xffffffff, builder.idx);
      return;
    }
    if (v === -Infinity || v === defaultDateTime) {
      builder.idx = builder.buffer.writeInt32BE(-0x80000000, builder.idx); // hi
      builder.idx = builder.buffer.writeUInt32BE(0x00000000, builder.idx);
      return;
    }
    if (!(v instanceof Date)) v = new Date(v);
    let n = BigInt(v.getTime());
    n = (n - timeShiftMs) * 1000n;
    builder.idx = builder.buffer.writeBigInt64BE(n, builder.idx);
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    const microSeconds = dataview.getBigInt64(offset);
    if (microSeconds === maxInt64) return maxDateTime;
    if (microSeconds === minInt64) return defaultDateTime;
    return new Date(Number((microSeconds / 1000n) + timeShiftMs));
  },
  test: { type: "object", priority: 0, test: (value: object) => isDate(value) },
};

export const DataTypeWHTimeStampArray = buildArrayCodec(DataTypeWHTimeStamp, DataTypeOids._timestamp, "_timestamp");

export const BlobType: Codec<WebHareBlob, WebHareBlob> = {
  name: "webhare_internal.webhare_blob",
  oid: 0, // we'll lookup after connecting
  encodeBinary: (builder, value) => {
    // 0-length blobs are stored as nulls
    if (!value.size)
      return null;

    const databaseid = uploadedblobs.get(value);
    if (!databaseid) {
      console.log({ value });
      throw new Error(`Attempting to insert a blob without uploading it first`);
    }
    const databaseIdLen = Buffer.byteLength(databaseid, 'utf8');
    builder.alloc(28 + databaseIdLen);
    builder.idx = builder.buffer.writeUInt32BE(2, builder.idx);// 2 columns
    builder.idx = builder.buffer.writeUInt32BE(pgTypeOid_text, builder.idx);
    builder.idx = builder.buffer.writeUInt32BE(databaseIdLen, builder.idx);
    builder.idx += builder.buffer.utf8Write(databaseid, builder.idx);
    builder.idx = builder.buffer.writeUInt32BE(pgTypeOid_int8, builder.idx);
    builder.idx = builder.buffer.writeUInt32BE(8, builder.idx); // col 2, 8 bytes length
    builder.idx = builder.buffer.writeBigInt64BE(BigInt(value.size), builder.idx);
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    if (len < 28)
      throw new Error(`WHDBBlob binary data too short: ${len} bytes`);
    if (dataview.getUint32(offset) !== 2)
      throw new Error(`Expected 2 columns in WHDBBlob, got ${dataview.getUint32(offset)}`);
    if (dataview.getUint32(offset + 4) !== pgTypeOid_text)
      throw new Error(`Expected OID.TEXT in WHDBBlob, got ${dataview.getUint32(offset + 4)}`);
    const databaseIdLen = dataview.getUint32(offset + 8);
    if (len < 28 + databaseIdLen)
      throw new Error(`WHDBBlob binary data too short for blobid: ${len} bytes`);
    const databaseId = buffer.utf8Slice(offset + 12, offset + 12 + databaseIdLen);
    if (dataview.getUint32(offset + 12 + databaseIdLen) !== pgTypeOid_int8)
      throw new Error(`Expected OID.INT8 in WHDBBlob, got ${dataview.getUint32(offset + 12 + databaseIdLen)}`);
    if (dataview.getUint32(offset + 16 + databaseIdLen) !== 8)
      throw new Error(`Expected 8 bytes in WHDBBlob, got ${dataview.getUint32(offset + 16 + databaseIdLen)}`);
    const size = dataview.getBigUint64(offset + 20 + databaseIdLen);
    return createPGBlobByBlobRec(databaseId, Number(size));
  },
  test: { type: "object", priority: 0, test: WebHareBlob.isWebHareBlob },
};

const NUMERIC_NEG = 0x4000;
const NUMERIC_NAN = 0xc000;
// const DEC_DIGITS = 4;
// const ROUND_POWERS = [0, 1000, 100, 10];

export const MoneyType: Codec<Money, Money> = {
  name: "numeric",
  oid: DataTypeOids.numeric,

  encodeBinary: (builder, v: Money) => {
    let str = v.toString();
    // Is the value negative? THen remove the leading '-'
    const negative = str.startsWith('-');
    if (negative)
      str = str.slice(1);

    // Find decimal point position and remove it when present
    let dpos = str.indexOf('.');
    if (dpos === -1)
      dpos = str.length;
    else
      str = str.replace('.', '');

    // Make sure the number of digits before and after the decimal point is a multiple of 4 by adding leading or trailing zeros
    const addStart = (4 - (dpos & 3)) & 3;
    dpos += addStart;
    str = '0'.repeat(addStart) + str;
    // scale is the number of digits after the decimal point
    const scale = Math.max(0, str.length - dpos);
    const addEnd = (4 - ((str.length - dpos) & 3)) & 3;
    str += '0'.repeat(addEnd);

    // Remove leading zeros. Money won't output trailing zeros
    while (str.startsWith('0000')) {
      dpos -= 4;
      str = str.slice(4);
    }

    const digitCount = str.length / 4;
    const weight = str.length ? (dpos / 4) - 1 : 0; // use weight 0 when no digits present
    const sign = negative ? NUMERIC_NEG : 0;

    builder.alloc(8 + (str.length / 4) * 2);
    builder.idx = builder.buffer.writeInt16BE(digitCount, builder.idx);
    builder.idx = builder.buffer.writeInt16BE(weight, builder.idx);
    builder.idx = builder.buffer.writeInt16BE(sign, builder.idx);
    builder.idx = builder.buffer.writeInt16BE(scale, builder.idx);

    for (let i = 0; i < str.length; i += 4) {
      const digit = parseInt(str.slice(i, i + 4), 10);
      builder.idx = builder.buffer.writeInt16BE(digit, builder.idx);
    }
  },
  decodeBinary: (buffer, dataview, offset, len) => {
    const digitCount = dataview.getInt16(offset);
    const weight = dataview.getInt16(offset + 2);
    const sign = dataview.getInt16(offset + 4);
    const scale = dataview.getInt16(offset + 6);

    if (sign === NUMERIC_NAN)
      throw new Error(`Unparseable Money value in database: ${JSON.stringify({ len, weight, sign, scale })}`);

    let digits = "";
    for (let i = 0; i < digitCount; i++) {
      digits += dataview.getInt16(offset + 8 + i * 2).toString().padStart(4, '0');
    }

    const dpospoint = (weight + 1) * 4;
    if (dpospoint > 0) {
      if (dpospoint >= digits.length)
        digits = digits.padEnd(dpospoint, '0');
      else
        digits = digits.slice(0, dpospoint) + '.' + digits.slice(dpospoint);
    } else if (dpospoint <= 0)
      digits = '0.' + '0'.repeat(-dpospoint) + digits;

    if (sign & NUMERIC_NEG)
      digits = '-' + digits;

    // Money constructor will take care of leading and trailing zeros
    return new Money(digits);
  },
  test: { type: "object", priority: 0, test: (value: object) => Money.isMoney(value) },
};

export const MoneyTypeArray = buildArrayCodec(MoneyType, DataTypeOids._numeric, "_numeric");
