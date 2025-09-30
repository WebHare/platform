import { decodeYAML } from "@mod-platform/js/devsupport/validation";
import { backendConfig } from "@webhare/services";
import { readFile } from "fs/promises";

interface Axioms {
  publishPackages: string[];
  copyPackageFields: string[];
}

export async function readAxioms(): Promise<Axioms> {
  return decodeYAML<Axioms>(await readFile(__dirname + "/../../data/facts/axioms.yml", "utf8"));
}

export async function readPlatformConf(): Promise<Record<string, string>> {
  const source = await readFile(backendConfig.installationRoot + "etc/platform.conf", "utf8");
  const result: Record<string, string> = {};
  for (const line of source.split("\n")) {
    const [key, value] = line.split("=");
    if (key.trim().startsWith("#") || !value || !value.trim())
      continue;

    result[key.trim()] = value.trim();
  }

  return result;
}
