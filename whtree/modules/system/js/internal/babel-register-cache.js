"use strict";

let path = require("path");
let fs = require("fs");
let mkdirpSync = require("mkdirp").sync;
let homeOrTmp = require("home-or-tmp");
let pathExists = require("path-exists");

const FILENAME = process.env.BABEL_CACHE_PATH || path.join(homeOrTmp, ".babel.json");
let data = {};

/**
 * Write stringified cache to disk.
 */

function save() {
  let serialised = {};
  try {
    serialised = JSON.stringify(data, null, "  ");
  } catch (err) {
    if (err.message === "Invalid string length") {
      err.message = "Cache too large so it's been cleared.";
      console.error(err.stack);
    } else {
      throw err;
    }
  }
  mkdirpSync(path.dirname(FILENAME));
  fs.writeFileSync(FILENAME, serialised);
}

/**
 * Load cache from disk and parse.
 */

function load() {
  // We still want the cache to trigger when doing coverage testing, even if nyc disables it for us
  let env = process.env.BABEL_ENV || process.env.NODE_ENV;
  if (process.env.BABEL_DISABLE_CACHE && env !== "coverage") return;

  process.on("exit", save);
  process.nextTick(save);

  if (!pathExists.sync(FILENAME)) return;

  try {
    data = JSON.parse(fs.readFileSync(FILENAME));
  } catch (err) {
    return;
  }

//  console.log("loaded cache", Object.keys(data).length);
}

/**
 * Retrieve data from cache.
 */

function get() {
  return data;
}

module.exports.get = get;
module.exports.load = load;
module.exports.save = save;
