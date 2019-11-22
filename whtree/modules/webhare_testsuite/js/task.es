"use strict";

async function runTask(context, data)
{
  context.resolveByCompletion({ nodepong: data.nodeping });
}

module.exports = runTask;
