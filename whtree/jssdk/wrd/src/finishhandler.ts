import { VariableType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { emplace } from "@webhare/std";
import { type FinishHandler, broadcastOnCommit } from "@webhare/whdb";
import { finishHandlerFactory } from "@webhare/whdb/src/impl";


class WRDFinishHandler implements FinishHandler {
  linkCheckedSettings = new Set<number>;
  /// Map from wrdschema id to changeset id
  autoChangeSets = new Map<number, number>;
  typeChanges = new Map<number, {
    type: number;
    created?: Set<number>;
    updated?: Set<number>;
    deleted?: Set<number>;
    num: number;
    allinvalidated?: boolean;
  }>;
  schemaChanges = new Map<number, {
    metadata?: boolean;
    name?: boolean;
  }>;

  onBeforeCommit() {
    this.autoChangeSets.clear();

    // schedule the broadcasts to take place before the commit handlers
    for (const typeRec of this.typeChanges.values()) {
      broadcastOnCommit(`wrd:type.${typeRec.type}.change`, {
        allinvalidated: typeRec.allinvalidated || false,
        created: getTypedArray(VariableType.IntegerArray, typeRec.allinvalidated ? [] : [...typeRec.created || []].sort()),
        updated: getTypedArray(VariableType.IntegerArray, typeRec.allinvalidated ? [] : [...typeRec.updated || []].sort()),
        deleted: getTypedArray(VariableType.IntegerArray, typeRec.allinvalidated ? [] : [...typeRec.deleted || []].sort()),
      });
    }

    let anyListChange = false;
    for (const [id, changes] of this.schemaChanges) {
      if (changes.metadata)
        broadcastOnCommit(`wrd:schema.${id}.change`, { metadatachanged: true });
      if (changes.name)
        anyListChange = true;
    }
    if (anyListChange)
      broadcastOnCommit(`wrd:schema.list`);
  }

  getTypeRecord(wrdTypeId: number) {
    let typeRec = this.typeChanges.get(wrdTypeId);
    if (!typeRec) {
      typeRec = {
        type: wrdTypeId,
        num: 0,
      };
      this.typeChanges.set(wrdTypeId, typeRec);
    }
    return typeRec;
  }

  entityChange(wrdSchemaId: number, wrdTypeId: number, entityId: number, type: "created" | "updated" | "deleted") {
    const typeRec = this.getTypeRecord(wrdTypeId);
    if (typeRec.allinvalidated)
      return;

    if (++typeRec.num > 500) {
      typeRec.allinvalidated = true;
      return;
    }

    (typeRec[type] ??= new Set).add(entityId);
  }

  schemaNameChanged(wrdSchemaId: number) {
    const changes = emplace(this.schemaChanges, wrdSchemaId, { insert: () => ({}) });
    changes.metadata = true;
    changes.name = true;
  }

  entityCreated(wrdSchemaId: number, wrdTypeId: number, entityId: number): void {
    this.entityChange(wrdSchemaId, wrdTypeId, entityId, "created");
  }

  entityUpdated(wrdSchemaId: number, wrdTypeId: number, entityId: number): void {
    this.entityChange(wrdSchemaId, wrdTypeId, entityId, "updated");
  }

  entityDeleted(wrdSchemaId: number, wrdTypeId: number, entityId: number): void {
    this.entityChange(wrdSchemaId, wrdTypeId, entityId, "deleted");
  }

  addLinkCheckedSettings(settingids: number[]): void {
    for (const id of settingids)
      this.linkCheckedSettings.add(id);
  }

  getAutoChangeSet(wrdSchemaId: number): number | null {
    return this.autoChangeSets.get(wrdSchemaId) ?? null;
  }

  setAutoChangeSet(wrdSchemaId: number, changeSetId: number): void {
    this.autoChangeSets.set(wrdSchemaId, changeSetId);
  }
}

export const wrdFinishHandler = finishHandlerFactory(WRDFinishHandler);
