import { getApplyTesterForObject, type WHFSApplyTester } from "@webhare/whfs/src/applytester";
import { getType } from "@webhare/whfs/src/contenttypes";
import { openFileOrFolder } from "@webhare/whfs";
import type { ValueConstraints } from "@mod-platform/generated/schema/siteprofile";
import { mergeConstraints, suggestTolliumComponent } from "@mod-platform/js/tollium/valueconstraints";

interface MetaTabs {
  types: Array<{
    namespace: string;
    title: string;
    members: Array<{
      name: string;
      title: string;
      constraints: ValueConstraints | null;
      component: Record<string, unknown>;
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
      const members: MetaTabs["types"][0]["members"] = [];
      for (const member of extend.layout ?? []) { //we keep them in definition order
        //TODO store/give warnings/errors about components we failed to add
        const match = matchtype.members.find(_ => _.jsname === member);
        if (!match)
          continue;

        const override = overrides[member];
        const constraints = mergeConstraints(match.constraints ?? null, override?.constraints ?? null);
        const suggestion = constraints && suggestTolliumComponent(constraints);
        const component = suggestion?.component ?? { text: { error: suggestion?.error ?? 'Unable to suggest a component' } };

        members.push({
          name: member,
          title: match.title || member,
          constraints,
          component
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
