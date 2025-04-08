import type { FileToUpdate } from "./shared";
import { listWebServers } from "@mod-platform/js/configure/webservers";

export type CMSConfig = {
  interfaceServers: string[];
};

export async function generateCMSConfig(): Promise<string> {
  const config: CMSConfig = {
    interfaceServers: (await listWebServers()).filter(s => s.isInterface).map(s => s.baseURL)
  };
  return JSON.stringify(config) + '\n';
}

export async function listMiscTS(mods: string[]): Promise<FileToUpdate[]> {
  return [];
  // { we currently have no 'misc TS' but they're likely to reappear? keeping listMiscTS for now
  //   path: `config/public-config.json`,
  //   module: "dummy-installed",
  //   type: "ts",
  //   generator: (/*context: GenerateContext*/) => generatePublicConfig()
  // }
}


export async function listPublicConfig(): Promise<FileToUpdate[]> {
  return [
    { //FIXME unlike public-config, ensure we regenerate whenever an interface webserver changes
      path: `public/cms.json`, //public publisher/cms configuration - hosted on https://my.webhare.dev/.wh/ea/config/cms.json with a 15 second cache policy
      module: "dummy-installed",
      type: "public",
      generator: (/*context: GenerateContext*/) => generateCMSConfig()
    }
  ];
}
