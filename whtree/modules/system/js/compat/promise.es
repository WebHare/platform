if(!window.__dompackdeprecated)
  window.__dompackdeprecated=[];
window.__dompackdeprecated.push("@mod-system/js/compat/promise.es");

const dompromise = require('dompack/src/promise');

/** @require: const Promise = require('@mod-system/js/compat/promise.es') */

// Workaround babel error that 'Promise.defer = ' isn't converted to the Babel promise type
let PromiseType = Promise;
if(!PromiseType.defer)
{
  PromiseType.defer = dompromise.createDeferred;
}
module.exports = PromiseType;
