import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { encodeHSON } from "@webhare/hscompat";
import { db } from "@webhare/whdb";

export async function listIndexManagers(): Promise<Array<{
  id: number;
  name: string;
}>> {
  const indices = await db<PlatformDB>().
    selectFrom("consilio.indexmanagers").
    select(["id", "name", "address"]).
    execute();

  return indices;
}

export async function createIndexManager(name: string, address: string): Promise<{
  id: number;
}> {

  //TODO validate name, address, ... ?

  const newIndex = await db<PlatformDB>().
    insertInto("consilio.indexmanagers").
    values({ name: name, address: address, configuration: encodeHSON({}) }).
    returning(["id"]).
    execute();

  return { id: newIndex[0].id };
}
