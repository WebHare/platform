import { backendConfig } from "@webhare/services";
import * as vm from 'node:vm';
import * as services from '@webhare/services';
import { HareScriptVM } from "./harescript";
import { defaultDateTime, formatISO8601Date, localizeDate, maxDateTimeTotalMsecs } from "@webhare/hscompat/datetime";
import { VariableType } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { IPCEncodedException, parseIPCException } from "@mod-system/js/internal/whmanager/ipc";

/* Syscalls are simple APIs for HareScript to reach into JS-native functionality that would otherwise be supplied by
   the C++ baselibs, eg openssl crypto. These APIs are generally pure and JSON based for ease of implementation and
   is used for initial API implementation. Once a syscall is too slow or inefficient, it should use the faster
   externalfunction/dllinterface APIs */

// Used by wasm.whlib to detect the WASM environment (the C++ EM_Syscall implementation would always return null)
export function init() {
  return { iswasm: true };
}

export async function lockMutex(hsvm: HareScriptVM, params: { mutexname: string; wait_until: Date }) {
  const mutex = await services.lockMutex(params.mutexname, { timeout: params.wait_until });
  if (!mutex)
    return { status: "timeout" };

  hsvm.mutexes.push(mutex);
  return { status: "ok", mutex: hsvm.mutexes.length };
}

export async function unlockMutex(hsvm: HareScriptVM, params: { mutexid: number }) {
  hsvm.mutexes[params.mutexid - 1]?.release();
  hsvm.mutexes[params.mutexid - 1] = null;
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
export function executeInline(hsvm: HareScriptVM, { func, param }: { func: string; param?: unknown }): Promise<unknown> {
  const compileOptions = {
    contextExtensions: [{ require }]
  };

  /* When the keyword "await" is present in the function code, it needs to be run in an async function. For false
     positives, this might result in a somewhat slower execution, but no correctness problems.
  */
  if (func.indexOf("await") !== -1) {
    if (param !== undefined) {
      const tocall = vm.compileFunction(`async function wrapper(vm, param) { ${func} }; return wrapper($vm, $param);`, ["$vm", "$param"], compileOptions);
      return tocall(hsvm, param);
    } else {
      const tocall = vm.compileFunction(`async function wrapper(vm) { ${func} }; return wrapper($vm);`, ["$vm"], compileOptions);
      return tocall(hsvm);
    }
  } else {
    if (param !== undefined) {
      const tocall = vm.compileFunction(func, ["vm", "param"], compileOptions);
      return tocall(hsvm, param);
    } else {
      const tocall = vm.compileFunction(func, ["vm"], compileOptions);
      return tocall(hsvm);
    }
  }
}

export function formatISO8601DateTime(_hsvm: HareScriptVM, params: {
  date: Date; options: {
    dateformat: "year" | "month" | "day" | "empty";
    timeformat: "hours" | "minutes" | "seconds" | "milliseconds" | "empty";
    timezone: string;
    extended: boolean;
  };
}) {
  if (params.date.getTime() <= defaultDateTime.getTime() || params.date.getTime() >= maxDateTimeTotalMsecs)
    return { result: "" };

  return {
    result: formatISO8601Date(params.date, {
      dateFormat: params.options.dateformat,
      timeFormat: params.options.timeformat,
      timeZone: params.options.timezone,
      extended: params.options.extended
    })
  };
}

export function localizeDateTime(_hsvm: HareScriptVM, params: {
  formatstring: string;
  date: Date;
  locale: string;
  timezone: string;
}) {
  if (params.date.getTime() <= defaultDateTime.getTime() || params.date.getTime() >= maxDateTimeTotalMsecs)
    return { result: "" };

  return {
    result: localizeDate(params.formatstring, params.date, params.locale, params.timezone || "UTC")
  };
}
export function getActionQueue(hsvm: HareScriptVM) {
  const functionrequests = [];
  for (const req of hsvm.pendingFunctionRequests) {
    if (req.sent)
      continue;

    Object.defineProperty(req.params, "__hstype", { value: VariableType.VariantArray }); //hack so setJSValue doesn't mangle us as determineType is confused bt HSVMVars (but we really should reconsider allowing setJSValue to take HSVMVars)
    functionrequests.push({
      id: req.id,
      functionref: req.functionref,
      params: req.params,
      object: req.object
    });
    req.sent = true;
  }

  return {
    ///Function calls the JS code wants the HSVM to execute
    functionrequests
  };
}

export function resolvedFunctionRequest(hsvm: HareScriptVM, { id, ismacro, resolved, rejected }: { id: number; ismacro: boolean; resolved?: unknown; rejected?: IPCEncodedException }) {
  // console.log("resolvedFunctionRequest", id, ismacro, resolved, rejected);
  const req = hsvm.pendingFunctionRequests.findIndex(_ => _.id == id);
  if (req == -1) //already resolved
    return;

  if (rejected)
    hsvm.pendingFunctionRequests[req].reject(parseIPCException({ __exception: rejected }));
  else
    hsvm.pendingFunctionRequests[req].resolve(ismacro ? undefined : resolved);

  hsvm.pendingFunctionRequests.splice(req, 1);
}
