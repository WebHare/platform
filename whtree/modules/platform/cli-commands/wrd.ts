// @webhare/cli: Manage WRD

import { wrd, describeEntity, listSchemas, type AnySchemaType, type WRDEntityMatch, type WRDSchemaType } from '@webhare/wrd';
import { regExpFromWildcards, throwError } from '@webhare/std';
import { decodeHSON } from '@webhare/hscompat';
import { beginWork, runInWork } from '@webhare/whdb';
import { CLIRuntimeError, intOption, runCli } from "@webhare/cli";
import { parseSchema } from '@webhare/wrd/src/schemaparser';
import { checkWRDSchema, type WRDIssue } from '@webhare/wrd/src/check';
import YAML from 'yaml';
import { commonFlags, commonOptions, readArgFile } from '@mod-platform/js/cli/cli-tools';
import { exportFileAsFetch } from '@webhare/services/src/descriptor';

async function exportEntity(entitySchema: WRDSchemaType<AnySchemaType>, entityType: string, entityMatch: WRDEntityMatch<WRDSchemaType<AnySchemaType>, string>, opts: { json: boolean; resources: string }, field?: string) {
  const attrs = await entitySchema.getType(entityType).listAttributes();
  const entity = await entitySchema.getFields(entityType, entityMatch, field ?? attrs.map(_ => _.tag), {
    export: true,
    exportFile: opts.resources === "fetch" ? exportFileAsFetch : undefined,
    historyMode: "unfiltered",
  });
  console.log(opts.json ? JSON.stringify(entity, null, 2) : YAML.stringify(entity));
}

async function updateEntity(entitySchema: WRDSchemaType<AnySchemaType>, entityType: string, entityMatch: WRDEntityMatch<WRDSchemaType<AnySchemaType>, string>, source: string, opts: { json: boolean; dryRun: boolean }) {
  const entityId = await entitySchema.getFields(entityType, entityMatch, "wrdId");
  const importData: Record<string, unknown> = YAML.parse(await (await readArgFile(source)).text());
  delete importData.wrdId;

  const attrs = await entitySchema.getType(entityType).listAttributes();
  for (const attr of attrs)
    if (attr.isReadOnly)
      delete importData[attr.tag];

  await using work = await beginWork();
  await entitySchema.update(entityType, entityMatch, importData);
  if (!opts.dryRun)
    await work.commit();
  console.log(opts.json ? JSON.stringify({ wrdId: entityId }) : `Updated entity #${entityId}`);
}

