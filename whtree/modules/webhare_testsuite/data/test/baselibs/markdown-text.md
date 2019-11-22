# Markdown text rendering tests


Paragraphs and line feeds

```````````````````````````````` example
bla\
bla

bla
bla

bla
.
bla
bla

bla bla

bla
````````````````````````````````

Headers (atx, setex)
```````````````````````````````` example
# H1

H2
--
.
H1

H2
````````````````````````````````

Thematic break
```````````````````````````````` example
bla
- - -
bla
.
bla
---
bla
````````````````````````````````

Emphasis
```````````````````````````````` example
**bla _bla_ bla**
.
bla bla bla
````````````````````````````````

autolink
```````````````````````````````` example
<http://example.com>
.
http://example.com
````````````````````````````````

html tag
```````````````````````````````` example
Tag: <div>
.
Tag: <div>
````````````````````````````````

code span
```````````````````````````````` example
`code`
.
code
````````````````````````````````

link
```````````````````````````````` example
[link](http://example.com)
.
link
````````````````````````````````

image
```````````````````````````````` example
![image](http://example.com/image.jpg)
.
image
````````````````````````````````

WebHare symbol reference
```````````````````````````````` example
%symbolref
.
symbolref
````````````````````````````````

List
```````````````````````````````` example
- a
- b
9. a
10. b
.
- a
- b
9. a
10. b
````````````````````````````````
