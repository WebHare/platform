import { writeMarshalData, readMarshalData, readMarshalPacket, writeMarshalPacket, encodeHSON } from "@mod-system/js/internal/whmanager/hsmarshalling";


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
