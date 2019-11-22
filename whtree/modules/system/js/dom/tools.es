//ADDME starting from 4.07 or so, warn about uses of domtools
const dompack = require ('dompack');
module.exports = { ...dompack
                 , registerComponent:dompack.register //backwards compat
                 , onready:dompack.onDomReady
                 };
