/* FormDefinition is supposed to become like RichDocument, an advanced wrapper for what's currently stored as a compound document according to HS.
   But for now we'll just wrap a CompoundDocument to avoid coding assumptions that FormDefinition === CompoundDocument */

import type { ExportOptions } from "@webhare/services";
import { buildCompoundDocument, type CompoundDocument, type ExportedCompoundDocument } from "./compound-document";
import { getWHType } from "@webhare/std/src/quacks";
import type { ImportOptions } from "./descriptor";

export type ExportedFormDefinition = {
  __compoundform: ExportedCompoundDocument;
};

class FormDefinition {
  private static "__ $whTypeSymbol" = "FormDefinition"; //Used to identify this as a CompoundDocument in the WebHare API

  private compoundDocument: CompoundDocument;

  constructor(compoundDocument: CompoundDocument) {
    this.compoundDocument = compoundDocument;
  }

  async export(options?: ExportOptions): Promise<ExportedFormDefinition> {
    return { __compoundform: await this.compoundDocument.export(options) };
  }
}

export async function buildFormDefinition(cd: ExportedFormDefinition, options?: ImportOptions): Promise<FormDefinition> {
  return new FormDefinition(await buildCompoundDocument(cd.__compoundform, options));
}

export function isFormDefinition(value: unknown): value is FormDefinition {
  return Boolean(value && getWHType(value) === "FormDefinition");
}

export function buildFormDefinitionFromCompoundDocument(cd: CompoundDocument): FormDefinition {
  return new FormDefinition(cd);
}

export type { FormDefinition };
