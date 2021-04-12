# Beacons

Beacons have a name (eg `is-student`) and an associated last-trigger date/time.

Adaptive content can be linked to beacons. Use `<setlibrary name="publisher:beacons">` to point adaptive content apps
to your beacon store(s).

```xml
  <apply>
    <to type="all" />
    <setlibrary name="publisher:beacons">
      <source path="site::mysite/beacons/" />
    </setlibrary>
  </apply>
```

Keep in mind that if you have multiple sources of beacon that their names still need to be unique.

## Triggering a beacon by visiting a page

In RTDs and texts within forms the 'trigger beacon' widget can be added to trigger the selected beacon when the page is
visited. To be able to add this widget, the `http://www.webhare.net/xmlns/publisher/widgets/triggerbeacon` widget must be
allowed in the used RTD type. If you add the widget to a form page, the beacon is only triggered if the page to which the
beacon was added has been visible.

## JavaScript API:

To trigger a beacon programmatically, for example after the user performs a certain action within a website, use the
JavaScript API.

```javascript
import * as beacons from '@mod-publisher/js/contentlibraries/beacons';

// Sets/triggers the beacon
beacons.trigger("is-student");

// Removes/clears the beacon
beacons.clear("is-student");

if (beacons.isSet("is-student"))
{
  // The beacon was triggered
}

const since = new Date();
since.setDate(since.getDate() - 7);
if (beacons.isSet("is-student", { since }))
{
  // The beacon was triggered within the last 7 days
}

if (beacons.isSet("is-student", { minCount: 3 }))
{
  // The beacon was triggered at least 3 times
}

if (beacons.isSet("is-student", { since, minCount: 3 }))
{
  // The beacon was triggered at least 3 times within the last 7 days
}
```
