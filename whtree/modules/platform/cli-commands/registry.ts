// @webhare/cli: Manage registry keys

import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { CLIRuntimeError, enumOption, runCli } from "@webhare/cli";
import { decodeHSON, determineType, encodeHSON, getHSTypeName, HareScriptType, setHareScriptType, type IPCMarshallableData } from "@webhare/hscompat/src/hson";
import { createWebHarePasswordHash } from "@webhare/hscompat/src/passwords";
import { backendConfig, readRegistryKey, WebHareBlob, writeRegistryKey } from "@webhare/services";
import { splitRegistryKey } from "@webhare/services/src/registry";
import { compare, parseTyped, stringify } from "@webhare/std";
import { db, runInWork } from "@webhare/whdb";
import { readAnyFromDatabase } from "@webhare/whdb/src/formats";
import { readArgFile } from "@mod-platform/js/cli/cli-tools";
import { buildGeneratorContext } from "@mod-system/js/internal/generation/context";
import { listRegistryKeys } from "@mod-system/js/internal/generation/gen_registry";
import YAML from "yaml";

const registryKeyOptions = { acceptInvalidKeyNames: true };

function toRegistryKeyLikeMask(mask: string): string {
  // Storage uses a dot after the module; convert CLI syntax and escape SQL LIKE metacharacters.
  const storageMask = mask.replace(/^(<overrideuser>\.|<wrd:[a-f0-9]{32}>\.)?([^:.]+):/, "$1$2.");
  return storageMask.toUpperCase().replace(/[\\%_*?]/g, character => {
    if (character === "*")
      return "%";
    if (character === "?")
      return "_";
    return `\\${character}`;
  });
}

function formatRegistryKeyName(name: string): string {
  // Display the stored module separator in the colon form accepted by the CLI.
  return name.replace(/^(<overrideuser>\.|<wrd:[a-f0-9]{32}>\.)?([^:.]+)\./, "$1$2:");
}

/** Get the registry keys matching any of the masks, sorted by name. Throws if a mask doesn't match any key */
async function getKeysByMasks(masks: string[]): Promise<Array<{ name: string; value: unknown }>> {
  const keys = new Map<string, unknown>();
  for (const mask of masks) {
    const matchkeys = await db<PlatformDB>()
      .selectFrom("system.flatregistry")
      .select(["name", "data", "blobdata"])
      .where(eb => eb(eb.fn("upper", ["name"]), "like", toRegistryKeyLikeMask(mask)))
      .execute();

    if (!matchkeys.length)
      throw new CLIRuntimeError(`No registry keys match the mask '${mask}'`);

    for (const key of matchkeys)
      if (!keys.has(key.name))
        keys.set(key.name, await readAnyFromDatabase(key.data, key.blobdata));
  }

  return [...keys.entries()]
    .toSorted((lhs, rhs) => compare(lhs[0].toUpperCase(), rhs[0].toUpperCase()))
    .map(([name, value]) => ({ name: formatRegistryKeyName(name), value }));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !WebHareBlob.isWebHareBlob(value) && determineType(value) === HareScriptType.Record;
}

/** Check whether a value contains a blob anywhere. YAML and JSON can't hold blobs, so such values can't be exported or imported */
function containsBlob(value: unknown): boolean {
  if (WebHareBlob.isWebHareBlob(value))
    return true;
  if (Array.isArray(value))
    return value.some(containsBlob);
  if (isPlainRecord(value))
    return Object.values(value).some(containsBlob);
  return false;
}

/** An imported value loses type information that YAML/JSON can't express, so restore what we can from the current value.
    This restores the type of empty arrays (eg. a RECORD ARRAY), also inside records and arrays. Floats with a whole
    number value can't be restored, as JavaScript doesn't distinguish them from integers (see replacesFloatWithInteger). */
function matchExistingType(value: unknown, existingValue: unknown): unknown {
  if (Array.isArray(value) && Array.isArray(existingValue)) {
    if (!value.length) //an empty array doesn't tell us its element type
      return setHareScriptType(value, determineType(existingValue));
    return value.map((elt, idx) => matchExistingType(elt, existingValue[idx] ?? existingValue[0]));
  }
  if (isPlainRecord(value) && isPlainRecord(existingValue)) {
    const existingCells = new Map(Object.entries(existingValue).map(([cell, cellValue]) => [cell.toLowerCase(), cellValue]));
    return Object.fromEntries(Object.entries(value).map(([cell, cellValue]) => [cell, matchExistingType(cellValue, existingCells.get(cell.toLowerCase()))]));
  }
  return value;
}

/** Check whether a value puts a whole number where the current value has a float inside a record or array, as it would
    be stored as an integer. Only floats that aren't whole numbers can be recognized in the current value: a whole number
    float decodes to the same JavaScript number as an integer. */
