# WebHare PSP Base

Base package for WebHare PSP integrations

## Building a new PSP
Setup a TS (or JS) file and export a driver class implementing the `PSPDriver` interface from `@webhare/psp-base`.

We recommend using `doc/dummy-driver.ts` as the basis for your new payment driver, replacing Dummy with the name
of your driver.

Implement `connect()` first. Connect should validate the configuration and return the method(s) supported by the PSP.
Once `connect()` works you should be able to configure the PSP in WebHare and it should be able to show up in payment
screens

Implement `startPayment` to handle actual payment attempts. Inform the PSP about the returnUrl and pushUrl.

Implement `processPush` to receive notifications sent to the pushUrl. This function should return a status update
AND the response to provide to the notification invoker. eg:

```typescript
  return {
    setStatus: "approved"
    response: new Response("It is done", { headers: { "content-type": "text/plain" } })
  };
```

The `Response` object here is part of the Fetch API - you normally shouldn't be importing this from anywhere.

Note that it's very common for processPush, processReturn and checkStatus to be nearly identical in implementation. Some providers may allow
or even require you to do a status check in your processPush or processReturn paths.
