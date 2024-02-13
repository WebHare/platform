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

function getXMLWebfeatures(mod: string, resourceBase: string, modXml: Document): Webfeature[] {
  const webfeaturesnode = modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "webfeature").item(0);
  if (!webfeaturesnode)
    return [];

  const gid = determineNodeGid(resourceBase, webfeaturesnode);
  const webfeatures = new Array<Webfeature>();

  for (const node of elements(modXml.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "webfeature"))) {
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
  }
  return JSON.stringify({ webdesigns, webfeatures }, null, 2) + "\n";
}
