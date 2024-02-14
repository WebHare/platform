import { resolveResource } from "@webhare/services";
import { GenerateContext, isNodeApplicableToThisWebHare } from "./shared";
import { elements, getAttr, parseXMLTidPtr, determineNodeGid } from "./xmlhelpers";


export interface Webfeature {
  name: string;
  title: string;
  hidden: boolean;
  siteProfile: string;
  webdesignMasks: string[];
}

export function getXMLWebfeatures(mod: string, resourceBase: string, modXml: Document): Webfeature[] {
  const publishernode = modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "publisher").item(0);
  if (!publishernode)
    return [];

  const gid = determineNodeGid(resourceBase, publishernode);
  const webfeatures = new Array<Webfeature>();

  for (const node of elements(publishernode.getElementsByTagNameNS(publishernode.namespaceURI, "webfeature"))) {
    if (!isNodeApplicableToThisWebHare(node, ""))
      continue;

    const featurename = getAttr(node, "name");
    webfeatures.push({
      name: `${mod}:${featurename}`,
      title: parseXMLTidPtr(resourceBase, gid, node, "title"),
      hidden: getAttr(node, "hidden", false),
      siteProfile: resolveResource(resourceBase, getAttr(node, "siteprofile", "")),
      webdesignMasks: getAttr(node, "webdesignmasks", [])
    });
  }

  return webfeatures;
}

export function generateWebDesigns(context: GenerateContext): string {
  const webdesigns: never[] = [];
  const webfeatures = new Array<Webfeature>();

  for (const mod of context.moduledefs) {
    if (mod.modXml)
      webfeatures.push(...getXMLWebfeatures(mod.name, mod.resourceBase, mod.modXml));

    for (const [featurename, featuredef] of Object.entries(mod.modYml?.webfeatures ?? [])) {
      webfeatures.push({
        name: `${mod.name}:${featurename}`,
        title: featuredef.title ? ":" + featuredef.title : '',
        hidden: featuredef.hidden || false,
        siteProfile: featuredef.siteProfile ? resolveResource(mod.resourceBase, featuredef.siteProfile) : '',
        webdesignMasks: featuredef.webdesignMasks || []
      });
    }
  }
  return JSON.stringify({ webdesigns, webfeatures }, null, 2) + "\n";
}
