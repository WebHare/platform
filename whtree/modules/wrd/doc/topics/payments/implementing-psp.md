# Implementing a new PSP

Actual communication is done inside one of the three execution functions: ExecutePayment, GetPayFormData, or GetPayRedirectUrl.
Which one is invoked depends on the interaction type of the PSP. These functions always run outside of work, as they're
expected to communicate with an external provider.

If these function need to update payment state (metadata, paid, etc) they should
open work and invoke UpdatePaymentMetadata with the payment token passed to them.

Some general guidelines when implementing a new payment method
- Don't skip the implementation of `RecheckPayment()` unless the PSP really
  does not support it. This may be the only way to get a proper success/failure
  status if the user cancels the gateway workflow.
- A lot of payment providers work with a flow where they redirect back to us
  and pass parameters over the URL giving the payment status. It may often be
  easier to directly query the PSP instead of trusting the URL - you're less
  affected by any bugs in your or their signature implementation, and you may
  have already implemented the logic for RecheckPayment anyway.
- The payments API return page (where redirect flows generally end up) is
  designed to survive multiple status posts (it will invoke the payment
  completion handler only once). So you can generally point all the success,
  failure, notification etc URLs to the same return page.
  - Be careful with notification/push URLs - eg. Sisow will try to notify you
    synchronously during the payment process, which breaks if you're testing
    on an unreachable machine (eg locally) because the gateway can't reach you
