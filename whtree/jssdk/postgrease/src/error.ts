import type { ErrorResponse } from "./response-parser";

export class DatabaseError extends Error implements ErrorResponse {
  severity: "ERROR" | "FATAL" | "PANIC" = "ERROR";
  code = "";

  severityLocalized?: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  internalQuery?: string;
  where?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
  file?: string;
  line?: string;
  routine?: string;

  query?: string;
  parameterTypes?: string[];

  constructor(data: ErrorResponse) {
    super(data.message ?? "Unknown error, no message specified");
    Object.assign(this, data);
  }
}
