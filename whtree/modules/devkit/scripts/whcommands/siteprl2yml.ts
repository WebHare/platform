// @webhare/cli: Convert a module's *.es files to TypeScript (disabling any linting/checking)

import { CLIRuntimeError, run } from "@webhare/cli";
import { backendConfig, parseResourcePath, resolveResource, toFSPath, WebHareBlob } from "@webhare/services";
import type { CSPApplyRule, CSPContentType, CSPDynamicExecution, CSPMember, CSPModifyType, CSPSiteSetting, CSPSource, CSPWebRule, CSPWidgetEditor } from "@webhare/whfs/src/siteprofiles";
import { nameToCamelCase, omit, regExpFromWildcards, throwError, toCamelCase, typedEntries, typedFromEntries } from "@webhare/std";
import { whconstant_builtinmodules, whconstant_defaultwidgetgroup } from "@mod-system/js/internal/webhareconstants";
import type { AllowDenyTypeList, ApplyRule, ApplyTypes, BaseType, DataFileType, DynamicExecution, FolderType, InstanceType, PageType, RTDType, SiteProfile, SiteSetting, Sources, Type, TypeMembers, UploadType, WebRule, WidgetEditor, WidgetType } from "@mod-platform/generated/schema/siteprofile";
import { membertypenames } from "@webhare/whfs/src/describe";
import YAML from "yaml";
import { runJSBasedValidator } from "@mod-platform/js/devsupport/validation";
import { logValidationResultToConsole } from "@mod-platform/js/cli/output.ts";
import { getOfflineSiteProfiles, readAndParseSiteProfile } from "@mod-publisher/lib/internal/siteprofiles/parser";
import * as test from "@webhare/test";
import { storeDiskFile } from "@webhare/system-tools";
import { fallbacknameTypeName, importApplyTo, suggestTypeName } from "@mod-devkit/js/validation/toyaml";
import { simpleGit } from "simple-git";
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { elements } from "@mod-system/js/internal/generation/xmlhelpers";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { rewriteResource } from "@mod-devkit/js/validation/rewrite";

type ImportContext = {
  topLevelGid: string;
  resourcePath: string;
};

function unresolvePath(ctx: Pick<ImportContext, "resourcePath">, targetPath: string) {
  const wittyPathMatches = targetPath.match(/^mod::([^:]+):(.*)$/); //change :comp to #comp
  if (wittyPathMatches)
    targetPath = `mod::${wittyPathMatches[1]}#${wittyPathMatches[2]}`;

  const basename = ctx.resourcePath.substring(0, ctx.resourcePath.lastIndexOf('/') + 1);
  if (targetPath.startsWith(basename)) {
    return targetPath.slice(basename.length) || '.'; //if the paths are identical we need an explicit '.' - tihs usually happens to designfolder
  }
  const modulename = ctx.resourcePath.substring(0, ctx.resourcePath.indexOf('/') + 1);
  if (targetPath.startsWith(modulename)) {
    return '/' + targetPath.slice(modulename.length);
  }

  return targetPath;
}

function uniqueName(suggested: string, seen: Set<string>) {
  let count = 1;
  for (; ;) {
    const tryname = count > 1 || suggested === fallbacknameTypeName ? `${suggested}-${count}` : suggested;
    if (!seen.has(tryname)) {
      seen.add(tryname);
      return tryname;
    }
    ++count;
  }
}

function getMembers(members: CSPMember[]): TypeMembers {
  const retval: TypeMembers = {};
  for (const member of members) {
    const memberName = member.jsname || nameToCamelCase(member.name);
    retval[memberName] = {
      type: membertypenames[member.type] ?? throwError(`Unsupported member type ${member.type} for member ${memberName}`),
      ...member.comment ? { comment: member.comment } : {},
      ...member.children.length ? { members: getMembers(member.children) } : {},
    };
  }
  return retval;
}

