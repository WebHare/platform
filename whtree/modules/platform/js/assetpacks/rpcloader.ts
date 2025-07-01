/*
  This is the RPC loader, which is used by the assetpackmanager to generate JSONRPC binding files based on *.rpc.json
  JSONRPC specification files. See services.md for further documentation
*/
import * as fs from "fs";
import { loadlib } from '@webhare/harescript';
import type * as esbuild from 'esbuild';
import type { CaptureLoadPlugin } from "./compiletask";
import { AsyncLocalStorage } from "async_hooks";

async function generateRPCWrappers(resourcePath: string, rpcdata: string) {
  const rpcfile = JSON.parse(rpcdata);
  const service = rpcfile.services[0];
  const response = await loadlib("mod::publisher/lib/internal/webdesign/rpcloader.whlib").GetServiceInfo(service);
  const dependencies = [];
  const warnings: string[] = [];

  let output = `// Auto-generated RPC interface from ${resourcePath}
var RPCClient = require("@mod-system/js/wh/rpc").default;
var request = exports.rpcclient = new RPCClient("${service}");
exports.rpcResolve = function (promise, result) { request._handleLegacyRPCResolve(promise, result) };
exports.invoke = function () { return request.invoke.apply(request,Array.prototype.slice.call(arguments)); }
`;
  // Define JSONRPC error code constants as getter-only properties on the exports object
  [
    "HTTP_ERROR", "JSON_ERROR", "PROTOCOL_ERROR", "RPC_ERROR", "OFFLINE_ERROR",
    "TIMEOUT_ERROR", "SERVER_ERROR"
  ].forEach(function (code, i) {
    if (!i)
      output += "\n";
    output += `Object.defineProperty(module.exports, "${code}", { get: function () { return JSONRPC.${code}; }});\n`;
  });

  if (response.diskpath) {
    output += `\n// Adding dependency: '${response.diskpath}'\n`;
    dependencies.push(response.diskpath);
  }

  response.functions.forEach((func: { name: string; arguments: Array<{ type: string; name: string }>; type: string }) => {
    if (func.name.toLowerCase().startsWith("rpc")) {
      warnings.push("Not including function '" + func.name + "', because its name starts with 'rpc'");
    } else {
      output += "\n";
      // Export both the original function name and the the function name with a lowercase first letter
      const args = func.arguments.map(arg => `/*${arg.type}*/ ${arg.name}`).join(', ');
      if (func.name[0] !== func.name[0].toLowerCase()) {
        const jsfuncname = func.name[0].toLowerCase() + func.name.substr(1);
        output += `exports.${jsfuncname} = `;
      }
      //note: use ES5 stuff to avoid us requiring a babel polyfill
      output += `exports.${func.name} = /*${func.type}*/function (${args})
{
return request.invoke.apply(request,["${func.name}"].concat(Array.prototype.slice.call(arguments)));
}
`;
    }
  });

  return {
    output,
    dependencies,
    warnings
  };
}
import { toFSPath } from "@webhare/services";
import { basename } from "path";

export function buildRPCLoaderPlugin(captureplugin: CaptureLoadPlugin) {
  const runInAsyncScope = AsyncLocalStorage.snapshot();
  return {
    name: "jsonrpc",
    setup: function (build: esbuild.PluginBuild) {
      build.onLoad({ filter: /.\.rpc\.json$/, namespace: "file" }, a => runInAsyncScope(async (args) => {
        const url = new URL(`file:///${args.path}${args.suffix}`);
        if (url.searchParams.has("proxy")) { //Opting in to the loadlib-less Proxy implementation
          const source = await fs.promises.readFile(args.path, 'utf8');
          const rpcfile = JSON.parse(source);
          const service = rpcfile.services[0];
          const contents = `const { createService } = require("@mod-system/js/wh/rpc.ts"); export default createService("${service}");`;
          const dependencies = [args.path, toFSPath("mod::system/js/wh/rpc.ts")];

          dependencies.forEach(dep => captureplugin.loadcache.add(dep));

          return { contents, warnings: [], watchFiles: dependencies };
        }

        // Original Harescript-dependent implementation
        const source = await fs.promises.readFile(args.path);
        const result = await generateRPCWrappers(args.path, source.toString());

        result.dependencies.forEach(dep => captureplugin.loadcache.add(dep));

        return {
          contents: result.output,
          warnings: [
            { text: `Load of '${basename(args.path)}' is slow, add ?proxy but don't import with "import * as"` },
            ...result.warnings.map(_ => ({ text: _ }))
          ],
          watchFiles: result.dependencies //NOTE doesn't get used until we get rid of captureplugin
        };
      }, a));
    }
  };
}
