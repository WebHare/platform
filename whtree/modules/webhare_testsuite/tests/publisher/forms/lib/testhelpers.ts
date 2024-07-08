import { isPromise } from '@webhare/std';
import * as test from '@webhare/test';
import { TestError, type Annotation, type WaitRetVal } from '@webhare/test/src/checks';

/** Ensure a condition has changed. TODO decide if that has broader applicability than just forms and add to checks.ts with possibly cooler neame */
export async function waitChange<T>(waitfor: () => T | Promise<T>, action: () => unknown | Promise<unknown>, options?: Annotation | { timeout?: number; annotation?: Annotation }): WaitRetVal<T> {
  if (typeof options === "string" || typeof options === "function")
    options = { annotation: options };

  //Evaluate immediately
  let result = waitfor();
  if (isPromise(result)) //TODO guard with timeout - share with wait()
    result = await result;

  if (result)
    throw new TestError("waitChange: the waitfor condition is already initially true", options?.annotation);

  await test.sleep(1);

  //Re-evaluate
  result = waitfor();
  if (isPromise(result)) //TODO guard with timeout - share with wait()
    result = await result;

  if (result)
    throw new TestError("waitChange: the waitfor condition became true before we even got to invoke the action!", options?.annotation);

  await action();
  return await test.wait(waitfor, options);
}
