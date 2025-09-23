/* Generates various extracts of moduledefinition information */

import { resolveResource } from "@webhare/services";
import { type FileToUpdate, type GenerateContext, isNodeApplicableToThisWebHare, matchesThisServer } from "./shared";
import { elements, getAttr } from "./xmlhelpers";
import { whconstant_default_compatibility } from "../webhareconstants";
import { addModule } from "@webhare/services/src/naming";
import type { ModDefYML } from "@webhare/services/src/moduledefparser";
import { generateWebDesigns } from "./webdesigns";
import * as crypto from "node:crypto";
import { stringify, throwError } from "@webhare/std";
import type { Document } from "@xmldom/xmldom";
import { generateTasks } from "./gen_extract_tasks";
import { generateHooks } from "./gen_extract_hooks";
import { getAllModuleWRDSchemas } from "./gen_wrd";
import { generateUserRights } from "./gen_extract_userrights";
import { generatePlugins } from "./gen_plugins";

const DefaultMaxBodySize = 64 * 1024;
export interface AssetPack {
  name: string; //full name
  entryPoint: string;
  supportedLanguages: string[];
  compatibility: string;
  whPolyfills: boolean;
  environment: string;
  afterCompileTask: string;
  esBuildPlugins: Array<{
    plugin: string;
    pluginOptions: unknown[];
  }>;
  esBuildSettings: string;
  extraRequires: string[];
  baseCompileToken: string;
}

export interface BackendServiceDescriptor {
  name: string;
  coreService: boolean;
  clientFactory: string;
  controllerFactory: string;
}

export type OpenAPIValidationMode = ["never"] | ["always"] | Array<"test" | "development">;

export interface OpenAPIDescriptor {
  name: string;
  spec: string;
  initHook?: string;
  handlerInitHook?: string;
  merge?: string;
  inputValidation?: OpenAPIValidationMode;
  outputValidation?: OpenAPIValidationMode;
  crossdomainOrigins?: string[];
}

export interface TypedServiceDescriptor {
  name: string;
  api: string;
  filter: string;
  maxBodySize: number;
}

export interface Services {
  backendServices: BackendServiceDescriptor[];
  openAPIServices: OpenAPIDescriptor[];
  openAPIClients: OpenAPIDescriptor[]; //no difference in types (yet)
  rpcServices: TypedServiceDescriptor[];
}

export function makeAssetPack(pack: Omit<AssetPack, "baseCompileToken">): AssetPack {
  const contenthasher = crypto.createHash('md5');
  contenthasher.update(stringify(pack, { stable: true }));
  const baseCompileToken: string = contenthasher.digest("base64");

  return { ...pack, baseCompileToken };
}

function getXMLAssetPacks(mod: string, resourceBase: string, modXml: Document): AssetPack[] {
  const packs: AssetPack[] = [];

  const publisher = modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "publisher")[0];
  if (!publisher)
    return [];

  //TODO we're actually a <webdesign> parser!
  for (const webdesign of elements(publisher.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "webdesign"))) {
    if (!isNodeApplicableToThisWebHare(webdesign, ""))
      continue;

    const designname = getAttr(webdesign, "name");
    let designroot = getAttr(webdesign, "path", `mod::${mod}/webdesigns/${designname}/`);
    if (!designroot.endsWith("/"))
      designroot += "/";

    const istemplate = getAttr(webdesign, "istemplate", false);
    if (!istemplate)
      for (const assetpacknode of elements(webdesign.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "assetpack"))) {
        const assetpackname = addModule(mod, getAttr(assetpacknode, "name", designname));
        if (packs.find(_ => _.name === assetpackname)) {
          //TODO error about dupe
          continue;
        }

        packs.push(makeAssetPack({
          name: assetpackname,
          entryPoint: resolveResource(resourceBase, getAttr(assetpacknode, "entrypoint")),
          supportedLanguages: [...new Set(getAttr(assetpacknode, "supportedlanguages", []))],
          compatibility: getAttr(assetpacknode, "compatibility", whconstant_default_compatibility),
          whPolyfills: getAttr(assetpacknode, "webharepolyfills", true),
          environment: getAttr(assetpacknode, "environment", "window"),
          afterCompileTask: addModule(mod, getAttr(assetpacknode, "aftercompiletask")),
          esBuildSettings: getAttr(assetpacknode, "esbuildsettings"), //FIXME deprecate this, we should just let users supply a JS function to apply to the esbuild config
          esBuildPlugins: [],
          extraRequires: []
        }));
      }

    /* TOOD to be a webdesign parser, we also need this:

    //In a template, the siteprofile is simply a witty expression, so don't expand it
      STRING siteprofile;
      IF(istemplate)
        siteprofile:= child -> GetAttribute("siteprofile"); //no legacy support for templates
      ELSE //We used to resolve based on designroot, but that's inconsistent with how our paths normally work
        siteprofile:= this -> GetVerifyPath(child, "siteprofile", designroot);

      INSERT[name := designname
          , title := ParseXMLTidPtr(this -> respath, childgid, child, "title")
          , siteprofile := siteprofile
          , line := child -> linenum
          , col := 0
          , designroot := designroot
          , istemplate := istemplate
          , hidden := ParseXSBoolean(child -> GetAttribute("hidden"))
          ] INTO designs AT END;
    }*/
  }

  return packs;
}

