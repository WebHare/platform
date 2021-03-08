# Consenthandling

The TL;DR: version

```js
import * as consenthandler from '@mod-publisher/js/analytics/consenthandler.es';

function activateSocialWidget(node) { ... }
consenthandler.onConsent("thirdparty", function() { dompack.register(".socialwidget", activateSocialWidget) });
consenthandler.setup("<sitename>-consent", showCookieBanner);
```

## Setting up

Setup in JS:

```js
import * as consenthandler from '@mod-publisher/js/analytics/consenthandler.es';

function showCookieBanner()
{
  //launch a banner..
  ackbutton.addEventListener("click", () => consenthandler.setConsent(["analytics","remarketing"]));
  denybutton.addEventListener("click", () => consenthandler.setConsent([]));
}

consenthandler.setup("<sitename>-consent", showCookieBanner);
```

`setup` sets up the cookie name (just use eg. the site name, but we require you to set up a cookie to properly work with multiple sites sharing an output host) and launches the callback if consent is unknown

setContent expects an array of consent flags. if it's just an all or nothing, just use `['all']`. use an empty array `[]` if consent was denied

When the consent settings change, consenthandler will fire a wh:consent-change event with the list of consents in evt.detail.consent

To responds to positive consent, use `consenthandler.onConsent(type, callback)`. Similar to onDomReady, the callback
will be invoked directly if consent is already known.

To respond to any consent change, use `consenthandler.onConsentChange(callback)` to trigger a callback whenever the consent has changed.
Please note that onConsentChange is invoked whether consent is accepted or denied, so always check the 'consent' property of the passed argument.

Consent status is also marked as property on the documentElement, eg you can test `document.documentElement.dataset.whConsent` for specific consent flags,
"unknown" if the consent question is and "denied" if consent has been declined. This property is mostly intended for CSS selectors (eg `html[data-wh-consent*="remarketing"] { ... }`)

You can also test for consent using `consenthandler.hasConsent(consentflag)`

## Setting up consent overlays

Wrap consent-requiring elements inside a `wh-requireconsent` element, and insert
a `wh-requireconsent__overlay` element at the top of this container.

Use the `data-wh-consent-required` attribute to specify the exact consent required

Example HTML:
```html
<div class="wh-requireconsent" data-wh-consent-required="marketing">
  <div class="wh-requireconsent__overlay"></div>
  ... the elements requiring consent ...
</div>
```

Example CSS:
```css
.wh-requireconsent
{
  position:relative;
  z-index:0;
}
.wh-requireconsent__overlay
{
  position:absolute;
  top:0;
  bottom:0;
  left:0;
  right:0;
  z-index:1;
}
```

You may also want to implement a clickhandler on the consent overlay so users
can change their consent preferences. The simplest approach is a redirect:

```javascript
  dompack.register(".wh-requireconsent__overlay",
    node => node.addEventListener("click", () => location.href="/privacy/");
```

If your content still requires a click to activate (eg a videoplayer showing
a locally hosted poster image and a play button), placing it behind a consentlayer
is often enough. If your content needs to load something immediately if consent
was given (eg a 3rd party hosted slideshow) you should use a `dompack.register`
as callback from a `consenthandler.onConsent()` call

## Testing/debugging
To reset the content setting, type this in the console:
```js
whResetConsent();
```

If you use our testing GTM container GTM-TN7QQM, you will see the consent triggers
in the console.

## GA4 compatibility
Make sure your `<googleanalytics4>` node has its launch property set to `manual`. Then add the following JavaScript code
to link it to the consent layer:

```js
import * as ga4 from '@mod-publisher/js/analytics/ga4.es';
ga4.initOnConsent();
```

## GTM compatibility
Make sure you use the publisher version of the gtm plugin in your siteprofile - in general, `<gtm />` should have no `xmlns=` attribute.

```xml
<apply minservertype="production">
  <to type="all" />
  <gtm account="GTM-42PROD42" />
</apply>
<apply maxservertype="test"> <!-- use standard WH debug GTM container -->
  <to type="all" />
  <gtm account="GTM-TN7QQM" />
</apply>
```

You can avoid loading GTM until the consent choices have been made (eg until
a cookiebar is answered)
```xml
<apply minservertype="production">
  <to type="all" />
  <gtm account="GTM-42PROD42" launch="manual" />
</apply>
```

but then you'll need to manually activate it in your consenthandler integration
```js
import * as gtm from '@mod-publisher/js/analytics/gtm.es';

gtm.initOnConsent();
consenthandler.setup("<sitename>-consent", showCookieBanner);
```

In GTM, setup your triggers to activate on the proper consent settings:
- Create a trigger (eg Page View)
- This trigger fires on: Some Page Views
- Fire this trigger when an Event occurs and all of these conditions are true
  - wh.consent contains all (or whichever flag(s) you agreed on)

Use "wh.consent equals denied" if you want to trigger when consent is not given.
Note that "wh.consent" must be defined as a Datalayer variable.

