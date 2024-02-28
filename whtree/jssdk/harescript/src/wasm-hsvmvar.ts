import { Marshaller, IPCMarshallableRecord, VariableType, determineType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import type { HSVM_VariableId, HSVM_VariableType, } from "../../../lib/harescript-interface";
import type { HareScriptVM, JSBlobTag } from "./wasm-hsvm";
import { dateToParts, makeDateFromParts } from "@webhare/hscompat";
import { Money } from "@webhare/std";
import { __getBlobDatabaseId, __getBlobDiskFilePath, createPGBlobByBlobRec } from "@webhare/whdb/src/blobs";
import { resurrect } from "./wasm-resurrection";
import { WebHareBlob } from "@webhare/services/src/webhareblob";
import { ReadableStream } from "node:stream/web";

function canCastTo(from: VariableType, to: VariableType): boolean {
  if (from === to)
    return true;
  if (from === VariableType.Integer && to === VariableType.Integer64)
    return true;
  return false;
}

//TODO WeakRefs so the HareScriptVM can be garbage collected ? We should also consider moving the GlobalBlobStorage to JavaScript so we don't need to keep the HSVMs around
class HSVMBlob extends WebHareBlob {
  blob: HSVMHeapVar | null;

  constructor(blob: HSVMHeapVar, size: number) {
    super(size);
    this.blob = blob;
  }

  __getAsSyncUInt8Array(): Readonly<Uint8Array> {
    if (!this.blob)
      throw new Error(`This blob has already been closed`);

    const buffer = this.blob.vm.wasmmodule._malloc(this.size);
    const openblob = this.blob.vm.wasmmodule._HSVM_BlobOpen(this.blob.vm.hsvm, this.blob.id);

    try {
      const numread = Number(this.blob.vm.wasmmodule._HSVM_BlobDirectRead(this.blob.vm.hsvm, openblob, 0n, this.size, buffer));
      if (numread !== this.size)
        throw new Error(`Failed to read blob, got ${numread} of ${this.size} bytes`);

      const data = this.blob.vm.wasmmodule.HEAP8.slice(buffer, buffer + this.size);
      return new Uint8Array(data);
    } finally {
      this.blob.vm.wasmmodule._free(buffer);
      this.blob.vm.wasmmodule._HSVM_BlobClose(this.blob.vm.hsvm, openblob);
    }
  }

  async getStream(): Promise<ReadableStream<Uint8Array>> {
    const data = this.__getAsSyncUInt8Array();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      }
    });
  }

  //You should close a HSVMBlob when you're done with it so the HSVM can garbage collect it (FIXME use a FinalizerRegistry because noone can reallyt invoke this!)
  close() {
    if (this.blob) {
      this.blob.dispose();
      this.blob = null;
    }
  }

  //Get the JS tag for this blob, used to track its original/current location (eg on disk or uploaded to PG)
  getJSTag(): JSBlobTag {
    if (!this.blob)
      throw new Error(`This blob has already been closed`);

    return this.blob.vm.getBlobJSTag(this.blob.id);
  }
  setJSTag(tag: JSBlobTag) {
    if (!this.blob)
      throw new Error(`This blob has already been closed`);

    this.blob.vm.setBlobJSTag(this.blob.id, tag);
  }

  __registerPGUpload(databaseid: string) {
    if (this.blob) //not closed yet
      this.setJSTag({ pg: databaseid });
  }
}

export class HSVMVar {
  vm: HareScriptVM;
  id: HSVM_VariableId;
  private type: VariableType | undefined;

  constructor(vm: HareScriptVM, id: HSVM_VariableId) {
    this.vm = vm;
    this.id = id;
  }

