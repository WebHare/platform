import { IPCMarshallableRecord, VariableType, determineType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import type { HSVM_VariableId, HSVM_VariableType, } from "../../../lib/harescript-interface";
import type { HarescriptVM } from "./wasm-hsvm";

export class HSVMVar {
  vm: HarescriptVM;
  id: HSVM_VariableId;
  type: VariableType | undefined;

  constructor(vm: HarescriptVM, id: HSVM_VariableId) {
    this.vm = vm;
    this.id = id;
  }

  checkType(type: VariableType) {
    this.type ??= this.vm.wasmmodule._HSVM_GetType(this.vm.hsvm, this.id);
    if (this.type !== type)
      throw new Error(`Variable doesn't have expected type ${VariableType[type]}, but got ${VariableType[this.type]}`);
  }
  getBoolean(): number {
    this.checkType(VariableType.Boolean);
    return this.vm.wasmmodule._HSVM_BooleanGet(this.vm.hsvm, this.id);
  }
  setBoolean(value: boolean) {
    this.vm.wasmmodule._HSVM_BooleanSet(this.vm.hsvm, this.id, value ? 1 : 0);
    this.type = VariableType.Boolean;
  }
  getInteger(): number {
    this.checkType(VariableType.Integer);
    return this.vm.wasmmodule._HSVM_IntegerGet(this.vm.hsvm, this.id);
  }
  setInteger(value: number) {
    this.vm.wasmmodule._HSVM_IntegerSet(this.vm.hsvm, this.id, value);
    this.type = VariableType.Integer;
  }
  getString(): string {
    this.checkType(VariableType.String);
    this.vm.wasmmodule._HSVM_StringGet(this.vm.hsvm, this.id, this.vm.wasmmodule.stringptrs, this.vm.wasmmodule.stringptrs + 4);
    const begin = this.vm.wasmmodule.getValue(this.vm.wasmmodule.stringptrs, "*") as number;
    const end = this.vm.wasmmodule.getValue(this.vm.wasmmodule.stringptrs + 4, "*") as number;
    // TODO: can we useuffer and its utf-8 decoder? strings can also contain \0
    return this.vm.wasmmodule.UTF8ToString(begin, end - begin);
  }
  setString(value: string) {
    // this.checkType(VariableType.String);
    const len = this.vm.wasmmodule.lengthBytesUTF8(value);
    const alloced = this.vm.wasmmodule._malloc(len + 1);
    this.vm.wasmmodule.stringToUTF8(value, alloced, len + 1);
    this.vm.wasmmodule._HSVM_StringSet(this.vm.hsvm, this.id, alloced, alloced + len);
    this.vm.wasmmodule._free(alloced);
    this.type = VariableType.String;
  }
  setDefault(type: VariableType): HSVMVar {
    if (type === VariableType.Array)
      throw new Error(`Illegal variable type ${VariableType[type] ?? type}`);
    this.vm.wasmmodule._HSVM_SetDefault(this.vm.hsvm, this.id, type as HSVM_VariableType);
    this.type = type;
    return this;
  }
  arrayAppend() {
    this.type ??= this.vm.wasmmodule._HSVM_GetType(this.vm.hsvm, this.id);
    if (!(this.type & 0x80))
      throw new Error(`Variable is not an ARRAY`);
    const eltid = this.vm.wasmmodule._HSVM_ArrayAppend(this.vm.hsvm, this.id);
    return new HSVMVar(this.vm, eltid);
  }
  ensureCell(name: string) {
    this.type ??= this.vm.wasmmodule._HSVM_GetType(this.vm.hsvm, this.id);
    if (this.type !== VariableType.Record)
      throw new Error(`Variable is not an RECORD`);

    const columnid = this.vm.getColumnId(name.toString());
    const newid = this.vm.wasmmodule._HSVM_RecordCreate(this.vm.hsvm, this.id, columnid);
    return new HSVMVar(this.vm, newid);
  }
  setJSValue(value: unknown) {
    this.setJSValueInternal(value, VariableType.Variant);
  }
  private setJSValueInternal(value: unknown, forcetype: VariableType): void {
    const type = determineType(value);
    if (forcetype !== VariableType.Variant && type !== forcetype)
      throw new Error(`Cannot use a ${VariableType[type]} here, a ${VariableType[forcetype]} is required`);
    switch (type) {
      case VariableType.VariantArray: break;
      case VariableType.BooleanArray: break;
      case VariableType.DateTimeArray: break;
      case VariableType.MoneyArray: break;
      case VariableType.FloatArray: break;
      case VariableType.StringArray: break;
      case VariableType.BlobArray: break;
      case VariableType.Integer64Array: break;
      case VariableType.IntegerArray: break;
      case VariableType.RecordArray: break;
      case VariableType.ObjectArray: break;

      case VariableType.Integer: {
        this.setInteger(value as number);
        return;
      } break;
      case VariableType.Boolean: {
        this.setBoolean(Boolean(value));
        return;
      } break;
      case VariableType.String: {
        this.setString(value as string);
        return;
      } break;
      case VariableType.Record: {
        const recval = value as IPCMarshallableRecord;
        if (!recval)
          this.setDefault(VariableType.Record);
        else {
          this.vm.wasmmodule._HSVM_RecordSetEmpty(this.vm.hsvm, this.id);
          for (const [key, propval] of Object.entries(recval)) {
            this.ensureCell(key).setJSValue(propval);
          }
        }
        return;
      }
    }
    if (type & VariableType.Array) {
      const itemtype = type !== VariableType.VariantArray ? type & ~VariableType.Array : VariableType.Variant;
      this.setDefault(type);
      for (const item of value as unknown[])
        this.arrayAppend().setJSValueInternal(item, itemtype);
      return;
    }
    throw new Error(`Encoding ${VariableType[type]} not supported yet`);
  }
  getJSValue(): unknown {
    const type = this.vm.wasmmodule._HSVM_GetType(this.vm.hsvm, this.id) as VariableType;
    switch (type) {
      case VariableType.VariantArray: break;
      case VariableType.BooleanArray: break;
      case VariableType.DateTimeArray: break;
      case VariableType.MoneyArray: break;
      case VariableType.FloatArray: break;
      case VariableType.StringArray: break;
      case VariableType.BlobArray: break;
      case VariableType.Integer64Array: break;
      case VariableType.IntegerArray: break;
      case VariableType.RecordArray: break;
      case VariableType.ObjectArray: break;

      case VariableType.Integer: {
        return this.vm.wasmmodule._HSVM_IntegerGet(this.vm.hsvm, this.id);
      } break;
      case VariableType.Boolean: {
        return Boolean(this.vm.wasmmodule._HSVM_BooleanGet(this.vm.hsvm, this.id));
      } break;
      case VariableType.String: {
        return this.getString();
      } break;
      case VariableType.Record: {
        if (!this.vm.wasmmodule._HSVM_RecordExists(this.vm.hsvm, this.id))
          return null;
        const cellcount = this.vm.wasmmodule._HSVM_RecordLength(this.vm.hsvm, this.id);
        const value: Record<string, unknown> = {};
        for (let pos = 0; pos < cellcount; ++pos) {
          const columnid = this.vm.wasmmodule._HSVM_RecordColumnIdAtPos(this.vm.hsvm, this.id, pos);
          const cell = this.vm.wasmmodule._HSVM_RecordGetRef(this.vm.hsvm, this.id, columnid);
          value[this.vm.getColumnName(columnid)] = (new HSVMVar(this.vm, cell)).getJSValue();
        }
        return value;
      }
      default: {
        throw new Error(`Decoding ${VariableType[type]} not supported yet`);
      }
    }
    if (type & VariableType.Array) {
      const value: unknown[] = getTypedArray(type, []);
      const eltcount = this.vm.wasmmodule._HSVM_ArrayLength(this.vm.hsvm, this.id);
      for (let i = 0; i < eltcount; ++i) {
        const elt = this.vm.wasmmodule._HSVM_ArrayGetRef(this.vm.hsvm, this.id, i);
        value.push((new HSVMVar(this.vm, elt)).getJSValue());
      }
      return value;
    }
  }
}
