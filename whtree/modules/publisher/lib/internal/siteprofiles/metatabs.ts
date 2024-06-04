import { getApplyTesterForMockedObject, getApplyTesterForObject, type WHFSApplyTester } from "@webhare/whfs/src/applytester";
import { getType } from "@webhare/whfs/src/contenttypes";
import { openFileOrFolder, openFolder } from "@webhare/whfs";
import type { FieldLayout, ValueConstraints } from "@mod-platform/generated/schema/siteprofile";
import { mergeConstraints, suggestTolliumComponent, type AnyTolliumComponent } from "@mod-platform/js/tollium/valueconstraints";
import { toSnakeCase, type ToSnakeCase } from "@webhare/hscompat";
import { nameToSnakeCase, toCamelCase } from "@webhare/hscompat/types";
import type { CSPApplyRule, CSPContentType, CSPMember, CSPMemberOverride, CustomFieldsLayout } from "@webhare/whfs/src/siteprofiles";
import { isTruthy } from "@webhare/std/collections";
import { parseYamlComponent } from "./parser";

interface MetadataSection {
  title: string;
  fields: Array<{
    name: string;
    title: string;
    constraints: ValueConstraints | null;
    component: Record<string, unknown> & { text?: { value?: string; enabled?: boolean } }; //failed suggestions are converted to text: { value: { "Unable..."}, enabled: false}
    layout?: FieldLayout;
  }>;
}
interface MetaTabs {
  types: Array<{
    namespace: string;
    layout?: string[];
    sections: MetadataSection[];
  }>;
  /** Is this a new object (ie lives in autosave space, not original that's added to a public WHFS folder yet) */
  isNew: boolean;
}

type ExtendProperties = CSPApplyRule["extendproperties"][0];

function determineLayout(matchtype: CSPContentType, layout: CustomFieldsLayout): CSPMember[] {
  if (layout === "all")
    return matchtype.members;

  //if explicitly set, use that
  return layout.map(name => matchtype.members.find(_ => _.jsname === name)).filter(isTruthy);
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
    types: [],
    isNew: applytester.isNew()
  };

  for (const [contenttype, extendproperties] of Object.entries(pertype)) {
    const matchtype = await getType(contenttype);
    if (!matchtype?.yaml)
      continue;

    let lastlayout: CustomFieldsLayout | undefined;
    const overrides: Record<string, CSPMemberOverride> = {};

    for (const extend of extendproperties) {
      if (extend.layout)
        lastlayout = extend.layout;

      if (extend.override) //can't blindly assign, need to go through each member ...
        for (const [name, override] of extend.override) {
          if (!overrides[name]) {
            overrides[name] = structuredClone(override);
            continue; //just copy, no override yet
          }

          if (override.component) //and overwrite / merge what we see there
            overrides[name].component = override.component;
          if (override.props)
            overrides[name].props = { ...overrides[name].props, ...override.props };
          if (override.title !== undefined)
            overrides[name].title = override.title;
          if (override.constraints)
            overrides[name].constraints = overrides[name].constraints ? mergeConstraints(overrides[name].constraints!, override.constraints) : override.constraints;
        }
    }

    if (!lastlayout)
      continue; //no layout received, nothing to show

    //gather the members to display
    const mainsection: MetadataSection = {
      title: matchtype.title || matchtype.scopedtype || matchtype.namespace,
      fields: []
    };
    const addsections: MetadataSection[] = [];

    for (const member of determineLayout(matchtype, lastlayout)) {
      const override = overrides[member.jsname!]; //has to exist as we wouldn't be processing non-yaml types
      const constraints = mergeConstraints(member.constraints ?? null, override?.constraints ?? null);

      const component = determineComponent(constraints, override?.component ?? member.component);
      if (override?.props) {
        const compname: string = Object.keys(component)[0];
        component[compname] = { ...component[compname]!, ...toCamelCase(override.props) };
      }

      const fieldTitle = override?.title || member.title || (":" + member.jsname!);
      const useLayout = override?.layout || member.layout;
      let addtoSection = mainsection;

      if (useLayout === 'section') {
        addtoSection = { title: fieldTitle, fields: [] };
        addsections.push(addtoSection);
      }

      addtoSection.fields.push({
        name: member.jsname!,
        title: override?.title || member.title || (":" + member.jsname!),
        layout: useLayout,
        constraints,
        component
      });
    }

    metasettings.types.push({
      namespace: matchtype.namespace,
      sections: [...(mainsection.fields.length ? [mainsection] : []), ...addsections]
    });
  }

  if (!metasettings.types.length)
    return null; //do not trigger any new functionality

  return metasettings;
}

interface MetaTabsForHS {
  types: Array<{
    namespace: string;
    sections: Array<{
      title: string;
      fields: Array<{
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
  }>;
  is_new: boolean;
}

export function remapForHs(metatabs: MetaTabs): MetaTabsForHS {
  const translated: MetaTabsForHS = {
    types: metatabs.types.map(type => ({
      ...type,
      sections: type.sections.map(section => ({
        title: section.title,
        fields: section.fields.map(field => ({
          ...field,
          name: nameToSnakeCase(field.name),
          constraints: toSnakeCase(field.constraints),
          component: parseYamlComponent(field)! //here we only use it to convert 'component', never line(s)
        }))
      }))
    })),
    is_new: metatabs.isNew
  };
  return translated;
}

export async function describeMetaTabsForHS(obj: { objectid: number; parent: number; isfolder: boolean; type: number }): Promise<MetaTabsForHS | null> {
  const typens = getType(obj.type)?.namespace ?? '';
  try {
    const applytester = obj.objectid ? await getApplyTesterForObject(await openFileOrFolder(obj.objectid, { allowHistoric: true }))
      : await getApplyTesterForMockedObject(await openFolder(obj.parent), obj.isfolder, typens);

    const metatabs = await describeMetaTabs(applytester);
    if (!metatabs)
      return null;

    return remapForHs(metatabs);
  } catch (e) {
    if ((e as Error)?.message.startsWith('No recycle info found for'))
      return null; //Fixes system.whfs.test-whfs-history-v4 and allows versioning to ignore metatabs for now. We want to finish metatabs first and *then* worry about how versioning ties into metatabs, if at all
    throw e;
  }
}
