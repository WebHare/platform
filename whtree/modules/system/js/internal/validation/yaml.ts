//I guess we're extending the theme of the 'validation' folder to 'validation and parsing'

import { toSnakeCase } from "@webhare/hscompat";
import { decodeYAML } from "@mod-platform/js/devsupport/validation";

export { decodeYAML };

export function __decodeForHareScript(text: string, mode: "json" | "snakecase") {
  const result = decodeYAML(text);
  if (mode === "json")
    return JSON.stringify(result);
  else if (mode === "snakecase")
    return toSnakeCase(result as object);
  else
    throw new Error("Invalid mode");
}
