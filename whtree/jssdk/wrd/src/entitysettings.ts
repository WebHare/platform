import { isTruthy } from "@webhare/std";
import { nextVals } from "@webhare/whdb";

export class SettingsStorer<SettingType extends { sub?: SettingType[]; parentsetting?: number | null; id?: number }> {
  flattened = new Array<SettingType & { parentsetting?: number | null }>;

  constructor(toEncode: SettingType[]) {
    this.recurseIntoFlattened(toEncode, null); //fills 'flattened'
  }

  private recurseIntoFlattened(settings: SettingType[], parent: SettingType | null) {
    for (const item of settings) {
      if (parent?.id)
        item.parentsetting = parent.id;
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
      rowsWithoutId.forEach((row, idx) => {
        row.id = newIds[idx];
        if (row.sub)
          for (const sub of row.sub)
            sub.parentsetting = row.id;
      });
    }

    return newIds;
  }

  //TODO shouldn't have to pass the items to us, but wrd currently modifies the flattened list (seems dangerous though..)
  async allocateIdsAndParents(items: SettingType[], table: string) {
    return await this.__addIdsAndParents(items, count => nextVals(table, count));
  }

  /** Reuse earlier setting ids by matching the member/attribute & parent field */
  reuseExistingSettings<ParentField extends keyof SettingType, MemberField extends keyof SettingType>(parentField: ParentField, memberField: MemberField, existingItems: readonly SettingType[]): number[] {
    const reused: number[] = [];
    const usedIds = new Set<number>(this.flattened.map(item => item.id).filter(isTruthy));
    for (const row of this.flattened) {
      if (row.id)
        continue;

      const existingItem = existingItems.find(item => (item[parentField] ?? null) === (row.parentsetting ?? null) && item[memberField] === row[memberField]);
      if (existingItem?.id && !usedIds.has(existingItem.id)) {
        row.id = existingItem.id;
        if (row.sub) {
          for (const sub of row.sub)
            sub.parentsetting = row.id;
        }
        usedIds.add(existingItem.id);
        reused.push(existingItem.id);
      }
    }

    return reused;
  }
}
