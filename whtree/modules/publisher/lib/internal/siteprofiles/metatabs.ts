import { getApplyTesterForObject, type WHFSApplyTester } from "@webhare/whfs/src/applytester";
import { getType } from "@webhare/whfs/src/contenttypes";
import { openFileOrFolder } from "@webhare/whfs";
import type { ValueConstraints } from "@mod-platform/generated/schema/siteprofile";
import { mergeConstraints, suggestTolliumComponent, type AnyTolliumComponent } from "@mod-platform/js/tollium/valueconstraints";
import { toSnakeCase, type ToSnakeCase } from "@webhare/hscompat";
import { nameToSnakeCase, toCamelCase } from "@webhare/hscompat/types";
import type { CSPApplyRule, CSPContentType, CSPMember, CSPMemberOverride } from "@webhare/whfs/src/siteprofiles";
import { isTruthy } from "@webhare/std/collections";
import { parseYamlComponent } from "./parser";

interface MetaTabs {
  types: Array<{
    namespace: string;
    title: string;
    layout?: string[];
    members: Array<{
      name: string;
      title: string;
      constraints: ValueConstraints | null;
      component: Record<string, unknown>;
    }>;
  }>;
}

type ExtendProperties = CSPApplyRule["extendproperties"][0];

function determineLayout(matchtype: CSPContentType, layout?: string[]): CSPMember[] {
  //if explicitly set, use that
  if (layout)
    return layout.map(name => matchtype.members.find(_ => _.jsname === name)).filter(isTruthy);

  return matchtype.members;
}

function toYamlComponent(comp: NonNullable<CSPMember["component"]>, constraints: ValueConstraints | null): AnyTolliumComponent {
  const props = { ...toCamelCase(comp.yamlprops), valueConstraints: constraints };
  if (comp.ns === "http://www.webhare.net/xmlns/tollium/screens")
    return { [comp.component]: props };
  else
    return { [`${comp.ns}#${comp.component}`]: props };
}

function determineComponent(constraints: ValueConstraints | null, setComponent: CSPMember["component"]): AnyTolliumComponent {
  if (setComponent)
    return toYamlComponent(setComponent, constraints ?? {});

  const suggestion = constraints && suggestTolliumComponent(constraints);
  return suggestion?.component ?? {
    text: {
      value: suggestion?.error ?? 'Unable to suggest a component',
      enabled: false
    }
  };
}

export async function describeMetaTabs(applytester: WHFSApplyTester): Promise<MetaTabs | null> {
  const cf = await applytester.__getCustomFields();

  const pertype: Record<string, ExtendProperties[]> = {};

  //First gather all rules per type in their apply order
  for (const rule of cf.extendprops)
    for (const extend of rule.extendproperties) {
      pertype[extend.contenttype] ||= [];
      pertype[extend.contenttype].push(extend);
    }

  const metasettings: MetaTabs = {
    types: []
  };

  for (const [contenttype, extendproperties] of Object.entries(pertype)) {
    const matchtype = await getType(contenttype);
    if (!matchtype?.yaml)
      continue;

    let lastlayout: string[] | undefined;
    const overrides: Record<string, CSPMemberOverride> = {};

    for (const extend of extendproperties) {
      if (extend.layout)
        lastlayout = extend.layout;
      if (extend.override)
        Object.assign(overrides, Object.fromEntries(extend.override));
    }

    //gather the members to display
    const members: MetaTabs["types"][0]["members"] = [];
    for (const member of determineLayout(matchtype, lastlayout)) {
      const override = overrides[member.jsname!]; //has to exist as we wouldn't be processing non-yaml types
      const constraints = mergeConstraints(member.constraints ?? null, override?.constraints ?? null);
      const component = override?.component ? toYamlComponent(override.component, constraints) : determineComponent(constraints, member.component); //FIXME support override

      members.push({
        name: member.jsname!,
        title: override?.title || member.title || member.jsname!,
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
        component: parseYamlComponent(member.component)
      }))
    }))
  };
  return translated;
}

export async function describeMetaTabsForHS(objectid: number): Promise<MetaTabsForHS | null> {
  const applytester = await getApplyTesterForObject(await openFileOrFolder(objectid, { allowHistoric: true }));
  if (!applytester)
    return null;

  const metatabs = await describeMetaTabs(applytester);
  if (!metatabs)
    return null;

  return remapForHs(metatabs);
}
