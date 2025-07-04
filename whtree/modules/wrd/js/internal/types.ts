import type { MapRecordOutputMap as MapRecordOutputMap3, OutputMap, RecordOutputMap, SchemaTypeDefinition, SelectionResultRow as SelectionResultRow3, TypeDefinition, WRDAttributeType, WRDMetaType, WRDTypeBaseSettings } from "@webhare/wrd/src/types";

// Temporary exports for WH 5.7 compat

export type {
  /** @deprecated Try to avoid for now, if really necessary use \@webhare/wrd/src/types instead */
  RecordOutputMap,
  /** @deprecated Try to avoid for now, if really necessary use \@webhare/wrd/src/types instead */
  WRDAttributeType,
  /** @deprecated Try to avoid for now, if really necessary use \@webhare/wrd/src/types instead */
  WRDTypeBaseSettings,
  /** @deprecated Try to avoid for now, if really necessary use \@webhare/wrd/src/types instead */
  WRDMetaType,
  /** @deprecated Try to avoid for now, if really necessary use \@webhare/wrd/src/types instead */
  SchemaTypeDefinition,
};


/** @deprecated Try to avoid for now, if really necessary use \@webhare/wrd/src/types instead */
export type SelectionResultRow<T extends TypeDefinition, O extends OutputMap<T>> = SelectionResultRow3<T, O, false>;
/** @deprecated Try to avoid for now, if really necessary use \@webhare/wrd/src/types instead */
export type MapRecordOutputMap<T extends TypeDefinition, O extends RecordOutputMap<T>> = MapRecordOutputMap3<T, O, false>;
