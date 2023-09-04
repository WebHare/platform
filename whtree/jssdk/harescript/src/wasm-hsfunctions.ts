import { createHarescriptModule, recompileHarescriptLibrary, HareScriptVM } from "./wasm-hsvm";
import { IPCMarshallableRecord, VariableType, getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { backendConfig, log } from "@webhare/services";
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { HSVMVar } from "./wasm-hsvmvar";
import { WASMModule } from "./wasm-modulesupport";
import { HSVM, Ptr, StringPtr } from "wh:internal/whtree/lib/harescript-interface";
import { OutputObjectBase } from "@webhare/harescript/src/wasm-modulesupport";
import { generateRandomId, sleep } from "@webhare/std";
import * as syscalls from "./syscalls";
import { localToUTC, utcToLocal } from "@webhare/hscompat/datetime";
import { isWHDBBlob } from "@webhare/whdb/src/blobs";
import * as crypto from "node:crypto";
import { IPCEndPoint, IPCMessagePacket, IPCPort } from "@mod-system/js/internal/whmanager/ipc";
import { isValidName } from "@webhare/whfs/src/support";

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
  async activate() {
    try {
      await this.link?.activate();
    } catch (e) {
      // Ignore activation errors, they will close the link anyway
      this.setReadSignalled(true);
    }
  }
}

const ipcContext = contextGetterFactory(class {
  ports = new Map<number, HSIPCPort>;
  links = new Map<number, HSIPCLink>;
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

  wasmmodule.registerAsyncExternalFunction("CREATEHASHER::I:S", async (vm, id_set, varAlgorithm) => {
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

  wasmmodule.registerAsyncExternalFunction("FINALIZEHASHER::S:I", async (vm, id_set, id) => {
    const hasher = Hasher.context(vm).hashers.get(id.getInteger());
    if (!hasher)
      throw new Error(`No such crypto hasher with id ${id.getInteger()}`);
    id_set.setString(hasher.finalize());
  });

  wasmmodule.registerAsyncExternalFunction("__HS_CREATENAMEDIPCPORT::I:SB", async (vm, id_set, var_portname, var_globalport) => {
    const port = bridge.createPort(var_portname.getString(), { global: var_globalport.getBoolean() });
    const hsport = new HSIPCPort(vm, port);
    ipcContext(vm).ports.set(hsport.id, hsport);
    await hsport.port.activate();
    id_set.setInteger(hsport.id);
  });

  wasmmodule.registerExternalFunction("__HS_CONNECTTOIPCPORT::I:S", (vm, id_set, var_portname) => {
    let link: IPCEndPoint | undefined;
    if (var_portname.getString() !== "system:whmanager") {
      link = bridge.connect(var_portname.getString(), { global: false });
    }
    const hslink = new HSIPCLink(vm, link);
    // Not waiting for activation by the other side, HareScript didn't do that either.
    hslink.activate();
    ipcContext(vm).links.set(hslink.id, hslink);
    id_set.setInteger(hslink.id);
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
      id_set.setJSValue({ msgid: 0n, status: "closed" });
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
      await sleep(1);
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

  wasmmodule.registerExternalMacro("SETEXTERNALSESSIONDATA:::S", (vm, var_sessiondata) => {
    ipcContext(vm).externalsessiondata = var_sessiondata.getString();
  });
}
