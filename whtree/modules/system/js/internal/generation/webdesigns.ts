import { resolveResource } from "@webhare/services";
import { type GenerateContext, isNodeApplicableToThisWebHare, matchesThisServer } from "./shared";
import { elements, getAttr, parseXMLTidPtr, determineNodeGid } from "./xmlhelpers";
import type { Document } from "@xmldom/xmldom";

export interface WebFeature {
  name: string;
  title: string;
  hidden: boolean;
  siteProfile: string;
  webDesignMasks: string[];
}

export type WebDesignsExtract = {
  webDesigns: never[];
  webFeatures: WebFeature[];
  siteProfiles: string[];
  //TODO shouldn't we add assetpacks too?
};

export function getXMLWebfeatures(mod: string, resourceBase: string, modXml: Document): WebFeature[] {
  const publishernode = modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "publisher").item(0);
  if (!publishernode)
    return [];

  const gid = determineNodeGid(resourceBase, publishernode);
  const webFeatures = new Array<WebFeature>();

  for (const node of elements(publishernode.getElementsByTagNameNS(publishernode.namespaceURI, "webfeature"))) {
    if (!isNodeApplicableToThisWebHare(node, ""))
      continue;

    const featurename = getAttr(node, "name");
    webFeatures.push({
      name: `${mod}:${featurename}`,
      title: parseXMLTidPtr(resourceBase, gid, node, "title"),
      hidden: getAttr(node, "hidden", false),
      siteProfile: resolveResource(resourceBase, getAttr(node, "siteprofile", "")),
      webDesignMasks: getAttr(node, "webdesignmasks", [])
    });
  }

  return webFeatures;
}

export function getXMLSiteProfiles(mod: string, resourceBase: string, modXml: Document): string[] {
  const publishernode = modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "publisher").item(0);
  if (!publishernode)
    return [];

  const siteProfiles = new Array<string>();

  for (const node of elements(publishernode.getElementsByTagNameNS(publishernode.namespaceURI, "siteprofile"))) {
    if (!isNodeApplicableToThisWebHare(node, ""))
      continue;

    siteProfiles.push(resolveResource(resourceBase, getAttr(node, "path")));
  }

  return siteProfiles;
}

export async function generateWebDesigns(context: GenerateContext): Promise<string> {
  const siteProfiles = new Set<string>();
  const extract: WebDesignsExtract = {
    webDesigns: [],
    webFeatures: [],
    siteProfiles: []
  };

  for (const mod of context.moduledefs) {
    if (mod.modXml) {
      extract.webFeatures.push(...getXMLWebfeatures(mod.name, mod.resourceBase, mod.modXml));
      getXMLSiteProfiles(mod.name, mod.resourceBase, mod.modXml).forEach(sp => siteProfiles.add(sp));
    }

    if (mod.modYml?.siteProfiles?.length)
      for (const sp of mod.modYml.siteProfiles) {
        if (sp.ifWebHare && !matchesThisServer(sp.ifWebHare))
          continue;
        siteProfiles.add(resolveResource(mod.resourceBase, sp.path));
      }

    for (const [featurename, featuredef] of Object.entries(mod.modYml?.webFeatures ?? [])) {
      if (featuredef.ifWebHare && !matchesThisServer(featuredef.ifWebHare))
        continue;


      extract.webFeatures.push({
        name: `${mod.name}:${featurename}`,
        title: featuredef.title ? ":" + featuredef.title : '',
        hidden: featuredef.hidden || false,
        siteProfile: featuredef.siteProfile ? resolveResource(mod.resourceBase, featuredef.siteProfile) : '',
        webDesignMasks: featuredef.webDesignMasks || []
      });
    }
  }

  extract.siteProfiles = [...siteProfiles].toSorted();
  return JSON.stringify(extract, null, 2) + "\n";
}
