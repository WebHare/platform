// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/test-backend" {
}

/* @webhare/test-backend is a superset of @webhare/test with additional backend test support
 */

//By definition we re-export all of whtest and @webhare/test
export * from "@mod-platform/js/testing/whtest";
