import { program } from 'commander'; //https://www.npmjs.com/package/commander
import { getBridgeManagerLink } from "@webhare/services/src/bridgemgrlink";

program
  .name('bridge')
  .description('Control WebHare bridge connections (ie. javascript processes)');

program.command('connections')
  .description('List all scripts connected to the bridge')
  .action(async () => {
    const connections = await (await getBridgeManagerLink()).listConnections();
    console.table(connections);
  });

program.command('inspect')
  .description('Enable inspector and return settings')
  .argument('<instance>', 'Instance to connect to')
  .action(async (instance: string) => {
    const inspectorinfo = await (await getBridgeManagerLink()).enableInspector(instance);
    if (inspectorinfo) {
      console.log("Inspector URL: " + inspectorinfo.url);
      console.log("Locally you should see the session on chrome://inspect/#devices");
    } else {
      console.error("Failed to open an inspector");
      process.exit(1);
    }
  });

program.parse();
