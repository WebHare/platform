import { buildInstance, type Instance } from "./richdocument";
import { WebHareBlob } from "./webhareblob";
import { mapExternalWHFSRef, ResourceDescriptor, unmapExternalWHFSRef, type ExportedResource, type ExportOptions, type ImportOptions } from "./descriptor";
import type { ExportedInstance } from "@webhare/whfs/src/contenttypes";
import { getWHType } from "@webhare/std/src/quacks";

export type CompoundDocumentType = "platform:formdefinition" | "platform:markdown" | "platform:html";

export type ExportedCompoundDocument = {
  type: CompoundDocumentType;
  instances?: Record<string, ExportedInstance>;
  links?: Record<string, string>;
  embedded?: Record<string, ExportedResource>;
  text: string;
};

export class CompoundDocument {
  private static "__ $whTypeSymbol" = "CompoundDocument"; //Used to identify this as a CompoundDocument in the WebHare API

  instances = new Map<string, Instance>;
  links = new Map<string, number>();
  embedded = new Map<string, ResourceDescriptor>();

  constructor(public type: CompoundDocumentType, public text: WebHareBlob, opts?: {
    instances?: Map<string, Instance> | Record<string, Instance>;
    links?: Map<string, number> | Record<string, number>;
    embedded?: Map<string, ResourceDescriptor> | Record<string, ResourceDescriptor>;
  }) {
    if (opts?.instances)
      for (const [key, val] of opts.instances instanceof Map ? opts.instances : Object.entries(opts.instances))
        this.instances.set(key, val);

    if (opts?.links)
      for (const [key, val] of opts.links instanceof Map ? opts.links : Object.entries(opts.links))
        this.links.set(key, val);

    if (opts?.embedded)
      for (const [key, val] of opts.embedded instanceof Map ? opts.embedded : Object.entries(opts.embedded))
        this.embedded.set(key, val);
  }

  async export(options?: ExportOptions): Promise<ExportedCompoundDocument> {
    const doc: ExportedCompoundDocument = {
      type: this.type,
      text: await this.text.text(),
    };
    if (this.instances?.size)
      doc.instances = Object.fromEntries(await Promise.all(Array.from(this.instances.entries()).map(async ([key, instance]) => [key, await instance.export(options)])));
    if (this.links?.size)
      doc.links = Object.fromEntries(await Promise.all(this.links.entries().map(async ([key, val]) => [key, await mapExternalWHFSRef(val, options)])));
    if (this.embedded?.size)
      doc.embedded = Object.fromEntries(await Promise.all(this.embedded.entries().map(async ([key, val]) => [key, await val.export(options)])));

    return doc;
  }
}

export async function buildCompoundDocument(cd: ExportedCompoundDocument, options?: ImportOptions): Promise<CompoundDocument> {
  const instances = new Map<string, Instance>;
  const links = new Map<string, number>;
  const embedded = new Map<string, ResourceDescriptor>;

  if (cd.instances)
    for (const instance of Object.entries(cd.instances)) {
      instances.set(instance[0], await buildInstance(instance[1], options));
    }
  if (cd.links)
    for (const link of Object.entries(cd.links)) {
      const target = await unmapExternalWHFSRef(link[1], options);
      if (typeof target === "number")
        links.set(link[0], target);
    }
  if (cd.embedded)
    for (const [key, val] of Object.entries(cd.embedded))
      embedded.set(key, await ResourceDescriptor.import(val, options));

  return new CompoundDocument(cd.type, WebHareBlob.from(cd.text), { instances, links, embedded });
}

export function isCompoundDocument(value: unknown): value is CompoundDocument {
  return Boolean(value && getWHType(value) === "CompoundDocument");
}