function importRTDType(ctxt: ImportContext, rt: CSPContentType): RTDType {
  if (!rt.structure)
    throw new Error("RTD type " + rt.namespace + " has no structure defined");

  //helpers to simplify casting
  type BSType = NonNullable<RTDType["blockStyles"]>[string];
  type BSTypeR = Required<BSType>;
  type TSType = NonNullable<RTDType["tableStyles"]>[string];

  const tablestyles = rt.structure.blockstyles.filter(_ => _.type === "table");

  return {
    ...rt.comment ? { comment: rt.comment } : {},
    ...rt.allownewwindowlinks === true ? { allowNewWindowLinks: true } : {},
    ...rt.cssfiles?.length ? { css: rt.cssfiles.map(_ => unresolvePath(ctxt, _.path)) } : {},
    ...rt.htmlclass ? { htmlClass: rt.htmlclass } : {},
    ...rt.bodyclass ? { bodyClass: rt.bodyclass } : {},
    ...rt.structure.defaultblockstyle ? { defaultBlockStyle: rt.structure.defaultblockstyle.toLowerCase() } : {},
    blockStyles: typedFromEntries(rt.structure.blockstyles.filter(_ => _.type === "text").map(bs => [
      bs.tag.toLowerCase(), {
        ...bs.containertag ? { containerTag: bs.containertag as BSTypeR["containerTag"] } : {},
        ...bs.textstyles.length ? { textStyles: bs.textstyles as BSTypeR["textStyles"] } : {},
        ...bs.importfrom?.length ? { importFrom: bs.importfrom } : {},
        ...bs.nextblockstyle ? { nextBlockStyle: bs.nextblockstyle.toLowerCase() } : {},
        ...bs.title ? { title: bs.title } : {},
      } satisfies BSType
    ])),
    ...tablestyles.length ? {
      tableStyles: typedFromEntries(tablestyles.map(bs => [
        bs.tag.toLowerCase(), {
          ...bs.title ? { title: bs.title } : {},
          ...bs.tabledefaultblockstyle ? { defaultBlockStyle: bs.tabledefaultblockstyle.toLowerCase() } : {},
          ...bs.allowstyles ? { allowStyles: bs.allowstyles.map(s => s.toLowerCase()) } : {}
        } satisfies TSType
      ]))
    } : {},
    ...rt.structure.cellstyles.length ? {
      cellStyles: typedFromEntries(rt.structure.cellstyles.map(cs => [
        cs.tag, {
          title: cs.title,
        }
      ]))
    } : {},
    ...rt.ignoresiteprofilewidgets ? { ignoreSiteProfileWidgets: true } : {},
    ...rt.allowedobjects?.length ? {
      allowedObjects: rt.allowedobjects.map(_ => ({
        type: _.type,
        inherit: _.inherit === true,
      }))
    } : {},
    ...rt.linkhandlers?.length ? { linkHandlers: rt.linkhandlers.map(lh => lh.namespaceuri + '#' + lh.localname) } : {},
    ...rt.structure.tag_b === "strong" ? { b: "strong" } : {},
    ...rt.structure.tag_i === "em" ? { i: "em" } : {},
  };
}

function importWebRule(ctxt: ImportContext, wr: CSPWebRule): WebRule {
  return {
    path: wr.rule.path + (wr.rule.matchtype === 1 ? "*" : ""),
    ...wr.rule.priority ? { priority: wr.rule.priority === 1000 ? "after" : "before" } : {},
    ...wr.rule.cachecontrol ? { cacheControl: wr.rule.cachecontrol } : {},
    ...wr.rule.csps.length ? { contentSecurityPolicy: wr.rule.csps[0].policy } : {},
    ...wr.rule.addheaders.length ? { headers: Object.fromEntries(wr.rule.addheaders.map(h => [h.name, h.value])) } : {},
    ...wr.rule.ruledata?.router ? { router: wr.rule.ruledata.router } : {},
    ...wr.rule.allowallmethods ? { methods: "*" } : {},
  };
}

function importSiteSetting(ctxt: ImportContext, ss: CSPSiteSetting): SiteSetting {
  return {
    ...ss.sitefilter?.sitemask ? { site: ss.sitefilter.sitemask } : {},
    ...ss.sitefilter?.sitename ? { site: ss.sitefilter.sitename } : {},
    ...ss.sitefilter?.siteregex ? { site: { regex: ss.sitefilter.siteregex } } : {},
    ...ss.sitefilter?.webrootregex ? { webRoot: { regex: ss.sitefilter.webrootregex } } : {},
    ...ss.addtocatalogs?.length ? {
      addToCatalogs: ss.addtocatalogs.map(ac => ({
        catalog: ac.catalog,
        ...ac.folder ? { folder: ac.folder } : {}
      }))
    } : {},
    ...ss.webrules?.length ? {
      webRules: ss.webrules.map(wr => importWebRule(ctxt, wr)
      )
    } : {},
  };
}

function importDynamicExecution(ctxt: ImportContext, dx: CSPDynamicExecution): DynamicExecution {
  return {
    ...dx.cachewebcookies?.length ? { cacheCookies: dx.cachewebcookies } : {},
    ...dx.cacheblacklistcookies?.length ? { cacheIgnoreCookies: dx.cacheblacklistcookies } : {},

    ...dx.cachewebvariables?.length ? { cacheGetParameters: dx.cachewebvariables } : {},
    ...dx.cacheblacklistvariables?.length ? { cacheIgnoreGetParameters: dx.cacheblacklistvariables } : {},

    ...dx.cachettl ? { cacheTtl: dx.cachettl } : {},

    ...dx.routerfunction ? { routerFunction: unresolvePath(ctxt, dx.routerfunction) } : {},
    ...dx.startmacro ? { startMacro: unresolvePath(ctxt, dx.startmacro) } : {},
    ...dx.webpageobjectname ? { webPageObjectName: unresolvePath(ctxt, dx.webpageobjectname) } : {},
  };
}

function importEditor(ctxt: ImportContext, editor: CSPWidgetEditor): WidgetEditor {
  return editor?.type === "extension"
    ? { tabsExtension: unresolvePath(ctxt, editor.extension) }
    : { function: unresolvePath(ctxt, editor.functionname) };
}

