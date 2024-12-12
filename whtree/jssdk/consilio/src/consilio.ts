// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/consilio" {
}

export { type CatalogListEntry } from "./types";
export { openCatalog, createCatalog, listCatalogs, type Catalog } from "./catalog";
export { isValidIndexName, isValidIndexSuffix } from "./support";
