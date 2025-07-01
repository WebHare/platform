import type { WRDSchema } from "./schema";

export class ValueQueryChecker {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- needed for generics
    private schema: WRDSchema<any>,
    public readonly typeTag: string,
    public readonly entityId: number | null,
    public readonly temp: boolean,
    public readonly importMode: boolean) {
  }

  private uniqueChecks = new Map<string, {
    values: Array<{
      value: unknown;
      source: string;
    }>;
  }>;
  private refChecks = new Map<number, {
    values: Array<{
      value: number[];
      source: string;
    }>;
  }>;

  addUniqueCheck(attrFullTag: string, value: unknown, source: string) {
    const checks = this.uniqueChecks.get(attrFullTag);
    if (!checks)
      this.uniqueChecks.set(attrFullTag, { values: [{ value, source }] });
    else
      checks.values.push({ value, source });
  }

  addRefCheck(attr: number, values: number | number[], source: string) {
    if (!Array.isArray(values))
      values = [values];
    const checks = this.refChecks.get(attr);
    if (!checks)
      this.refChecks.set(attr, { values: [{ value: values, source }] });
    else
      checks.values.push({ value: values, source });
  }

  async runChecks() {
    for (const uniqueCheck of this.uniqueChecks) {
      const isArrayMember = uniqueCheck[0].includes(".");
      const res = await this.schema
        .query(this.typeTag)
        .select("wrdId")
        .where(uniqueCheck[0], isArrayMember ? "mentionsany" : "in", uniqueCheck[1].values.map((v) => v.value))
        .where("wrdId", "!=", this.entityId)
        .limit(1)
        .execute();
      if (res.length) {
        // Checking which value was responsibel for the clash can be difficult for values within an array
        // for now, re-check all items one by one
        for (const toCheck of uniqueCheck[1].values) {
          const subRes = await this.schema
            .query(this.typeTag)
            .select("wrdId")
            .where(uniqueCheck[0], isArrayMember ? "mentions" : "=", toCheck.value)
            .where("wrdId", "!=", this.entityId)
            .limit(1)
            .execute();
          if (subRes.length)
            throw new Error(`Unique constraint violated - the value passed in ${this.typeTag}.${toCheck.source} is already used in entity #${subRes[0]}`);
        }
      }
    }
    for (const refCheck of this.refChecks) {
      const typeTag = await this.schema.__getTypeTag(refCheck[0]);
      if (!typeTag)
        throw new Error(`No such type ${refCheck[0]}`);
      const toCheck = new Set(refCheck[1].values.map((v) => v.value).flat());
      const exists = await this.schema
        .query(typeTag)
        .select("wrdId")
        .where("wrdId", "in", [...toCheck])
        .historyMode("unfiltered")
        .execute();

      if (exists.length < toCheck.size) {
        const missing = [...toCheck].filter((v) => !exists.includes(v));
        for (const value of refCheck[1].values) {
          const hereMissing = value.value.filter(v => missing.includes(v));
          if (hereMissing.length)
            throw new Error(`Referential integrity violated - the value passed in ${this.typeTag}.${value.source} refers to non-existing entity #${hereMissing[0]}`);
        }
      }
    }
  }
}
