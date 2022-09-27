# Author mode
The author mode is triggered when a site is opened through the Publisher. It adds the 'WebHare actions' bar allowing the user
to access WebHare functionality from the front end

To reposition the bar to the left side, add the class `authormode` to your `<html>` element. In your webdesign:

```harescript
  INSERT "wh-authorbar--left" INTO this->htmlclasses AT END;
```
