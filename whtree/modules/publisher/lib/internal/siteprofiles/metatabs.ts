import { getApplyTesterForMockedObject, getApplyTesterForObject, type WHFSApplyTester } from "@webhare/whfs/src/applytester";
import { getType } from "@webhare/whfs/src/describe";
import { openFileOrFolder, openFolder } from "@webhare/whfs";
import type { FieldLayout, ValueConstraints } from "@mod-platform/generated/schema/siteprofile";
import { mergeConstraints, suggestTolliumComponent, type AnyTolliumComponent } from "@mod-platform/js/tollium/valueconstraints";
import { toCamelCase, toSnakeCase, type ToSnakeCase, nameToSnakeCase } from "@webhare/std";
import type { CSPApplyRule, CSPContentType, CSPMember, CSPMemberOverride, CustomFieldsLayout } from "@webhare/whfs/src/siteprofiles";
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

const hsinfo = Symbol("hsinfo");

interface MetaTabs {
  types: Array<{
    namespace: string;
    layout?: string[];
    sections: MetadataSection[];
  }>;
  /** Issues - for now simply strings */
  issues: string[];
}

interface MetaTabsWithHSInfo extends MetaTabs {
  //harescript info, used for HS metadata only
  [hsinfo]: unknown;
}


type ExtendProperties = CSPApplyRule["extendproperties"][0];

/** Calculate the tabs to render for this YAML SP layout: */
function determineLayout(matchtype: CSPContentType, layout: CustomFieldsLayout): Array<{
  title: string;
  members: CSPMember[];
}> {
  if (layout === "all")
    return [
      {
        title: "",
        members: matchtype.members || []
      }
    ];

  const inTabs = Array.isArray(layout) ? [{ title: "", layout }] : layout.tabs;

  const outtabs = [];
  const seen = new Set<string>;
  for (const tab of inTabs) {
    const outmembers = [];
    for (const field of tab.layout) {
      if (seen.has(field))
        continue; //eliminate duplicates

      seen.add(field);
      const member = matchtype.members?.find(_ => _.jsname === field);
      if (!member)
        continue; //skip if not found

      outmembers.push(member);
    }
    if (outmembers.length)
      outtabs.push({ title: tab.title, members: outmembers });
  }

  return outtabs;
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

/** @param options.requireWorkflow - only return tabs that support workflow (ie: we are the document editor */
export async function describeMetaTabs(applytester: WHFSApplyTester, options?: { requireWorkflow?: boolean }): Promise<MetaTabs> {
  const cf = await applytester.__getCustomFields();
  const pertype: Record<string, ExtendProperties[]> = {};

  //First gather all rules per type in their apply order
  for (const rule of cf.extendprops)
    for (const extend of rule.extendproperties) {
      pertype[extend.contenttype] ||= [];
      pertype[extend.contenttype].push(extend);
    }

  const metasettings: MetaTabsWithHSInfo = {
    types: [],
    [hsinfo]: applytester.__getHSInfo(),
    issues: []
  };

  for (const [contenttype, extendproperties] of Object.entries(pertype)) {
    const matchtype = getType(contenttype);
    if (!matchtype) {
      metasettings.issues.push(`No such type ${contenttype}`);
      continue;
    }
    if (!matchtype?.yaml) {
      metasettings.issues.push(`Type ${contenttype} must be defined by a YAML siteprofile`);
      continue;
    }
    if (options?.requireWorkflow && !matchtype.workflow) {
      metasettings.issues.push(`Type ${contenttype} is not defined for workflow, but this context requires workflow`);
      continue;
    }

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

    if (!lastlayout) {
      metasettings.issues.push(`Type ${contenttype} has no layout applied`);
      continue; //no layout received, nothing to show
    }

    //gather the members to display
    const sections: MetadataSection[] = [];

    for (const tab of determineLayout(matchtype, lastlayout)) { //for every tab in the layout
      const section: MetadataSection = { //prepare the section. we may still discard this tab if all fields are layout: section
        title: tab.title || matchtype.title || matchtype.scopedtype || matchtype.namespace,
        fields: []
      };
      sections.push(section);

      for (const member of tab.members) { // for every member in the tab
        const override = overrides[member.jsname!]; //has to exist as we wouldn't be processing non-yaml types
        const constraints = mergeConstraints(member.constraints ?? null, override?.constraints ?? null);

        const component = determineComponent(constraints, override?.component ?? member.component);
        if (override?.props) {
          const compname: string = Object.keys(component)[0];
          component[compname] = { ...component[compname]!, ...toCamelCase(override.props) };
        }

        const fieldTitle = override?.title || member.title || (":" + member.jsname!);
        const useLayout = override?.layout || member.layout;

        let addtoSection = section; //to which section we'll add (either 'section' or a separate tab)
        if (useLayout === 'section') {
          addtoSection = { title: fieldTitle, fields: [] };
          sections.push(addtoSection);
        }

        addtoSection.fields.push({
          name: member.jsname!,
          title: override?.title || member.title || (":" + member.jsname!),
          layout: useLayout,
          constraints,
          component
        });
      }
    }

    metasettings.types.push({
      namespace: matchtype.namespace,
      sections: sections.filter(section => section.fields.length > 0),
    });
  }

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
  __hsinfo: unknown;
  issues: string[];
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
    __hsinfo: (metatabs as MetaTabsWithHSInfo)[hsinfo],
    issues: metatabs.issues
  };
  return translated;
}

export async function describeMetaTabsForHS(obj: { objectid: number; parent: number; isfolder: boolean; type: number; requireworkflow: boolean }): Promise<MetaTabsForHS | null> {
  try {
    let applytester;
    if (obj.objectid) {
      applytester = await getApplyTesterForObject(await openFileOrFolder(obj.objectid, { allowHistoric: true }));
    } else {
      const typens = getType(obj.type, obj.isfolder ? "folderType" : "fileType")?.namespace ?? '';
      applytester = await getApplyTesterForMockedObject(await openFolder(obj.parent, { allowRoot: true }), obj.isfolder, typens);
    }

    const metatabs = await describeMetaTabs(applytester, { requireWorkflow: obj.requireworkflow });
    return remapForHs(metatabs);
  } catch (e) {
    if ((e as Error)?.message.startsWith('No recycle info found for'))
      return null; //Fixes system.whfs.test-whfs-history-v4 and allows versioning to ignore metatabs for now. We want to finish metatabs first and *then* worry about how versioning ties into metatabs, if at all
    throw e;
  }
}