function replacesFloatWithInteger(value: unknown, existingValue: unknown): boolean {
  if (typeof value === "number" && typeof existingValue === "number")
    return Number.isInteger(value) && determineType(existingValue) === HareScriptType.Float;
  if (Array.isArray(value) && Array.isArray(existingValue))
    return value.some((elt, idx) => replacesFloatWithInteger(elt, existingValue[idx] ?? existingValue[0]));
  if (isPlainRecord(value) && isPlainRecord(existingValue)) {
    const existingCells = new Map(Object.entries(existingValue).map(([cell, cellValue]) => [cell.toLowerCase(), cellValue]));
    return Object.entries(value).some(([cell, cellValue]) => replacesFloatWithInteger(cellValue, existingCells.get(cell.toLowerCase())));
  }
  return false;
}

/** Encode a value for comparison. Returns null if it can't be encoded (eg. a blob that isn't readable synchronously) */
function tryEncodeHSON(value: unknown): string | null {
  try {
    return encodeHSON(value as IPCMarshallableData);
  } catch {
    return null;
  }
}

runCli({
  description: "Manage registry keys",
  flags: {
    "j,json": { description: "Output in JSON format" }
  },
  subCommands: {
    get: {
      description: "Get a registry key",
      arguments: [{ name: "<keyname>", description: "Registry key to read" }],
      async main({ args, opts }) {
        const value = await readRegistryKey<unknown>(args.keyname, undefined, registryKeyOptions);
        if (opts.json)
          console.log(JSON.stringify(value, null, 2));
        else if (typeof value === "string" || typeof value === "number")
          console.log(value);
        else if (typeof value === "boolean")
          console.log(value ? "true" : "false");
        else
          console.log(encodeHSON(value as IPCMarshallableData));
      }
    },
    list: {
      description: "List the names, types and descriptions of registry keys matching any of the wildcard patterns. Use 'wh registry export' to get their values",
      arguments: [{ name: "<keymask...>", description: "Key patterns (module:subkey format; * for any number of characters, ? for one character)" }],
      async main({ args, opts }) {
        const keys = await getKeysByMasks(args.keymask);

        //The descriptions aren't stored in the registry, look them up in the module definitions. A module can also declare
        //keys for other modules (eg. the system module declares publisher:publication.maxpublishtime), so read them all
        const context = await buildGeneratorContext(null, false);
        const descriptions = new Map<string, string>();
        for (const declared of listRegistryKeys(context, Object.keys(backendConfig.module)))
          if ("description" in declared)
            descriptions.set(declared.name.toUpperCase(), declared.description);

        const output = keys.map(key => ({
          name: key.name,
          type: getHSTypeName(determineType(key.value)).toLowerCase(),
          description: descriptions.get(splitRegistryKey(key.name, registryKeyOptions).storename.toUpperCase()) ?? ""
        }));
        if (opts.json)
          console.log(JSON.stringify(output, null, 2));
        else
          console.table(output);
      }
    },
    export: {
      description: "Export registry keys matching any of the wildcard patterns as YAML (or JSON with --json), for use with 'wh registry import'",
      arguments: [{ name: "<keymask...>", description: "Key patterns (module:subkey format; * for any number of characters, ? for one character)" }],
      async main({ args, opts }) {
        const keys = await getKeysByMasks(args.keymask);
        const skippedBlobs = new Array<string>;
        const output: Record<string, unknown> = {};
        for (const key of keys) {
          if (containsBlob(key.value))
            skippedBlobs.push(key.name);
          else //the typed encoding preserves dates, money and 64-bit integer values
            output[key.name] = JSON.parse(stringify(key.value, { typed: true }));
        }

        if (skippedBlobs.length)
          console.error(`Skipped ${skippedBlobs.length} key(s) containing a blob, these cannot be exported: ${skippedBlobs.map(name => `'${name}'`).join(", ")}`);

        process.stdout.write(opts.json ? JSON.stringify(output, null, 2) + "\n" : YAML.stringify(output));
      }
    },
    import: {
      description: "Import registry keys exported by 'wh registry export'. Will fail if any of the keys doesn't exist yet unless --skip-unknown is set",
      flags: {
        "skip-unknown": { description: "Skip keys that don't exist in this registry" },
      },
      arguments: [{ name: "<file>", description: "YAML or JSON file to import, '-' to read from standard input" }],
      async main({ args, opts }) {
        let input: unknown, text: string;
        try {
          text = await (await readArgFile(args.file)).text();
        } catch (e) {
          throw new CLIRuntimeError(`Cannot read '${args.file}': ${(e as Error)?.message || "Unknown error"}`);
        }
        try {
          input = parseTyped(JSON.stringify(YAML.parse(text)));
        } catch (e) {
          throw new CLIRuntimeError(`Cannot parse '${args.file}': ${(e as Error)?.message || "Unknown error"}`);
        }
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new CLIRuntimeError(`Expected '${args.file}' to contain an object mapping registry key names to their values`);

        const toImport = Object.entries(input).map(([name, value]) => {
          try {
            return { name, value, storeName: splitRegistryKey(name, registryKeyOptions).storename };
          } catch {
            throw new CLIRuntimeError(`Invalid registry key name '${name}' in '${args.file}', expected 'module:node.key'`);
          }
        });

        const imported = new Array<string>, unchanged = new Array<string>, skipped = new Array<string>;
        await runInWork(async () => {
          const existing = new Map<string, { value: unknown; isFloat: boolean }>();
          if (toImport.length) {
            const rows = await db<PlatformDB>()
              .selectFrom("system.flatregistry")
              .select(["name", "data", "blobdata"])
              .where("name", "in", toImport.map(key => key.storeName))
              .execute();
            for (const row of rows) {
              const raw = row.data || await row.blobdata?.text() || "";
              //A FLOAT with a whole number value decodes to a JavaScript number that we would write back as an INTEGER
              existing.set(row.name, { value: raw ? decodeHSON(raw) : null, isFloat: raw.startsWith("hson:f ") });
            }
          }

          const unknown = toImport.filter(key => !existing.has(key.storeName)).map(key => key.name);
          if (unknown.length && !opts.skipUnknown)
            throw new CLIRuntimeError(`The following key(s) do not exist in this registry, use --skip-unknown to skip them: ${unknown.map(name => `'${name}'`).join(", ")}`);
          skipped.push(...unknown);

          for (const key of toImport) {
            const current = existing.get(key.storeName);
            if (!current)
              continue;

            if (containsBlob(current.value)) //we would replace the blob with whatever the file has
              throw new CLIRuntimeError(`Cannot import '${key.name}': its current value contains a blob, which cannot be imported`);

            const value = matchExistingType(key.value, current.value);
            if (tryEncodeHSON(value) === tryEncodeHSON(current.value)) { //don't rewrite (and possibly retype) values that didn't change
              unchanged.push(key.name);
              continue;
            }
            if ((current.isFloat && Number.isInteger(value)) || replacesFloatWithInteger(value, current.value))
              throw new CLIRuntimeError(`Cannot import '${key.name}': it holds a float and whole numbers would be stored as an integer`);

            try { //we've verified the key exists, but user registry keys still require createIfNeeded
              await writeRegistryKey(key.name, value, { ...registryKeyOptions, createIfNeeded: key.name.startsWith("<") });
            } catch (e) {
              throw new CLIRuntimeError(`Cannot import '${key.name}': ${(e as Error)?.message || "Unknown error"}`);
            }
            imported.push(key.name);
          }
        });

        if (skipped.length)
          console.error(`Skipped ${skipped.length} key(s) that do not exist in this registry: ${skipped.map(name => `'${name}'`).join(", ")}`);
        if (opts.json)
          console.log(JSON.stringify({ imported, unchanged, skipped }, null, 2));
        else
          console.log(`Imported ${imported.length} key(s), ${unchanged.length} unchanged`);
      }
    },
    set: {
      description: "Set a registry key. Will fail if the key doesn't exist yet unless --type is set",
      options: {
        type: { description: "Value type", type: enumOption(["string", "boolean", "integer", "record"]) },
      },
      flags: {
        password: { default: false, description: "Hash a string value as a password" },
      },
      arguments: [
        { name: "<keyname>", description: "Registry key to write" },
        { name: "<value>", description: "Value to write" },
      ],
      async main({ args, opts }) {
        const createIfNeeded = Boolean(opts.type); //if a type is set, we can create the key
        let valueType = opts.type;
        if (!valueType) {
          const existingValue = await readRegistryKey<unknown>(args.keyname, undefined, registryKeyOptions);
          const gotType = getHSTypeName(determineType(existingValue)).toLowerCase();
          if (gotType !== "string" && gotType !== "boolean" && gotType !== "integer" && gotType !== "record")
            throw new CLIRuntimeError(`Unsupported value type '${gotType}'`);

          valueType = gotType;
        }

        if (opts.password && valueType !== "string")
          throw new CLIRuntimeError("Only keys of type 'string' can be set as a --password");

        let value: unknown;
        switch (valueType) {
          case "string":
            value = opts.password ? await createWebHarePasswordHash(args.value) : args.value;
            break;
          case "boolean":
            value = ["1", "TRUE"].includes(args.value.toUpperCase());
            break;
          case "integer": {
            const parsed = Number.parseInt(args.value, 10);
            value = Number.isNaN(parsed) ? 0 : parsed;
            break;
          }
          case "record": {
            const decoded = decodeHSON(args.value);
            if (decoded !== null && (typeof decoded !== "object" || Array.isArray(decoded)))
              throw new CLIRuntimeError("Value for a record registry key must decode to a record");
            value = decoded;
            break;
          }
          default:
            valueType satisfies never; //assert that we've handled all cases
            throw new CLIRuntimeError(`Not sure how to store value of type '${valueType}'`);
        }

        await runInWork(() => writeRegistryKey(args.keyname, value, { ...registryKeyOptions, createIfNeeded }));
        if (opts.json)
          console.log(JSON.stringify({ name: formatRegistryKeyName(args.keyname), updated: true }, null, 2));
      }
    }
  }
});