export function getYMLAssetPacks(modYml: ModDefYML): AssetPack[] {
  const packs: AssetPack[] = [];
  if (modYml.assetPacks)
    for (const [name, assetpack] of Object.entries(modYml.assetPacks)) {
      if (assetpack.ifWebHare && !matchesThisServer(assetpack.ifWebHare))
        continue;

      const esBuildPlugins = [];
      for (const plugged of assetpack.esBuildPlugins || [])
        esBuildPlugins.push({
          plugin: resolveResource(modYml.baseResourcePath, plugged.plugin),
          pluginOptions: plugged.pluginOptions || []
        });

      packs.push(makeAssetPack({
        name: addModule(modYml.module, name),
        entryPoint: resolveResource(modYml.baseResourcePath, assetpack.entryPoint),
        supportedLanguages: [...new Set(assetpack.supportedLanguages)],
        compatibility: assetpack.compatibility || whconstant_default_compatibility,
        whPolyfills: assetpack.whPolyfills ?? true,
        environment: "window", //TODO can we remove this? only liveapi neeeded it for crypto shims, and browser-packagejson can fix that too
        afterCompileTask: addModule(modYml.module, assetpack.afterCompileTask || ""),
        esBuildSettings: "", //FIXME deprecate this ? we should just let users supply a JS function to apply to the esbuild config? or both?
        esBuildPlugins,
        extraRequires: []
      }));
    }

  return packs;
}

function getXMLAddToPacks(mod: string, resourceBase: string, modXml: Document) {
  const publisher = modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "publisher")[0];
  if (!publisher)
    return [];

  const addto = [];
  for (const addtoassetpack of elements(publisher.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "addtoassetpack"))) {
    if (!isNodeApplicableToThisWebHare(addtoassetpack, ""))
      continue;

    const assetpack = getAttr(addtoassetpack, "assetpack");
    const extraRequire = resolveResource(resourceBase, getAttr(addtoassetpack, "entrypoint"));
    addto.push({ assetpack, extraRequire });
  }

  return addto;
}

export async function generateAssetPacks(context: GenerateContext) {
  const assetpacks = new Array<AssetPack>();
  const addto = [];

  for (const mod of context.moduledefs) {
    if (mod.modXml) {
      assetpacks.push(...getXMLAssetPacks(mod.name, mod.resourceBase, mod.modXml));
      addto.push(...getXMLAddToPacks(mod.name, mod.resourceBase, mod.modXml));
    }
    if (mod.modYml) {
      assetpacks.push(...getYMLAssetPacks(mod.modYml));
    }
  }

  for (const toadd of addto) {
    const match = assetpacks.find(_ => _.name === toadd.assetpack);
    if (match)
      match.extraRequires.push(toadd.extraRequire);
  }

  return JSON.stringify(assetpacks, null, 2) + "\n";
}

