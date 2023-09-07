import { createHarescriptModule, recompileHarescriptLibrary, HareScriptVM, allocateHSVM, MessageList } from "./wasm-hsvm";
import { IPCMarshallableRecord, VariableType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { backendConfig, log } from "@webhare/services";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { HSVMVar } from "./wasm-hsvmvar";
import { SocketError, WASMModule } from "./wasm-modulesupport";
import { HSVM, Ptr, StringPtr } from "wh:internal/whtree/lib/harescript-interface";
import { OutputObjectBase } from "@webhare/harescript/src/wasm-modulesupport";
import { createDeferred, generateRandomId, sleep } from "@webhare/std";
import * as syscalls from "./syscalls";
import { localToUTC, utcToLocal } from "@webhare/hscompat/datetime";
import { isWHDBBlob } from "@webhare/whdb/src/blobs";
import * as crypto from "node:crypto";
import { IPCEndPoint, IPCMessagePacket, IPCPort, createIPCEndPointPair, decodeTransferredIPCEndPoint } from "@mod-system/js/internal/whmanager/ipc";
import { isValidName } from "@webhare/whfs/src/support";
import { AsyncWorker, ConvertWorkerServiceInterfaceToClientInterface } from "@mod-system/js/internal/worker";

type SysCallsModule = { [key: string]: (vm: HareScriptVM, data: unknown) => unknown };


class OutputCapturingModule extends WASMModule {
  stdout_bytes: number[] = [];
  outputfunction: number = 0;

  init() {
    super.init();
    const out = (opaqueptr: number, numbytes: number, data: StringPtr, allow_partial: number, error_result: Ptr): number => {
      this.stdout_bytes.push(...Array.from(this.HEAP8.slice(data, data + numbytes)));
      return numbytes;
    };
    this.outputfunction = this.addFunction(out, "iiiiii");
  }

  initVM(hsvm: HSVM) {
    super.initVM(hsvm);
    this._HSVM_SetOutputCallback(hsvm, 0, this.outputfunction);
  }

  getOutput() {
    return Buffer.from(this.stdout_bytes).toString();
  }
}

/** Builds a function that returns (or creates when not present yet) a class instance associated with a HareScriptVM */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contextGetterFactory<T extends new (...args: any) => any>(obj: T): (vm: HareScriptVM) => InstanceType<T> {
  const map = new WeakMap<HareScriptVM, InstanceType<T>>;
  return (vm: HareScriptVM): InstanceType<T> => {
    const res = map.get(vm);
    if (res)
      return res;
    const newobj = new obj;
    map.set(vm, newobj);
    return newobj;
  };
}

class Hasher extends OutputObjectBase {
  static context = contextGetterFactory(class { hashers = new Map<number, Hasher>; });

  hasher: crypto.Hash;

  constructor(vm: HareScriptVM, algorithm: string) {
    super(vm, "Crypto hasher");
    this.hasher = crypto.createHash(algorithm);
  }

  write(buffer: Buffer, allowPartial: boolean) {
    this.hasher.update(buffer);
    return { bytes: buffer.byteLength };
  }

  finalize(): Buffer {
    const result = this.hasher.digest();
    this.close();
    return result;
  }
}

class HSIPCPort extends OutputObjectBase {
  port: IPCPort;
  endpoints = new Array<IPCEndPoint>;
  constructor(vm: HareScriptVM, port: IPCPort) {
    super(vm, "IPC port");
    this.port = port;
    this.port.on("accept", (endpoint) => {
      this.injectEndPoint(endpoint);
    });
    this.setReadSignalled(false);
  }
  protected syncUpdateReadSignalled(): void {
    this.port.checkForEventsSync();
  }
  injectEndPoint(endpoint: IPCEndPoint) {
    this.endpoints.push(endpoint);
    this.setReadSignalled(true);
  }
  getEndPoint() {
    const endpoint = this.endpoints.shift();
    this.setReadSignalled(Boolean(this.endpoints.length || this.closed));
    return endpoint;
  }
  close() {
    this.port.close();
    for (const endpoint of this.endpoints)
      endpoint.close();
    super.close();
  }
}

class HSIPCLink extends OutputObjectBase {
  link: IPCEndPoint | undefined;
  messages = new Array<IPCMessagePacket<IPCMarshallableRecord>>;
  whmanagerMsgIdCounter = 0n;
  constructor(vm: HareScriptVM, link: IPCEndPoint | undefined) {
    super(vm, "IPC link");
    if (link)
      this.setLink(link);
    this.setReadSignalled(false);
  }
  setLink(link: IPCEndPoint) {
    if (this.link)
      throw new Error(`Cannot set link twice`);
    this.link = link;
    this.link.on("message", (msg) => {
      this.messages.push(msg);
      this.setReadSignalled(true);
    });
    this.link.on("exception", (msg) => {
      this.messages.push(msg);
      this.setReadSignalled(true);
    });
    this.link.on("close", () => {
      this.setReadSignalled(true);
    });
  }
  protected syncUpdateReadSignalled(): void {
    this.link?.checkForEventsSync();
  }
  injectMessage(msg: IPCMessagePacket<IPCMarshallableRecord>) {
    this.messages.push(msg);
    this.setReadSignalled(true);
  }
  getMessage(): IPCMessagePacket<IPCMarshallableRecord> | undefined {
    const msg = this.messages.shift();
    this.setReadSignalled(Boolean(this.messages.length || this.closed || this.link?.closed));
    return msg;
  }
  close() {
    if (this.link) {
      this.link.close();
    }
    super.close();
  }
  async activate(): Promise<boolean> {
    try {
      await this.link?.activate();
      return true;
    } catch (e) {
      // Ignore activation errors, they will close the link anyway
      this.setReadSignalled(true);
      return false;
    }
  }
}

class HSJob extends OutputObjectBase {
  linkinparent: IPCEndPoint | undefined;
  worker: AsyncWorker;
  jobobj: ConvertWorkerServiceInterfaceToClientInterface<HareScriptJob>;
  isRunning = false;
  arguments = new Array<string>;
  output: HSJobOutput | undefined;
  constructor(
    vm: HareScriptVM,
    linkinparent: IPCEndPoint,
    worker: AsyncWorker,
    jobobj: ConvertWorkerServiceInterfaceToClientInterface<HareScriptJob>,
  ) {
    super(vm, "Job");
    this.linkinparent = linkinparent;
    this.worker = worker;
    this.jobobj = jobobj;
  }
  async start() {
    if (this.closed)
      throw new Error(`The job has already been closed`);
    this.setReadSignalled(false);
    await this.jobobj.start();
    this.isRunning = true;
    // The job may be closed before
    this.jobobj.waitDone().then(() => this.jobIsDone()).catch(e => void (false));
  }
  private jobIsDone() {
    this.setReadSignalled(true);
    this.isRunning = false;
  }
  async setArguments(args: string[]) {
    if (this.closed)
      throw new Error(`The job has already been closed`);
    await this.jobobj.setArguments(args);
  }
  async getAuthenticationRecord() {
    if (this.closed)
      throw new Error(`The job has already been closed`);
    return this.jobobj.getAuthenticationRecord();
  }
  async setAuthenticationRecord(authrec: unknown) {
    if (this.closed)
      throw new Error(`The job has already been closed`);
    this.jobobj.setAuthenticationRecord(authrec);
  }
  async getExternalSessionData() {
    if (this.closed)
      throw new Error(`The job has already been closed`);
    return this.jobobj.getExternalSessionData();
  }
  async setExternalSessionData(newdata: string) {
    if (this.closed)
      throw new Error(`The job has already been closed`);
    this.jobobj.setExternalSessionData(newdata);
  }
  async getEnvironment() {
    if (this.closed)
      throw new Error(`The job has already been closed`);
    return this.jobobj.getEnvironment();
  }
  async setEnvironment(newdata: Array<{ name: string; value: string }>) {
    if (this.closed)
      throw new Error(`The job has already been closed`);
    this.jobobj.setEnvironment(newdata);
  }
  async terminate() {
    if (this.closed)
      throw new Error(`The job has already been closed`);
    await this.jobobj.terminate();
  }
  async captureOutput(endpoint: IPCEndPoint) {
    if (this.closed)
      throw new Error(`The job has already been closed`);
    const encoded = endpoint.encodeForTransfer();
    await this.jobobj.captureOutput.callWithTransferList(encoded.transferList, encoded.encoded);
  }
  async getExitCode() {
    if (this.closed)
      throw new Error(`The job has already been closed`);
    return await this.jobobj.getExitCode();
  }
  close() {
    if (this.closed)
      return;
    this.jobobj.close();
    this.output?.close();
    this.worker.close();
    super.close();
  }
}

class HSJobOutput extends OutputObjectBase {
  buf0ofs = 0;
  buffers = new Array<Buffer>;
  linkClosed = false;
  endpoint: IPCEndPoint;
  constructor(vm: HareScriptVM, endpoint: IPCEndPoint) {
    super(vm, "Job output");
    this.setReadSignalled(false);
    this.endpoint = endpoint;
    this.endpoint.on("message", (packet) => this.gotMessage(packet));
    this.endpoint.on("close", () => this.gotClose());
    this.endpoint.activate();
  }

  gotMessage(packet: IPCMessagePacket<IPCMarshallableRecord>) {
    const buffer = Buffer.from((packet.message as { data: number[] }).data);
    if (buffer.byteLength) {
      this.buffers.push(Buffer.from((packet.message as { data: number[] }).data));
      this.setReadSignalled(true);
    }
  }

  gotClose() {
    this.linkClosed = true;
    this.setReadSignalled(true);
  }

  read(buffer: Buffer): { error?: SocketError; bytes: number; signalled?: boolean } {
    let pos = 0;
    while (pos < buffer.byteLength && this.buffers.length) {
      const tocopy = Math.min(buffer.byteLength - pos, this.buffers[0].byteLength - this.buf0ofs);
      this.buffers[0].copy(buffer, pos, this.buf0ofs, this.buf0ofs + tocopy);
      this.buf0ofs += tocopy;
      pos += tocopy;
      if (this.buf0ofs === this.buffers[0].byteLength) {
        this.buffers.shift();
        this.buf0ofs = 0;
      }
    }
    return { bytes: pos, signalled: Boolean(this.buffers.length || this.linkClosed) };
  }

  isAtEOF() {
    return !this.buffers.length && this.linkClosed;
  }

  close() {
    this.endpoint.close();
    super.close();
  }
}

const ipcContext = contextGetterFactory(class {
  ports = new Map<number, HSIPCPort>;
  links = new Map<number, HSIPCLink>;
  jobs = new Map<number, HSJob>;
  linktoparent: IPCEndPoint | undefined;
  externalsessiondata = "";
});

export function registerBaseFunctions(wasmmodule: WASMModule) {

  wasmmodule.registerExternalFunction("__SYSTEM_GETMODULEINSTALLATIONROOT::S:S", (vm, id_set, modulename) => {
    const mod = backendConfig.module[modulename.getString()];
    if (!mod) {
      id_set.setString("");
    } else
      id_set.setString(mod.root);
  });
  wasmmodule.registerExternalFunction("GETCONSOLEARGUMENTS::SA:", (vm, id_set) => {
    id_set.setDefault(VariableType.StringArray);
    for (const arg of wasmmodule.itf.consoleArguments)
      id_set.arrayAppend().setString(arg);
  });
  wasmmodule.registerExternalFunction("__SYSTEM_WHCOREPARAMETERS::R:", (vm, id_set) => {
    id_set.setJSValue({
      installationroot: backendConfig.installationroot,
      basedataroot: backendConfig.dataroot,
      varroot: backendConfig.dataroot,
      ephemeralroot: backendConfig.dataroot + "ephemeral/",
      logroot: backendConfig.dataroot + "log/",
      moduledirs: [...getFullConfigFile().modulescandirs, backendConfig.installationroot + "modules/"] // always filled, no need to cast
    });
  });
  wasmmodule.registerExternalFunction("__SYSTEM_GETINSTALLEDMODULENAMES::SA:", (vm, id_set) => {
    id_set.setJSValue(getTypedArray(VariableType.StringArray, Object.keys(backendConfig.module).sort()));
  });
  wasmmodule.registerExternalFunction("__SYSTEM_GETSYSTEMCONFIG::R:", (vm, id_set) => {
    id_set.setJSValue(bridge.systemconfig);
  });
  wasmmodule.registerAsyncExternalFunction("DOCOMPILE:WH_SELFCOMPILE:RA:S", async (vm, id_set, uri) => {
    const uri_str = uri.getString();
    const compileresult = await recompileHarescriptLibrary(uri_str, { force: true });
    id_set.setJSValue(getTypedArray(VariableType.RecordArray, compileresult));
  });
  wasmmodule.registerAsyncExternalFunction("DORUN:WH_SELFCOMPILE:R:SSA", async (vm, id_set, filename, args) => {
    const extfunctions = new OutputCapturingModule;
    const newmodule = await createHarescriptModule(extfunctions);
    const newvm = new HareScriptVM(newmodule);
    newvm.consoleArguments = args.getJSValue() as string[];
    await newvm.loadScript(filename.getString());
    await newmodule._HSVM_ExecuteScript(newvm.hsvm, 1, 0);
    newmodule._HSVM_GetMessageList(newvm.hsvm, newvm.errorlist, 1);
    id_set.setJSValue({
      errors: new HSVMVar(newvm, newvm.errorlist).getJSValue(),
      output: extfunctions.getOutput()
    });
  });
  wasmmodule.registerExternalFunction("GENERATEUFS128BITID::S:", (vm, id_set) => {
    id_set.setString(generateRandomId("base64url"));
  });
  wasmmodule.registerAsyncExternalFunction("__EM_SYSCALL::R:SV", async (vm, id_set, var_func, var_data) => {
    const func = var_func.getString();
    const data = var_data.getJSValue();
    if (!(syscalls as SysCallsModule)[func]) {
      id_set.setJSValue({ result: "unknown" });
      return;
    }
    let value = await (syscalls as SysCallsModule)[func](vm, data);
    if (value === undefined)
      value = false;
    id_set.setJSValue({
      result: "ok",
      value
    });
  });
  wasmmodule.registerAsyncExternalFunction("__ICU_GETTIMEZONEIDS::SA:", async (vm, id_set) => {
    //@ts-ignore -- MDN says it is supported everywhere we need it to be
    const list = Intl.supportedValuesOf('timeZone');
    // Add some missing timezones: https://bugs.chromium.org/p/v8/issues/detail?id=13084
    for (const toAdd of ["UTC", "GMT", "CET"])
      if (!list.includes(toAdd))
        list.push(toAdd);
    id_set.setJSValue(list.sort());
  });
  wasmmodule.registerAsyncExternalFunction("__ICU_LOCALTOUTC::D:DS", async (vm, id_set, var_date, var_timezone) => {
    try {
      id_set.setDateTime(localToUTC(var_date.getDateTime(), var_timezone.getString()));
    } catch (e) {
      id_set.copyFrom(var_date);
    }
  });
  wasmmodule.registerAsyncExternalFunction("__ICU_UTCTOLOCAL::D:DS", async (vm, id_set, var_date, var_timezone) => {
    try {
      id_set.setDateTime(utcToLocal(var_date.getDateTime(), var_timezone.getString()));
    } catch (e) {
      id_set.copyFrom(var_date);
    }
  });
  wasmmodule.registerAsyncExternalFunction("POSTGRESQLESCAPEIDENTIFIER::S:S", async (vm, id_set, var_str) => {
    const str = var_str.getString();
    const is_simple = Boolean(str.match(/^[0-9a-zA-Z_"$]*$/));
    let retval: string;
    if (is_simple)
      retval = `"${str.replaceAll(`"`, `""`)}"`;
    else {
      retval = `U&"`;
      for (const char of str) {
        const code = char.charCodeAt(0);
        if (code >= 32 && code < 127) {
          if (char === "\\")
            retval += char;
          retval += char;
        } else {
          if (code < 65536)
            retval += `\\${code.toString(16).padStart(4, "0")}`;
          else
            retval += `\\+${code.toString(16).padStart(8, "0")}`;
        }
      }
      retval += `"`;
    }
    id_set.setString(retval);
  });
  wasmmodule.registerAsyncExternalFunction("POSTGRESQLESCAPELITERAL::S:S", async (vm, id_set, var_str) => {
    // Don't care about UTF-8 encoding problems, the server will catch them anyway
    let have_backslashes = false;
    const str = var_str.getString();
    let result = `'`;
    for (const char of str) {
      const code = char.codePointAt(0) ?? 0;
      if (char == `'`)
        result += char;
      else if (code < 32 || code == 127) {
        switch (code) {
          case 8:    /* \b */ result += '\\b'; break;
          case 12:   /* \f */ result += '\\f'; break;
          case 10:   /* \n */ result += '\\n'; break;
          case 13:   /* \r */ result += '\\r'; break;
          case 9:    /* \t */ result += '\\t'; break;
          default: result += `\\x${code.toString(16).padStart(2, "0")}`;
        }
        have_backslashes = true;
        continue;
      } else if (char == '\\') {
        result += char;
        have_backslashes = true;
      }
      result += char;
    }
    result += `'`;
    if (have_backslashes)
      result = " E" + result;
    id_set.setString(result);
  });

  wasmmodule.registerAsyncExternalFunction("__PGSQL_GETBLOBINTERNALID::S:IX", async (vm, id_set, transaction, var_blob) => {
    const blob = var_blob.getBlob();
    id_set.setString(isWHDBBlob(blob) ? blob.databaseid : "");
  });

  wasmmodule.registerExternalFunction("__HS_GETCURRENTGROUPID::S:", (vm, id_set) => {
    id_set.setString(vm.currentgroup);
  });

  wasmmodule.registerExternalFunction("GETEXTERNALSESSIONDATA::S:", (vm, id_set) => {
    id_set.setString(ipcContext(vm).externalsessiondata);
  });

  wasmmodule.registerExternalMacro("__SYSTEM_REMOTELOG:::SS", (vm, logfile: HSVMVar, text: HSVMVar) => {
    //FIXME should bridge log just give us a raw format? or should we convert all WASM logger usage to JSON?
    log(logfile.getString(), { __system_remotelog_wasm: text.getString() });
  });

  wasmmodule.registerExternalFunction("CREATEHASHER::I:S", (vm, id_set, varAlgorithm) => {
    let algorithm: "md5" | "sha1" | "sha224" | "sha256" | "sha384" | "sha512" | "crc32";
    switch (varAlgorithm.getString()) {
      case "MD5": algorithm = "md5"; break;
      case "SHA-1": algorithm = "sha1"; break;
      case "SHA-256": algorithm = "sha256"; break;
      case "SHA-224": algorithm = "sha224"; break;
      case "SHA-384": algorithm = "sha384"; break;
      case "SHA-512": algorithm = "sha512"; break;
      default: throw new Error(`Unsupported algorithm ${JSON.stringify(varAlgorithm.getString())}`);
    }
    const hasher = new Hasher(vm, algorithm);
    Hasher.context(vm).hashers.set(hasher.id, hasher);
    id_set.setInteger(hasher.id);
  });

  wasmmodule.registerExternalFunction("FINALIZEHASHER::S:I", (vm, id_set, id) => {
    const hasher = Hasher.context(vm).hashers.get(id.getInteger());
    if (!hasher)
      throw new Error(`No such crypto hasher with id ${id.getInteger()}`);
    id_set.setString(hasher.finalize());
  });

  wasmmodule.registerAsyncExternalFunction("__HS_CREATENAMEDIPCPORT::I:SB", async (vm, id_set, var_portname, var_globalport) => {
    const port = bridge.createPort(var_portname.getString(), { global: var_globalport.getBoolean() });
    const hsport = new HSIPCPort(vm, port);
    try {
      await hsport.port.activate();
      ipcContext(vm).ports.set(hsport.id, hsport);
      id_set.setInteger(hsport.id);
    } catch (e) {
      id_set.setInteger(0);
    }
  });

  wasmmodule.registerAsyncExternalFunction("__HS_CONNECTTOIPCPORT::I:S", async (vm, id_set, var_portname) => {
    let link: IPCEndPoint | undefined;
    if (var_portname.getString() !== "system:whmanager") {
      link = bridge.connect(var_portname.getString(), { global: false });
    }
    const hslink = new HSIPCLink(vm, link);
    // Wait 100 ms for activation, so we can error out on not-existing local ports
    const activationPromise = hslink.activate();
    if (await Promise.race([sleep(100), activationPromise]) === false) {
      id_set.setInteger(0);
      hslink.close();
    } else {
      ipcContext(vm).links.set(hslink.id, hslink);
      id_set.setInteger(hslink.id);
    }
  });

  wasmmodule.registerExternalFunction("__HS_SENDIPCMESSAGE::R:IV6", (vm, id_set, var_linkid, var_data, var_replyto) => {
    const link = ipcContext(vm).links.get(var_linkid.getInteger());
    if (!link)
      throw new Error(`No such link with id ${var_linkid.getInteger()}`);
    if (!link.link) {
      // system:whmanager pseudo-link
      const data = var_data.getJSValue() as { type: string; port: string };
      switch (data.type) {
        case "register": {// registers a port as global. just act like it has been registered
          const replyto = ++link.whmanagerMsgIdCounter;
          const msgid = ++link.whmanagerMsgIdCounter;
          const res = {
            msgid,
            replyto,
            message: { type: "createportresponse", port: data.port, success: true }
          };
          link.injectMessage(res);
          id_set.setJSValue({ msgid: replyto, status: "ok" });
          return;
        }
        case "connect": { // connect a link to a remote port
          const replyto = ++link.whmanagerMsgIdCounter;
          const msgid = ++link.whmanagerMsgIdCounter;

          link.setLink(bridge.connect(data.port, { global: true }));
          // TypeScript doesn't known that setLink updated the link property
          // Not waiting for activation by the other side, HareScript didn't do that either.
          link.activate();
          const res = {
            msgid,
            replyto,
            message: { status: "ok" }
          };
          link.injectMessage(res);
          id_set.setJSValue({ msgid: replyto, status: "ok" });
          return;
        }
      }
      id_set.setJSValue({ msgid: 0n, status: "ok" });
    } else if (link.link.closed)
      id_set.setJSValue({ msgid: 0n, status: "gone" });
    else {
      const msgid = link.link.send(var_data.getJSValue() as IPCMarshallableRecord, var_replyto.getInteger64());
      id_set.setJSValue({ msgid, status: "ok" });
    }
  });

  wasmmodule.registerAsyncExternalFunction("__HS_RECEIVEIPCMESSAGE::R:I", async (vm, id_set, var_linkid, var_data, var_replyto) => {
    const link = ipcContext(vm).links.get(var_linkid.getInteger());
    if (!link)
      throw new Error(`No such link with id ${var_linkid.getInteger()}`);
    let msg = link.getMessage();
    if (!msg) {
      // HareScript is more deterministic than JS bridge, wait a bit and try again
      await sleep(10);
      msg = link.getMessage();
    }
    if (msg) {
      id_set.setJSValue({
        status: "ok",
        replyto: msg.replyto,
        msgid: msg.msgid,
        msg: msg.message
      });
    } else if (link.closed || link.link?.closed)
      id_set.setJSValue({ status: "gone" });
    else
      id_set.setJSValue({ status: "none" });
  });

  wasmmodule.registerAsyncExternalFunction("__HS_ACCEPTIPCCONNECTION::I:I", async (vm, id_set, var_portid) => {
    const port = ipcContext(vm).ports.get(var_portid.getInteger());
    if (!port)
      throw new Error(`No such port with id ${var_portid.getInteger()}`);

    let bridgelink = port.getEndPoint();
    if (!bridgelink) {
      await sleep(10);
      bridgelink = port.getEndPoint();
    }
    if (!bridgelink)
      id_set.setInteger(0);
    else {
      const hslink = new HSIPCLink(vm, bridgelink);
      await hslink.activate();
      ipcContext(vm).links.set(hslink.id, hslink);
      id_set.setInteger(hslink.id);
    }
  });

  wasmmodule.registerExternalFunction("__HS_CLOSEIPCENDPOINT:::I", (vm, id_set, var_linkid) => {
    const link = ipcContext(vm).links.get(var_linkid.getInteger());
    if (!link)
      throw new Error(`No such link with id ${var_linkid.getInteger()}`);
    link.close();
    ipcContext(vm).links.delete(var_linkid.getInteger());
  });

  wasmmodule.registerExternalFunction("__HS_CLOSENAMEDIPCPORT:::I", (vm, id_set, var_portid) => {
    const port = ipcContext(vm).ports.get(var_portid.getInteger());
    if (!port)
      throw new Error(`No such port with id ${var_portid.getInteger()}`);

    port.close();
    ipcContext(vm).ports.delete(var_portid.getInteger());
  });

  wasmmodule.registerExternalFunction("ISVALIDWHFSNAME::B:SB", (vm, id_set, var_name, var_slashes) => {
    const name = var_name.getString();
    const slashes = var_slashes.getBoolean();
    id_set.setBoolean(isValidName(name, { allowSlashes: slashes }));
  });

  wasmmodule.registerAsyncExternalFunction("__HS_CREATEJOB::R:S", async (vm, id_set, var_mainscript) => {
    const context = ipcContext(vm);

    // Get authenticationrecord
    const scratchvar = vm.allocateVariable();
    vm.wasmmodule._HSVM_GetAuthenticationRecord(vm.hsvm, scratchvar.id);
    const authenticationRecord = scratchvar.getJSValue();
    scratchvar.dispose();

    const link = createIPCEndPointPair();
    const encodedEndpoint = link[1].encodeForTransfer();

    const worker = new AsyncWorker;
    const jobobj = await worker.callFactory<HareScriptJob>({
      ref: __filename + "#harescriptWorkerFactory",
      transferList: encodedEndpoint.transferList
    },
      var_mainscript.getString(),
      encodedEndpoint.encoded,
      authenticationRecord,
      context.externalsessiondata,
    );

    const job = new HSJob(vm, link[0], worker, jobobj,);
    context.jobs.set(job.id, job);

    id_set.setJSValue({
      status: "ok",
      jobid: job.id,
      groupid: "unknown",
      errors: getTypedArray(VariableType.RecordArray, [])
    });
  });

  wasmmodule.registerExternalFunction("__HS_GETIPCLINKTOJOB::I:I", (vm, id_set, var_jobid) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);
    if (!job.linkinparent)
      throw new Error(`Link to job has already been retrieved`);

    const hslink = new HSIPCLink(vm, job.linkinparent);
    hslink.activate();
    ipcContext(vm).links.set(hslink.id, hslink);
    id_set.setInteger(hslink.id);
    job.linkinparent = undefined;
  });

  wasmmodule.registerAsyncExternalMacro("__HS_STARTJOB:::I", async (vm, var_jobid) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);

    await job.start();
  });

  wasmmodule.registerExternalFunction("__HS_GETIPCLINKTOPARENT::I:", (vm, id_set) => {
    const endpoint = ipcContext(vm).linktoparent;
    if (endpoint) {
      ipcContext(vm).linktoparent = undefined;
      const hslink = new HSIPCLink(vm, endpoint);
      hslink.activate();
      ipcContext(vm).links.set(hslink.id, hslink);
      id_set.setInteger(hslink.id);
    } else
      id_set.setInteger(0);
  });

  wasmmodule.registerAsyncExternalMacro("__HS_TERMINATEJOB:::I", async (vm, var_jobid) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);

    await job.jobobj.terminate();
  });

  wasmmodule.registerAsyncExternalMacro("__HS_DELETEJOB:::I", async (vm, var_jobid) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);

    if (job.isRunning)
      await job.terminate();
    job.close();
  });

  wasmmodule.registerExternalMacro("SETEXTERNALSESSIONDATA:::S", (vm, var_sessiondata) => {
    ipcContext(vm).externalsessiondata = var_sessiondata.getString();
  });

  wasmmodule.registerAsyncExternalMacro("__HS_SETJOBARGUMENTS:::ISA", async (vm, var_jobid, var_arguments) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);
    if (job.isRunning)
      throw new Error(`Job is already running`);
    await job.setArguments(var_arguments.getJSValue() as string[]);
  });

  wasmmodule.registerAsyncExternalFunction("__HS_GETJOBAUTHENTICATIONRECORD::R:I", async (vm, id_set, var_jobid) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);
    if (job.isRunning)
      throw new Error(`Job is already running`);
    id_set.setJSValue(await job.getAuthenticationRecord());
  });

  wasmmodule.registerAsyncExternalMacro("__HS_SETJOBAUTHENTICATIONRECORD:::IR", async (vm, var_jobid, var_authrecord) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);
    if (job.isRunning)
      throw new Error(`Job is already running`);
    await job.setAuthenticationRecord(var_authrecord.getJSValue());
  });

  wasmmodule.registerAsyncExternalFunction("__HS_GETJOBEXTERNALSESSIONDATA::S:I", async (vm, id_set, var_jobid) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);
    if (job.isRunning)
      throw new Error(`Job is already running`);
    id_set.setString(await job.getExternalSessionData());
  });

  wasmmodule.registerAsyncExternalMacro("__HS_SETJOBEXTERNALSESSIONDATA:::IS", async (vm, var_jobid, var_newdata) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);
    if (job.isRunning)
      throw new Error(`Job is already running`);
    await job.setExternalSessionData(var_newdata.getString());
  });

  wasmmodule.registerAsyncExternalFunction("__HS_CAPTUREJOBOUTPUT::I:I", async (vm, id_set, var_jobid) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);
    if (job.isRunning)
      throw new Error(`Job is already running`);

    const links = createIPCEndPointPair();
    job.output = new HSJobOutput(vm, links[0]);
    job.captureOutput(links[1]);
    id_set.setInteger(job.output.id);
  });

  wasmmodule.registerAsyncExternalFunction("__HS_GETJOBEXITCODE::I:I", async (vm, id_set, var_jobid) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);
    id_set.setInteger(await job.getExitCode());
  });

  wasmmodule.registerAsyncExternalFunction("__HS_GETJOBERRORS::RA:I", async (vm, id_set, var_jobid) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);
    id_set.setJSValue(getTypedArray(VariableType.RecordArray, await job.jobobj.getErrors()));
  });

  wasmmodule.registerAsyncExternalFunction("__HS_GETJOBENVIRONMENT::RA:I", async (vm, id_set, var_jobid) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);
    id_set.setJSValue(getTypedArray(VariableType.RecordArray, await job.jobobj.getEnvironment()));
  });

  wasmmodule.registerAsyncExternalMacro("__HS_SETJOBENVIRONMENT:::IRA", async (vm, var_jobid, var_newdata) => {
    const job = ipcContext(vm).jobs.get(var_jobid.getInteger());
    if (!job)
      throw new Error(`No such job with id ${var_jobid.getInteger()}`);
    const newdata = var_newdata.getJSValue() as Array<{ name: string; value: string }>;
    for (const elt of newdata) {
      if (typeof elt.name !== "string" || typeof elt.value !== "string")
        throw new Error(`Incorrect data in new environment record array`);
    }
    await job.jobobj.setEnvironment(newdata);
  });

  wasmmodule.registerAsyncExternalFunction("__SYSTEM_FLUSHREMOTELOG::B:S", async (vm, id_set, var_logname) => {
    await bridge.flushLog(var_logname.getString());
    id_set.setBoolean(true);
  });

  wasmmodule.registerExternalMacro("__HS_SETRUNNINGSTATUS:::B", (vm, var_running) => {
    // Ignored
  });
}

