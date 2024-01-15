import { env } from "node:process";

export function getEnvironmentDebugFlags(): string[] {
  return env.WEBHARE_DEBUG?.split(',').filter(_ => _) || [];
}
