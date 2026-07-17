import type { LinkResolverContext, LinkResolverFunction } from "@webhare/router";
import type { IntExtLink } from "@webhare/services/src/intextlink";
import { updateURL } from "@webhare/std/src/strings";
import { openFileOrFolder } from "@webhare/whfs";

export async function resolveTS1Link(context: LinkResolverContext, link: IntExtLink): Promise<string | null> {
  return updateURL("https://beta.webhare.net/", {
    resolvedby: "js",
    subpath: link.externalLink?.split(":")[1] || null,
    target: context.targetObject.sitePath,
  }).toString();
}

export async function resolveTS2Link(context: LinkResolverContext, link: IntExtLink): Promise<string | null> {
  return updateURL("https://beta.webhare.net/", {
    resolvedby: "js",
    whfspath: (await openFileOrFolder(link.internalLink || 0)).whfsPath,
  }).toString();
}

resolveTS1Link satisfies LinkResolverFunction;
resolveTS2Link satisfies LinkResolverFunction;