class HareScriptJob {
  vm: HareScriptVM;
  script: string;
  runPromise: Promise<void> | undefined;
  outputEndPoint: IPCEndPoint | undefined;
  exitCode = 0;
  errors: MessageList = [];
  active = true;
  deferShutdown = createDeferred<void>();

  constructor(vm: HareScriptVM, script: string, link: IPCEndPoint, authRecord: unknown, externalSessionData: string) {
    this.vm = vm;
    this.script = script;
    ipcContext(vm).linktoparent = link;
    ipcContext(vm).externalsessiondata = externalSessionData;
    this.setAuthenticationRecord(authRecord);
  }
  captureOutput(encodedLink: unknown) {
    this.outputEndPoint = decodeTransferredIPCEndPoint<IPCMarshallableRecord, IPCMarshallableRecord>(encodedLink);
    const out = (opaqueptr: number, numbytes: number, data: StringPtr, allow_partial: number, error_result: Ptr): number => {
      this.outputEndPoint!.send({ data: Array.from(this.vm.wasmmodule.HEAP8.slice(data, data + numbytes)) });
      return numbytes;
    };

    const outputfunction = this.vm.wasmmodule.addFunction(out, "iiiiii");
    this.vm.wasmmodule._HSVM_SetOutputCallback(this.vm.hsvm, 0, outputfunction);
  }
  setArguments(args: string[]) {
    this.vm.consoleArguments = args;
  }
  start(): void {
    this.runPromise = this.vm.run(this.script).finally(() => this.scriptDone()).catch(e => void (0));
  }
  terminate(): void {
    if (this.active)
      this.vm.wasmmodule._HSVM_AbortVM(this.vm.hsvm);
  }
  async getAuthenticationRecord() {
    const scratchvar = this.vm.allocateVariable();
    this.vm.wasmmodule._HSVM_GetAuthenticationRecord(this.vm.hsvm, scratchvar.id);
    const retval = scratchvar.getJSValue();
    scratchvar.dispose();
    return retval;
  }
  async getExternalSessionData() {
    return ipcContext(this.vm).externalsessiondata;
  }
  async setExternalSessionData(newdata: string) {
    ipcContext(this.vm).externalsessiondata = newdata;
  }
  setAuthenticationRecord(authrecord: unknown): void {
    const scratchvar = this.vm.allocateVariable();
    scratchvar.setJSValue(authrecord);
    this.vm.wasmmodule._HSVM_SetAuthenticationRecord(this.vm.hsvm, scratchvar.id);
    scratchvar.dispose();
  }
  async getEnvironment() {
    const scratchvar = this.vm.allocateVariable();
    this.vm.wasmmodule._GetEnvironment(this.vm.hsvm, scratchvar.id);
    const retval = scratchvar.getJSValue() as Array<{ name: string; value: string }>;
    scratchvar.dispose();
    return retval;
  }
  async setEnvironment(env: Array<{ name: string; value: string }>) {
    const scratchvar = this.vm.allocateVariable();
    scratchvar.setJSValue(env);
    this.vm.wasmmodule._SetEnvironment(this.vm.hsvm, scratchvar.id);
    scratchvar.dispose();
  }
  async waitDone() {
    await this.runPromise;
  }
  getExitCode() {
    return this.exitCode;
  }
  getErrors() {
    return this.errors;
  }
  scriptDone() {
    this.active = false;
    this.exitCode = this.vm.wasmmodule._HSVM_GetConsoleExitCode(this.vm.hsvm);
    this.errors = this.vm.parseMessageList();
    if (this.errors.length)
      this.exitCode = -1; // hsvm_processmgr does it too
    ipcContext(this.vm).linktoparent?.close();
    this.vm.releaseResources();
    this.outputEndPoint?.close();
    this.deferShutdown.resolve();
  }

  close() {
    this.terminate();
    this.deferShutdown.promise.then(() => this.vm.shutdown());
  }
}

export async function harescriptWorkerFactory(script: string, encodedLink: unknown, authRecord: unknown, externalSessionData: string): Promise<HareScriptJob> {
  const link = decodeTransferredIPCEndPoint<IPCMarshallableRecord, IPCMarshallableRecord>(encodedLink);
  const vm = await allocateHSVM();
  return new HareScriptJob(vm, script, link, authRecord, externalSessionData);
}
