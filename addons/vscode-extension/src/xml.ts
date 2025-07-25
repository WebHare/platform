import { ExtensionContext, Uri, extensions } from 'vscode';
import { client, toFSPath } from './client';

export async function activateXML(context: ExtensionContext) {
	// Activate the XML extension to support schemas in screens xmls
	const ext = extensions.getExtension("redhat.vscode-xml");
	if (!ext)
		return console.log("vscode-xml not found");

	try {
		//https://github.com/redhat-developer/vscode-xml/blob/184bdd95a61e82612416141c92b29c18dcdc1427/src/api/xmlExtensionApi.ts#L24
		const api = await ext.activate();
		const catalog_fspath = await toFSPath("storage::dev/catalog.xml");

		api.addXMLCatalogs([catalog_fspath]);

		console.log("vscode-xml configured");
	} catch (e) {
		console.error("Error activating XML extension: " + e.message);
		console.log(e);
		//ignore to prevent uncaught exception, we don't expect our callers to catch
	}
}
