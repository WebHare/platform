import { nextVals } from "@webhare/whdb";

export class SettingsStorer<SettingType extends { sub?: SettingType[]; parentsetting?: number | null; id?: number }> {
  parentMap = new Map<SettingType, SettingType>;
  flattened = new Array<SettingType & { parentsetting?: number | null }>;

  constructor(toEncode: SettingType[]) {
    this.recurseIntoFlattened(toEncode, null); //fills 'flattened'
  }

  private recurseIntoFlattened(settings: SettingType[], parent: SettingType | null) {
    for (const item of settings) {
      if (parent)
        this.parentMap.set(item, parent);

      this.flattened.push(item);
      if (item.sub?.length)
        this.recurseIntoFlattened(item.sub, item);
    }
  }

  async __addIdsAndParents(items: SettingType[], getIds: (count: number) => Promise<number[]>) {
    const rowsWithoutId = items.filter(item => !item.id);
    let newIds: number[] = [];
    if (rowsWithoutId.length > 0) {
      newIds = await getIds(rowsWithoutId.length);
      rowsWithoutId.forEach((row, idx) => row.id = newIds[idx]);
    }

    for (const [child, parent] of this.parentMap) {
      child.parentsetting = parent.id;
    }

    return newIds;
  }

  //TODO shouldn't have to pass the items to us, but wrd currently modifies the flattend list (seems sdangerous though..)
  async allocateIdsAndParents(items: SettingType[], table: string) {
    return await this.__addIdsAndParents(items, count => nextVals(table, count));
  }
}
