// short: Convert a resource path to a filesystem path

import { toFSPath } from "@webhare/services";

// syntax: <path>
if (!process.argv[2]) {
  console.log("Syntax: wh tofspath <path>");
  process.exit(1);
}

console.log(toFSPath(process.argv[2]));
