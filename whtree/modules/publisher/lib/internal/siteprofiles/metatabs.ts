import { getApplyTesterForObject, type WHFSApplyTester } from "@webhare/whfs/src/applytester";
import { getType } from "@webhare/whfs/src/contenttypes";
import { openFileOrFolder } from "@webhare/whfs";
import type { ValueConstraints } from "@mod-platform/generated/schema/siteprofile";
import { mergeConstraints } from "@mod-platform/js/tollium/valueconstraints";

interface MetaTabs {
  types: Array<{
    namespace: string;
    title: string;
    members: Array<{
      name: string;
      title: string;
      constraints: ValueConstraints | null;
    }>;
  }>;
}

export async function describeMetaTabs(applytester: WHFSApplyTester): Promise<MetaTabs | null> {
  const cf = await applytester.__getCustomFields();
  const metasettings: MetaTabs = {
    types: []
  };

  for (const rule of cf.extendprops) {
    for (const extend of rule.extendproperties) {
      const overrides = extend.override ? Object.fromEntries(extend.override) : {};

      const matchtype = await getType(extend.contenttype);
      if (!matchtype?.yaml)
        continue;

      //gather the members to display
      const members = [];
      for (const member of extend.layout ?? []) { //we keep them in definition order
        const match = matchtype.members.find(_ => _.jsname === member);
        if (!match)
          continue;

        const override = overrides[member];

        members.push({
          name: member,
          title: match.title || member,
          constraints: mergeConstraints(match.constraints ?? null, override?.constraints ?? null)
        });
      }

      metasettings.types.push({
        namespace: matchtype.namespace,
        title: matchtype.title || matchtype.scopedtype || matchtype.namespace,
        members,
      });
    }
  }

  if (!metasettings.types.length)
    return null; //do not trigger any new functionality

  return metasettings;
}

export async function describeMetaTabsById(objectid: number): Promise<MetaTabs | null> {
  const applytester = await getApplyTesterForObject(await openFileOrFolder(objectid));
  return applytester ? await describeMetaTabs(applytester) : null;
}
