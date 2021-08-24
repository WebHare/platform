const path = require('path');
const bridge = require('@mod-system/js/wh/bridge');

function resolveWebHareAssetPath(startingpoint, inpath)
{
  if(inpath.startsWith("dompack/"))
  {
    return path.join(bridge.getInstallationRoot(), "modules/system/js/" + inpath);
  }
  try
  {
    // https://nodejs.org/api/modules.html#modules_require_resolve_request_options
    let paths = [];
    if(startingpoint)
      paths.push(startingpoint);
    paths.push(path.join(bridge.getBaseDataRoot(),"nodejs/node_modules/"));

    return require.resolve(inpath, { paths });
  }
  catch(e)
  {
    // console.log("resolve failed");
    return null;
  }
}

module.exports = { resolveWebHareAssetPath };
