import { resolveResource } from "@webhare/services";
import { type GenerateContext, isNodeApplicableToThisWebHare } from "./shared";
import { elements, getAttr, parseXMLTidPtr, determineNodeGid } from "./xmlhelpers";
import type { Document } from "@xmldom/xmldom";

export interface WebFeature {
  name: string;
  title: string;
  hidden: boolean;
  siteProfile: string;
  webDesignMasks: string[];
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

export function generateWebDesigns(context: GenerateContext): string {
  const webDesigns: never[] = [];
  const webFeatures = new Array<WebFeature>();

  for (const mod of context.moduledefs) {
    if (mod.modXml)
      webFeatures.push(...getXMLWebfeatures(mod.name, mod.resourceBase, mod.modXml));

    for (const [featurename, featuredef] of Object.entries(mod.modYml?.webFeatures ?? [])) {
      webFeatures.push({
        name: `${mod.name}:${featurename}`,
        title: featuredef.title ? ":" + featuredef.title : '',
        hidden: featuredef.hidden || false,
        siteProfile: featuredef.siteProfile ? resolveResource(mod.resourceBase, featuredef.siteProfile) : '',
        webDesignMasks: featuredef.webDesignMasks || []
      });
    }
  }
  return JSON.stringify({ webDesigns, webFeatures }, null, 2) + "\n";
}
