import { wildcardsToRegExp } from "@webhare/std/strings";

export function isLike(text: string, mask: string): boolean {
  return new RegExp(`^${wildcardsToRegExp(mask)}$`).test(text);
}

export function isNotLike(text: string, mask: string): boolean {
  return !isLike(text, mask);
}

export function wrdGuidToUUID(guid: string) {
  if (!guid.match(/^wrd:[0-9A-F]{32}$/)) //TODO or should we be case insensitive ?
    throw new Error("Invalid WRD GUID: " + guid);
  const uuid = guid.substring(4).toLowerCase();
  return `${uuid.substring(0, 8)}-${uuid.substring(8, 12)}-${uuid.substring(12, 16)}-${uuid.substring(16, 20)}-${uuid.substring(20)}`;
}
export function UUIDToWrdGuid(uuid: string) {
  if (!uuid.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/))  //TODO or should we be case insensitive ?
    throw new Error("Invalid UUID: " + uuid);
  return `wrd:${uuid.replace(/-/g, "").toUpperCase()}`;
}