function importCtype(ctxt: ImportContext, ct: CSPContentType): Type {
  let retval: Type = {
    namespace: ct.namespace,
    ...ct.title ? (ct.title.startsWith(':') ? { title: ct.title.substring(1) } : { tid: ct.title })
      : ctxt.topLevelGid ? { title: "" } : {}, //if there's a toplevelgid we'll need to explicitly set an empty title
    ...ct.comment ? { comment: ct.comment } : {},
    ...ct.tolliumicon ? { icon: ct.tolliumicon } : {},
  };

  if (ct.filetype) {
    if (ct.filetype.generatepreview) { //in parser.whlib the generatepreview bit is set for widgets
      retval = {
        ...retval,
        metaType: ct.embedtype === "block" ? "blockWidget" : "inlineWidget",
        ...ct.editor ? { editor: importEditor(ctxt, ct.editor) } : {},
        ...ct.renderer ? { renderer: unresolvePath(ctxt, ct.renderer.objectname) } : {},
        ...ct.requiremergefieldscontext ? { requireMergeFieldsContext: true } : {},
        ...ct.ingroup && ct.ingroup !== whconstant_defaultwidgetgroup ? { group: ct.ingroup } : {},
        ...ct.previewcomponent ? { previewComponent: unresolvePath(ctxt, ct.previewcomponent) } : {},
        ...ct.wittycomponent ? { wittyComponent: unresolvePath(ctxt, ct.wittycomponent) } : {},
      } satisfies BaseType & WidgetType;
    } else if (ct.filetype.blobiscontent) {
      retval = {
        ...retval,
        metaType: "upload",
        ...ct.filetype.requirescontent ? { requiresContent: true } : {},
        ...ct.filetype.extensions?.length ? { extension: ct.filetype.extensions[0] } : {},
        ...ct.filetype.isacceptableindex ? { isAcceptableIndex: true } : {},
        ...ct.filetype.needstemplate ? { useWebDesign: true } : {},
        ...!ct.filetype.ispublishable ? { isPublishable: false } : {},
        ...ct.filetype.browserpreview ? { browserPreview: ct.filetype.browserpreview } : {},
      } satisfies BaseType & UploadType;
    } else if (!ct.filetype.ispublishable) {
      retval = {
        ...retval,
        metaType: "dataFile"
      } satisfies BaseType & DataFileType;
    } else {
      retval = {
        ...retval,
        metaType: "page",
        workflow: !ct.filetype.initialpublish,
        //the following settings default to true so we only make 'false' explicit
        ...!ct.filetype.isacceptableindex ? { isAcceptableIndex: false } : {},
        ...!ct.filetype.needstemplate ? { useWebDesign: false } : {},
        ...!ct.filetype.ispublishedassubdir ? { isPublishedAsSubdir: false } : {},
        ...ct.filetype.pagelistprovider ? { pageListProvider: unresolvePath(ctxt, ct.filetype.pagelistprovider) } : {},
        ...ct.dynamicexecution ? { dynamicExecution: importDynamicExecution(ctxt, ct.dynamicexecution) } : {},
        ...ct.filetype.capturesubpaths ? { captureSubPaths: true } : {},
      } satisfies BaseType & PageType;
    }

    //generic filetype stuff
    if (ct.filetype?.searchcontentprovider)
      retval.searchContentProvider = ct.filetype.searchcontentprovider;
  } else if (ct.foldertype) {
    retval = {
      ...retval,
      metaType: "folder",
      ...ct.dynamicexecution ? { dynamicExecution: importDynamicExecution(ctxt, ct.dynamicexecution) } : {},
    } satisfies BaseType & FolderType;
  } else {
    retval = {
      ...retval,
      workflow: false,
      ...(!ct.cloneoncopy ? { clone: "never" } : {}),
    } satisfies BaseType & InstanceType;
  }

  if (ct.members?.length)
    retval.members = getMembers(ct.members);

  return retval;
}

function mapModifyTypes(mts: CSPModifyType[]): ApplyTypes {
  return mts.map(mt => mt.isallow ?
    mt.newonlytemplate && mt.setnewonlytemplate ?
      { allowTemplate: mt.typedef } : { allowType: mt.typedef } : { denyType: mt.typedef });
}

function importSources(ctxt: ImportContext, sources: CSPSource[]): Sources {
  return sources.map(s => ({
    path: s.relativeto === "siteprofile" ? unresolvePath(ctxt, s.path) : s.path,
    ...s.relativeto === "targetobject" ? { relativeTo: "targetObject" } : {}
  }));
}

