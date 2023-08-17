import { backendConfig } from "@webhare/services";
import * as vm from 'node:vm';
import * as services from '@webhare/services';
import { HareScriptVM } from "./harescript";

/* Syscalls are simple APIs for HareScript to reach into JS-native functionality that would otherwise be supplied by
   the C++ baselibs, eg openssl crypto. These APIs are generally pure and JSON based for ease of implementation and
   is used for initial API implementation. Once a syscall is too slow or inefficient, it should use the faster
   externalfunction/dllinterface APIs */

// Used by wasm.whlib to detect the WASM environment (the C++ EM_Syscall implementation would always return null)
export function init() {
  return { iswasm: true };
}

export async function lockMutex(this: HareScriptVM, params: { mutexname: string; wait_until: Date }) {
  const mutex = await services.lockMutex(params.mutexname, { timeout: params.wait_until });
  if (!mutex)
    return { status: "timeout" };

  this.mutexes.push(mutex);
  return { status: "ok", mutex: this.mutexes.length };
}

export async function unlockMutex(this: HareScriptVM, params: { mutexid: number }) {
  this.mutexes[params.mutexid - 1]?.release();
  this.mutexes[params.mutexid - 1] = null;
  return null;
}

export function webHareConfig() {
  return {
    servertype: backendConfig.dtapstage,
    servername: backendConfig.servername,
    primaryinterfaceurl: backendConfig.backendURL,
    __eventmasks: [
      "system:registry.system.global",
      "system:whfs.sitemeta.16" //site 16 (WebHare backend) tells us where the primaryinterfaceurl is
    ]
  };
}

/** Run JavaScript code directly (no TypeScript!) */
export function executeInline({ func, param }: { func: string; param?: unknown }): Promise<unknown> {
  const compileOptions = {
    contextExtensions: [{ require }]
  };

  /* When the keyword "await" is present in the function code, it needs to be run in an async function. For false
     positives, this might result in a somewhat slower execution, but no correctness problems.
  */
  if (func.indexOf("await") !== -1) {
    if (param !== undefined) {
      const tocall = vm.compileFunction(`async function wrapper(param) { ${func} }; return wrapper($param);`, ["$param"], compileOptions);
      return tocall(param);
    } else {
      const tocall = vm.compileFunction(`async function wrapper() { ${func} }; return wrapper();`, [], compileOptions);
      return tocall();
    }
  } else {
    if (param !== undefined) {
      const tocall = vm.compileFunction(func, ["param"], compileOptions);
      return tocall(param);
    } else {
      const tocall = vm.compileFunction(func, [], compileOptions);
      return tocall();
    }
  }
}
