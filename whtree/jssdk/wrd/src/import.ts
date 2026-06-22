import { TrackedYAML } from "@mod-platform/js/devsupport/validation";
import type { AnyWRDSchema } from "./schema";
import { WRDSchemaType } from "@webhare/wrd/src/schema";

/* Future schema plans/ideas (for which we are reserving room in the structure)

   - Future compatiblility with full WRD Schema descriptions. Would add eg. 'import' and 'migrations' keys next to 'types' keys
   - Creating types, setting attributes as well as entities. Would extend ImportGroup with more keys than just 'entities'
   - Perhaps adding a way to do partial imports, useful for CI? an 'if' statement per ImportGroup, similar to applicability?
     that would also make having multiple 'attributes' keys under a type useful, so that the option to put attributes into groups
     just like entities makes a bit moe sense
   - Configurable historyMode for upsert
   - Using the entity names for cross references during insert

   TODO Also consider whether this is the place for bulk cleanup/deletion (HareScript CleanupWRDSchema)
*/

type WRDSchemaImport = {
  /** Types to create/update (both metadata and entities) */
  types?: EntityImportDefinition;
};

type EntityImportDefinition = Record<string, ImportGroup | ImportGroup[]>;

/** Import instruction for a type */
type ImportGroup = {
  /** Defaults to apply to all entities in this importgroup */
  defaults?: Partial<ImportEntity>;
  keys: string[];
  /** set these keys only when creating a new entity, not when updating */
  ifNew: string[];
  /** entities to import */
  entities: Record<string, ImportEntity> | ImportEntity[];
};
type ImportEntity = {
  [key: string]: unknown;
  /** wrdGuid - preferred upsert key if no keys are explicitly set  */
  wrdGuid?: string;
  /** wrdTag - preferred upsert key if no keys are explicitly set and wrdGuid is not set for this entity */
  wrdTag?: string;
};

export type ImportEntitiesResult = {
  byType: Record<string, number[]>;
  byName: Record<string, number>;
};

/** Import multiple entities into a WRDSchema (similar to HareScript WRDSchema::SetupEntities)
 * @param wrdSchema - The WRDSchema to import into
 * @param yamlContent - The YAML content to import, structured as a mapping of type name to an array of entities, eg:
*/
export async function importIntoWRDSchema(wrdSchema: AnyWRDSchema, yamlContent: string): Promise<ImportEntitiesResult> {
  //Accepting straight YAML might simplify error reporing in the future (we have a chance to give source line numbers.
  //Would be nice to also accept straight objects
  const content = new TrackedYAML<WRDSchemaImport>(yamlContent);
  if (content.anyErrors()) {
    throw new Error("Invalid YAML: " + content.getMessages("input").map(m => m.message).join("; "));
  }

  if (typeof content.doc !== "object" || content.doc === null || Array.isArray(content.doc))
    throw new Error("Expected top-level YAML document to be an object");

  const retval: ImportEntitiesResult = {
    byType: {},
    byName: {}
  };

  for (const [type, importGroups] of Object.entries(content.doc.types ?? {})) {
    retval.byType[type] = [];

    for (const importGroup of Array.isArray(importGroups) ? importGroups : [importGroups]) {
      const entities: Array<[string, ImportEntity]> = Array.isArray(importGroup.entities) ? importGroup.entities.map(entity => ["", entity]) : Object.entries(importGroup.entities);

      for (const [name, ent] of entities) {
        const finalEnt = { ...importGroup.defaults, ...ent };
        let id: number;

        // When the entity contains either wrdGuid or wrdTag, we treat it as an upsert by default
        if (importGroup.keys || "wrdGuid" in finalEnt || "wrdTag" in finalEnt) {
          //Extract 'ifNew' keys
          const ifNew: Partial<typeof finalEnt> = {};

          if (importGroup.ifNew) //split up finalEnt and ifNew
            for (const key of importGroup.ifNew) {
              if (key in finalEnt) {
                ifNew[key] = finalEnt[key];
                delete finalEnt[key];
              }
            }

          //Build upsert key
          const upsertKey: Partial<typeof finalEnt> = {};
          if (importGroup.keys) {
            for (const key of importGroup.keys) {
              if (!(key in finalEnt))
                throw new Error(`Missing upsert key ${key} for entity ${name} of type ${type}`);
              upsertKey[key] = finalEnt[key];
            }
          } else if ("wrdGuid" in finalEnt) {
            upsertKey["wrdGuid"] = finalEnt.wrdGuid;
          } else {
            upsertKey["wrdTag"] = finalEnt.wrdTag;
          }
          [id] = await wrdSchema.upsert(type, upsertKey, finalEnt, { ifNew, historyMode: "all" });
        } else {
          //Plain insert, no deduplication
          id = await wrdSchema.insert(type, finalEnt);
        }

        retval.byType[type].push(id);
        if (name)
          retval.byName[name] = id;
      }
    }
  }
  return retval;
}

export async function importIntoWRDSchemaForHS(wrdSchema: string, yamlContent: string): Promise<ImportEntitiesResult> {
  return await importIntoWRDSchema(new WRDSchemaType(wrdSchema), yamlContent);
}