function importApplyRule(ctxt: ImportContext, ar: CSPApplyRule): ApplyRule {
  const rule: ApplyRule = {
    ...ar.comment ? { comment: ar.comment } : {},
  };

  if (ar.baseproperties) {
    rule.baseProps = {};
    for (const binaryprop of ["description", "noarchive", "keywords", "noIndex", "noFollow", "seoTitle", "seoTab"] as const)
      if (ar.baseproperties.haslist.includes(binaryprop.toUpperCase() as Uppercase<typeof binaryprop>))
        rule.baseProps[binaryprop] = (ar.baseproperties)[binaryprop.toLowerCase() as Lowercase<typeof binaryprop>] === true;
    if (ar.baseproperties.haslist.includes("SEOTABREQUIRERIGHT"))
      rule.baseProps.seoTab = { requireRight: ar.baseproperties.seotabrequireright };
  }

  if (ar.webdesign) {
    rule.webDesign = {
      ...ar.webdesign.has_assetpack ? { assetPack: ar.webdesign.assetpack } : {},
      ...ar.webdesign.objectname ? { objectName: unresolvePath(ctxt, ar.webdesign.objectname) } : {},
      ...ar.webdesign.has_contentnavstops ? { contentNavStops: ar.webdesign.contentnavstops } : {},
      ...ar.webdesign.has_supportsaccessdenied ? { supportsAccessDenied: ar.webdesign.supportsaccessdenied } : {},
      ...ar.webdesign.has_supportserrors ? { supportsErrors: ar.webdesign.supportserrors } : {},
      ...ar.webdesign.getdata ? { getData: ar.webdesign.getdata } : {},
      ...ar.webdesign.maxcontentwidth ? { maxContentWidth: ar.webdesign.maxcontentwidth } : {},
      ...ar.webdesign.siteresponsefactory ? { siteResponseFactory: unresolvePath(ctxt, ar.webdesign.siteresponsefactory) } : {},
      ...ar.webdesign.witty ? { witty: unresolvePath(ctxt, ar.webdesign.witty) } : {},
      ...ar.webdesign.wittyencoding ? { wittyEncoding: ar.webdesign.wittyencoding } : {},
      ...ar.webdesign.designfolder ? { designFolder: unresolvePath(ctxt, ar.webdesign.designfolder) } : {},
    };
  }

  if (ar.sitelanguage?.has_lang)
    rule.siteLanguage = ar.sitelanguage.lang;

  for (const formdef of ar.formdefinitions) {
    rule.formDefinitions ||= [];
    rule.formDefinitions.push({
      path: formdef.path,
      ...formdef.name ? { name: formdef.name } : {}
    });
  }

  if (ar.bodyrenderer) {
    rule.bodyRenderer = ar.bodyrenderer.objectname
      ? { objectName: unresolvePath(ctxt, ar.bodyrenderer.objectname) }
      : { renderer: unresolvePath(ctxt, ar.bodyrenderer.renderer) };
  }

  if (ar.contentlisting)
    throw new Error(`<contentlisting> is not supported by YAML based siteprofiles`);

  if (ar.folderindex) {
    // if (ar.folderindex.indexfile === "contentlisting") {
    //   rule.folderIndex = { newFileType: "http://www.webhare.net/xmlns/publisher/contentlisting" };
    // } else
    if (ar.folderindex.indexfile === "contentlink" || ar.folderindex.indexfile === "copy_of_file") {
      const path = ar.folderindex.site ? `site::${ar.folderindex.site}${ar.folderindex.fullpath}` : ar.folderindex.fullpath;
      if (ar.folderindex.indexfile === "contentlink")
        rule.folderIndex = { contentLink: path };
      else
        rule.folderIndex = { copy: path };
    } else if (ar.folderindex.indexfile === "newfile") {
      rule.folderIndex = {
        newFileType: ar.folderindex.newfiletype,
        ...ar.folderindex.newfilename ? { newFileName: ar.folderindex.newfilename } : {},
      };
    } else if (ar.folderindex.indexfile === "none") { //explicit disable
      rule.folderIndex = "none";
    }
    if (rule.folderIndex && rule.folderIndex !== "none" && ar.folderindex.protectindexfile)
      rule.folderIndex.pin = true;
  }

  if (ar.foldersettings) {
    rule.folderSettings = {
      ...ar.foldersettings.has_filterscreen ? { filterScreen: unresolvePath(ctxt, ar.foldersettings.filterscreen) } : {},
      ...ar.foldersettings.contentslisthandler ? { contentsListHandler: unresolvePath(ctxt, ar.foldersettings.contentslisthandler.objectname) } : {},
      ...ar.foldersettings.ordering ? { ordering: ar.foldersettings.ordering } : {},
    };
  }

  for (const task of ar.schedulemanagedtasks) {
    rule.scheduleManagedTasks ||= [];
    rule.scheduleManagedTasks.push({
      task: task.task,
    });
  }
  for (const task of ar.scheduletasknows) {
    rule.scheduleTimedTasks ||= [];
    rule.scheduleTimedTasks.push({
      task: task.task,
      ...task.delay ? { delay: task.delay } : {},
    });
  }

  for (const intercept of ar.hookintercepts) {
    rule.intercept ||= {};
    rule.intercept[intercept.name.split(':')[1]] = {
      interceptFunction: unresolvePath(ctxt, intercept.interceptfunction),
      target: intercept.target,
      ...intercept.orderafter.length ? { runAfter: intercept.orderafter } : {},
      ...intercept.orderbefore.length ? { runBefore: intercept.orderbefore } : {},
    };
  }

  for (const ext of ar.extendproperties) {
    rule.editProps ||= [];
    rule.editProps.push({
      type: ext.contenttype,
      ...ext.requireright ? { requireRight: ext.requireright } : {},
      ...ext.extension ? { tabsExtension: unresolvePath(ctxt, ext.extension) } : {},
    });
  }

  if (ar.usepublishtemplate?.script)
    rule.usePublishTemplate = unresolvePath(ctxt, ar.usepublishtemplate.script);

  if (ar.setobjecteditor) {
    rule.setObjectEditor = {
      ...ar.setobjecteditor.separateapp ? { separateApp: true } : {},
      ...ar.setobjecteditor.screen ? { screen: ar.setobjecteditor.screen } : {},
      ...ar.setobjecteditor.name ? { name: ar.setobjecteditor.name } : {},
    };
  }

  if (ar.webtoolsformrules?.length) {
    rule.forms ||= {};

    for (const fr of ar.webtoolsformrules) {
      const comp = fr.comp === "component" ? "components" : fr.comp === "handler" ? "handlers" : fr.comp === "rtdtype" ? "rtdTypes" : throwError(`Unsupported form rule type ${fr.comp}`);
      rule.forms[comp] ||= [];
      rule.forms[comp].push({ [fr.allow ? "allow" : "deny"]: fr.type } as AllowDenyTypeList[number]);
    }
  }

  if (ar.rtddoc) {
    rule.rtdDoc = {
      ...ar.rtddoc.bodyclass ? { bodyClass: ar.rtddoc.bodyclass } : {},
      ...ar.rtddoc.htmlclass ? { htmlClass: ar.rtddoc.htmlclass } : {},
      ...ar.rtddoc.margins ? { margins: ar.rtddoc.margins } : {},
      ...ar.rtddoc.rtdtype ? { rtdType: ar.rtddoc.rtdtype } : {},
    };
  }

  if (ar.modifyfiletypes?.length)
    rule.fileTypes = mapModifyTypes(ar.modifyfiletypes);
  if (ar.modifyfoldertypes?.length)
    rule.folderTypes = mapModifyTypes(ar.modifyfoldertypes);

  if (ar.mailtemplates?.length) {
    rule.mailTemplates = ar.mailtemplates.map(mt => ({
      path: mt.path,
      ...mt.title ? (mt.title.startsWith(':') ? { title: mt.title.substring(1) } : { tid: mt.title }) : {},
      ...mt.ordering ? { ordering: mt.ordering || 0 } : {},
      ...mt.sources?.length ? { sources: importSources(ctxt, mt.sources) } : {},
    }));
  }

  if (ar.setwidget?.length) {
    rule.setWidget = typedFromEntries(
      ar.setwidget.map(sw => [
        sw.contenttype, {
          ...sw.editor ? importEditor(ctxt, sw.editor) : {},
          ...sw.renderer ? { renderer: unresolvePath(ctxt, sw.renderer.objectname) } : {},
          ...sw.previewcomponent ? { previewComponent: unresolvePath(ctxt, sw.previewcomponent) } : {},
          ...sw.wittycomponent ? { wittyComponent: unresolvePath(ctxt, sw.wittycomponent) } : {},
        }
      ])
    );
  }

  for (const repub of ar.republishes) {
    rule.republish ||= [];
    rule.republish.push({
      ...repub.folder ? { folder: repub.folder } : {},
      ...repub.sitemask ? { siteMask: repub.sitemask } : {},
      ...repub.mask ? { mask: repub.mask } : {},
      ...repub.recursive ? { recursive: repub.recursive } : {},
      ...repub.indexonly ? { indexOnly: repub.indexonly } : {},
      ...repub.onchange ? { onChange: repub.onchange } : {},
      ...repub.scope ? { scope: repub.scope } : {},
    });
  }

  for (let [customKey, data] of Object.entries(ar).filter(([k, v]) => k.startsWith("yml_"))) {
    customKey = nameToCamelCase(customKey.substring(4));
    const plugininfo = getExtractedConfig("plugins").spPlugins.find(p => p.yamlProperty === customKey);
    if (!plugininfo)
      throw new Error(`No plugin registered for custom siteprofile property ${customKey}, cannot convert`);

    if (plugininfo.isArray) {
      if (rule[customKey])
        throw new Error(`Custom siteprofile property ${customKey} already exists? Cannot merge an array into it`);
      rule[customKey] = toCamelCase(data);
    } else {
      // Merge it into a property. needed for 'forms'
      rule[customKey] = { ...(rule[customKey] as object), ...toCamelCase(data[0]) };
    }
  }

  return rule;
}

