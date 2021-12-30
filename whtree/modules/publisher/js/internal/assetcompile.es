/* Dispatch to the proper compiler. Until we've completed webpack migration, you
   can force a compatibility mode by setting WEBHARE_ASSETPACK_FORCE_COMPATIBILITY=xxx
   eg `WEBHARE_ASSETPACK_FORCE_COMPATIBILITY=esnext wh console`

   If you want to debug this task, consider using `wh publisher:compile <assetpack>`,
   it will run us without going through the managed task system like wh assetpacks recompile would.
*/

async function runTask(taskcontext, data)
{
  let bundlecompat = process.env.WEBHARE_ASSETPACK_FORCE_COMPATIBILITY || data.bundle.bundleconfig.compatibility;

  let usewebpack = !bundlecompat || bundlecompat == 'modern';
  if(data.directcompile) //invoked as wh publisher:compile
    console.log(`[assetcompile] Compile bundle '${data.bundle.outputtag}' using ${usewebpack ? 'webpack' : 'esbuild'}`);

  if(usewebpack)
    return require('./assetcompile-webpack.es')(taskcontext, data);
  else
    return require('./esbuild/compiletask.es')(taskcontext, data);
}

module.exports = runTask;
