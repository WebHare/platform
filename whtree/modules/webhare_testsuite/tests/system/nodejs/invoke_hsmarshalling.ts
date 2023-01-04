import { writeMarshalData, readMarshalData, readMarshalPacket, writeMarshalPacket, encodeHSON, decodeHSON } from "@mod-system/js/internal/whmanager/hsmarshalling";


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
