//I guess we're extending the theme of the 'validation' folder to 'validation and parsing'

import YAML from "yaml";

///Simply decode YAML data, throw on failure.
export function decodeYAML(text: string, options: { json: boolean }): unknown {
  const result = YAML.parse(text, { strict: true, version: "1.2" });
  return options.json ? JSON.stringify(result) : result;
}
