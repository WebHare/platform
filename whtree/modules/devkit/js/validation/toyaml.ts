import type { CSPApplyTo } from "@webhare/whfs/src/siteprofiles";
import type { ApplyTo } from "@mod-platform/generated/schema/siteprofile";
import { nameToCamelCase } from "@webhare/std";

export const fallbacknameTypeName = "whfstype";

function preventDoubleName(typename: string) {
  //prevent webhare_testsuite:webhare_testsuite.webdesign_dynfolder
  const match = typename.match(/^([^:]+):([^.]+)\.(.*)$/);
  if (match && match[1] === match[2])
    return match[1] + ":" + match[3];
  return typename;
}

export function suggestTypeName(module: string, scopedtype: string): string {
  const grabType = scopedtype.match(/^.*\/(xmlns|webhare)\/(.*)\/?$/);
  if (grabType) //it's a common ../xmlns/.. or less-common ../webhare/ namespace
    return preventDoubleName(module + ":" + grabType[2].replaceAll("/", '.').replaceAll("-", '_'));

  //parse any http://domain/.../
  const grabPostOriginSuffix = scopedtype.match(/^https?:\/\/[^/]+\/(.*)\/?$/);
  if (grabPostOriginSuffix)
    return preventDoubleName(module + ":" + grabPostOriginSuffix[1].replaceAll("/", '.'));

  return fallbacknameTypeName;
}

export function importApplyTo(tos: CSPApplyTo[]): ApplyTo {
  const toList = new Array<ApplyTo>;
  for (const to of tos) {
    if (to.type === "to") {
      const rule: ApplyTo = {};
      if (to.match_index)
        rule.is = "index";
      else if (to.match_file || to.filetype)
        rule.is = "file";
      else if (to.match_folder || to.foldertype)
        rule.is = "folder";

      if (to.pathmask)
        rule.sitePath = to.pathmask;
      else if (to.pathregex)
        rule.sitePath = { regex: to.pathregex };

      if (to.whfspathmask)
        rule.whfsPath = to.whfspathmask;
      else if (to.whfspathregex)
        rule.whfsPath = { regex: to.whfspathregex };

      if (to.sitename || to.sitemask)
        rule.site = to.sitename || to.sitemask;
      else if (to.siteregex)
        rule.site = { regex: to.siteregex };

      if (to.parentmask)
        rule.parentPath = to.parentmask;
      else if (to.parentregex)
        rule.parentPath = { regex: to.parentregex };

      if (to.filetype || to.foldertype)
        rule.type = to.filetype || to.foldertype;

      if (to.parenttype)
        rule.parentType = to.parenttype;

      if (to.sitetype)
        rule.siteType = to.sitetype;

      if (to.withintype)
        rule.withinType = to.withintype;

      if (to.typeneedstemplate)
        rule.hasWebDesign = true;

      if (to.match_all && Object.keys(rule).length === 0) {
        toList.push("all"); //if we're match_all and no other constraints are here yet, we just become 'to: all'
        continue;
      }

      if (to.webfeatures?.length === 1)
        rule.webFeature = to.webfeatures[0];

      toList.push(rule);
    } else if (to.type === "and" || to.type === "or") {
      const subrules = to.criteria.map(r => importApplyTo([r]));
      toList.push({ [to.type]: subrules });
    } else if (to.type === "not") {
      if (to.criteria.length !== 1)
        throw new Error("Not rules should have exactly one criteria");
      toList.push({ not: importApplyTo([to.criteria[0]]) });
    } else if (to.type === "testdata") {
      toList.push({
        testSetting: {
          member: nameToCamelCase(to.membername),
          target: to.target as "self" | "root",
          type: to.typedef,
          value: to.value
        }
      });
    } else {
      throw new Error("Unsupported apply to type " + to.type);
    }
  }

  if (toList.length === 1)
    return toList[0];
  else
    return { or: toList };
}
