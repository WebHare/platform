import { type FileToUpdate, type GenerateContext, generatorBanner } from "./shared";
import { whconstant_builtinmodules } from "@mod-system/js/internal/webhareconstants";
import { gatherServices, type TypedServiceDescriptor } from "./gen_extracts";
import { throwError } from "@webhare/std";

function hsResourceToTsResource(path: string) {
  const hspath = path.match(/^mod::(.*)\/(.*)$/) ?? throwError("Invalid path");
  return `@mod-${hspath[1]}/${hspath[2]}`;
}

export function generateServicesDefs(services: TypedServiceDescriptor[]): string {
  const imports: string[] = [];
  const types: string[] = [];

  for (const service of services) {
    const [library, object] = service.api.split("#");

    const servicename = `${service.name.replaceAll(":", "$")}`;
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

async function gatherModuleServices(context: GenerateContext) {
  return Map.groupBy((await gatherServices(context)).rpcServices, service => {
    const [module] = service.name.split(":");
    return whconstant_builtinmodules.includes(module) ? "platform" : module;
  });
}

export async function listAllServiceTS(mods: string[]): Promise<FileToUpdate[]> {
  const noncoremodules = mods.filter(m => !whconstant_builtinmodules.includes(m));
  // Share the in-flight gathering across this generation's concurrent outputs.
  let services: ReturnType<typeof gatherModuleServices> | undefined;
  async function generate(context: GenerateContext, module: string) {
    services ??= gatherModuleServices(context);
    return generateServicesDefs((await services).get(module) ?? []);
  }
  return [
    {
      path: `ts/services.ts`,
      module: "platform",
      type: "ts",
      generator: (context: GenerateContext) => generate(context, "platform")
    }, {

      path: `ts/services.ts`,
      module: "dummy-installed",
      type: "ts",
      generator: async () => `${generatorBanner}\n${noncoremodules.map(module => `import type { } from "./${module}/services";`).join("\n")}\n`
    },
    ...noncoremodules.map((module): FileToUpdate => ({
      path: `ts/${module}/services.ts`,
      module,
      type: "ts",
      generator: (context: GenerateContext) => generate(context, module)
    }))
  ];
}
