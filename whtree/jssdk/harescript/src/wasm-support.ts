import { toFSPath } from "@webhare/services/src/resources.ts";

export const HSVMSymbol = Symbol("HSVM");

export function mapHareScriptPath(uri: string | null) {
  if (!uri)
    return "unknown";

  //Legacy HareScript namespaces we may not want to retain in JS
  if (uri.startsWith("direct::"))
    return uri.substring(8);

  if (uri.startsWith("wh::"))
    return toFSPath("mod::system/whlibs/" + uri.substring(4));

  return toFSPath(uri, { keepUnmatched: true });
}
