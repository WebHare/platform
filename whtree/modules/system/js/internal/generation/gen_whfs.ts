import { backendConfig, parseResourcePath } from "@webhare/services";
import { generatorBanner, type FileToUpdate, type GenerateContext } from "./shared";
import { whconstant_builtinmodules } from "../webhareconstants";
import { CSPMemberType, type CSPContentType, type CSPMember } from "@webhare/whfs/src/siteprofiles";
import { nameToSnakeCase, throwError } from "@webhare/std";
import { membertypenames } from "@webhare/whfs/src/describe";
import { codecs, type MemberType } from "@webhare/whfs/src/codecs";
import { loadlib } from "@webhare/harescript";

class WHFSCompileContext {
  private contenttypes?: Promise<CSPContentType[]>;

  private async loadContentTypes() {
    //FIXME prepare to write this to an extract, but our extract might cache database ids currently? we might need two extracts, one for the Declared situation (based on modules) and one for the Actual situation (based on database). or just cache in process
    const csp = await loadlib("mod::publisher/lib/internal/siteprofiles/compiler.whlib").getOfflineSiteProfiles();
    // console.log(csp);
    return csp.allcontenttypes as CSPContentType[];
  }

  async getContentTypes() {
    this.contenttypes ||= this.loadContentTypes();
    return await this.contenttypes;
  }
}

// TODO Integrate siteprofile compilation step with us as we need that one's data to generate the definitions here
//      or we'll always be a step behind
//

function exportMember(member: CSPMember, indent: number, structure: "getType" | "setType" | "exportType"): string {
  const mapsto: MemberType | null = membertypenames[member.type] || null;
  let type = 'never';

  if (member.children.length) {
    //construct all members between { .. }
    type = `{\n${member.children.map(child => exportMember(child, indent + 2, structure)).join("")}${" ".repeat(indent)}}`;
    //and wrap as needed
    if (structure === "setType")
      type = `Partial<${type}>`;
    if (member.type === CSPMemberType.Array)
      type = `Array<${type}>`;
    else
      type = `${type} | null`;
  } else if (mapsto) {
    type = codecs[mapsto]?.[structure] ?? codecs[mapsto]?.["getType"] ?? throwError(`Codec for member type '${mapsto}' is not providing ${structure} information`);
  }

  return " ".repeat(indent) + JSON.stringify(member.jsname || nameToSnakeCase(member.name)) + ": " + type + ";\n";
}

function getStructure(ctype: CSPContentType, type: "getType" | "setType" | "exportType"): string {
  if (!ctype.members.length)//empty
    return 'Record<never,unknown>;';

  let members = '';
  for (const member of ctype.members)
    members += exportMember(member, 8, type);

  return `{\n${members}\n};`;
}

export async function generateWHFSDefs(context: GenerateContext, mods: string[], whfscc: WHFSCompileContext): Promise<string> {
  //TODO cache it between the runs? no need to stat it per module
  // const csp = getExtractedHSConfig("siteprofiles").contentypes;
  const contenttypes = await whfscc.getContentTypes();

  let interfaces = '';

  for (const sp of contenttypes) {
    const module = parseResourcePath(sp.siteprofile)?.module;
    if (!module || !mods.includes(module))
      continue;


    interfaces += `
    // ${sp.siteprofile}${sp.line ? ` line ${sp.line}` : ''}
    ${JSON.stringify(sp.scopedtype || sp.namespace)}: {
      GetFormat: ${getStructure(sp, "getType")}
      SetFormat: ${getStructure(sp, "setType")}
      ExportFormat: ${getStructure(sp, "exportType")}
    };
`;
    // console.log(sp);
  }

  const fullfile = `${generatorBanner}
import type { } from "@webhare/whfs";
import type { Money } from "@webhare/std";
import type { IntExtLink, ResourceDescriptor, RichTextDocument } from "@webhare/services";
import type { ExportedResource } from "@webhare/services/src/descriptor";
import type { RTDBuildSource, WHFSInstance, ExportableRTD } from "@webhare/services/src/richdocument";
import type { ComposedDocument } from "@webhare/services/src/composeddocument";
import type { ExportedIntExtLink } from "@webhare/services/src/intextlink";

declare module "@webhare/whfs/src/contenttypes" {
  interface WHFSTypes {
${interfaces}
  }
} \n`;

  return fullfile;
}


export async function listAllModuleWHFSTypeDefs(): Promise<FileToUpdate[]> {
  const noncoremodules = Object.keys(backendConfig.module).filter(m => !whconstant_builtinmodules.includes(m));
  const whfsCompileContext = new WHFSCompileContext;
  return [
    {
      path: "ts/whfstypes.ts",
      module: "platform",
      type: "whfs",
      generator: (options: GenerateContext) => generateWHFSDefs(options, whconstant_builtinmodules, whfsCompileContext)
    }, ...noncoremodules.map((module: string): FileToUpdate => ({
      path: `ts/whfstypes.ts`,
      module: "dummy-installed",
      type: "whfs",
      generator: (options: GenerateContext) => generateWHFSDefs(options, noncoremodules, whfsCompileContext)
    }))
  ];
}
