import { BoxedDefaultBlob, BoxedFloat, IPCMarshallableRecord, VariableType, WebHareBlob, determineType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import type { HSVM_VariableId, HSVM_VariableType, } from "../../../lib/harescript-interface";
import type { HarescriptVM } from "./wasm-hsvm";
import { maxDateTime, maxDateTimeTotalMsecs } from "@webhare/hscompat/datetime";
import { Money } from "@webhare/std";
import { WHDBBlob } from "@webhare/whdb";
import { WHDBBlobImplementation, buildBlobFromPGPath } from "@webhare/whdb/src/blobs";
import { isWHDBBlob } from "@webhare/whdb/src/blobs";

function canCastTo(from: VariableType, to: VariableType): boolean {
  if (from === to)
    return true;
  if (from === VariableType.Integer && to === VariableType.Integer64)
    return true;
  return false;
}

//TODO WeakRefs so the HarescriptVM can be garbage collected ? We should also consider moving the GlobalBlobStorage to JavaScript so we don't need to keep the HSVMs around
class HSVMBlob implements WebHareBlob {
  readonly vm: HarescriptVM;
  openblob: number;
  readonly size: number;

  constructor(vm: HarescriptVM, openblob: number, size: number) {
    this.vm = vm;
    this.openblob = openblob;
    this.size = size;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const buffer = this.vm.wasmmodule._malloc(this.size);
    try {
      const numread = Number(this.vm.wasmmodule._HSVM_BlobDirectRead(this.vm.hsvm, this.openblob, 0n, this.size, buffer));
      if (numread !== this.size)
        throw new Error(`Failed to read blob, got ${numread} of ${this.size} bytes`);

      const data = this.vm.wasmmodule.HEAP8.slice(buffer, buffer + this.size);
      return new Int8Array(data);
    } finally {
      this.vm.wasmmodule._free(buffer);
    }
  }

  async text(): Promise<string> {
    return new TextDecoder("utf8").decode(await this.arrayBuffer());
  }

  isSameBlob(rhs: WebHareBlob): boolean {
    return false; //TODO? but we don't really care as there is currently no useful optimization
  }

  //You should close a HSVMBlob when you're done with it so the HSVM can garbage collect it (FIXME also use a FinalizerRegistry!)
  close() {
    if (this.openblob)
      this.vm.wasmmodule._HSVM_BlobClose(this.vm.hsvm, this.openblob);

    this.openblob = 0;
  }
}


export class HSVMVar {
  vm: HarescriptVM;
  id: HSVM_VariableId;
  private type: VariableType | undefined;

  constructor(vm: HarescriptVM, id: HSVM_VariableId) {
    this.vm = vm;
    this.id = id;
  }

  getType() {
    this.type ??= this.vm.wasmmodule._HSVM_GetType(this.vm.hsvm, this.id);
    return this.type;
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
  getInteger64(): bigint {
    this.checkType(VariableType.Integer64);
    return this.vm.wasmmodule._HSVM_Integer64Get(this.vm.hsvm, this.id);
  }
  setInteger64(value: number | bigint) {
    if (typeof value === "number")
      value = BigInt(value);
    this.vm.wasmmodule._HSVM_Integer64Set(this.vm.hsvm, this.id, value);
    this.type = VariableType.Integer64;
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
  getDateTime(): Date {
    this.checkType(VariableType.DateTime);
    this.vm.wasmmodule._HSVM_DateTimeGet(this.vm.hsvm, this.id, this.vm.wasmmodule.stringptrs, this.vm.wasmmodule.stringptrs + 4);
    const days_raw = this.vm.wasmmodule.getValue(this.vm.wasmmodule.stringptrs, "i32") as number;
    const msecs = this.vm.wasmmodule.getValue(this.vm.wasmmodule.stringptrs + 4, "i32") as number;
    const days = days_raw - 719163;
    const totalmsecs = days * 86400000 + msecs;
    if (totalmsecs >= maxDateTimeTotalMsecs)
      return maxDateTime;
    return new Date(totalmsecs);
  }
  setDateTime(value: Date) {
    const totalmsecs = Number(value as Date);
    let days, msecs;
    if (totalmsecs >= maxDateTimeTotalMsecs) {
      days = 2147483647;
      msecs = 86400000 - 1;
    } else {
      days = Math.floor(totalmsecs / 86400000);
      msecs = totalmsecs - days * 86400000;
      days += 719163; // 1970-1-1
      if (days < 0 || msecs < 0) {
        days = 0;
        msecs = 0;
      }
    }
    this.vm.wasmmodule._HSVM_DateTimeSet(this.vm.hsvm, this.id, days, msecs);
    this.type = VariableType.DateTime;
  }
  getMoney() {
    this.checkType(VariableType.HSMoney);
    const nrvalue = this.vm.wasmmodule._HSVM_MoneyGet(this.vm.hsvm, this.id);
    const strval = nrvalue.toString().padStart(6, "0");
    return new Money(`${strval.substring(0, strval.length - 5)}.${strval.substring(strval.length - 5)}`);
  }
  setMoney(value: Money) {
    const strval = value.toString();
    const parts = (strval + ".").split(".");
    parts[1] = parts[1].padEnd(5, "0");
    this.vm.wasmmodule._HSVM_MoneySet(this.vm.hsvm, this.id, BigInt(`${parts[0]}${parts[1]}`));
  }
  getFloat() {
    this.checkType(VariableType.Float);
    return new BoxedFloat(this.vm.wasmmodule._HSVM_FloatGet(this.vm.hsvm, this.id));
  }
  setFloat(value: number | BoxedFloat) {
    if (typeof value === "object")
      this.vm.wasmmodule._HSVM_FloatSet(this.vm.hsvm, this.id, value.value);
    else
      this.vm.wasmmodule._HSVM_FloatSet(this.vm.hsvm, this.id, value);
  }
  getBlob(): WebHareBlob {
    this.checkType(VariableType.Blob);
    const size = Number(this.vm.wasmmodule._HSVM_BlobLength(this.vm.hsvm, this.id));
    if (size === 0)
      return new BoxedDefaultBlob;

    const blobinfobuffer = this.vm.wasmmodule._malloc(1024);
    let openblob = this.vm.wasmmodule._HSVM_BlobOpen(this.vm.hsvm, this.id);
    const numbytes = this.vm.wasmmodule._HSVM_BlobDescription(this.vm.hsvm, openblob, blobinfobuffer, 1024); //returns written size

    try {
      if (numbytes >= 1024)
        throw new Error(`Buffer too small to read blob info`);

      const blobinfo = this.vm.wasmmodule.UTF8ToString(blobinfobuffer, numbytes);
      const matchdiskblob = blobinfo.match(/^DiskBlob \((.*)\)$/);
      if (matchdiskblob) {
        const trypgblob = buildBlobFromPGPath(matchdiskblob[1], size);
        if (trypgblob)
          return trypgblob;
      }

      if (blobinfo.startsWith("local blob")) {
        //TODO we might not need a wrapper around HSVM_BlobRead (with all the issue if the blobs outlive the HSVM!) if we can reach directly into the backing blob storage ?
        const blob = new HSVMBlob(this.vm, openblob, size);
        openblob = 0;
        return blob;
      }

      throw new Error(`Implement building a wrapper to read blob: ${blobinfo}`);
    } finally {
      this.vm.wasmmodule._free(blobinfobuffer);
      if (openblob)
        this.vm.wasmmodule._HSVM_BlobClose(this.vm.hsvm, openblob);
    }
  }
  setBlob(value: WHDBBlob | BoxedDefaultBlob | null) {
    if (typeof value === "object" && isWHDBBlob(value) && value.size) {
      const fullpath = (value as WHDBBlobImplementation).__getDiskPathinfo().fullpath;
      const fullpath_cstr = this.vm.wasmmodule.stringToNewUTF8(fullpath);
      this.vm.wasmmodule._HSVM_MakeBlobFromDiskPath(this.vm.hsvm, this.id, fullpath_cstr, BigInt(value.size));
      this.vm.wasmmodule._free(fullpath_cstr);
      this.type = VariableType.Blob;
    } else
      this.setDefault(VariableType.Blob);
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
  arrayGetRef(index: number) {
    const eltid = this.vm.wasmmodule._HSVM_ArrayGetRef(this.vm.hsvm, this.id, index);
    return eltid ? new HSVMVar(this.vm, eltid) : null;
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
    let type = determineType(value);
    if (forcetype !== VariableType.Variant) {
      if (!canCastTo(type, forcetype))
        throw new Error(`Cannot use a ${VariableType[type]} here, a ${VariableType[forcetype]} is required`);
      type = forcetype;
    }

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
      case VariableType.Integer64: {
        this.setInteger64(value as number | bigint);
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
      case VariableType.DateTime: {
        this.setDateTime(value as Date);
        return;
      } break;
      case VariableType.HSMoney: {
        this.setMoney(value as Money);
        return;
      } break;
      case VariableType.Float: {
        this.setFloat(value as number | BoxedFloat);
        return;
      } break;
      case VariableType.Blob: {
        this.setBlob(value as WHDBBlob | BoxedDefaultBlob | null);
        return;
      } break;
      case VariableType.Record: {
        const recval = value as IPCMarshallableRecord;
        if (!recval)
          this.setDefault(VariableType.Record);
        else {
          this.vm.wasmmodule._HSVM_RecordSetEmpty(this.vm.hsvm, this.id);
          this.type = VariableType.Record;
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
      for (const item of value as unknown[]) {
        this.arrayAppend().setJSValueInternal(item, itemtype);
      }
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
      }
      case VariableType.Integer64: {
        return this.vm.wasmmodule._HSVM_Integer64Get(this.vm.hsvm, this.id);
      }
      case VariableType.Boolean: {
        return Boolean(this.vm.wasmmodule._HSVM_BooleanGet(this.vm.hsvm, this.id));
      }
      case VariableType.String: {
        return this.getString();
      }
      case VariableType.DateTime: {
        return this.getDateTime();
      }
      case VariableType.Float: {
        return this.getFloat();
      }
      case VariableType.HSMoney: {
        return this.getMoney();
      }
      case VariableType.Blob: {
        return this.getBlob();
      }
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
  copyFrom(variable: HSVMVar): void {
    if (variable.vm != this.vm)
      throw new Error(`cross-vm copy not supported`);
    this.vm.wasmmodule._HSVM_CopyFrom(this.vm.hsvm, this.id, variable.id);
    this.type = variable.type;
  }
}
