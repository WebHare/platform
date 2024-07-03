import { writeMarshalData, readMarshalData, readMarshalPacket, writeMarshalPacket } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { encodeHSON, decodeHSON } from "@webhare/hscompat";
import { Money } from "@webhare/std";


export function decodeEncode(data: string) {
  const buf = Buffer.from(data, 'hex');

  const result = writeMarshalData(readMarshalData(buf));
  return result.toString("hex");
}

export function decodeEncodePacket(data: string) {
  const buf = Buffer.from(data, 'hex');

  const result = writeMarshalPacket(readMarshalPacket(buf));
  return result.toString("hex");
}

export function decodePacketEncodeHSON(data: string) {
  const buf = Buffer.from(data, 'hex');

  return encodeHSON(readMarshalPacket(buf));
}

export function decodeHSONEncodeHSON(data: string) {
  const decoded = decodeHSON(data);
  const encoded = encodeHSON(decoded);
  return encoded;
}

export function arrayEncodeTest() {
  const toEncode = {
    ia: [1, 2],
    i64a: [BigInt(1), BigInt(3)],
    fa: [1.25, 2.5],
    ma: [new Money("1"), new Money("2")],
    fa1: [1.25, 2],
    fa2: [2, new Money("1.0625"), 2.5],
    ma1: [new Money("1.00001"), 2],
    ma2: [2, new Money("1")],
    i64a1: [1, BigInt(3)],
    via: [[1, 2]]
  };
  return { marshal: writeMarshalData(toEncode).toString("hex"), hson: encodeHSON(toEncode) };
}

export function reusingStructureTest() {
  const reused = { line: 1, col: 0 };
  const toEncode = { a: reused, b: reused };
  return { marshal: writeMarshalPacket(toEncode).toString("hex"), hson: encodeHSON(toEncode) };
}

export function cycleStructureTest() {
  const toEncode = { a: {} };
  toEncode.a = toEncode;
  return { marshal: writeMarshalPacket(toEncode).toString("hex"), hson: encodeHSON(toEncode) };
}
