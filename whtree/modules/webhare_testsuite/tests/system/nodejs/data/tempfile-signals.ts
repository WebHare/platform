// Helper for testTempFileCleanup in test_systemtools.ts: creates a temporary file and then terminates in the requested way

import { storeTempFile } from "@webhare/system-tools";

function surviveSigInt() {
  process.once("SIGINT", () => {
    console.log("survived");
    setTimeout(() => process.exit(0), 10);
  });
}

async function main(dir: string, how: string) {
  /* A handler registered before the temporary file exists runs before our cleanup handler. As 'once' handlers are removed
     before they're invoked, it's no longer registered by then and we need to make sure we still notice it */
  if (how === "early-handled-sigint")
    surviveSigInt();

  const tempFile = await storeTempFile("signal-test.txt", "data", { dir });
  console.log(tempFile.path);

  switch (how) {
    case "exit": {
      process.exit(3);
      break;
    }
    case "throw": {
      throw new Error("Uncaught test error");
    }
    case "handled-sigint": //someone else handles SIGINT, so the process should survive it and still clean up on normal exit
    case "early-handled-sigint": {
      if (how === "handled-sigint")
        surviveSigInt();
      process.kill(process.pid, "SIGINT");
      await new Promise(resolve => setTimeout(resolve, 5000));
      break;
    }
    default: { //a signal
      process.kill(process.pid, how as NodeJS.Signals);
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log("still alive");
    }
  }
}

void main(process.argv[2], process.argv[3]);
