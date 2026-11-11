/* Support for `wh whfs list-types` and `wh whfs describe-type` */

import { getExtractedHSConfig } from "@mod-system/js/internal/configuration";
import { membertypenames } from "@webhare/whfs/src/describe";
import type { CSPContentType, CSPDynamicExecution, CSPMember } from "@webhare/whfs/src/siteprofiles";
import type { WHFSCloneMode } from "@webhare/whfs/src/contenttypes";
import { getTid, hasTid } from "@webhare/gettid";
import { nameToCamelCase, omit, regExpFromWildcards, toCamelCase } from "@webhare/std";

/** WHFS metatypes, using the names used for `metaType` in YAML siteprofiles */
export type SiteProfileMetaType = "instance" | "folder" | "page" | "upload" | "dataFile" | "blockWidget" | "inlineWidget";

export const metaTypeCategories = ["file", "folder", "widget", "instance"] as const;
export type MetaTypeCategory = typeof metaTypeCategories[number];

export interface ListedWHFSType {
  type: string;
  scopedType: string | null;
  namespace: string;
  metaType: SiteProfileMetaType;
  title: string;
  definedIn: string | null;
  orphan?: true;
}

/** All real WHFS content types (RTD types are not real WHFS types and are excluded) */
export function getAllContentTypes(): CSPContentType[] {
  return getExtractedHSConfig("siteprofiles").contenttypes.filter(type => !type.isrtdtype);
}

export function getTypeName(type: CSPContentType): string {
  return type.scopedtype || type.namespace;
}

export function findContentType(name: string): CSPContentType | undefined {
  const types = getAllContentTypes();
  if (/^\d+$/.test(name)) {
    const id = parseInt(name);
    return types.find(type => type.id === id);
  }
  return types.find(type => type.scopedtype === name || type.namespace === name)
    ?? types.find(type => type.scopedtype.toLowerCase() === name.toLowerCase() || type.namespace.toLowerCase() === name.toLowerCase());
}

export function getSiteProfileMetaType(type: CSPContentType): SiteProfileMetaType {
  if (type.foldertype)
    return "folder";
  if (type.isembeddedobjecttype)
    return type.embedtype === "inline" ? "inlineWidget" : "blockWidget";
  if (type.filetype) {
    if (type.filetype.blobiscontent)
      return "upload";
    if (!type.filetype.ispublishable)
      return "dataFile";
    return "page";
  }
  return "instance";
}

export function getMetaTypeCategory(metaType: SiteProfileMetaType): MetaTypeCategory {
  switch (metaType) {
    case "folder":
      return "folder";
    case "blockWidget":
    case "inlineWidget":
      return "widget";
    case "page":
    case "upload":
    case "dataFile":
      return "file";
    default:
      return "instance";
  }
}

function getCloneMode(type: CSPContentType): WHFSCloneMode {
  return type.workflow ? "onDraft" : type.cloneoncopy ? "onCopy" : type.cloneonarchive ? "onArchive" : "never";
}

/** Resolve a title (a tid, ':literal' or '~builtin') to its text. Returns an empty string if the text is missing */
function resolveTitle(title: string): string {
  return title && hasTid(title) ? getTid(title) : "";
}

/** Returns title/tid properties as they would appear in a siteprofile, but with the tid also resolved to its text */
function describeTitle(title: string | undefined): { title?: string; tid?: string } {
  if (!title)
    return {};
  if (title.startsWith(":"))
    return { title: title.substring(1) };
  const text = resolveTitle(title);
  return { ...(text ? { title: text } : {}), tid: title };
}

function getDefinedIn(type: Pick<CSPContentType, "siteprofile" | "line">): string | null {
  if (!type.siteprofile)
    return null;
  return type.line ? `${type.siteprofile}:${type.line}` : type.siteprofile;
}

export type DescribedWHFSType = { type: string } & ReturnType<typeof describeContentType>;

/** List content types
 * @param options - Options:
 *   masks - only return types whose scoped type or namespace matches one of these masks
 *   categories - only return types of these kinds
 *   members - return the full description (as returned by describeContentType) for each type
 */
export function listContentTypes(options: { masks?: string[]; categories?: MetaTypeCategory[]; members: true }): DescribedWHFSType[];
export function listContentTypes(options: { masks?: string[]; categories?: MetaTypeCategory[]; members?: boolean }): ListedWHFSType[] | DescribedWHFSType[];
export function listContentTypes(options: { masks?: string[]; categories?: MetaTypeCategory[]; members?: boolean }): ListedWHFSType[] | DescribedWHFSType[] {
  const maskRegExp = options.masks?.length ? regExpFromWildcards(options.masks, { caseInsensitive: true }) : null;
  const result: ListedWHFSType[] = [];
  const described: DescribedWHFSType[] = [];

  for (const type of getAllContentTypes()) {
    if (maskRegExp && !(type.scopedtype && maskRegExp.test(type.scopedtype)) && !maskRegExp.test(type.namespace))
      continue;

    const metaType = getSiteProfileMetaType(type);
    if (options.categories?.length && !options.categories.includes(getMetaTypeCategory(metaType)))
      continue;

    if (options.members) {
      described.push({ type: getTypeName(type), ...describeContentType(type) });
      continue;
    }

    result.push({
      type: getTypeName(type),
      scopedType: type.scopedtype || null,
      namespace: type.namespace,
      metaType,
      title: resolveTitle(type.title),
      definedIn: getDefinedIn(type),
      ...(type.orphan ? { orphan: true } : {})
    });
  }

  if (options.members)
    return described.sort((lhs, rhs) => lhs.type.localeCompare(rhs.type));
  return result.sort((lhs, rhs) => lhs.type.localeCompare(rhs.type));
}

