import { isValidUUID } from "@webhare/std";
import { regExpFromWildcards } from "@webhare/std/src/strings";

export function isLike(text: string, mask: string): boolean {
  return regExpFromWildcards(mask).test(text);
}

export function isNotLike(text: string, mask: string): boolean {
  return !isLike(text, mask);
}

export function isValidWRDGuid(guid: string) {
  return guid.match(/^wrd:[0-9A-F]{32}$/);
}

export function wrdGuidToUUID(guid: string) {
  if (!isValidWRDGuid(guid))
    throw new Error("Invalid WRD GUID: " + guid);
  const uuid = guid.substring(4).toLowerCase();
  return `${uuid.substring(0, 8)}-${uuid.substring(8, 12)}-${uuid.substring(12, 16)}-${uuid.substring(16, 20)}-${uuid.substring(20)}`;
}
export function UUIDToWrdGuid(uuid: string) {
  if (!isValidUUID(uuid))
    throw new Error("Invalid UUID: " + uuid);
  return `wrd:${uuid.replace(/-/g, "").toUpperCase()}`;
}
