/*
https://github.com/duckinator/innerText-polyfill

HTMLElement#innerText polyfill

I am well aware that innerText is nonstandard, and should generally be avoided.
However, I've ran into a few situations where textContent is utterly useless,
and innerHTML opens up the usual issues that arise with embedding user-supplied
HTML.

So, I decided to make a polyfill for innerText, even though it probably
shouldn't be used if there's an alternative available.

IE has had innerText for a long time, so we basically only need a polyfill for
Firefox. This means we can take advantage of Selection. You can find out more
information about Selection on the Mozilla Developer Network (MDN).

The code's pretty self explanatory, and commented, so read that if you want to
figure out how it works.
*/
/*
The MIT License (MIT)

Copyright (c) 2016 Marie Markwell <me@marie.so>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
if ( (!('innerText' in document.createElement('a'))) && ('getSelection' in window) ) {
    HTMLElement.prototype.__defineGetter__("innerText", function() {
        var selection = window.getSelection(),
            ranges    = [],
            str;

        // Save existing selections.
        var i;
        for (i = 0; i < selection.rangeCount; i++) {
            ranges[i] = selection.getRangeAt(i);
        }

        // Deselect everything.
        selection.removeAllRanges();

        // Select `el` and all child nodes.
        // 'this' is the element .innerText got called on
        selection.selectAllChildren(this);

        // Get the string representation of the selected nodes.
        str = selection.toString();

        // Deselect everything. Again.
        selection.removeAllRanges();

        // Restore all formerly existing selections.
        for (i = 0; i < ranges.length; i++) {
            selection.addRange(ranges[i]);
        }

        // Oh look, this is what we wanted.
        // String representation of the element, close to as rendered.
        return str;
    });

    HTMLElement.prototype.__defineSetter__("innerText", function(str) {
        this.innerHTML = str.replace(/\n/g, "<br />");
    });
}
