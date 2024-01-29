# Author mode
The author mode is triggered when a site is opened through the Publisher. It adds the 'WebHare actions' bar allowing the user
to access WebHare functionality from the front end.

To support author mode in your site run `setupAuthorMode` from the `@webhare/frontend` module. If you have a module ready (eg. connect) to handle
submitted screenshots, you can pass the `allowFeedback: true` option to `setupAuthorMode` to enable screenshots.