export async function gatherServices(context: GenerateContext) {
  const retval: Services = {
    backendServices: [],
    openAPIServices: [],
    openAPIClients: [],
    rpcServices: []
  };

  for (const mod of context.moduledefs) {
    for (const [servicename, servicedef] of Object.entries(mod.modYml?.backendServices ?? [])) {
      retval.backendServices.push({
        name: `${mod.name}:${servicename}`,
        coreService: servicedef.coreService || false,
        clientFactory: resolveResource(mod.resourceBase, servicedef.clientFactory || ""),
        controllerFactory: resolveResource(mod.resourceBase, servicedef.controllerFactory || "")
      });
    }

    for (const [servicename, servicedef] of Object.entries(mod.modYml?.openApiServices ?? [])) {
      retval.openAPIServices.push({
        name: `${mod.name}:${servicename}`,
        spec: resolveResource(mod.resourceBase, servicedef.spec),
        ...(servicedef.initHook ? { initHook: resolveResource(mod.resourceBase, servicedef.initHook) } : {}),
        ...(servicedef.handlerInitHook ? { handlerInitHook: resolveResource(mod.resourceBase, servicedef.handlerInitHook) } : {}),
        merge: (servicedef.merge?.length ?? 0) > 1 ? throwError("Multiple merges not supported yet") : servicedef?.merge?.[0],
        crossdomainOrigins: servicedef.crossDomainOrigins || [],
      });
    }

    for (const [servicename, servicedef] of Object.entries(mod.modYml?.rpcServices ?? [])) {
      retval.rpcServices.push({
        name: `${mod.name}:${servicename}`,
        api: resolveResource(mod.resourceBase, servicedef.api),
        filter: resolveResource(mod.resourceBase, servicedef.filter || ''),
        maxBodySize: servicedef.maxBodySize || DefaultMaxBodySize
      });
    }

    const services = mod.modXml?.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "services")[0];
    if (!services)
      continue;

    for (const backendservice of elements(services.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "backendservice"))) {
      if (!isNodeApplicableToThisWebHare(backendservice, ""))
        continue;

      retval.backendServices.push({
        name: `${mod.name}:${getAttr(backendservice, "name")}`,
        coreService: false,
        clientFactory: resolveResource(mod.resourceBase, getAttr(backendservice, "clientfactory")),
        controllerFactory: resolveResource(mod.resourceBase, getAttr(backendservice, "controllerfactory"))
      });
    }

    for (const openapiservice of elements(services.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "openapiservice"))) {
      if (!isNodeApplicableToThisWebHare(openapiservice, ""))
        continue;

      const mergeAttr = getAttr(openapiservice, "merge");
      const inputValidation = getAttr(openapiservice, "inputvalidation", []) as null | OpenAPIValidationMode;
      const outputValidation = getAttr(openapiservice, "outputvalidation", []) as null | OpenAPIValidationMode;
      retval.openAPIServices.push({
        name: `${mod.name}:${getAttr(openapiservice, "name")}`,
        spec: resolveResource(mod.resourceBase, getAttr(openapiservice, "spec")),
        ...(mergeAttr ? { merge: resolveResource(mod.resourceBase, mergeAttr) } : {}),
        ...(inputValidation?.length ? { inputValidation: inputValidation } : {}),
        ...(outputValidation?.length ? { outputValidation: outputValidation } : {}),
        crossdomainOrigins: getAttr(openapiservice, "crossdomainorigins", []),
      });
    }

    for (const openapiclient of elements(services.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "openapiclient"))) {
      if (!isNodeApplicableToThisWebHare(openapiclient, ""))
        continue;

      retval.openAPIClients.push({
        name: `${mod.name}:${getAttr(openapiclient, "name")}`,
        spec: resolveResource(mod.resourceBase, getAttr(openapiclient, "spec")),
      });
    }
  }
  return retval;
}

export async function generateServices(context: GenerateContext): Promise<string> {
  return JSON.stringify(await gatherServices(context), null, 2) + "\n";
}

export async function generateWRDSchemas(context: GenerateContext): Promise<string> {
  return JSON.stringify(await getAllModuleWRDSchemas(context), null, 2) + "\n";
}

export async function listAllExtracts(): Promise<FileToUpdate[]> {
  return [
    {
      path: `extracts/assetpacks.json`,
      module: "platform",
      type: "extracts",
      generator: (context: GenerateContext) => generateAssetPacks(context)
    },
    {
      path: `extracts/webdesigns.json`,
      module: "platform",
      type: "extracts",
      generator: (context: GenerateContext) => generateWebDesigns(context)
    },
    {
      path: `extracts/services.json`,
      module: "platform",
      type: "extracts",
      generator: (context: GenerateContext) => generateServices(context)
    },
    {
      path: `extracts/tasks.json`,
      module: "platform",
      type: "extracts",
      generator: (context: GenerateContext) => generateTasks(context)
    },
    {
      path: `extracts/hooks.json`,
      module: "platform",
      type: "extracts",
      generator: (context: GenerateContext) => generateHooks(context)
    },
    {
      path: `extracts/wrdschemas.json`,
      module: "platform",
      type: "extracts",
      generator: (context: GenerateContext) => generateWRDSchemas(context)
    },
    {
      path: `extracts/userrights.json`,
      module: "platform",
      type: "extracts",
      generator: (context: GenerateContext) => generateUserRights(context)
    },
    {
      path: `extracts/plugins.json`,
      module: "platform",
      type: "extracts",
      generator: (context: GenerateContext) => generatePlugins(context)
    }
  ];
}
