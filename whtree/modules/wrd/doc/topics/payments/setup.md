# Payments API setup and usage

WRD schema:
```xml
<schemadefinition xmlns="http://www.webhare.net/xmlns/wrd/schemadefinition">
  <!-- add to the entity being payed -->
  <attributes>
    ...
    <payment tag="PAYMENT" title="Payment" domain="PAYMENTPROVIDER"/>
  </attributes>

  <!-- set up domain containing payment providers -->
  <domain tag="PAYMENTPROVIDER" title="Betaalmethode">
    <attributes>
      <paymentprovider tag="PROVIDERDATA" required="true" />
    </attributes>
  </domain>
</schemadefinition>
```

Initiating payments from HareScript
```harescript

// Get all payment methods offered by the various providers
RECORD ARRAY pamentoptions := paymentapi->ListAllPaymentOptions();

RECORD paymentoption := ...; // the selected payment option from the list above

// Set up the payment api
OBJECT paymentapi := GetPaymentAPI(wrdschema, [ providerfield := "PAYMENTPROVIDER.PROVIDERDATA"
                                              , paymentfield := "DONATION.PAYMENT"
                                              , paymenthandler := Resolve("#MyPaymentHandler")
                                              ]);

OBJECT entity := ...; // should be an already created entity containing a (still empty) PAYMENT field

RECORD payment := this->paymentapi->StartPayment(entity->id, amount,
  [ paymentoptiontag := this->idealmethod.paymentoptiontag
  , returnurl := ... // the landing page after payment
  ]);

ExecuteSubmitInstruction(payment.submitinstruction); //redirects or posts the user where he needs to go

// Payment handler is an (optional) callback that is invoked when the payment status changed:
PUBLIC OBJECTTYPE MyPaymentHandler EXTEND WRDPaymentHandlerBase
<
  UPDATE PUBLIC MACRO OnPaymentFinalized(RECORD payment)
  {
    //Send a confirmation email to this->paymententity
  }
>;

// And on your landing page:
RECORD payment := paymentapi->GetReturnInfo(GetRequestURL());
RECORD payinfo := paymentapi->GetPaymentData(payment.paymentid);
```

Adding payment options to a form
```xml
  <paymentmethod xmlns="http://www.webhare.net/xmlns/wrd/forms" name="pm"/>
```
