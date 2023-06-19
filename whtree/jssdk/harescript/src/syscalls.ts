import * as crypto from "node:crypto";
import { config } from "@webhare/services";
import * as vm from 'node:vm';

/* Syscalls are simple APIs for HareScript to reach into JS-native functionality that would otherwise be supplied by
   the C++ baselibs, eg openssl crypto. These APIs are generally pure and JSON based for ease of implementation and
   is used for initial API implementation. Once a syscall is too slow or inefficient, it should use the faster
   externalfunction/dllinterface APIs */

// Used by wasm.whlib to detect the WASM environment (the C++ EM_Syscall implementation would always return null)
export function init() {
  return { iswasm: true };
}

/* invoked by crypto.whlib:
    RETURN DecodeBase64(EM_SYSCALL("getHash", CELL[ data := EncodeBase64(BlobToString(data)), algorithm, key_salt ]).base64);
*/
export function getHash(params: { data: string; algorithm: string; key_salt: string }): { base64: string } {
  switch (params.algorithm) {
    case "MD5": {
      const hasher = crypto.createHash("md5");
      hasher.update(params.data, "base64");
      return { base64: hasher.digest("base64") };
    }
    case "SHA-1": {
      const hasher = crypto.createHash("sha1");
      hasher.update(params.data, "base64");
      return { base64: hasher.digest("base64") };
    }
  }
  throw new Error("Unsupported algorithm: " + params.algorithm);
}

export function webHareConfig() {
  return {
    servertype: config.dtapstage,
    servername: config.servername,
    primaryinterfaceurl: config.backendurl,
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
