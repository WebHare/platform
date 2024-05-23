import { getApplyTesterForObject, type WHFSApplyTester } from "@webhare/whfs/src/applytester";
import { getType } from "@webhare/whfs/src/contenttypes";
import { openFileOrFolder } from "@webhare/whfs";
import type { ValueConstraints } from "@mod-platform/generated/schema/siteprofile";
import { mergeConstraints, suggestTolliumComponent } from "@mod-platform/js/tollium/valueconstraints";
import { toSnakeCase, type ToSnakeCase } from "@webhare/hscompat";
import { nameToSnakeCase } from "@webhare/hscompat/types";
import type { CSPApplyRule, CSPContentType, CSPMember } from "@webhare/whfs/src/siteprofiles";
import { isTruthy } from "@webhare/std/collections";

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

type ExtendProperties = CSPApplyRule["extendproperties"][0];

function determineLayout(matchtype: CSPContentType, extend: ExtendProperties): CSPMember[] {
  //if explicitly set, use that
  if (extend.layout)
    return extend.layout.map(name => matchtype.members.find(_ => _.jsname === name)).filter(isTruthy);

  return matchtype.members;
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
      for (const member of determineLayout(matchtype, extend)) {
        const override = overrides[member.jsname!]; //has to exist as we wouldn't be processing non-yaml types
        const constraints = mergeConstraints(member.constraints ?? null, override?.constraints ?? null);
        const suggestion = constraints && suggestTolliumComponent(constraints);
        const component = suggestion?.component ?? {
          text: {
            value: suggestion?.error ?? 'Unable to suggest a component',
            enabled: false
          }
        };

        members.push({
          name: member.jsname!,
          title: member.title || member.jsname!,
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

interface MetaTabsForHS {
  types: Array<{
    namespace: string;
    title: string;
    members: Array<{
      name: string;
      title: string;
      constraints: ToSnakeCase<ValueConstraints> | null;
      component: {
        ns: string;
        component: string;
        yamlprops: unknown;
      };
    }>;
  }>;
}

export function remapForHs(metatabs: MetaTabs): MetaTabsForHS {
  const translated: MetaTabsForHS = {
    types: metatabs.types.map(type => ({
      ...type,
      members: type.members.map(member => ({
        ...member,
        name: nameToSnakeCase(member.name),
        constraints: toSnakeCase(member.constraints),
        component: {
          ns: "http://www.webhare.net/xmlns/tollium/screens",
          component: Object.keys(member.component)[0].toLowerCase(),
          yamlprops: toSnakeCase(Object.values(member.component)[0])
        }
      }))
    }))
  };
  return translated;
}

export async function describeMetaTabsForHS(objectid: number): Promise<MetaTabsForHS | null> {
  const applytester = await getApplyTesterForObject(await openFileOrFolder(objectid));
  if (!applytester)
    return null;

  const metatabs = await describeMetaTabs(applytester);
  if (!metatabs)
    return null;

  return remapForHs(metatabs);
}