function myCSPRuleCompare(expect: unknown, actual: unknown, path: string) {
  if (path.endsWith(".line") || path.endsWith(".col")) //positions are uncomparable
    return true;
  if (path.endsWith(".applynodetype") || path.endsWith(".applyindex")) //XML locators are useless with YAML
    return true;
  if (path.endsWith(".yaml") && !expect)
    return true;
  if (path.endsWith(".uploadtypemapping")) //we'll drop this in 6.0 anyway
    return true;
  if (path.endsWith(".siteprofile"))
    return true;
  //these are double imported, we only check those in webtoolsformrules
  if (path.match(/\.yml_forms\[\d+\]\.(components|handlers|rtdTypes)$/))
    return true;
}

function myCSPCompare(expect: unknown, actual: unknown, path: string) {
  if (path.endsWith(".yaml") && !expect)
    return true;
  if (path.endsWith(".line") || path.endsWith(".col")) //positions are uncomparable
    return true;
  if (path.endsWith(".scopedtype") && !expect)
    return true;
  if (path.endsWith(".jsname") && !expect)
    return true;
  if (path === ".name" || path === ".icons")
    return true;
  if (path.endsWith(".extensions"))
    return true;
  if ((path.endsWith(".wittycomponent") || path.endsWith(".previewcomponent")) && typeof actual === "string" && actual.replace('#', ':') === expect) //we convert : to # so try undoing that to match
    return true;
  if (path.endsWith(".rule.source"))
    return true;
}

