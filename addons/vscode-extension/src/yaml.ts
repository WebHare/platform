import { ExtensionContext, Uri, extensions } from 'vscode';
import { getWebHareResource } from './client';

const SCHEMA = "webhare";

function onRequestSchemaURI(resource: string): string | undefined {
	if (resource.endsWith('/moduledefinition.yml'))
		return `${SCHEMA}:///platform/data/schemas/moduledefinition.schema.yml`;
	if (resource.endsWith('/modulescreens.yml'))
		return `${SCHEMA}:///platform/data/schemas/modulescreens.schema.yml`;
	if (resource.endsWith('.siteprl.yml'))
		return `${SCHEMA}:///platform/data/schemas/siteprofile.schema.yml`;

	if (resource.endsWith('/moduleshops.yml'))
		return `${SCHEMA}:///webshop/data/schemas/moduleshops.schema.yml`;
	if (resource.endsWith('.skdbapiconfig.yml'))
		return `${SCHEMA}:///skdb/data/schemas/skdbapiconfig.schema.yml`;

	return undefined;
}

async function onRequestSchemaContent(schemaUri: string): Promise<string | undefined> {
	const parsedUri = Uri.parse(schemaUri);
	if (parsedUri.scheme !== SCHEMA) {
		return undefined;
	}

	try {
		const resource = "mod::" + parsedUri.path.substring(1);
		const schema = await getWebHareResource(resource);
		return schema as string;
	} catch (e) {
		console.error(e);
	}
}

export async function activateYAML(context: ExtensionContext) {
	const ext = extensions.getExtension("redhat.vscode-yaml");
	if (!ext)
		return console.log("vscode-yaml not found");

	try {
		//https://github.com/redhat-developer/vscode-yaml/wiki/Extension-API
		const api = await ext.activate();
		api.registerContributor(SCHEMA, onRequestSchemaURI, onRequestSchemaContent);
		console.log("vscode-yaml configured");
	} catch (e) {
		console.error("Error activating YAML extension: " + e.message);
		console.log(e);
		//ignore to prevent uncaught exception, we don't expect our callers to catch
	}
}
