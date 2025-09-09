import type { WHFSInstance } from "./richdocument";
import type { WebHareBlob } from "./webhareblob";
import type { ResourceDescriptor } from "./descriptor";

export type ComposedDocumentType = "platform:formdefinition" | "platform:markdown" | "platform:richtextdocument";

export class ComposedDocument {
  instances = new Map<string, WHFSInstance>;
  links = new Map<string, number>();
  embedded = new Map<string, ResourceDescriptor>();

  constructor(public type: ComposedDocumentType, public text: WebHareBlob, opts?: {
    instances?: Map<string, WHFSInstance> | Record<string, WHFSInstance>;
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
}
