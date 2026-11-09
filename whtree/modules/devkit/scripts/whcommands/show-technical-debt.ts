// @webhare/cli: Scan module for modernizable things.

/* Scan a WebHare module for constructs that can be modernized. Read-only: it never changes files.

   wh devkit:scan-technical-debt [--json] [--no-lint] <module>

   Deprecated APIs are found with the module's typed ESLint setup (as used by `wh checkmodule`) plus the
   @typescript-eslint/no-deprecated rule, so every `@deprecated` JSDoc tag in the platform is covered without
   maintaining a list here. Deprecated YAML properties (eg. siteprofile `pageBuilder` -> `onRenderPage`) are found
   the same way using `deprecated: true` in the JSON schemas registered as moduleFileTypes. The other categories
   are file and import patterns that aren't marked deprecated.
*/

import { ESLint } from "eslint";
import { buildRelaxedConfig } from "@webhare/eslint-config";
import { backendConfig, resolveResource, toFSPath, toResourcePath } from "@webhare/services";
import { runCli } from "@webhare/cli";
import { globSync, readFileSync } from "node:fs";
import { getAllModuleYAMLs } from "@webhare/services/src/moduledefparser";
import { decodeYAML, TrackedYAML } from "@mod-platform/js/devsupport/yaml";

type Hit = { file: string; line?: number; detail?: string };
type Category = { id: string; title: string; skill: string; hits: Hit[] };

type SchemaNode = {
  $ref?: string;
  type?: string | string[];
  deprecated?: boolean;
  description?: string;
  properties?: Record<string, SchemaNode>;
  patternProperties?: Record<string, SchemaNode>;
  additionalProperties?: SchemaNode | boolean;
  items?: SchemaNode;
  oneOf?: SchemaNode[];
  anyOf?: SchemaNode[];
  allOf?: SchemaNode[];
  $defs?: Record<string, SchemaNode>;
};

/** Expand a schema node into the plain subschemas that may apply (following $refs and oneOf/anyOf/allOf branches) */
function expandSchema(root: SchemaNode, node: SchemaNode | boolean | undefined, seen = new Set<SchemaNode>()): SchemaNode[] {
  if (!node || node === true || seen.has(node))
    return [];
  seen.add(node);
  const result = [node];
  if (node.$ref?.startsWith("#/")) {
    let target: unknown = root;
    for (const part of node.$ref.substring(2).split("/"))
      target = (target as Record<string, unknown> | undefined)?.[part];
    result.push(...expandSchema(root, target as SchemaNode | undefined, seen));
  }
  for (const branch of [...node.oneOf ?? [], ...node.anyOf ?? [], ...node.allOf ?? []])
    result.push(...expandSchema(root, branch, seen));
  return result;
}

/** Check whether a value could match the schema's 'type' (so we don't report a deprecated oneOf branch for a value in a different form) */
function typeMatches(node: SchemaNode, value: unknown) {
  if (!node.type)
    return true;
  const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value === "number" ? (Number.isInteger(value) ? "integer" : "number") : typeof value;
  const allowed = Array.isArray(node.type) ? node.type : [node.type];
  return allowed.includes(actual) || (actual === "integer" && allowed.includes("number"));
}

/** Find properties in a YAML document that its schema marks as deprecated. Deliberately lenient: any oneOf/anyOf
    branch may match, as we're only looking for deprecated names, not validating */
function findDeprecatedProperties(root: SchemaNode, schema: SchemaNode, data: unknown, pointer: string, found: Array<{ pointer: string; detail: string }>) {
  const candidates = expandSchema(root, schema);
  if (Array.isArray(data)) {
    data.forEach((item, idx) => {
      for (const cand of candidates)
        if (cand.items)
          findDeprecatedProperties(root, cand.items, item, `${pointer}/${idx}`, found);
    });
    return;
  }
  if (!data || typeof data !== "object")
    return;

  for (const [key, value] of Object.entries(data)) {
    const subSchemas: SchemaNode[] = [];
    for (const cand of candidates) {
      if (cand.properties?.[key])
        subSchemas.push(cand.properties[key]);
      for (const [pattern, sub] of Object.entries(cand.patternProperties ?? {}))
        if (new RegExp(pattern, "u").test(key))
          subSchemas.push(sub);
      if (!cand.properties?.[key] && typeof cand.additionalProperties === "object")
        subSchemas.push(cand.additionalProperties);
    }

    const keyPointer = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    const deprecated = subSchemas.flatMap(sub => expandSchema(root, sub)).find(sub => sub.deprecated && typeMatches(sub, value));
    if (deprecated && !found.some(_ => _.pointer === keyPointer)) //multiple oneOf branches may lead us here
      found.push({ pointer: keyPointer, detail: `'${key}' is deprecated${deprecated.description ? `: ${deprecated.description}` : ""}` });

    for (const sub of subSchemas)
      findDeprecatedProperties(root, sub, value, keyPointer, found);
  }
}

async function findDeprecatedYAML(root: string): Promise<Hit[]> {
  const validators = (await getAllModuleYAMLs()).flatMap(mod => (mod.moduleFileTypes ?? []).map(type => ({
    resourceMask: new RegExp(type.resourceMask, "i"),
    schema: resolveResource(mod.baseResourcePath, type.schema)
  })));
  const schemas = new Map<string, SchemaNode>();
  const hits: Hit[] = [];

  for (const file of listFiles(root, "**/*.yml")) {
    const resource = toResourcePath(root + file, { allowUnmatched: true });
    const validator = resource ? validators.find(_ => _.resourceMask.test(resource)) : null;
    if (!validator)
      continue;

    if (!schemas.has(validator.schema))
      schemas.set(validator.schema, decodeYAML<SchemaNode>(readFileSync(toFSPath(validator.schema), "utf8")));
    const schema = schemas.get(validator.schema)!;

    const tracked = new TrackedYAML<object>(readFileSync(root + file, "utf8"));
    if (tracked.anyErrors())
      continue; //broken YAML is wh checkmodule's problem

    const found: Array<{ pointer: string; detail: string }> = [];
    findDeprecatedProperties(schema, schema, tracked.doc, "", found);
    for (const item of found)
      hits.push({ file, line: tracked.getPositionForPointer(item.pointer)?.line || undefined, detail: item.detail });
  }
  return hits;
}