runCli({
  description: "Manage WRD",
  flags: {
    ...commonFlags.json
  },
  subCommands: {
    "check": {
      description: "Check a WRD schema for errors",
      arguments: [{ name: "<schemamask>", description: "Schema(s) to check" }],
      flags: {
        ...commonFlags.verbose,
        "metadata-only": {
          description: "Only check metadata, not data integrity"
        }
      },
      main: async ({ opts, args }) => {
        const issues: Array<WRDIssue & { schema: string }> = [];
        const tofind = regExpFromWildcards(args.schemamask, { caseInsensitive: true });
        const schemas = (await listSchemas({ includeInvalidTags: true })).filter(s => tofind.test(s.tag));
        if (schemas.length === 0)
          throw new CLIRuntimeError(`No schemas found matching '${args.schemamask}'`);

        for (const schema of schemas.toSorted((a, b) => a.tag.localeCompare(b.tag))) {
          if (opts.verbose)
            console.log(`Checking schema '${schema.tag}'...`);

          await checkWRDSchema(schema.tag, (issue: WRDIssue) => {
            issues.push({ ...issue, schema: schema.tag });
            if (!opts.json) //then we can print immediately
              console.log(`${schema.tag}: ${issue.message}`);
          }, { metadataOnly: opts.metadataOnly });
        }

        if (opts.json) {
          console.log(JSON.stringify({ issues }));
        } else if (issues.length === 0) {
          console.log("No issues found");
        }

        return issues.length === 0 ? 0 : 1;
      }
    },
    "parse-schema": {
      description: "Parse a WRD schema. dump the contents",
      arguments: [{ name: "<schemaresource>", description: "Schema to parse" }],
      main: async ({ args }) => {
        console.log(JSON.stringify(await parseSchema(args.schemaresource, true, null), null, 2));
      }
    },
    "get-entity": {
      description: "Export an entity",
      options: { ...commonOptions.resources },
      arguments: [
        { name: "<id>", description: "Entity ID", type: intOption() },
        { name: "[field]", description: "Single entity field to export" }
      ],
      main: async ({ opts, args }) => {
        const entityId = args.id;
        const entityInfo = await describeEntity(entityId) ?? throwError(`Entity #${entityId} not found`);
        await exportEntity(wrd<AnySchemaType>(entityInfo.schema), entityInfo.type, entityId, opts, args.field);
      }
    },
    "get-setting": {
      description: "Export a schema's settings entity",
      options: { ...commonOptions.resources },
      arguments: [
        { name: "<schema>", description: "Schema to read settings from" },
        { name: "[field]", description: "Single settings field to export" }
      ],
      main: async ({ opts, args }) => {
        await exportEntity(wrd<AnySchemaType>(args.schema), "wrdSettings", { wrdTag: "WRD_SETTINGS" }, opts, args.field);
      }
    },
    "create-entity": {
      description: "Create an entity",
      flags: {
        "dry-run": "Perform the insert but roll back the transaction"
      },
      arguments: [
        { name: "<schema>", description: "Schema to import into" },
        { name: "<type>", description: "Entity type to import" },
        { name: "<source>", description: "Data to import - path to a file or '-' for stdin" }
      ],
      main: async ({ opts, args }) => {
        const wrdschema = wrd<AnySchemaType>(args.schema);
        const importData: Record<string, unknown> = YAML.parse(await (await readArgFile(args.source)).text());

        const attrs = await wrdschema.getType(args.type).listAttributes();
        for (const attr of attrs)
          if (attr.isReadOnly)
            delete importData[attr.tag];

        if (!importData.wrdGuid)
          importData.wrdGuid = wrdschema.getNextGuid(args.type);

        await using work = await beginWork();
        const result = await wrdschema.insert(args.type, importData);
        if (!opts.dryRun)
          await work.commit();
        console.log(opts.json ? JSON.stringify({ wrdId: result, wrdGuid: importData.wrdGuid }) : `Inserted entity #${result} (${importData.wrdGuid})`);
      }
    },
    "update-entity": {
      description: "Update an entity from imported data",
      flags: {
        "dry-run": "Perform the update but roll back the transaction"
      },
      arguments: [
        { name: "<id>", description: "Entity ID", type: intOption() },
        { name: "<source>", description: "Data to import - path to a file or '-' for stdin" }
      ],
      main: async ({ opts, args }) => {
        const entityId = args.id;
        const entityInfo = await describeEntity(entityId) ?? throwError(`Entity #${entityId} not found`);
        await updateEntity(wrd<AnySchemaType>(entityInfo.schema), entityInfo.type, entityId, args.source, opts);
      }
    },
    "update-setting": {
      description: "Update a schema's settings entity from imported data",
      flags: {
        "dry-run": "Perform the update but roll back the transaction"
      },
      arguments: [
        { name: "<schema>", description: "Schema to update settings in" },
        { name: "<source>", description: "Data to import - path to a file or '-' for stdin" }
      ],
      main: async ({ opts, args }) => {
        await updateEntity(wrd<AnySchemaType>(args.schema), "wrdSettings", { wrdTag: "WRD_SETTINGS" }, args.source, opts);
      }
    },
    "search": {
      description: "Find an entity ID by a field value",
      arguments: [
        { name: "<schema>", description: "Schema to search" },
        { name: "<type>", description: "Entity type to search" },
        { name: "<field>", description: "Field to search" },
        { name: "<value>", description: "Value to search for" }
      ],
      main: async ({ args }) => {
        const searchSchema = wrd<AnySchemaType>(args.schema);
        console.log(JSON.stringify(await searchSchema.search(args.type, args.field, args.value)));
      }
    },
    /* TODO consider whether to keep this, and support all fields, and turn it into update-entity-field ?
            or drop this in favor of an update-entity that expects a JSON body with updates ? */
    "update": {
      description: "Update an entity",
      arguments: [
        { name: "<id>", description: "Entity ID", type: intOption() },
        { name: "<field>", description: "Field to set" },
        { name: "<value>", description: "Value to set" }
      ],
      main: async ({ opts, args }) => {
        const { id, field, value } = args;
        const entityid = id;
        const entityinfo = await describeEntity(entityid) ?? throwError(`Entity #${entityid} not found`);
        const wrdschema = wrd<AnySchemaType>(entityinfo.schema);
        // const type = await wrdschema.describeType(entityinfo.type) ?? throwError("Type not found");
        const attr = await wrdschema.getType(entityinfo.type).describeAttribute(field) ?? throwError(`Attribute '${field}' not found`);

        const toset: Record<string, unknown> = {};
        switch (attr.attributeType) {
          case "hson": {
            const parsed = decodeHSON(value);
            toset[field] = parsed;
            break;
          }
          default:
            throw new CLIRuntimeError(`Unsupported attribute type '${attr.attributeType}'`);
        }

        await runInWork(() => wrdschema.update(entityinfo.type, id, toset));
        console.log(opts.json ? '"updated"' : `Updated entity #${entityid}`);
      }
    }
  }
});
