# Markdown extra tests

This file contains tests for cases the specification examples don't test for.

# Lists

Ordered list markers MUST end with a `.` or a `)`. The following should not be a list:

```````````````````````````````` example
1 test
.
<p>1 test</p>
````````````````````````````````

# Autolinks

Full URLs should not have their protocol part encoded. The following should be an unencoded URL:

```````````````````````````````` example
[This is an example link](http://example.org)
.
<p><a href="http://example.org">This is an example link</a></p>
````````````````````````````````
