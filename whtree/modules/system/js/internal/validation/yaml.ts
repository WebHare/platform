//I guess we're extending the theme of the 'validation' folder to 'validation and parsing'

import YAML from "yaml";

export function decodeYAML(text: string, options: { json: true }): string;
export function decodeYAML<T>(text: string, options?: { json: boolean }): T;

///Simply decode YAML data, throw on failure.
export function decodeYAML<T>(text: string, options?: { json: boolean }): T {
  const result = YAML.parse(text, { strict: true, version: "1.2" });
  return options?.json ? JSON.stringify(result) : result;
}
