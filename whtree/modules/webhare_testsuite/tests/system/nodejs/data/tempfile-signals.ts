// Helper for testTempFileCleanup in test_systemtools.ts: creates a temporary file and then terminates in the requested way

import { storeTempFile } from "@webhare/system-tools";

async function main(dir: string, how: string) {
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
    case "handled-sigint": { //someone else handles SIGINT, so the process should survive it and still clean up on normal exit
      process.once("SIGINT", () => {
        console.log("survived");
        setTimeout(() => process.exit(0), 10);
      });
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