//Blind search and replace through all the nodes. can we indeed do this blindly?
function fixAllTypeRefs<T>(topnode: T, remap: Map<string, string>, propertyName?: string): T {
  if (Array.isArray(topnode))
    return topnode.map(subnode => fixAllTypeRefs(subnode, remap)) as unknown as T;
  if (typeof topnode === "object" && topnode !== null)
    return typedFromEntries(typedEntries(topnode).map(([k, v]) => [k, fixAllTypeRefs(v, remap, k)])) as T;
  if (propertyName !== "namespace" && typeof topnode === "string" && remap.has(topnode))
    return remap.get(topnode) as T;
  return topnode;
}

run({
  flags: {
    "dump-yaml": { description: "Dump all generated YAML documents" },
    "dry-run": { description: "Don't write any files, just validate the output" },
    "no-status-check": { description: "Don't check for a clean git status before proceeding" },
  },
  options: {
    "mask": {
      description: "Only convert siteprofiles matching this wildcard mask",
    }
  },
  arguments: [{ name: "<module>", description: "Module to convert" }],
  async main({ opts, args }) {
    let errors = false;

    const root = backendConfig.module[args.module]?.root;
    if (!root)
      throw new CLIRuntimeError(`Module ${args.module} not found`);

    if (!opts.noStatusCheck && !opts.dryRun) {
      const status = await simpleGit({ baseDir: root }).status();
      if (!status.isClean())
        throw new CLIRuntimeError(`Module ${root} appears to have uncommitted changes, please commit or stash them before running siteprl2yml`);
    }

    //Locate and load all siteprofiles (this takes 6 seconds for me with 200+ modules so doesn't seem worth it to filter by module yet)
    const csp = await getOfflineSiteProfiles(true, []);

    const modulesInScope = args.module === "platform" ? whconstant_builtinmodules : [args.module];
    const toWrite = new Map<string, string | null>;
    const matchName = opts.mask ? regExpFromWildcards(opts.mask, { caseInsensitive: true }) : /.*/;
    const remapTypes = new Map(csp.allcontenttypes.filter(_ => _.scopedtype && _.scopedtype !== _.namespace).map(_ => [_.namespace, _.scopedtype]));

    const profilesToConvert = csp.siteprofiles.filter(sp => {
      if (sp.resourcename.endsWith(".yml") || sp.resourcename.endsWith(".yaml"))
        return false;
      if (!matchName.test(sp.resourcename))
        return false;

      const module = parseResourcePath(sp.resourcename)?.module;
      return module && modulesInScope.includes(module);
    }).map(sp => ({
      ...sp,
      name: sp.resourcename,
      newName: sp.resourcename.replace(/\.siteprl(\.xml)?$/, ".siteprl.yml"),
      source: readFileSync(toFSPath(sp.resourcename), "utf-8"),
      result: null as SiteProfile | null,
      ctxt: {
        resourcePath: sp.resourcename,
        topLevelGid: sp.siteprofile.gid
      } satisfies ImportContext
    }));

    //Gather used scoped types
    const seenScopedTypes = new Set<string>();

    for (const sp of profilesToConvert)
      for (const ct of sp.siteprofile.contenttypes)
        if (ct.scopedtype) {
          seenScopedTypes.add(ct.scopedtype);
        }

    for (const sp of profilesToConvert) {
      if (!sp.resourcename.endsWith(".siteprl") && !sp.resourcename.endsWith(".siteprl.xml"))
        throw new Error(`Unexpected filename ${sp.resourcename}, expected *.siteprl.xml or *.siteprl`);

      const ctxt = sp.ctxt;

      console.log(`Converting ${sp.resourcename} to ${sp.newName} `);

      const outsiteprofile: SiteProfile = {
        ...sp.siteprofile.gid ? { gid: sp.siteprofile.gid } : {},
      };

      if (sp.siteprofile.contenttypes.length) {
        outsiteprofile.types = {};
        for (const ct of sp.siteprofile.contenttypes) {
          const subName = uniqueName(suggestTypeName(args.module, ct.namespace), seenScopedTypes);
          outsiteprofile.types![subName.substring(args.module.length + 1)] = importCtype(ctxt, ct);
        }
      }

      if (sp.siteprofile.applyrules.length) {
        for (const apply of sp.siteprofile.applyrules)
          if (apply.whfstype) { //this apply rule needs to be added to its original type
            const matchtype = Object.values(outsiteprofile.types || {}).find(_ => _.namespace === apply.whfstype);
            if (!matchtype)
              throw new Error(`Apply rule references unknown type ${apply.whfstype
                } `);

            matchtype.apply = importApplyRule(ctxt, apply);
          } else {
            const to = importApplyTo(apply.tos);

            outsiteprofile.apply ||= [];
            outsiteprofile.apply.push({
              to,
              ...apply.priority ? { priority: apply.priority } : {},
              ...importApplyRule(ctxt, apply)
            });
          }
      }

      if (sp.siteprofile.grouptypes.length) {
        outsiteprofile.widgetGroups = {};
        for (const gt of sp.siteprofile.grouptypes) {
          outsiteprofile.widgetGroups[gt.namespace] = {
            ...gt.title ? (gt.title.startsWith(':') ? { title: gt.title.substring(1) } : { tid: gt.title }) : {},
            ...gt.tolliumicon ? { icon: gt.tolliumicon } : {},
          };
        }
      }

      if (sp.siteprofile.rtdtypes.length) {
        outsiteprofile.rtdTypes = {};
        for (const rt of sp.siteprofile.rtdtypes) {
          outsiteprofile.rtdTypes[rt.namespace] = importRTDType(ctxt, rt);
        }
      }

      for (const setting of sp.siteprofile.sitesettings) {
        outsiteprofile.siteSettings ||= [];
        outsiteprofile.siteSettings.push(importSiteSetting(ctxt, setting));
      }

      if (sp.siteprofile.applysiteprofiles.length) {
        outsiteprofile.applySiteProfiles = sp.siteprofile.applysiteprofiles;
      }

      sp.result = outsiteprofile;
    }

    //Once all are converted we can start validating them (so we have all the cross references)
    for (const sp of profilesToConvert) {
      const yamlText = YAML.stringify(sp.result);
      const validation = await runJSBasedValidator(WebHareBlob.from(yamlText), sp.newName);
      if (validation.messages.some(_ => _.type === "warning" || _.type === "error")) {
        console.log("Validation issues found in generated YAML:");
        console.log(yamlText);
        logValidationResultToConsole(validation);
        throw new CLIRuntimeError(`Validation issues found in generated YAML, see above`);
      }

      //Reparse the siteprofile as YML and compare the individual parse results
      const parsedYaml = await readAndParseSiteProfile(sp.resourcename, { overridetext: yamlText });
      let spSuccess = true;

      //Compare rules[] array manually so we can better explain failures. Plus we expect there to be some continuing friction here so its more useful to log everything and let the user decide
      for (const [idx, rule] of parsedYaml.applyrules.entries()) {
        const finalRule = rule;
        let sourceRule = sp.siteprofile.applyrules[idx];

        sourceRule = {
          ...sourceRule,
          customnodes: sourceRule.customnodes.filter(_ =>
            _.namespaceuri !== "urn:xyz" //remove these when comparing, they're test nodes to verify the old SP compiler
            && _.localname !== "mswordconversion") //there's no translation for these nodes so ignore
        };

        try {
          test.eq(sourceRule, finalRule, { onCompare: myCSPRuleCompare });
        } catch (e) {
          errors = true;
          spSuccess = false;
          console.log("Mismatch on rule #" + idx, (e as Error).message);
          console.dir({ sourceRule, finalRule }, { depth: null });
        }
      }
      if (parsedYaml.applyrules.length !== sp.siteprofile.applyrules.length) {
        errors = true;
        spSuccess = false;
        console.log(`Mismatch on applyrules count, source has ${sp.siteprofile.applyrules.length} but YAML has ${parsedYaml.applyrules.length}`);
      }

      //And contenttypes[]
      for (const [idx, rule] of parsedYaml.contenttypes.entries()) {
        const finalType = rule;
        const sourceType = sp.siteprofile.contenttypes[idx];

        try {
          test.eq(sourceType, finalType, { onCompare: myCSPCompare });
        } catch (e) {
          errors = true;
          spSuccess = false;
          console.log("Mismatch on contenttype #" + idx, (e as Error).message);
          console.dir({ sourceType, finalType }, { depth: null });
        }
      }
      if (parsedYaml.contenttypes.length !== sp.siteprofile.contenttypes.length) {
        errors = true;
        spSuccess = false;
        console.log(`Mismatch on contenttypes count, source has ${sp.siteprofile.contenttypes.length} but YAML has ${parsedYaml.contenttypes.length}`);
      }


      //And sitesettings[]
      for (const [idx, rule] of parsedYaml.sitesettings.entries()) {
        const finalType = rule;
        const sourceType = sp.siteprofile.sitesettings[idx];
        console.log({ sourceType, finalType });
        try {
          test.eq(sourceType, finalType, { onCompare: myCSPCompare });
        } catch (e) {
          spSuccess = false;
          errors = true;
          console.log("Mismatch on sitesetting #" + idx, (e as Error).message);
          console.dir({ sourceType, finalType }, { depth: null });
        }
      }
      if (parsedYaml.sitesettings.length !== sp.siteprofile.sitesettings.length) {
        errors = true;
        spSuccess = false;
        console.log(`Mismatch on sitesettings count, source has ${sp.siteprofile.sitesettings.length} but YAML has ${parsedYaml.sitesettings.length}`);
      }

      try {
        const ignoreList = ["applyrules", "sitesettings", "contenttypes", "messages", "applysiteprofiles"] as const;
        test.eq(omit(sp.siteprofile, ignoreList), omit(parsedYaml, ignoreList), { onCompare: myCSPCompare });
        test.eq(sp.siteprofile.applysiteprofiles.length, parsedYaml.applysiteprofiles.length); //since we rename XML to YML, lets only care about the count
      } catch (e) {
        spSuccess = false;
      }

      if (!spSuccess) {
        if (opts.dumpYaml) {
          console.log("### " + sp.newName + "\n---\n");
          console.log(yamlText);
        }
        sp.result = null; //clear it, we had errors and won't be remapping this file
      }


      //Add conversion result to the typemap
      for (const rt of parsedYaml.contenttypes)
        if (rt.scopedtype !== rt.namespace)
          remapTypes.set(rt.namespace, rt.scopedtype);
    } //for (const sp of profilesToConvert)

    const renameMap = new Map<string, string>;

    for (const sp of profilesToConvert.filter(_ => _.result)) {
      //Converted succesfully so get rid of SP nodes in the old XML file
      const spXml = new DOMParser().parseFromString(sp.source, "text/xml");
      for (const node of elements(spXml.documentElement!.childNodes!)) {
        if (node.namespaceURI === "http://www.webhare.net/xmlns/publisher/siteprofile") {
          spXml.documentElement!.removeChild(node);
        }
      }

      if (elements(spXml.documentElement!.childNodes!).length) { //we need to keep the XML around
        //Reformat the cleaned up XML file (TODO consider deletion!)
        const rawxml = new XMLSerializer().serializeToString(spXml);
        const final = await rewriteResource(sp.resourcename, rawxml);
        if (!final)
          throw new Error(`rewrite of ${sp.resourcename} failed`);

        if (final !== sp.source)
          toWrite.set(sp.resourcename, final);
      } else {
        toWrite.set(sp.resourcename, null);
      }

      renameMap.set(sp.resourcename, sp.newName);
    }

    //Fix references in all other siteprofiles to us
    for (const checkSp of profilesToConvert) {
      if (checkSp.result?.applySiteProfiles?.length) //if its referring to us, rewrite it
        checkSp.result.applySiteProfiles = checkSp.result.applySiteProfiles.map(p => renameMap.get(p) ?? p);

      //remove all local prefix from the remapTypes list
      for (const [k, v] of remapTypes)
        if (v.startsWith(`${args.module}:`))
          remapTypes.set(k, v.substring(args.module.length + 1));

      //Fix type references.
      checkSp.result = fixAllTypeRefs(checkSp.result, remapTypes);
    }


    //Rewrite moduledefinition.xml
    const moddefXMLResource = `mod::${args.module}/moduledefinition.xml`;
    const moddefXMLSource = readFileSync(toFSPath(moddefXMLResource), "utf-8");
    const moddefXML = new DOMParser().parseFromString(moddefXMLSource, "text/xml");
    let anyXMLChanges = false;
    for (const tofix of [
      { node: "webdesign", attribute: "siteprofile" },
      { node: "webfeature", attribute: "siteprofile" },
      { node: "siteprofile", attribute: "path" },
    ])
      for (const webdesignnode of moddefXML.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", tofix.node)) {
        console.log("Checking <" + tofix.node + "> for " + tofix.attribute);
        const cursp = webdesignnode.getAttribute(tofix.attribute);
        if (!cursp)
          continue;

        const resolvedCurSp = resolveResource(`mod::${args.module}/`, cursp);
        const newResource = renameMap.get(resolvedCurSp);
        if (!newResource) {
          console.log("No match for " + resolvedCurSp);
          continue;

        }
        console.log(`Fixing reference to siteprofile ${cursp} in <${tofix.node}> to point to new ${newResource}`);
        webdesignnode.setAttribute(tofix.attribute, unresolvePath({ resourcePath: `mod::${args.module}/moduledefinitions.xml` }, newResource));
        anyXMLChanges = true;
      }

    if (anyXMLChanges) { //only rewrite if we made changes
      const rawxml = new XMLSerializer().serializeToString(moddefXML);
      const final = await rewriteResource(moddefXMLResource, rawxml);
      if (!final)
        throw new Error(`rewrite of ${moddefXMLResource} failed`);

      if (final !== moddefXMLSource)
        toWrite.set(moddefXMLResource, final);
    }

    // Serialize new YMLs
    for (const sp of profilesToConvert.filter(_ => _.result)) {
      if (sp.result?.applySiteProfiles)
        sp.result.applySiteProfiles = sp.result.applySiteProfiles.map(path => unresolvePath(sp.ctxt, path));

      toWrite.set(sp.newName, YAML.stringify(sp.result));
    }

    //Write the conversion result to disk
    for (const [path, content] of toWrite) {
      const outpath = toFSPath(path);
      if (content !== null) {
        if (opts.dumpYaml && path.endsWith(".yml")) {
          console.log("### " + path + "\n---\n");
          console.log(content);
        }

        if (opts.dryRun)
          console.log(`Would ${existsSync(outpath) ? "update" : "create"} ${outpath} (${content.length} bytes)`);
        else
          await storeDiskFile(outpath, content, { overwrite: true });
      } else {
        if (opts.dryRun)
          console.log(`Would delete ${outpath}`);
        else
          rmSync(outpath);
      }
    }

    console.log("DONE! 🚀");
    if (errors)
      console.error("There were errors during conversion, please fix those or revert and retry");

    console.log("You should verify the result and update siteprofile references from module definitions to use the new files");
    console.log("Also check XML files for any important (possibly deleted!) comments you would still prefer to keep");
    console.log("If XML files contain irrelevant modifidations consider running a devkit:cleanupmodule --xml on them first");
    return errors ? 1 : 0;
  }
});
