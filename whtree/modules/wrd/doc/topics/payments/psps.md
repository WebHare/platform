# Payment service providers

Payment providers (and known limitiations) currently supported by WebHare

## Riverty (formerly Afterpay)
- Only B2C payments for NL is implemented
- Requires passing a lot more data (IP, billing address, customer information to StartPayment
- Orderids are max. 36 characters, min. 2 characters. Only A-Z,a-z,0-9,`_` and `-` are allowed
- Requires you to have the user accept Afterpay's terms and conditions. See https://mip.afterpay.nl/en/direct-api-integration/
  for link to their terms and ensure your payment method takes care of this
- Order using the email address `rejection@afterpay.nl` to test Afterpay rejection

More information: [Afterpay homepage](https://www.afterpay.nl/)

## External
The external PSP is used to set up payments that are resolved outside of WebHare.

## Mollie
We implement V2 of the Mollie API.

Mollie payments may fail if you're behind a firewall. When developing you can disable 'webhooks' in the payment settings to
prevent Mollie from trying to contact your server

## Multisafepay

## Test
The test payment provider allows you to use a safe 'loopback' payment method when developing new integrations with the
payment API. You should always ensure this provider works before connecting different providers to your application.

Be careful about enabling the Test provider on production systems as payments made through the Test provider may appear to
be actually completed payments to your application.

Useful test scenarios:
- Place an order with 'fraud' somewhere in your email address to trigger an error in StartPayment.
- Place an order with 'throw' somewhere in your email address to trigger a THROW in StartPayment.
- Place an order with 'fraud' somewhere in the last name to fail a payment - it will go through the payment pages but still be rejected and provide a 'htmlstatusforuser' to show on the payment page
