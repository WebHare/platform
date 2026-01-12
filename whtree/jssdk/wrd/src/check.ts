
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { WRDSchema } from "@webhare/wrd";
import { db } from "@webhare/whdb";

export type WRDIssue = {
  message: string;
};

function addFullTags<T extends { tag: string; id: number; parent: number | null }>(attrs: T[]) {
  return attrs.map(attr => {
    let fullTag = "";
    //FIXME loop protection
    for (let useAttr: typeof attr | undefined = attr; useAttr; useAttr = attrs.find(a => a.id === useAttr!.parent)) {
      fullTag = useAttr.tag + (fullTag ? "." + fullTag : "");
    }
    return { ...attr, fullTag };
  });
}

/** Test the consistency of a WRD schema and pinpoint reference defects
*/
export async function checkWRDSchema(tag: string, onIssue: (issue: WRDIssue) => void, options?: { metadataOnly: boolean }): Promise<void> {
  const schema = new WRDSchema(tag);
  const schemaId = await schema.getId();

  // List raw types (schema.listTypes gives too little info)
  const types = await db<PlatformDB>().selectFrom("wrd.types").selectAll().
    where("wrd_schema", "=", schemaId).execute();

  /// Check entity-types
  for (const type of types) {
    for (const prop of ["requiretype_left", "requiretype_right", "parenttype"] as const) {
      if (type[prop] && !types.find(t => t.id === type[prop])) {
        onIssue({ message: `WRD type ${type.title} refers to type #${type[prop]} in its ${prop} field which is not in the same schema` });
      }
    }
  }

  const attrs = addFullTags(await db<PlatformDB>().selectFrom("wrd.attrs").selectAll().
    where("type", "in", types.map(_ => _.id)).execute());

  for (const attr of attrs) {
    if (attr.domain && !types.find(t => t.id === attr.domain)) {
      onIssue({ message: `WRD type ${attr.title} refers to type #${attr.domain} in its domain field which is not in the same schema` });
    }
  }
  //Verify against duplicate attributes (TODO also detect collisions against built-in attributes, we may be able to make better use of existing WRD APIs if we're sure those won't hide issues)
  for (const checkingType of types) {
    const seenTags = new Map<string, typeof attrs[0]>();
    const attrIds: number[] = [];
    const parents = [];

    for (let currentAncestor: typeof checkingType | undefined = checkingType; currentAncestor; currentAncestor = types.find(t => t.id === currentAncestor.parenttype)) {
      if (parents.indexOf(currentAncestor) >= 0) {
        onIssue({ message: `WRD type ${checkingType.title} has a circular parenttype reference` });
        break;
      }
      parents.push(currentAncestor);

      for (const attr of attrs.filter(_ => _.type === currentAncestor!.id)) {
        attrIds.push(attr.id);

        const conflict = seenTags.get(attr.fullTag);
        if (!conflict) {
          seenTags.set(attr.fullTag, attr);
          continue;
        }

        if (conflict.type === currentAncestor.id) {
          onIssue({ message: `WRD type ${checkingType.tag} has internal duplicate attribute ${attr.fullTag} - attr #${attr.id} conflicts with attr #${conflict.id}` });
        } else {
          onIssue({ message: `WRD type ${checkingType.tag} has inherited duplicate attribute ${attr.fullTag} from ancestor ${currentAncestor.tag} - attr #${conflict.id} conflicts with inherited attr #${attr.id}` });
        }
      }
    }

    if (!options?.metadataOnly && attrIds.length) { //also validate all entities of this type that their attributes are valid
      const brokenSettings = await db<PlatformDB>().
        selectFrom("wrd.entity_settings")
        .select(["wrd.entity_settings.id", "wrd.entity_settings.entity", "wrd.entity_settings.attribute"])
        .where("wrd.entity_settings.attribute", "not in", attrIds)
        .leftJoin("wrd.entities", "wrd.entities.id", "wrd.entity_settings.entity")
        .where("wrd.entities.type", "=", checkingType.id)
        .execute();
      for (const setting of brokenSettings)
        onIssue({ message: `WRD type ${checkingType.tag} has entity setting #${setting.id} for entity #${setting.entity} that refers to invalid attribute #${setting.attribute}` });
    }
  }

  if (options?.metadataOnly)
    return;

  //TODO type-check entity references - leftentity/rightentity according to requiretype_left/requiretype_right and setting according to domain

  const entities = await db<PlatformDB>().selectFrom("wrd.entities").select(["id", "leftentity", "rightentity", "type"]).execute();
  const validEntities = new Set(entities.map(_ => _.id));
  for (const ent of entities) {
    if (ent.leftentity && !validEntities.has(ent.leftentity)) {
      onIssue({ message: `Entity #${ent.id} of type ${ent.type} refers to entity #${ent.leftentity} in its leftentity field which is not in the same schema` });
    }
    if (ent.rightentity && !validEntities.has(ent.rightentity)) {
      onIssue({ message: `Entity #${ent.id} of type ${ent.type} refers to entity #${ent.rightentity} in its rightentity field which is not in the same schema` });
    }
  }

  //Find entity settings pointing outside the schema
  for (const attr of attrs.filter(_ => _.domain !== null)) {
    //One query per attribute to cut back on DB/memory usage
    const settings = await db<PlatformDB>().
      selectFrom("wrd.entity_settings")
      .select(["id", "entity", "attribute", "setting"])
      .where("attribute", "=", attr.id)
      .execute();

    for (const setting of settings) {
      if (setting.setting && !validEntities.has(setting.setting)) {
        onIssue({ message: `Setting #${setting.id} of attribute ${setting.attribute} refers to entity #${setting.setting} which is not in the same schema` });
      }
    }
  }
}
