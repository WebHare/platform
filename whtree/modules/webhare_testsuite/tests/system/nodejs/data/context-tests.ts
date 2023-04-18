import { sleep } from "@webhare/std";
import { CodeContext, getCodeContext } from "@webhare/services";

export function returnContextId() {
  return getCodeContext().id;
}

export async function returnContextIdAsync() {
  await sleep(1);
  return getCodeContext().id;
}

export function getWrappedReturnContextId() {
  return CodeContext.wrap(returnContextId);
}

export function getWrappedReturnContextIdAsync() {
  return CodeContext.wrap(returnContextIdAsync);
}

export function* generateContextId() {
  yield "1:" + getCodeContext().id;
  yield "2:" + getCodeContext().id;
}

export async function* generateContextIdAsync() {
  yield "1:" + getCodeContext().id;
  yield "2:" + getCodeContext().id;
}
