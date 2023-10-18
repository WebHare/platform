import { ModuleDefinitionYML } from "@webhare/services/src/moduledeftypes";

export interface FileToUpdate {
  path: string;
  module: string; //'platform' for builtin modules
  type: string;
  generator: (options: GenerateContext) => string | Promise<string>;
}

export interface LoadedModuleDefs {
  name: string;
  resourceBase: string;
  modXml: Document | null;
  modYml: ModuleDefinitionYML | null;
}

export interface GenerateContext {
  verbose: boolean;
  moduledefs: LoadedModuleDefs[];
}

export function elements<T extends Element>(collection: HTMLCollectionOf<T>): T[] {
  const items: T[] = [];
  for (let i = 0; i < collection.length; ++i)
    items.push(collection[i]);
  return items;
}
