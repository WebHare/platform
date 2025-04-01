import { type FileToUpdate, type GenerateContext, generatorBanner } from "./shared";
import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";
import { gatherServices } from "./gen_extracts";
import { throwError } from "@webhare/std";

function hsResourceToTsResource(path: string) {
  const hspath = path.match(/^mod::(.*)\/(.*)$/) ?? throwError("Invalid path");
  return `@mod-${hspath[1]}/${hspath[2]}`;
}

export async function generateServicesDefs(context: GenerateContext, mods: string[]): Promise<string> {
  const services = await gatherServices(context); //TODO we will be runnning this twice now in a 'wh apply' run.

  const imports: string[] = [];
  const types: string[] = [];

  for (const service of services.rpcServices) {
    const [module] = service.name.split(":");
    if (!mods.includes(module))
      continue;

    const [library, object] = service.api.split("#");

    const servicename = `${module}$${object}`;
    imports.push(`import type { ${object} as ${servicename} } from "${hsResourceToTsResource(library)}";`);
    types.push(`    ${JSON.stringify(service.name)}: typeof ${servicename};`);
  }

  return `${generatorBanner}

import type { } from "@webhare/rpc";
${imports.join("\n")}

declare module "@webhare/rpc" {
  interface KnownRPCServices {
${types.join("\n")}
  }
}
`;
}

export async function listAllServiceTS(mods: string[]): Promise<FileToUpdate[]> {
  return [
    {
      path: `ts/services.ts`,
      module: "platform",
      type: "ts-dev",
      generator: (context: GenerateContext) => generateServicesDefs(context, whconstant_builtinmodules)
    }, {

      path: `ts/services.ts`,
      module: "dummy-installed",
      type: "ts-dev",
      generator: (context: GenerateContext) => generateServicesDefs(context, mods.filter(m => !whconstant_builtinmodules.includes(m)))
    }
  ];
}
