///@ts-ignore -- not provided yet
import { Session } from 'node:inspector/promises';

interface SessionInterface {
  connect: () => Promise<void>;
  post: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

let session: SessionInterface | undefined;
const process_exit_backup = process.exit.bind(process);

async function finishProfile() {
  if (!session)
    return;

  const savesession = session;
  session = undefined; //prevent parallel runs of finishProfile

  const { profile } = await savesession.post('Profiler.stop');
  console.log(JSON.stringify(profile, null, 2));
  process_exit_backup(); //force an exit. profiler seems to go into a 100% CPU loop? and we're done anyway now. without paramers this will simply quit with process.exitCode
}

process.exit = function (code?: number): never {
  if (code !== undefined)
    process.exitCode = code;
  finishProfile().then(() => process_exit_backup());
  throw new Error('Process has exited'); //process.exit is not supposed to return, so we'll throw until JS adds a longjmp to get back to profilerMain
};

async function profilerMain() {
  session = new Session();
  session!.connect();

  await session!.post('Profiler.enable');
  await session!.post('Profiler.start');

  process.on("beforeExit", finishProfile);

  // Invoke business logic under measurement here...
  process.argv.splice(1, 1); //remove us from the argument list
  require(process.argv[1]);
}

profilerMain();
