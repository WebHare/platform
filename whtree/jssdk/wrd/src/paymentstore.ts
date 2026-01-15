import { omit, parseTyped, type Money } from "@webhare/std";

class PaymentProviderValue {
  #type: string;
  #data: { [key: string]: unknown };

  constructor(type: string, data: { [key: string]: unknown }) {
    this.#type = type;
    this.#data = data;
  }

  get __paymentData() {
    return {
      type: this.#type, data: this.#data
    };
  }
}


export function makePaymentProviderValueFromEntitySetting(data: object) {
  /* In HareScript we serialized CELL[type,meta] as HSON.
     A JS driver would look like this:
       type: "wrd:js"
       meta: {
         configuration: "JSON encoded configuration"
         driver: "@mod-platform/packages/psp-testdriver/testdriver.ts#TestDriver"
         islive: false/true
         methods: [...]
       }
    islive/methods are a cache of data retrieved from connectPSP.

    HS would 'hide' the data behind __paymentdata so we should wrap it too
    So in the TS variant we should wrap it in an object
  */
  if (!("type" in data) || typeof data.type !== "string")
    throw new Error("Invalid PaymentProviderValue data, missing 'type' field");

  return new PaymentProviderValue(data.type, omit(data, ["type"]));
}

type PaymentDataRow = {
  a: Money;
  d: Date;
  h: string;
  /** Driver specific payment metadtata */
  m: {
    paymeta?: string;
  } | null;
  o: string;
  p: string;
  s: "approved" | "pending" | "failed";
  u: string;
};

class PaymentValue {
  #data: PaymentDataRow[];

  constructor(data: object[]) {
    if (data.length === 0)
      throw new Error("PaymentValue must have at least one payment data row");

    this.#data = data as PaymentDataRow[];
  }

  #getBestPayment(): PaymentDataRow {
    return this.#data.findLast(row => row.s === "approved") || this.#data.at(-1)!;
  }

  getPSPMetadata() {
    const paymeta = this.#getBestPayment().m?.paymeta;
    return paymeta ? parseTyped(paymeta) : null;
  }
}

export function makePaymentValueFromEntitySetting(data: object[]) {
  return new PaymentValue(data);
}

export type { PaymentProviderValue, PaymentValue };
