// eslint-disable-next-line @typescript-eslint/no-require-imports -- not sure why a js can't require though .. our eslint seems confused
const fs = require("fs");
let pluginNum = 1;

module.exports = function (opts, prefix) {
  const filterRegExp = opts && opts.regEx ? new RegExp(opts.regEx) : /\.txt1$/;
  return {
    name: `testplugin-${++pluginNum}`,
    setup(build) {
      // Load ".txt" files and return an array of words
      build.onLoad({ filter: filterRegExp }, async (args) => {
        let text = fs.readFileSync(args.path, 'utf8');
        return {
          contents: JSON.stringify( (prefix || "") + text.split(/\s+/)),
          loader: 'json',
        };
      });
    }
  };
};

module.exports.loader = function (opts) {
  const filterRegExp = opts && opts.regEx ? new RegExp(opts.regEx) : /\.load$/;
  return {
    name: `testplugin-${++pluginNum}`,
    setup(build) {
      build.onLoad({ filter: filterRegExp }, async (args) => {
        return {
          loader: "file",
          contents: Uint8Array.from(await fs.promises.readFile(args.path)),
        };
      });
    }
  };
};
