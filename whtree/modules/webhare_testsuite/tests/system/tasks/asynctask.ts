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
  return { action, source: "js" };
}
