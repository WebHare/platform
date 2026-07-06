import type { ValidationMessageWithType } from "./validation";

export function formatValidationMessage(msg: ValidationMessageWithType): string {
  return `${msg.resourcename}:${msg.line}:${msg.col}: ${msg.type[0].toUpperCase()}${msg.type.substring(1)}: ${msg.message}`;
}

export function logValidationMessagesToConsole(messages: ValidationMessageWithType[], options?: { sort?: boolean }): void {
  const msgs = [...messages];
  if (options?.sort !== false)
    msgs.sort((lhs, rhs) => lhs.resourcename.localeCompare(rhs.resourcename) || lhs.line - rhs.line || lhs.col - rhs.col);

  for (const msg of msgs) {
    console.log(formatValidationMessage(msg));
  }
}