function describeMembers(members: CSPMember[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const member of members) {
    const constraints = omit(member.constraints ?? {}, ["valueType"]); //valueType is implied by the member type
    const component = member.component;
    result[member.jsname ?? nameToCamelCase(member.name)] = {
      type: membertypenames[member.type] ?? `#${member.type}`,
      ...describeTitle(member.title),
      ...(member.comment ? { comment: member.comment } : {}),
      ...(Object.keys(constraints).length ? { constraints } : {}),
      ...(component ?
        component.component === "__yamlholder" ? toCamelCase(component.yamlprops)
          : {
            component: {
              [component.ns === "http://www.webhare.net/xmlns/tollium/screens" ? component.component : `${component.ns}#${component.component}`]: toCamelCase(component.yamlprops)
            }
          }
        : {}),
      ...(member.layout ? { layout: member.layout } : {}),
      ...(member.children?.length ? { members: describeMembers(member.children) } : {})
    };
  }
  return result;
}

function describeDynamicExecution(exec: CSPDynamicExecution) {
  return {
    ...(exec.startmacro ? { startMacro: exec.startmacro } : {}),
    ...(exec.webpageobjectname ? { webPageObjectName: exec.webpageobjectname } : {}),
    ...(exec.onrendercontent ? { onRenderContent: exec.onrendercontent } : {}),
    ...(exec.routerfunction ? { routerFunction: exec.routerfunction } : {}),
    ...(exec.cachettl ? { cacheTtl: exec.cachettl } : {}),
    ...(exec.cachewebvariables.length ? { cacheGetParameters: exec.cachewebvariables } : {}),
    ...(exec.cacheblacklistvariables.length ? { cacheIgnoreGetParameters: exec.cacheblacklistvariables } : {}),
    ...(exec.cachewebcookies.length ? { cacheCookies: exec.cachewebcookies } : {}),
    ...(exec.cacheblacklistcookies.length ? { cacheIgnoreCookies: exec.cacheblacklistcookies } : {}),
  };
}

/** Describe the file type specific settings, only listing settings that differ from the defaults for its metatype (like a siteprofile would) */
function describeFileTypeSettings(type: CSPContentType, metaType: SiteProfileMetaType): Record<string, unknown> {
  const ft = type.filetype;
  if (!ft)
    return {};

  const result: Record<string, unknown> = {};
  const isPage = metaType === "page";
  if (!type.isembeddedobjecttype) {
    if (ft.ispublishable !== (metaType === "page" || metaType === "upload"))
      result.isPublishable = ft.ispublishable;
    if (ft.needstemplate !== isPage)
      result.useWebDesign = ft.needstemplate;
    if (ft.isacceptableindex !== isPage)
      result.isAcceptableIndex = ft.isacceptableindex;
    if (ft.ispublishedassubdir !== isPage)
      result.isPublishedAsSubdir = ft.ispublishedassubdir;
    if (ft.capturesubpaths)
      result.captureSubPaths = true;
    if (ft.requirescontent)
      result.requiresContent = true;
    if (ft.extensions.length === 1)
      result.extension = ft.extensions[0];
    else if (ft.extensions.length > 1)
      result.extensions = ft.extensions;
    if (ft.browserpreview)
      result.browserPreview = ft.browserpreview;
    if (ft.pagelistprovider)
      result.pageListProvider = ft.pagelistprovider;
  }
  if (ft.searchcontentprovider)
    result.searchContentProvider = ft.searchcontentprovider;
  return result;
}

function describeWidgetSettings(type: CSPContentType): Record<string, unknown> {
  if (!type.isembeddedobjecttype)
    return {};

  return {
    ...(type.editor ? { editor: type.editor.type === "extension" ? { tabsExtension: type.editor.extension } : { function: type.editor.functionname } } : {}),
    ...(type.renderer?.objectname ? { renderer: type.renderer.objectname } : {}),
    ...(type.onrenderwidget ? { onRenderWidget: type.onrenderwidget } : {}),
    ...(type.previewcomponent ? { previewComponent: type.previewcomponent } : {}),
    ...(type.wittycomponent ? { wittyComponent: type.wittycomponent } : {}),
    ...(type.requiremergefieldscontext ? { requireMergeFieldsContext: true } : {}),
  };
}

/** Describe a content type in a format close to how it would be defined in a YAML siteprofile */
export function describeContentType(type: CSPContentType) {
  const metaType = getSiteProfileMetaType(type);
  return {
    id: type.id || null,
    scopedType: type.scopedtype || null,
    namespace: type.namespace,
    definedIn: getDefinedIn(type),
    ...(type.yaml ? {} : { format: "xml" }),
    ...(type.orphan ? { orphan: true } : {}),
    metaType,
    ...describeTitle(type.title),
    ...(type.comment ? { comment: type.comment } : {}),
    ...(type.tolliumicon ? { icon: type.tolliumicon } : {}),
    ...(type.ingroup ? { group: type.ingroup } : {}),
    clone: getCloneMode(type),
    ...(type.contentlink ? { contentLink: true } : {}),
    ...describeFileTypeSettings(type, metaType),
    ...describeWidgetSettings(type),
    ...(type.dynamicexecution ? { dynamicExecution: describeDynamicExecution(type.dynamicexecution) } : {}),
    members: describeMembers(type.members ?? [])
  };
}
