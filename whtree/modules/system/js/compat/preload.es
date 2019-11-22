if(!window.__dompackdeprecated)
  window.__dompackdeprecated=[];
window.__dompackdeprecated.push("@mod-system/js/compat/preload.es");

import * as preload from 'dompack/extra/preload';

module.exports = { promiseImage: preload.promiseImage
                 , promiseScript: preload.promiseScript
                 };
