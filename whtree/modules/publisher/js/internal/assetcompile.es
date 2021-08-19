async function runTask(taskcontext, data)
{
  if(!data.bundle.bundleconfig.compatibility || data.bundle.bundleconfig.compatibility == 'modern')
    return require('./assetcompile-webpack.es')(taskcontext, data);
}

module.exports = runTask;
