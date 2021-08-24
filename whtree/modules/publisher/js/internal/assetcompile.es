/* Dispatch to the proper compiler. Until we've completed webpack migration, you
   can force a compatibility mode by setting WEBHARE_ASSETPACK_FORCE_COMPATIBILITY=xxx
   eg `WEBHARE_ASSETPACK_FORCE_COMPATIBILITY=esnext wh console`
*/

async function runTask(taskcontext, data)
{
  let bundlecompat = process.env.WEBHARE_ASSETPACK_FORCE_COMPATIBILITY || data.bundle.bundleconfig.compatibility;
  if(!bundlecompat || bundlecompat == 'modern')
    return require('./assetcompile-webpack.es')(taskcontext, data);
  else
    return require('./esbuild/compiletask.es')(taskcontext, data);
}

module.exports = runTask;
