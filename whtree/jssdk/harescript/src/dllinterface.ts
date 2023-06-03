import { VariableType } from "@mod-system/js/internal/whmanager/hsmarshalling";

export type Ptr = number;
export type StringPtr = Ptr;
export type HSVM = number & { type: "hsvm" };
export type HSVM_VariableId = number & { type: "variableid" };
export type HSVM_VariableType = VariableType & { type: "variabletype" };
export type HSVM_ColumnId = number & { type: "columnnameid" };

export interface Module {
  _CreateHSVM(): HSVM;
  _HSVM_TestMustAbort(vm: HSVM): number;
  _HSVM_IsUnwinding(vm: HSVM): number;

  _HSVM_GetMessageList(vm: HSVM, errorstore: HSVM_VariableId, with_trace: number): number;

  _HSVM_AllocateVariable(hsvm: HSVM): HSVM_VariableId;
  _HSVM_DeallocateVariable(hsvm: HSVM, varid: HSVM_VariableId): HSVM_VariableId;
  _HSVM_CollectGarbage(hsvm: HSVM): void;
  _HSVM_MakeFunctionPtr(hsvm: HSVM, id_set: HSVM_VariableId, libraryuri: StringPtr, function_name: StringPtr, returntype: HSVM_VariableType, numargs: number, args: Ptr, errors: HSVM_VariableId): number;
  _HSVM_LoadScript(hsvm: HSVM, scriptname: StringPtr): number;
  _HSVM_ExecuteScript(hsvm: HSVM, deinitialize_when_finished: number, allow_suspension: number): number;
  _malloc(size: number): Ptr;
  _free(ptr: Ptr): void;

  stringToUTF8(str: string, outptr: Ptr, maxBytesToWrite: number): number;
  lengthBytesUTF8(str: string): number;
  stringToNewUTF8(str: string): Ptr;
  UTF8ToString(str: Ptr, maxlength?: number): string;
  getExceptionMessage(ex: unknown): string;

  getValue(ptr: number, type: string): number;
  setValue(ptr: number, value: unknown, type: string): void;

  _HSVM_OpenFunctionCall(vm: HSVM, param_count: number): void;
  _HSVM_CallParam(vm: HSVM, param: number): HSVM_VariableId;
  _HSVM_CallFunctionPtr(vm: HSVM, fptr: HSVM_VariableId, allow_macro: number): HSVM_VariableId;
  _HSVM_CallFunction(vm: HSVM, libraryuri: StringPtr, function_name: StringPtr, returntype: HSVM_VariableType, numargs: number, args: Ptr): HSVM_VariableId;
  _HSVM_CallFunctionAutoDetect(vm: HSVM, libraryuri: StringPtr, function_name: StringPtr): HSVM_VariableId;
  _HSVM_MakeFunctionPtrAutoDetect(vm: HSVM, id_set: HSVM_VariableId, libraryuri: StringPtr, function_name: StringPtr, errors: HSVM_VariableId): number;
  _HSVM_CloseFunctionCall(vm: HSVM): void;
  _HSVM_CancelFunctionCall(vm: HSVM): void;

  _HSVM_CopyFrom(vm: HSVM, dest: HSVM_VariableId, source: HSVM_VariableId): void;
  _HSVM_GetType(vm: HSVM, id: HSVM_VariableId): HSVM_VariableType;

  _HSVM_SetDefault(vm: HSVM, id: HSVM_VariableId, type: HSVM_VariableType): void;
  _HSVM_BooleanGet(vm: HSVM, id: HSVM_VariableId): number;
  _HSVM_BooleanSet(vm: HSVM, id: HSVM_VariableId, value: boolean): void;
  _HSVM_IntegerGet(vm: HSVM, id: HSVM_VariableId): number;
  _HSVM_IntegerSet(vm: HSVM, id: HSVM_VariableId, value: number): void;
  _HSVM_StringSet(hsvm: HSVM, id: HSVM_VariableId, begin: number, end: number): void;
  _HSVM_StringGet(hsvm: HSVM, id: HSVM_VariableId, begin: Ptr, end: Ptr): void;
  _HSVM_ArrayLength(vm: HSVM, id: HSVM_VariableId): number;
  _HSVM_ArrayGetRef(vm: HSVM, id: HSVM_VariableId, index: number): HSVM_VariableId;
  _HSVM_RecordLength(vm: HSVM, id: HSVM_VariableId): number;
  _HSVM_RecordGetRef(vm: HSVM, id: HSVM_VariableId, columnid: HSVM_ColumnId): HSVM_VariableId;
  _HSVM_RecordColumnIdAtPos(vm: HSVM, id: HSVM_VariableId, num: number): HSVM_ColumnId;
  _HSVM_GetColumnName(vm: HSVM, id: HSVM_ColumnId, columnname: Ptr): number;
  _HSVM_RecordExists(vm: HSVM, id: HSVM_VariableId): number;
}
