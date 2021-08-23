/*
  This is the RPC loader, which is used by the assetpackmanager to generate JSONRPC binding files based on *.rpc.json
  JSONRPC specification files. See services.md for further documentation
*/
let bridge = require('@mod-system/js/wh/bridge');

async function generateRPCWrappers(resourcePath, rpcdata)
{
  let rpcfile = JSON.parse(rpcdata);
  let service = rpcfile.services[0];
  let response = await bridge.invoke("mod::publisher/lib/internal/webdesign/rpcloader.whlib", "GetServiceInfo", service);
  let dependencies = [];
  let warnings = [];

  let output = `// Auto-generated RPC interface from ${resourcePath}
var RPCClient = require("@mod-system/js/wh/rpc").default;
var request = exports.rpcclient = new RPCClient("${service}");
exports.rpcResolve = function(promise, result) { request._handleLegacyRPCResolve(promise, result) };
exports.invoke = function() { return request.invoke.apply(request,Array.prototype.slice.call(arguments)); }
`;
  // Define JSONRPC error code constants as getter-only properties on the exports object
  [ "HTTP_ERROR", "JSON_ERROR", "PROTOCOL_ERROR", "RPC_ERROR", "OFFLINE_ERROR"
  , "TIMEOUT_ERROR", "SERVER_ERROR" ].forEach(function(code, i)
  {
    if (!i)
      output += "\n";
    output += `Object.defineProperty(module.exports, "${code}", { get: function() { return JSONRPC.${code}; }});\n`;
  });

  if (response.diskpath)
  {
    output += `\n// Adding dependency: '${response.diskpath}'\n`;
    dependencies.push(response.diskpath);
  }

  response.functions.forEach(func =>
  {
    if (func.name.toLowerCase().startsWith("rpc"))
    {
      warnings.push("Not including function '" + func.name + "', because its name starts with 'rpc'");
    }
    else
    {
      output += "\n";
      // Export both the original function name and the the function name with a lowercase first letter
      let args = func.arguments.map( arg => `/*${arg.type}*/ ${arg.name}`).join(', ');
      if (func.name[0] != func.name[0].toLowerCase())
      {
        let jsfuncname = func.name[0].toLowerCase() + func.name.substr(1);
        output += `exports.${jsfuncname} = `;
      }
      //note: use ES5 stuff to avoid us requiring a babel polyfill
      output += `exports.${func.name} = /*${func.type}*/function(${args})
{
return request.invoke.apply(request,["${func.name}"].concat(Array.prototype.slice.call(arguments)));
}
`;
    }
  });

  return { output
         , dependencies
         , warnings
         };
}

async function runRPCLoader(context, rpcfile, callback)
{
  // context.inputValue[0] is the parsed JSON object from the 'json' loader
  try
  {
    let result = await generateRPCWrappers(context.resourcePath, rpcfile);
    result.dependencies.forEach(dep => context.addDependency(dep));
    result.warnings.forEach(warning => context.emitWarning(warning));

    callback(null, result.output);
  }
  catch(e)
  {
    console.log('caught runrpcloader error:',e);
    context.emitError(e);
    callback(null, '/*\n' + JSON.stringify(e) + '\n*/\n');
  }
}

function webpackJSONRPCLoader(source)
{
  let callback = this.async();
  if (!callback)
    return "";

  this.cacheable(true);
  runRPCLoader(this, source, callback);
}

module.exports = webpackJSONRPCLoader;