function listFiles(root: string, pattern: string) {
  return globSync(pattern, { cwd: root, exclude: name => name === "node_modules" || name.startsWith(".") }).toSorted();
}

function findLines(root: string, files: string[], regex: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const lines = readFileSync(root + file, "utf8").split("\n");
    lines.forEach((text, idx) => {
      if (regex.test(text))
        hits.push({ file, line: idx + 1, detail: text.trim() });
    });
  }
  return hits;
}

async function findDeprecatedUses(root: string, tsFiles: string[]): Promise<Hit[]> {
  const project = root + "tsconfig.json";
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      ...buildRelaxedConfig({ project, tsconfigRootDir: root }),
      { files: ["**/*.ts", "**/*.tsx"], rules: { "@typescript-eslint/no-deprecated": "warn" } }
    ],
    allowInlineConfig: false //don't let eslint-disable comments hide deprecations
  });

  const hits: Hit[] = [];
  for (const file of tsFiles) {
    const [result] = await eslint.lintFiles([root + file]);
    for (const msg of result?.messages ?? [])
      if (msg.ruleId === "@typescript-eslint/no-deprecated")
        hits.push({ file, line: msg.line, detail: msg.message });
  }
  return hits;
}

runCli({
  arguments: [{ name: "<module>", description: "Module to scan" }],
  flags: {
    "json": { default: false, description: "Output JSON instead of a report" },
    "no-lint": { default: false, description: "Skip the (slower) deprecated API check" }
  },
  async main({ args, opts }) {
    const root = backendConfig.module[args.module]?.root;
    if (!root)
      throw new Error(`No such module '${args.module}'`);

    const tsFiles = listFiles(root, "**/*.{ts,tsx}").filter(_ => !_.endsWith(".d.ts"));
    const categories: Category[] = [
      {
        id: "deprecated-api",
        title: "Deprecated APIs (eg run -> runCli, test.run -> test.runTests)",
        skill: "none - follow the replacement in the deprecation message",
        hits: opts.noLint ? [] : await findDeprecatedUses(root, tsFiles)
      }, {
        id: "deprecated-yaml",
        title: "Deprecated YAML properties (eg pageBuilder -> onRenderPage, workflow -> clone: onDraft)",
        skill: "none - follow the replacement in the schema's description",
        hits: await findDeprecatedYAML(root)
      }, {
        id: "legacy-wrd",
        title: "Legacy WRD API (wh:wrd/... imports, new WRDSchema)",
        skill: "wrd (references/migrating-legacy.md)",
        hits: findLines(root, tsFiles, /from\s+["']wh:wrd\/|new WRDSchema\s*[<(]/)
      }, {
        id: "rpc-json",
        title: "rpc.json imports",
        skill: "rpc-json-to-service",
        hits: findLines(root, tsFiles, /from\s+["'][^"']*\.rpc\.json["']/)
      }, {
        id: "es-files",
        title: "JavaScript .es files",
        skill: "none - run `wh devkit:es2ts <module>`",
        hits: listFiles(root, "**/*.es").map(file => ({ file }))
      }, {
        id: "siteprofile-xml",
        title: "XML siteprofiles (.siteprl.xml)",
        skill: "siteprofiles",
        hits: listFiles(root, "**/*.siteprl.xml").map(file => ({ file }))
      }, {
        id: "witty",
        title: "Witty templates",
        skill: "witty-to-litty",
        hits: listFiles(root, "**/*.witty").map(file => ({ file }))
      }, {
        id: "harescript-cli",
        title: "HareScript wh commands (scripts/whcommands/*.whscr)",
        skill: "harescript-cli-to-typescript",
        hits: listFiles(root, "scripts/whcommands/*.whscr").map(file => ({ file }))
      }, {
        id: "shell-scripts",
        title: "Shell scripts",
        skill: "convert-shell-to-typescript",
        hits: listFiles(root, "**/*.sh").map(file => ({ file }))
      }
    ];

    if (opts.json) {
      console.log(JSON.stringify(categories, null, 2));
      return;
    }

    console.log(`Modernization scan of ${args.module} (${root})\n`);
    for (const cat of categories) {
      const fileCount = new Set(cat.hits.map(_ => _.file)).size;
      const skipped = cat.id === "deprecated-api" && opts.noLint;
      console.log(`[${cat.id}] ${cat.title}: ${skipped ? "skipped (--no-lint)" : `${fileCount} files, ${cat.hits.length} occurrences`}`);
      if (!cat.hits.length)
        continue;

      console.log(`  skill: ${cat.skill}`);
      if (cat.id === "deprecated-api" || cat.id === "deprecated-yaml") { //break down per deprecated symbol, the message names it and its replacement
        const bySymbol = [...Map.groupBy(cat.hits, _ => _.detail!).entries()].toSorted(([, lhs], [, rhs]) => rhs.length - lhs.length);
        for (const [message, hits] of bySymbol)
          console.log(`  - ${message}\n      ${hits.map(_ => `${_.file}:${_.line}`).join(", ")}`);
      } else {
        for (const hit of cat.hits)
          console.log(`  - ${hit.file}${hit.line ? `:${hit.line}` : ""}`);
      }
    }
  }
});
