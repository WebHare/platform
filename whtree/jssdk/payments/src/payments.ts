import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { openPSP } from "@mod-wrd/js/internal/paymentbridge";
import type { PSPDriver } from "@webhare/psp-base";
import { throwError } from "@webhare/std";
import type { PaymentProviderValue, PaymentValue } from "@webhare/wrd/src/paymentstore";
import { WRDSchema } from "@webhare/wrd/src/schema";

// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/payments" {
}

interface PaymentApiConfiguration {
  providerType: string;
  providerField: string;
  paymentType: string;
  paymentField: string;
}

class PaymentApi {
  private wrdschema: string;
  private config: PaymentApiConfiguration;

  constructor(wrdschema: string, config: PaymentApiConfiguration) {
    this.wrdschema = wrdschema;
    this.config = config;
  }

  /** Open a payment provider by id */
  async openPaymentProvider(providerEntityId: number): Promise<PSPDriver> {
    const wrdschema = new WRDSchema(this.wrdschema);
    const providerEntity = await wrdschema.getFields(this.config.providerType, providerEntityId, [this.config.providerField]);
    if (!providerEntity)
      throw new Error(`Payment provider with id ${providerEntityId} not found`);

    const provider = providerEntity[this.config.providerField] as PaymentProviderValue | null;
    if (!provider)
      throw new Error(`Payment provider with id ${providerEntityId} has no payment provider configured`); //TODO or return a wrd:unavailable equivalent ?

    const data = provider.__paymentData.data as { meta?: { configuration?: string; driver?: string } };
    let driver: string;
    if (provider.__paymentData.type === "wrd:js") {
      driver = data?.meta?.driver ?? throwError(`Payment provider with id ${providerEntityId} is missing driver information`);
    } else {
      const psp = getExtractedConfig("wrdschemas").psp.find(_ => _.tag === provider.__paymentData.type);
      if (!psp)
        throw new Error(`Payment provider with id ${providerEntityId} has unsupported type '${provider.__paymentData.type}'`);

      driver = psp.driver;
    }

    const result = await openPSP(driver, data?.meta?.configuration ?? throwError(`Payment provider with id ${providerEntityId} is missing configuration`), { paymentId: String(providerEntityId) });
    if ("error" in result)
      throw new Error(`Failed to connect to payment provider with id ${providerEntityId}: ${result.error}`);

    return result;
  }

  /** Retrieve a payment value for a specific entity */
  async getPaymentValue(paymentEntityId: number): Promise<PaymentValue | null> {
    const wrdschema = new WRDSchema(this.wrdschema);
    const paymentEntity = await wrdschema.getFields(this.config.paymentType, paymentEntityId, [this.config.paymentField]);
    if (!paymentEntity)
      throw new Error(`Payment provider with id ${paymentEntityId} not found`);

    return paymentEntity[this.config.paymentField] as PaymentValue | null;
  }
}

export function getPaymentApi(wrdschema: string, config: PaymentApiConfiguration): PaymentApi {
  return new PaymentApi(wrdschema, config);
}

export type { PaymentApi };