  getType() {
    this.type ??= this.vm.wasmmodule._HSVM_GetType(this.vm.hsvm, this.id);
    return this.type;
  }
  checkType(expectType: VariableType) {
    this.type ??= this.vm.checkType(this.id, expectType);
  }
  getBoolean(): boolean {
    this.checkType(VariableType.Boolean);
    return Boolean(this.vm.wasmmodule._HSVM_BooleanGet(this.vm.hsvm, this.id));
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
    return this.vm.wasmmodule.UTF8ToString(begin, end - begin);
  }
  getStringAsBuffer(): Buffer {
    this.checkType(VariableType.String);
    this.vm.wasmmodule._HSVM_StringGet(this.vm.hsvm, this.id, this.vm.wasmmodule.stringptrs, this.vm.wasmmodule.stringptrs + 4);
    const begin = this.vm.wasmmodule.getValue(this.vm.wasmmodule.stringptrs, "*") as number;
    const end = this.vm.wasmmodule.getValue(this.vm.wasmmodule.stringptrs + 4, "*") as number;
    return Buffer.from(this.vm.wasmmodule.HEAP8.slice(begin, end));
  }
  setString(value: string | Buffer) {
    if (typeof value === "string") {
      const len = this.vm.wasmmodule.lengthBytesUTF8(value);
      const alloced = this.vm.wasmmodule._malloc(len + 1);
      this.vm.wasmmodule.stringToUTF8(value, alloced, len + 1);
      this.vm.wasmmodule._HSVM_StringSet(this.vm.hsvm, this.id, alloced, alloced + len);
      this.vm.wasmmodule._free(alloced);
    } else {
      const alloced = this.vm.wasmmodule._malloc(value.byteLength);
      this.vm.wasmmodule.HEAP8.set(value, alloced);
      this.vm.wasmmodule._HSVM_StringSet(this.vm.hsvm, this.id, alloced, alloced + value.byteLength);
      this.vm.wasmmodule._free(alloced);
    }
    this.type = VariableType.String;
  }
  getDateTime(): Date {
    this.checkType(VariableType.DateTime);
    this.vm.wasmmodule._HSVM_DateTimeGet(this.vm.hsvm, this.id, this.vm.wasmmodule.stringptrs, this.vm.wasmmodule.stringptrs + 4);
    const days = this.vm.wasmmodule.getValue(this.vm.wasmmodule.stringptrs, "i32") as number;
    const msecs = this.vm.wasmmodule.getValue(this.vm.wasmmodule.stringptrs + 4, "i32") as number;
    return makeDateFromParts(days, msecs);
  }
  setDateTime(value: Date) {
    const { days, msecs } = dateToParts(value);
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
    return this.vm.wasmmodule._HSVM_FloatGet(this.vm.hsvm, this.id);
  }
  setFloat(value: number) {
    this.vm.wasmmodule._HSVM_FloatSet(this.vm.hsvm, this.id, value);
  }
  getBlob(): WebHareBlob {
    this.checkType(VariableType.Blob);
    const size = Number(this.vm.wasmmodule._HSVM_BlobLength(this.vm.hsvm, this.id));
    if (size === 0)
      return WebHareBlob.from("");

    const tag = this.vm.getBlobJSTag(this.id);
    if (tag?.pg)
      return createPGBlobByBlobRec(tag.pg, size);

    //TODO we might not need a wrapper around HSVM_BlobRead (with all the issue if the blobs outlive the HSVM!) if we can reach directly into the backing blob storage ?
    const cloneblob = this.vm.allocateVariable();
    this.vm.wasmmodule._HSVM_CopyFrom(this.vm.hsvm, cloneblob.id, this.id);
    return new HSVMBlob(cloneblob, size);
  }
  setBlob(blob: WebHareBlob | null) {
    if (!blob || !blob.size) {
      this.setDefault(VariableType.Blob);
      return;
    }

    const dbid = __getBlobDatabaseId(blob);
    if (dbid) {
      const fullpath = __getBlobDiskFilePath(dbid);
      const fullpath_cstr = this.vm.wasmmodule.stringToNewUTF8(fullpath);
      this.vm.wasmmodule._HSVM_MakeBlobFromDiskPath(this.vm.hsvm, this.id, fullpath_cstr, BigInt(blob.size));
      this.vm.wasmmodule._free(fullpath_cstr);
      this.vm.setBlobJSTag(this.id, { pg: dbid });
      this.type = VariableType.Blob;
      return;
    }

    const blobcontent = blob.__getAsSyncUInt8Array();
    const stream = this.vm.wasmmodule._HSVM_CreateStream(this.vm.hsvm);
    //TODO write in blocks to reduce memory peak usage/fragmentation? or replace __getAsSyncUInt8Array with an APi to directly copy it into the alloced buffer ?
    const tempbuffer = this.vm.wasmmodule._malloc(blob.size);
    this.vm.wasmmodule.HEAP8.set(blobcontent, tempbuffer);
    //TODO deal with too short return values
    this.vm.wasmmodule._HSVM_WriteTo(this.vm.hsvm, stream, blobcontent.byteLength, tempbuffer);
    this.vm.wasmmodule._free(tempbuffer);
    this.vm.wasmmodule._HSVM_MakeBlobFromStream(this.vm.hsvm, this.id, stream);
  }
  setDefault(type: VariableType): HSVMVar {
    if (type === VariableType.Array)
      throw new Error(`Illegal variable type ${VariableType[type] ?? type}`);
    this.vm.wasmmodule._HSVM_SetDefault(this.vm.hsvm, this.id, type as HSVM_VariableType);
    this.type = type;
    return this;
  }
  arrayLength() {
    this.type ??= this.vm.wasmmodule._HSVM_GetType(this.vm.hsvm, this.id);
    if (!(this.type & 0x80))
      throw new Error(`Variable is not an ARRAY`);
    return this.vm.wasmmodule._HSVM_ArrayLength(this.vm.hsvm, this.id);
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
  ///Return all array elements as HSVMVars references
  arrayContents(): HSVMVar[] {
    const retval: HSVMVar[] = [];
    const num = this.arrayLength();
    for (let i = 0; i < num; ++i)
      retval.push(this.arrayGetRef(i)!);
    return retval;
  }
  getCell(name: string): HSVMVar | null {
    this.checkType(VariableType.Record);

    const columnid = this.vm.getColumnId(name.toString());
    const newid = this.vm.wasmmodule._HSVM_RecordGetRef(this.vm.hsvm, this.id, columnid);
    return newid ? new HSVMVar(this.vm, newid) : null;
  }
  ensureCell(name: string) {
    this.checkType(VariableType.Record);

    const columnid = this.vm.getColumnId(name.toString());
    const newid = this.vm.wasmmodule._HSVM_RecordCreate(this.vm.hsvm, this.id, columnid);
    return new HSVMVar(this.vm, newid);
  }
  recordExists(): boolean {
    this.checkType(VariableType.Record);
    return this.vm.wasmmodule._HSVM_RecordExists(this.vm.hsvm, this.id) !== 0;
  }
  objectExists(): boolean {
    this.checkType(VariableType.Object);
    return this.vm.wasmmodule._HSVM_ObjectExists(this.vm.hsvm, this.id) !== 0;
  }
  functionPtrExists(): boolean {
    this.checkType(VariableType.FunctionPtr);
    return this.vm.wasmmodule._HSVM_FunctionPtrExists(this.vm.hsvm, this.id) !== 0;
  }
  memberExists(name: string): boolean {
    this.checkType(VariableType.Object);
    const columnid = this.vm.getColumnId(name);
    return this.vm.wasmmodule._HSVM_ObjectMemberExists(this.vm.hsvm, this.id, columnid) !== 0;
  }

  /** Get and copy an object member, resolve property calls */
  async getMember(name: string, options?: { allowMissing: false }): Promise<HSVMHeapVar>;
  async getMember(name: string, options?: { allowMissing: boolean }): Promise<HSVMHeapVar | undefined>;

  async getMember(name: string, options?: { allowMissing: boolean }): Promise<HSVMHeapVar | undefined> {
    if (!this.memberExists(name))
      if (options?.allowMissing)
        return undefined;
      else
        throw new Error(`No such member or property '${name}' on HareScript object`);

    const columnid = this.vm.getColumnId(name);
    const temp = this.vm.wasmmodule._HSVM_AllocateVariable(this.vm.hsvm);
    if (!await this.vm.wasmmodule._HSVM_ObjectMemberCopy(this.vm.hsvm, this.id, columnid, temp, /*skipaccess=*/1))
      throw new Error(`Failed to copy member ${name} from object`);

    return new HSVMHeapVar(this.vm, temp);
  }

  /** Get a primitive object member. Will fail if the property requires a callback. Returns a reference that may be invalidated on future VM calls */
  getMemberRef(name: string, options?: { allowMissing: false }): HSVMVar;
  getMemberRef(name: string, options?: { allowMissing: boolean }): HSVMVar | undefined;

  getMemberRef(name: string, options?: { allowMissing: boolean }): HSVMVar | undefined {
    if (!this.memberExists(name))
      if (options?.allowMissing)
        return undefined;
      else
        throw new Error(`No such member or property '${name}' on HareScript object`);

    const columnid = this.vm.getColumnId(name);
    return new HSVMVar(this.vm, this.vm.wasmmodule._HSVM_ObjectMemberRef(this.vm.hsvm, this.id, columnid, /*skipaccess=*/1));
  }

  setJSValue(value: unknown, forcetype: VariableType = VariableType.Variant): void {
    if (value instanceof HSVMVar) {
      if (forcetype !== VariableType.Variant && forcetype !== value.getType())
        throw new Error(`Cannot use a ${VariableType[value.getType()]} here, a ${VariableType[forcetype]} is required`);

      this.copyFrom(value as HSVMVar);
      return;
    }

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
        this.setString(value as string | Buffer);
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
        this.setFloat(value as number);
        return;
      } break;
      case VariableType.Blob: {
        this.setBlob(value as WebHareBlob | null);
        return;
      } break;
      case VariableType.Record: {
        if (typeof value == "object" && value?.[Marshaller]?.setValue) {
          value?.[Marshaller]?.setValue.apply(value, [this]);
          return;
        }

        const recval = value as IPCMarshallableRecord;
        if (!recval)
          this.setDefault(VariableType.Record);
        else {
          this.vm.wasmmodule._HSVM_RecordSetEmpty(this.vm.hsvm, this.id);
          this.type = VariableType.Record;
          for (const [key, propval] of Object.entries(recval)) {
            if (propval !== undefined)
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
        this.arrayAppend().setJSValue(item, itemtype);
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
      case VariableType.FunctionPtrArray: break;

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
      case VariableType.Object: {
        if (!this.objectExists())
          return null; //TODO or a boxed default object?

        //We map some objects based on their ^$WASMTYPE. We can't use the __GetMarshalData approach as we can't invoke functionptrs here (async)
        const wasmtype_column = this.getMemberRef("^$WASMTYPE", { allowMissing: true });
        if (wasmtype_column !== undefined)
          return resurrect(wasmtype_column.getString(), this);

        return this.vm.objectCache.ensureObject(this.id);
      }
      case VariableType.FunctionPtr:
        if (!this.functionPtrExists())
          return null; //TODO or a boxed default functionptr?

        throw new Error(`Returning active function ptr not supported yet`);

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

export class HSVMHeapVar extends HSVMVar {
  constructor(vm: HareScriptVM, id: HSVM_VariableId) {
    super(vm, id);
    vm.heapFinalizer.register(this, id, this);
  }

  dispose() {
    if (this.id) {
      this.vm.heapFinalizer.unregister(this);
      this.vm.wasmmodule._HSVM_DeallocateVariable(this.vm.hsvm, this.id);
      this.id = 0 as HSVM_VariableId;
    }
  }

  [Symbol.dispose]() {
    this.dispose();
  }
}
