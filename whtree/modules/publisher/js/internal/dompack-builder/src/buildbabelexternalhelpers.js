// When added as entry "!!val!<path>" into webpack, this file expands to a source file with all babel helpers
module.exports = () => ({ code: require("@babel/core").buildExternalHelpers() });
