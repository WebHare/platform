//@webhare/env is dangerous to load for other low level libs as it has side effect

/** The DTAP stages */
export enum DTAPStage {
  Development = "development",
  Test = "test",
  Acceptance = "acceptance",
  Production = "production"
}
