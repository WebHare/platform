import { readFileSync } from "node:fs";
import { toFSPath } from "./resources";
import { DOMParser } from '@xmldom/xmldom';
import { elements } from "@mod-system/js/internal/generation/xmlhelpers";

export interface ParseError {
  resource: string;
  line: number;
  error: string;
}

export interface LogFile {
  filename: string;
  timestamps: boolean;
}

export interface ModuleDefinition {
  logs: Record<string, LogFile>;
  errors: ParseError[];
}

function parseLogs(resource: string, logging: Element) {
  const result: Pick<ModuleDefinition, "logs" | "errors"> = { logs: {}, errors: [] };
  for (const lognode of elements(logging.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "log"))) {
    const name = lognode.getAttribute("name");
    const filename = lognode.getAttribute("filename");
    if (!name || !filename) {
      result.errors.push({ resource, line: 0, error: "Invalid <log> node" });
      continue;
    }

    result.logs[name] = {
      filename,
      timestamps: !['0', 'false'].includes(lognode.getAttribute("timestamps") || 'true')
    };
  }

  return result;
}


//TODO we probably want to parse and cache these as JSON. we might even offer YAML as an alternative format (but we'd first need to have HareScript stop parsing XML then)
//TODO cache in process, discard cached version on update
export function getModuleDefinition(name: string): ModuleDefinition {
  const result: ModuleDefinition = {
    logs: {},
    errors: []
  };

  const resource = `mod::${name}/moduledefinition.xml`;
  const doc = new DOMParser().parseFromString(readFileSync(toFSPath(resource)).toString('utf-8'), 'text/xml');
  const logging = doc.getElementsByTagNameNS("http://www.webhare.net/xmlns/system/moduledefinition", "logging")[0];
  if (logging) {
    const { logs, errors } = parseLogs(resource, logging);
    result.logs = logs;
    result.errors.push(...errors);
  }

  return result;
}
