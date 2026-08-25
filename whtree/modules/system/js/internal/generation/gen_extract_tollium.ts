import type { ModuleQualifiedName } from "@webhare/services/src/naming";
import type { GenerateContext } from "./shared";
import { typedEntries } from "@webhare/std";

export type TowlNotification = {
  /** Fully qualified name */
  name: ModuleQualifiedName;
  /** Title tid */
  title: string;
  /** Description tid */
  description: string;
  /** Enabled by default? */
  defaultEnabled: boolean;
};

export interface TolliumConfig {
  notifications: TowlNotification[];
}

export async function generateTollium(context: GenerateContext): Promise<string> {
  const retval: TolliumConfig = {
    notifications: []
  };

  for (const mod of context.moduledefs)
    for (const [key, note] of typedEntries(mod.modYml?.notifications || {})) {
      const notification: TowlNotification = {
        name: `${mod.name}:${key}`,
        title: context.parseYMLTid(mod, note, "title"),
        description: context.parseYMLTid(mod, note, "description"),
        defaultEnabled: note?.defaultEnabled || false
      };
      retval.notifications.push(notification);
    }

  return JSON.stringify(retval);
}
