/* Generates various extracts of moduledefinition information */

import { resolveResource } from "@webhare/services";
import { FileToUpdate, GenerateContext, isNodeApplicableToThisWebHare } from "./shared";
import { elements, getAttr } from "./xmlhelpers";
import { whconstant_default_compatibility } from "../webhareconstants";
import { addModule } from "@webhare/services/src/naming";
import { ModDefYML } from "@webhare/services/src/moduledefparser";
import { generateWebDesigns } from "./webdesigns";
import * as crypto from "node:crypto";
import { stringify } from "@webhare/std";

export interface AssetPack {
  name: string; //full name
  entryPoint: string;
  supportedLanguages: string[];
  compatibility: string;
  whPolyfills: boolean;
  environment: string;
  afterCompileTask: string;
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
  merge?: string;
  inputValidation?: OpenAPIValidationMode;
  outputValidation?: OpenAPIValidationMode;
  crossdomainOrigins?: string[];
}

export interface Services {
  backendServices: BackendServiceDescriptor[];
  openAPIServices: OpenAPIDescriptor[];
  openAPIClients: OpenAPIDescriptor[]; //no difference in types (yet)
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

export function getYMLAssetPacks(mod: string, modYml: ModDefYML): AssetPack[] {
  const packs: AssetPack[] = [];
  if (modYml.assetPacks)
    for (const [name, assetpack] of Object.entries(modYml.assetPacks)) {
      packs.push(makeAssetPack({
        name: addModule(mod, name),
        entryPoint: resolveResource(modYml.baseResourcePath, assetpack.entryPoint),
        supportedLanguages: [...new Set(assetpack.supportedLanguages)],
        compatibility: assetpack.compatibility || whconstant_default_compatibility,
        whPolyfills: assetpack.whPolyfills ?? true,
        environment: "window", //TODO can we remove this? only liveapi neeeded it for crypto shims, and browser-packagejson can fix that too
        afterCompileTask: addModule(mod, assetpack.afterCompileTask || ""),
        esBuildSettings: "", //FIXME deprecate this ? we should just let users supply a JS function to apply to the esbuild config? or both?
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

export function generateAssetPacks(context: GenerateContext): string {
  const assetpacks = new Array<AssetPack>();
  const addto = [];

  for (const mod of context.moduledefs) {
    if (mod.modXml) {
      assetpacks.push(...getXMLAssetPacks(mod.name, mod.resourceBase, mod.modXml));
      addto.push(...getXMLAddToPacks(mod.name, mod.resourceBase, mod.modXml));
    }
    if (mod.modYml) {
      assetpacks.push(...getYMLAssetPacks(mod.name, mod.modYml));
    }
  }

  for (const toadd of addto) {
    const match = assetpacks.find(_ => _.name === toadd.assetpack);
    if (match)
      match.extraRequires.push(toadd.extraRequire);
  }

  return JSON.stringify(assetpacks, null, 2) + "\n";
}

export function generateServices(context: GenerateContext): string {
  const retval: Services = {
    backendServices: [],
    openAPIServices: [],
    openAPIClients: []
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
  return JSON.stringify(retval, null, 2) + "\n";
}

export async function listAllExtracts(): Promise<FileToUpdate[]> {
  return [
    {
      path: `extract/assetpacks.json`,
      module: "platform",
      type: "extract",
      generator: (context: GenerateContext) => generateAssetPacks(context)
    },
    {
      path: `extract/webdesigns.json`,
      module: "platform",
      type: "extract",
      generator: (context: GenerateContext) => generateWebDesigns(context)
    },
    {
      path: `extract/services.json`,
      module: "platform",
      type: "extract",
      generator: (context: GenerateContext) => generateServices(context)
    }
  ];
}
