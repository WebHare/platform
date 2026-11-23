import type { CSPRTDBlockStyle, CSPRTDStructure } from "@webhare/whfs/src/siteprofiles";
import { rtdListTypes } from "./richdocument";

/** Block level HTML elements. A block with one of these tags falls back to the default block style */
const blockNodes = [
  "address", "blockquote", "center", "div", "dl", "fieldset", "form", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "isindex", "menu", "ol", "p", "pre", "table", "ul",
  "dd", "dt", "frameset", "li", "tbody", "td", "tfoot", "th", "thead", "tr"
];

/** Tags that can also match a block style on the container tag alone */
const tagMatchNodes = ["h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol"];

/** Tags of lists. A class or tag match never turns a list into a non-list or vv */
const listTags: readonly string[] = rtdListTypes;

/** Find the block style an RTD type uses for a block. Mirrors LookupStyle in structuredef.whlib, which mirrors the matching in the structured editor
    @param structure - Structure of the RTD type
    @param containerTag - Tag of the block, eg 'p'
    @param className - Class name(s) of the block, eg 'normal'
    @returns The matching block style. If nothing matches, the default table style for tables and the default block style for other block elements. Null if there's no fallback either
*/
export function lookupRTDBlockStyle(structure: CSPRTDStructure, containerTag: string, className: string): CSPRTDBlockStyle | null {
  containerTag = containerTag.toLowerCase();
  const isList = listTags.includes(containerTag);
  const isTable = containerTag === "table";
  const classNames = className.toLowerCase().split(/\s+/).filter(Boolean);

  let importFromMatch: CSPRTDBlockStyle | null = null, classMatch: CSPRTDBlockStyle | null = null, tagMatch: CSPRTDBlockStyle | null = null;
  for (const blockStyle of structure.blockstyles) {
    const styleContainerTag = blockStyle.containertag.toLowerCase();

    // importfrom has the highest priority and can also turn a list into a non-list (or vv). Selectors have the form tag.class.class...
    if (!importFromMatch)
      for (const selector of blockStyle.importfrom) {
        const [selectorTag, ...selectorClasses] = selector.toLowerCase().split(".");
        if (selectorTag === containerTag && selectorClasses.every(selectorClass => classNames.includes(selectorClass)))
          importFromMatch = blockStyle;
      }

    // Match on class name, but don't change a list into a non-list or a table into a non-table (or vv)
    if (!classMatch
      && listTags.includes(styleContainerTag) === isList
      && (styleContainerTag === "table") === isTable
      && classNames.includes(blockStyle.tag.toLowerCase()))
      classMatch = blockStyle;

    // Headings and lists can also match on their tag
    if (!tagMatch && tagMatchNodes.includes(containerTag) && containerTag === styleContainerTag)
      tagMatch = blockStyle;
  }

  const match = importFromMatch ?? classMatch ?? tagMatch;
  if (match)
    return match;

  if (isTable) {
    const defaultTableStyle = structure.blockstyles.find(blockStyle => blockStyle.type === "table");
    if (defaultTableStyle)
      return defaultTableStyle;
  }
  if (blockNodes.includes(containerTag))
    return structure.blockstyles.find(blockStyle => blockStyle.tag === structure.defaultblockstyle) ?? null;
  return null;
}
