// Types shared between front- and backend

/** The DTAP stages */
export type DTAPStage = "development" | "test" | "acceptance" | "production";

export type ConsoleLogItemLocation = {
  filename: string;
  line: number;
  col: number;
  func: string;
};

export type ConsoleLogItem = {
  /** Date when console function was called */
  when: Date;
  /** `console` method that was called (eg 'log') */
  method: string;
  /** Logged data */
  data: string;
  /** Location of caller */
  location?: ConsoleLogItemLocation;
  /** Codecontext */
  codeContextId?: string;
};

//TODO should perhaps be in std?
export type Serialized<T> = {
  [P in keyof T]: T[P] extends Date ? string : Serialized<T[P]>
};

export type ConsoleLogItemJSON = Omit<ConsoleLogItem, "when"> & { when: string };
