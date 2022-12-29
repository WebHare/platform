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

program.parse();
