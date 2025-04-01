import { generatorBanner, type FileToUpdate } from "./shared";
import { listWebServers } from "@mod-platform/js/configure/webservers";


export async function generatePublicConfig(): Promise<string> {
  const interfaceServers = await listWebServers();
  return `${generatorBanner}

export const interfaceServers = ${JSON.stringify(interfaceServers.filter(s => s.isInterface).map(s => s.baseURL))};
`;
}

export async function listMiscTS(mods: string[]): Promise<FileToUpdate[]> {
  return [
    { //FIXME unlike public-config, ensure we regenerate whenever an interface webserver changes
      path: `ts/public-config.ts`, //included by all non builtin assetpacks
      module: "dummy-installed",
      type: "ts",
      generator: (/*context: GenerateContext*/) => generatePublicConfig()
    }
  ];
}
