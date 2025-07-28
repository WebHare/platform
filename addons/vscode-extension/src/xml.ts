import { ExtensionContext, Uri, extensions } from 'vscode';
import { client, firstConfig, toFSPath } from './client';
import type { XMLExtensionApi } from './xml-extension-api';


export async function activateXML(context: ExtensionContext) {
	// Activate the XML extension to support schemas in screens xmls
	const ext = extensions.getExtension("redhat.vscode-xml");
	if (!ext)
		return console.log("vscode-xml not found");

	try {
		const api: XMLExtensionApi = await ext.activate();

		//Wait for configuration to come in
		firstConfig.promise.then(initResult => {
			api.addXMLCatalogs([initResult.whServerInfo.dataRoot + "config/devkit/catalog.xml"]);
		});
		console.log("vscode-xml configured");
	} catch (e) {
		console.error("Error activating XML extension: " + e.message);
		console.log(e);
		//ignore to prevent uncaught exception, we don't expect our callers to catch
	}
}
