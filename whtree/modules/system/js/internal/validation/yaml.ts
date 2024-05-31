//I guess we're extending the theme of the 'validation' folder to 'validation and parsing'

import { toSnakeCase } from "@webhare/hscompat";
import YAML from "yaml";

///Simply decode YAML data, throw on failure.
export function decodeYAML<T>(text: string): T {
  const result = YAML.parse(text, { strict: true, version: "1.2" });
  return result;
}

export function __decodeForHareScript(text: string, mode: "json" | "snakecase") {
  const result = YAML.parse(text, { strict: true, version: "1.2" });
  if (mode === "json")
    return JSON.stringify(result);
  else if (mode === "snakecase")
    return toSnakeCase(result);
  else
    throw new Error("Invalid mode");
}
