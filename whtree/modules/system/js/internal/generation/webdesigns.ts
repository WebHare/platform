import { resolveResource } from "@webhare/services";
import { type GenerateContext, isNodeApplicableToThisWebHare, matchesThisServer } from "./shared";
import { elements, getAttr, parseXMLTidPtr, determineNodeGid } from "./xmlhelpers";
import type { Document } from "@xmldom/xmldom";

export interface WebDesign {
  name: string;
  title: string;
  siteProfiles: string[];
  isHidden: boolean;
  isTemplate: boolean;
  path: string;
}

export interface WebFeature {
  name: string;
  title: string;
  hidden: boolean;
  siteProfile: string;
  webDesignMasks: string[];
}

export type WebDesignsExtract = {
  webDesigns: WebDesign[];
  webFeatures: WebFeature[];
  siteProfiles: string[];
  //TODO shouldn't we add assetpacks too?
};

export function getXMLAddToWebDesigns(mod: string, resourceBase: string, modXml: Document) {
  const publishernode = modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "publisher").item(0);
  if (!publishernode)
    return [];

  const toAdd = [];
  for (const node of elements(publishernode.getElementsByTagNameNS(publishernode.namespaceURI, "addtowebdesign"))) {
    if (!isNodeApplicableToThisWebHare(node, ""))
      continue;

    const siteProfile = resolveResource(resourceBase, getAttr(node, "siteprofile", ""));
    const webDesign = getAttr(node, "webdesign");
    if (siteProfile && webDesign)
      toAdd.push({ siteProfile, webDesign });
  }
  return toAdd;
}

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

export function getXMLWebDesigns(mod: string, resourceBase: string, modXml: Document): WebDesign[] {
  const publishernode = modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "publisher").item(0);
  if (!publishernode)
    return [];

  const gid = determineNodeGid(resourceBase, publishernode);
  const webDesigns = new Array<WebDesign>();
  for (const node of elements(publishernode.getElementsByTagNameNS(publishernode.namespaceURI, "webdesign"))) {
    if (!isNodeApplicableToThisWebHare(node, ""))
      continue;

    const webdesignname = getAttr(node, "name");
    let path = resolveResource(resourceBase, getAttr(node, "path", `mod::${mod}/webdesigns/${webdesignname}/`));
    if (!path.endsWith("/"))
      path += "/";

    const isTemplate = getAttr(node, "isTemplate", false);
    //don't resolve the path for templates or we'll be cloning an absolute reference
    const siteProfile = isTemplate ? getAttr(node, "siteprofile", "") : resolveResource(resourceBase, getAttr(node, "siteprofile", ""));
    webDesigns.push({
      name: `${mod}:${webdesignname}`,
      title: parseXMLTidPtr(resourceBase, gid, node, "title"),
      siteProfiles: siteProfile ? [siteProfile] : [],
      isHidden: getAttr(node, "hidden", false),
      isTemplate,
      path
    });
  }

  return webDesigns;
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
  const webDesigns = new Map<string, WebDesign>();
  const extract: WebDesignsExtract = {
    webDesigns: [],
    webFeatures: [],
    siteProfiles: []
  };

  for (const mod of context.moduledefs) {
    if (mod.modXml) {
      extract.webFeatures.push(...getXMLWebfeatures(mod.name, mod.resourceBase, mod.modXml));
      getXMLWebDesigns(mod.name, mod.resourceBase, mod.modXml).forEach(wd => webDesigns.set(wd.name, wd));
      getXMLSiteProfiles(mod.name, mod.resourceBase, mod.modXml).forEach(sp => siteProfiles.add(sp));
    }

    if (mod.modYml?.siteProfiles?.length)
      for (const sp of mod.modYml.siteProfiles) {
        if (sp.ifWebHare && !matchesThisServer(sp.ifWebHare))
          continue;
        siteProfiles.add(resolveResource(mod.resourceBase, sp.path));
      }

    for (const [name, webDesign] of Object.entries(mod.modYml?.webDesigns ?? [])) {
      if (webDesign.ifWebHare && !matchesThisServer(webDesign.ifWebHare))
        continue;

      let path = resolveResource(mod.resourceBase, webDesign.path ?? `mod::${mod.name}/webdesigns/${name}/`);
      if (!path.endsWith("/"))
        path += "/";

      const designName = `${mod.name}:${name}`;
      // don't resolve the path for templates or we'll be cloning an absolute reference
      const siteProfile = webDesign.siteProfile ? webDesign.isTemplate ? webDesign.siteProfile : resolveResource(mod.resourceBase, webDesign.siteProfile) : '';
      webDesigns.set(designName, {
        name: designName,
        title: webDesign.tid ?? (webDesign.title ? ":" + webDesign.title : ''),
        siteProfiles: siteProfile ? [siteProfile] : [],
        isHidden: webDesign.isHidden || false,
        isTemplate: webDesign.isTemplate || false,
        path
      });
    }

    for (const [featurename, featuredef] of Object.entries(mod.modYml?.webFeatures ?? [])) {
      if (featuredef.ifWebHare && !matchesThisServer(featuredef.ifWebHare))
        continue;

      extract.webFeatures.push({
        name: `${mod.name}:${featurename}`,
        title: featuredef.tid ?? (featuredef.title ? ":" + featuredef.title : ''),
        hidden: featuredef.hidden || false,
        siteProfile: featuredef.siteProfile ? resolveResource(mod.resourceBase, featuredef.siteProfile) : '',
        webDesignMasks: featuredef.webDesignMasks || []
      });
    }
  }

  for (const mod of context.moduledefs) {
    const fromXml = mod.modXml ? getXMLAddToWebDesigns(mod.name, mod.resourceBase, mod.modXml) : [];
    const fromYml = mod.modYml?.addToWebDesigns?.filter(enty => !enty.ifWebHare || matchesThisServer(enty.ifWebHare)) ?? [];
    for (const list of [fromXml, fromYml])
      for (const toAdd of list) {
        const design = webDesigns.get(toAdd.webDesign);
        if (design)
          design.siteProfiles.push(toAdd.siteProfile);
      }
  }


  extract.siteProfiles = [...siteProfiles].toSorted();
  extract.webDesigns = [...webDesigns.values()].toSorted();
  return JSON.stringify(extract, null, 2) + "\n";
}
