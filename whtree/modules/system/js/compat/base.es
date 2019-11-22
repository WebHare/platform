import * as whintegration from '@mod-system/js/wh/integration';
import * as domdebug from 'dompack/src/debug';

module.exports = { config: whintegration.config
                 , debug: domdebug.debugflags
                 };

console.warn("compat/base has been deprecated and will be removed.");
console.warn("- WHBase.debug => dompack.debugflags");
console.warn("- WHBase.config => whintegration.config");
