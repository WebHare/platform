import { ServiceManagerClient } from '@mod-platform/js/bootstrap/servicemanager/main';
import { openBackendService } from '@webhare/services';
import { program } from 'commander'; //https://www.npmjs.com/package/commander

program.name("service")
  .description('Control services');

const servicename = "platform:servicemanager";

async function connectSM() {
  const smservice = await openBackendService<ServiceManagerClient>(servicename, [], { timeout: 5000 });
  return smservice;
}

program.command("list")
  .description("List all services")
  .action(async () => {
    const smservice = await connectSM();
    const state = await smservice.getWebHareState();
    console.table(state.availableServices);
  });

program.command("start")
  .description("Start a service")
  .argument("<service>", "Service name")
  .action(async (service: string) => {
    const smservice = await connectSM();
    const result = await smservice.startService(service);
    if (result.errorMessage) {
      console.error(result.errorMessage);
      process.exit(1);
    }
    console.log("Service starting");
  });

program.command("stop")
  .description("Stop a service")
  .argument("<service>", "Service name")
  .action(async (service: string) => {
    const smservice = await connectSM();
    const result = await smservice.stopService(service);
    if (result.errorMessage) {
      console.error(result.errorMessage);
      process.exit(1);
    }
    console.log("Service stopping");
  });

program.command("restart")
  .description("Restart a service")
  .argument("<service>", "Service name")
  .action(async (service: string) => {
    const smservice = await connectSM();
    const result = await smservice.restartService(service);
    if (result.errorMessage) {
      console.error(result.errorMessage);
      process.exit(1);
    }
    console.log("Service restarting");
  });

program.addHelpCommand();
program.parse();
