import type { ValidationMessageWithType } from "./validation";

export function formatValidationMessage(msg: ValidationMessageWithType): string {
  return `${msg.resourcename}:${msg.line}:${msg.col}: ${msg.type[0].toUpperCase()}${msg.type.substring(1)}: ${msg.message}`;
}

export function logValidationMessagesToConsole(messages: ValidationMessageWithType[]): void {
  const msgs = messages.toSorted((lhs, rhs) => lhs.resourcename.localeCompare(rhs.resourcename) || lhs.line - rhs.line || lhs.col - rhs.col);
  for (const msg of msgs) {
    console.log(formatValidationMessage(msg));
  }
}
