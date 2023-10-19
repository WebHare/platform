import { ModuleDefinitionYML } from "@webhare/services/src/moduledeftypes";
import { backendConfig, getVersionInteger } from "../configuration";
import { wildcardsToRegExp } from "@webhare/std/strings";
import { getAttr } from "./xmlhelpers";

const systemservertypes = ["production", "acceptance", "test", "development"];

export const generatorTypes = ["config", "extract", "whdb", "wrd", "openapi", "extract"] as const;
export type GeneratorType = typeof generatorTypes[number];

export interface FileToUpdate {
  path: string;
  module: string; //'platform' for builtin modules
  type: GeneratorType;
  generator: (options: GenerateContext) => string | Promise<string>;
}

export interface LoadedModuleDefs {
  name: string;
  resourceBase: string;
  modXml: Document | null;
  modYml: ModuleDefinitionYML | null;
}

export interface GenerateContext {
  verbose: boolean;
  moduledefs: LoadedModuleDefs[];
}

interface WebHareVersionInfo {
  versionnum: number;
  version: string;
  dtapstage: string;
  servername: string;
  modules: string[];
}

function getMyApplicabilityInfo() {
  return {
    versionnum: getVersionInteger(),
    version: backendConfig.buildinfo.version,
    dtapstage: backendConfig.dtapstage,
    servername: backendConfig.servername,
    modules: Object.keys(backendConfig.module)
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- will soon be used
function getSemVerFromClassicVersion(oldversion: number) {
  return `${oldversion / 10000}.${oldversion % 10000 / 100}.${oldversion % 100}`;
}

function getApplicabilityError(webhareversioninfo: WebHareVersionInfo, restrictions: ReturnType<typeof readApplicableToWebHareNode>): string | null {
  /* FIXME restore semver check: if(restrictions.webhareversion && !versionSatisfiesRange(semver, restrictions.webhareversion))
  //Support versioninfo without semantic 'version' for backwards compatibility (eg. peering with old webhares)
  const semver = webhareversioninfo?.version ?? getSemVerFromClassicVersion(webhareversioninfo.versionnum);
    RETURN`WebHare version '${semver}' does not match required version '${restrictions.webhareversion}'`;
    */

  for (let mod of restrictions.ifmodules.split(';')) {
    mod = mod.trim();
    if (mod && !webhareversioninfo.modules.includes(mod))
      return `Module '${mod}' is not installed`;
  }

  if (restrictions.minservertype && systemservertypes.indexOf(restrictions.minservertype) < systemservertypes.indexOf(webhareversioninfo.dtapstage))
    return `Required minimum dtap stage: '${restrictions.minservertype}', current: '${webhareversioninfo.dtapstage}'`;
  if (restrictions.maxservertype && systemservertypes.indexOf(restrictions.maxservertype) > systemservertypes.indexOf(webhareversioninfo.dtapstage))
    return `Required maximum dtap stage: '${restrictions.maxservertype}', current: '${webhareversioninfo.dtapstage}'`;

  for (const testvar of restrictions.ifenvironset)
    if (!process.env[testvar])
      return `Required environment variable '${testvar}' not set`;

  for (const testvar of restrictions.unlessenvironset)
    if (process.env[testvar])
      return `Forbidden environment variable '${testvar}' set to '${process.env[testvar]}'`;

  if (restrictions.restrictservers.length > 0
    && !restrictions.restrictservers.some(servermask => new RegExp(wildcardsToRegExp(servermask.toUpperCase())).test(webhareversioninfo.servername)))
    return `Restricted to servers: ${restrictions.restrictservers.join(", ")}, current: ${webhareversioninfo.servername}`;

  return null;
}


function readApplicableToWebHareNode(xmlnode: Element, prefix: string) {
  return {
    webhareversion: getAttr(xmlnode, prefix + "webhareversion"),
    minservertype: getAttr(xmlnode, prefix + "minservertype"),
    maxservertype: getAttr(xmlnode, prefix + "maxservertype"),
    restrictservers: getAttr(xmlnode, prefix + "restrictservers", []),
    ifenvironset: getAttr(xmlnode, prefix + "ifenvironset"),
    unlessenvironset: getAttr(xmlnode, prefix + "unlessenvironset"),
    ifmodules: getAttr(xmlnode, prefix + "ifmodules")
  };
}

/** Returns whether a node with version/servertype/installationtype restrictions is applicable to this WebHare installation
    @param xmlnode - XML node to check
    @param prefix - Prefix to add before attribute names. Eg set to 'data-' by <meta> mailer tags
    @returns Whether the node is applicable to this WebHare installation.
*/
export function isNodeApplicableToThisWebHare(xmlnode: Element, prefix: string) {
  return getApplicabilityError(getMyApplicabilityInfo(), readApplicableToWebHareNode(xmlnode, prefix)) === null;
}
