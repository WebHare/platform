import type { WHFSApplyTester } from "@webhare/whfs/src/applytester";
import { getType } from "@webhare/whfs/src/contenttypes";

interface MetaTabs {
  types: Array<{
    namespace: string;
    title: string;
    members: Array<{
      name: string;
      title: string;
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

      const matchtype = await getType(extend.contenttype);
      if (!matchtype?.yaml)
        continue;

      //gather the members to display
      const members = [];
      for (const member of extend.members ?? []) { //we keep them in definition order
        const match = matchtype.members.find(_ => _.jsname === member);
        if (!match)
          continue;

        members.push({
          name: member,
          title: match.title || member,
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
