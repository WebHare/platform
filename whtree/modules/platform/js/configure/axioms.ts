import { decodeYAML } from "@mod-system/js/internal/validation/yaml";
import { readFile } from "fs/promises";

interface Axioms {
  publishPackages: string[];
  copyPackageFields: string[];
}

export async function readAxioms(): Promise<Axioms> {
  return decodeYAML<Axioms>(await readFile(__dirname + "/../../data/facts/axioms.yml", "utf8"));
}
