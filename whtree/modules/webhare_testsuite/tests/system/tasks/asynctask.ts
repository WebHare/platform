import { sleep } from "@webhare/std";

export async function ping(arg: unknown) {
  return arg;
}

export async function callAsyncTest(action: number) {
  if (action == 1)
    process.exit(1);
  if (action == 2)
    throw new Error(`js-error`);
  if (action == 5)
    await new Promise(resolve => setTimeout(resolve, 100));
  if (action == 6) {
    new Promise((resolve, reject) => reject(new Error("This will be an uncaught rejection")));
    await sleep(60000);
  }
  return { action, source: "js" };
}
