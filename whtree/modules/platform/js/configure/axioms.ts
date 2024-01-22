import { readFile } from "fs/promises";
import YAML from "yaml";

interface Axioms {
  publishPackages: string[];
  copyPackageFields: string[];
}

export async function readAxioms(): Promise<Axioms> {
  return YAML.parse(await readFile(__dirname + "/../../data/facts/axioms.yml", "utf8")) as Axioms;
}
