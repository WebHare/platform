import { backendConfig } from "@webhare/services";
import * as vm from 'node:vm';
import * as services from '@webhare/services';
import { HareScriptVM } from "./harescript";
import { defaultDateTime, formatISO8601Date, localizeDate, maxDateTimeTotalMsecs } from "@webhare/hscompat/datetime";

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
