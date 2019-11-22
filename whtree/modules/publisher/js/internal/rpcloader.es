/*
  This is the RPC loader, which is used by the assetpackmanager to generate JSONRPC binding files based on *.rpc.json
  JSONRPC specification files. A JSONRPC specification file should contain one object, with a "services" key listing the
  JSONRPC services to include, e.g.:

  { "imports": [ "tollium:autocomplete" ]
  }

  This will generate Promise-returning functions for all public functions within the service. These functions can the be used
  to run JSONRPC requests:

  var autoCompleteService = require("autocomplete.rpc.json");
  autoCompleteService.autoComplete("ipcport", "query").then(function(result)
  {
    console.log("Received result", result.values);
  });

  To specify options to use when running the request, use the 'rpcOptions' object:

  autoCompleteService.rpcOptions.timeout = 30000; // Set timeout to 30 seconds

  If you want more control over the JSONRPC object, for example to add 'requeststart' or 'requestend' event listeners or for
  referencing JSONRPC error codes use the 'rpcObject' property:


*/
let bridge = require('@mod-system/js/wh/bridge');

async function getWrappers(context, service)
{
  var url = "/wh_services/" + service.replace(":", "/");
  let response = await bridge.invoke("mod::publisher/lib/internal/webdesign/rpcloader.whlib", "GetServiceInfo", service);
  let output='';

  if (response.diskpath)
  {
    output += `\n// Adding dependency: '${response.diskpath}'\n`;
    context.addDependency(response.diskpath);
  }

  response.functions.forEach(func =>
  {
    if (func.name.toLowerCase().startsWith("rpc"))
    {
      context.emitWarning("Not including function '" + func.name + "', because its name starts with 'rpc'");
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
var opts={url:"${url}"+urlappend};
for (var k in options)
if(options.hasOwnProperty(k))
opts[k]=options[k];

return request.promiseRequest("${func.name}",Array.prototype.slice.call(arguments),opts);
}
`;
    }
  });
  return output;
}

async function runRPCLoader(context, rpcfile, callback)
{
  // context.inputValue[0] is the parsed JSON object from the 'json' loader
  try
  {
    rpcfile = JSON.parse(rpcfile);

    let output = `// Auto-generated RPC interface from ${context.resourcePath}
var JSONRPC = require("@mod-system/js/net/jsonrpc");
var request = exports.rpcObject = new JSONRPC();
exports.rpcResolve = function(promise, result) { request._doAsyncAbort(promise, result) };
exports.rpcReject = function(promise, reject) { request._doAsyncAbort(promise, null, reject) };
var urlappend = '';
if(self&&self.location)
{
  var urldebugvar = window.location.href.match(new RegExp('[\?&#]wh-debug=([^&#?]*)'));
  if(urldebugvar)
    urlappend='?wh-debug='+urldebugvar[1];
}
var options = exports.rpcOptions = {};
`;
    // Define JSONRPC error code constants as getter-only properties on the exports object
    [ "HTTP_ERROR", "JSON_ERROR", "PROTOCOL_ERROR", "RPC_ERROR", "OFFLINE_ERROR"
    , "TIMEOUT_ERROR", "SERVER_ERROR" ].forEach(function(code, i)
    {
      if (!i)
        output += "\n";
      output += `Object.defineProperty(module.exports, "${code}", { get: function() { return JSONRPC.${code}; }});\n`;
    });

    output += (await Promise.all(rpcfile.services.map(service => getWrappers(context, service)))).join('');
    callback(null, output);
  }
  catch(e)
  {
    console.log('caught runrpcloader error:',e);
    context.emitError(e);
    callback(null, '/*\n' + JSON.stringify(e) + '\n*/\n');
  }
}

module.exports = function(source)
{
  let callback = this.async();
  if (!callback)
    return "";

  this.cacheable(true);
  runRPCLoader(this, source, callback);
};
