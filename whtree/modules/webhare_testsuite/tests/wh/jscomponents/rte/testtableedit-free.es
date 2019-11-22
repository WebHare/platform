import * as dompack from 'dompack';
import * as test from "@mod-tollium/js/testframework";
var domscroll = require('@mod-system/js/dom/scroll');

var gesture_time = 25;
var rte = null,table = null;
var moved = null;

function getRoundedSize(node)
{
  var size = node.getBoundingClientRect();
  return { x: Math.round(size.width)
         , y: Math.round(size.height)
         };
}

function getRoundedCoordinates(node)
{
  var coords = node.getBoundingClientRect();
  return { width: Math.round(coords.width)
         , height: Math.round(coords.height)
         , top: Math.round(coords.top)
         , left: Math.round(coords.left)
         , right: Math.round(coords.right)
         , bottom: Math.round(coords.bottom)
         };
}

test.registerTests(
  [
    { loadpage: '/.webhare_testsuite/tests/pages/rte/?editor=free&fill=tables'
    }

  , { name: 'init'
    , test: function(doc, win)
      {
        rte = win.rte.getEditor();
        table = rte.getContentBodyNode().getElementsByTagName('table')[0];
      }
    }

  , { name: 'tableeditor-resize'
    , test: function(doc, win)
      {

        // Test initial table sizes
        var coords = getRoundedCoordinates(table);
        test.eq(301, coords.width); // (4 * 75 column + 2 * 1 outer border)
        test.eq(96, coords.height); // (1 * 25 + 2 * 35 row + 2 * 1 outer border)

        let cells = table.querySelectorAll('tr:first-child th');
        test.eq(75, getRoundedCoordinates(cells[0]).width);
        test.eq(75, getRoundedCoordinates(cells[1]).width);
        test.eq(75, getRoundedCoordinates(cells[2]).width);
        test.eq(75, getRoundedCoordinates(cells[3]).width);

        cells = table.querySelectorAll('th:first-child, td:first-child');
        test.eq(25, getRoundedCoordinates(cells[0]).height);
        test.eq(35, getRoundedCoordinates(cells[1]).height);
        test.eq(35, getRoundedCoordinates(cells[2]).height);

        // Resize first column with the first row's resizer
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 75, clienty: coords.top + 1 + 12 }
                              , { up: 0, clientx: coords.left + 1 + 65, clienty: coords.top + 1 + 12, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-col1-row1'
    , test: function(doc, win)
      {
        var coords = getRoundedCoordinates(table);

        // Resize first column with the second row's resizer
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 65, clienty: coords.top + 1 + 25 + 17 }
                              , { up: 0, clientx: coords.left + 1 + 55, clienty: coords.top + 1 + 25 + 17, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-col1-row2'
    , test: function(doc, win)
      {
        var coords = getRoundedCoordinates(table);

        // Resize first column with the third row's resizer, make it smaller than its contents
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 55, clienty: coords.top + 1 + 25 + 35 + 17 }
                              , { up: 0, clientx: coords.left, clienty: coords.top + 1 + 25 + 35 + 17, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-col1-row3'
    , test: function(doc, win)
      {
        // The table itself should not be resized
        var coords = getRoundedCoordinates(table);
        test.eq(301, coords.width);
        test.eq(96, coords.height);

        // The first column should be 41 pixels wide (40 content + 1 border), the second column 109 pixels (150 - 41),
        // the other columns 75 pixels each
        var cells = table.querySelectorAll('tr:first-child th');
        test.eq(41, getRoundedCoordinates(cells[0]).width);
        test.eq(109, getRoundedCoordinates(cells[1]).width);
        test.eq(75, getRoundedCoordinates(cells[2]).width);
        test.eq(75, getRoundedCoordinates(cells[3]).width);

        // Resize second column, make it smaller than its contents
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 150, clienty: coords.top + 10 }
                              , { up: 0, clientx: coords.left, clienty: coords.top + 1 + 85, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-col2'
    , test: function(doc, win)
      {
        // The table itself should not be resized
        var coords = getRoundedCoordinates(table);
        test.eq(301, coords.width);
        test.eq(96, coords.height);

        // The first column should be 42 pixels wide (40 content + 1 border), the second column 51 pixels (50 content +
        // 1 border), the third column 131 pixels (225 - 41 - 51), the fourth column 75 pixels
        var cells = table.querySelectorAll('tr:first-child th');
        test.eq(41, getRoundedCoordinates(cells[0]).width);
        test.eq(51, getRoundedCoordinates(cells[1]).width);
        test.eq(133, getRoundedCoordinates(cells[2]).width);
        test.eq(75, getRoundedCoordinates(cells[3]).width);

        // Resize fourth column, make it smaller than its contents
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 225, clienty: coords.top + 1 + 85 }
                              , { up: 0, clientx: coords.right, clienty: coords.top + 10, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-col4'
    , test: function(doc, win)
      {
        // The table itself should not be resized
        var coords = getRoundedCoordinates(table);
        test.eq(301, coords.width);
        test.eq(96, coords.height);

        // The first column should be 41 pixels wide (40 content + 1 border), the second column 51 pixels (50 content +
        // 1 border), the fourth column 66 pixels (65 content + 1 border), the third column 142 pixels (300 - 41 - 51 - 66)
        var cells = table.querySelectorAll('tr:first-child th');
        test.eq(41, getRoundedCoordinates(cells[0]).width);
        test.eq(51, getRoundedCoordinates(cells[1]).width);
        test.eq(142, getRoundedCoordinates(cells[2]).width);
        test.eq(66, getRoundedCoordinates(cells[3]).width);

        // Resize third column, make it smaller than its contents
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 300 - 66, clienty: coords.top + 1 + 85 }
                              , { up: 0, clientx: coords.left, clienty: coords.top + 10, delay: gesture_time, transition: test.dragTransition }
                              ]);
        // Resize the table, making it bigger
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 300, clienty: coords.top + 10 }
                              , { up: 0, clientx: coords.left + 1 + 325, clienty: coords.top + 1 + 85, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-table-wider'
    , test: function(doc, win)
      {
        // The table should be 25 pixels wider
        var coords = getRoundedCoordinates(table);
        test.eq(326, coords.width);
        test.eq(96, coords.height);

        // The first and third columns should be 41 pixels wide (40 content + 1 border), the second column 51 pixels (50
        // content + 1 border), the fourth column 192 pixels (325 - 42 - 52 - 42)
        var cells = table.querySelectorAll('tr:first-child th');
        test.eq(41, getRoundedCoordinates(cells[0]).width);
        test.eq(51, getRoundedCoordinates(cells[1]).width);
        test.eq(41, getRoundedCoordinates(cells[2]).width);
        test.eq(192, getRoundedCoordinates(cells[3]).width);

        // Resize the table, making it smaller than its contents
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 325, clienty: coords.top + 1 + 85 }
                              , { up: 0, clientx: coords.left, clienty: coords.top + 10, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-table-smaller'
    , test: function(doc, win)
      {
        // The table should be wide enough just to contain its contents
        var coords = getRoundedCoordinates(table);
        test.eq(200, coords.width);
        test.eq(96, coords.height);

        // The first and third columns should be 42 pixels wide (40 content + 2 * 1 border), the second column 52 pixels (50
        // content + 2 * 1 border), the fourth column 67 pixels (55 content + 2 * 1 border)
        var cells = table.querySelectorAll('tr:first-child th');
        test.eq(41, getRoundedCoordinates(cells[0]).width);
        test.eq(51, getRoundedCoordinates(cells[1]).width);
        test.eq(41, getRoundedCoordinates(cells[2]).width);
        test.eq(66, getRoundedCoordinates(cells[3]).width);

        // Resize the table, making it higher
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 190, clienty: coords.top + 1 + 95 }
                              , { up: 0, clientx: coords.left + 1 + 190, clienty: coords.top + 1 + 95 + 50, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-table-higher'
    , test: function(doc, win)
      {
        // The table should be higher
        var coords = getRoundedCoordinates(table);
        test.eq(200, coords.width);
        test.eq(146, coords.height);

        // The first row should be 25 pixels high, the second row 35 pixels, the third row 85
        var cells = table.querySelectorAll('th:first-child, td:first-child');
        test.eq(25, getRoundedCoordinates(cells[0]).height);
        test.eq(35, getRoundedCoordinates(cells[1]).height);
        test.eq(85, getRoundedCoordinates(cells[2]).height);

        // Resize the first row, making the second row too small for its contents
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 190, clienty: coords.top + 1 + 25 }
                              , { up: 0, clientx: coords.left + 10, clienty: coords.bottom, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-row1-bigger'
    , test: function(doc, win)
      {
        // The table itself should not be resized
        var coords = getRoundedCoordinates(table);
        test.eq(200, coords.width);
        test.eq(146, coords.height);

        // The second row should be 26 pixels (25 content + 1 border), the first row 34 pixels (60 - 27), the third row
        // 85 pixels
        var cells = table.querySelectorAll('th:first-child, td:first-child');
        test.eq(34, getRoundedCoordinates(cells[0]).height);
        test.eq(26, getRoundedCoordinates(cells[1]).height);
        test.eq(85, getRoundedCoordinates(cells[2]).height);

        // Resize the second row, making it lower (less high)
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 190, clienty: coords.top + 1 + 60 }
                              , { up: 0, clientx: coords.left + 10, clienty: coords.top, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-row2-lower'
    , test: function(doc, win)
      {
        // The table itself and the rows should not be resized
        var coords = getRoundedCoordinates(table);
        test.eq(200, coords.width);
        test.eq(146, coords.height);

        var cells = table.querySelectorAll('th:first-child, td:first-child');
        test.eq(34, getRoundedCoordinates(cells[0]).height);
        test.eq(26, getRoundedCoordinates(cells[1]).height);
        test.eq(85, getRoundedCoordinates(cells[2]).height);

        // Resize the first row, making it lower
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 10, clienty: coords.top + 1 + 33 }
                              , { up: 0, clientx: coords.left + 1 + 190, clienty: coords.top, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-row1-lower'
    , test: function(doc, win)
      {
        // The table itself should not be resized
        var coords = getRoundedCoordinates(table);
        test.eq(200, coords.width);
        test.eq(146, coords.height);

        // The first row should be 21 pixels (20 content + 1 border), the second row 39 pixels (60 - 21), the third row
        // 85 pixels
        var cells = table.querySelectorAll('th:first-child, td:first-child');
        test.eq(21, getRoundedCoordinates(cells[0]).height);
        test.eq(39, getRoundedCoordinates(cells[1]).height);
        test.eq(85, getRoundedCoordinates(cells[2]).height);

        // Resize the second row, making it lower
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 190, clienty: coords.top + 1 + 60 }
                              , { up: 0, clientx: coords.left + 10, clienty: coords.top, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-row1-2-lower'
    , test: function(doc, win)
      {
        // The table itself should not be resized
        var coords = getRoundedCoordinates(table);
        test.eq(200, coords.width);
        test.eq(146, coords.height);

        // The first row should be 21 pixels (20 content + 1 border), the second row 26 pixels (25 content + 1 border),
        // the third row 98 pixels (145 - 21 - 26)
        var cells = table.querySelectorAll('th:first-child, td:first-child');
        test.eq(21, getRoundedCoordinates(cells[0]).height);
        test.eq(26, getRoundedCoordinates(cells[1]).height);
        test.eq(98, getRoundedCoordinates(cells[2]).height);

        // Resize the table, making it lower
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 10, clienty: coords.top + 1 + 145 }
                              , { up: 0, clientx: coords.left + 1 + 190, clienty: coords.top, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-table-lower'
    , test: function(doc, win)
      {
        // The table should be wide enough just to contain its contents
        var coords = getRoundedCoordinates(table);
        test.eq(200, coords.width);
        test.eq(79, coords.height);

        // The first row should be 21 pixels (20 content + 1 border), the second row 26 pixels (25 content + 1 border),
        // the third row 31 pixels (30 content + 1 border)
        var cells = table.querySelectorAll('th:first-child, td:first-child');
        test.eq(21, getRoundedCoordinates(cells[0]).height);
        test.eq(26, getRoundedCoordinates(cells[1]).height);
        test.eq(31, getRoundedCoordinates(cells[2]).height);

        // Resize the contents of the first table cell
        var div = table.querySelector('div');
        div.style.width="auto";
        div.style.height="auto";
        rte.selectNodeInner(div);
        var text = document.createTextNode("aap_noot_mies\nwim_zus_jet\nteun_vuur_gijs");
        rte.replaceSelectionWithNode(text);

        // Calculate the offset by which the resizer should have moved
        moved = getRoundedSize(cells[0]);
        moved = { x: moved.x - 42
                , y: moved.y - 22
                };
      }
    , waits: [ 150 ] // The tableeditor updates its resizers after a timeout of 100ms
    }

  , { test: function(doc, win)
      {
        var coords = getRoundedCoordinates(table);

        // Resize the table, making it higher
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 100, clienty: coords.top + 1 + 79 + moved.y }
                              , { up: 0, clientx: coords.left + 100, clienty: coords.top + 1 + 79 + moved.y + 50, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-table-edited-higher'
    , test: function(doc, win)
      {
        // The table should be 50 pixels higher
        var coords = getRoundedCoordinates(table);
        test.eq(200 + 1 + moved.x, coords.width);
        test.eq(79 + 1 + moved.y + 50, coords.height);

        // The first row should be 22 pixels + extra for added content (20 content + 2 * 1 border), the second row 26 pixels
        // (25 content + 1 border), the third row 81 pixels (30 content + 1 border + 50 resized)
        var cells = table.querySelectorAll('th:first-child, td:first-child');
        test.eq(22 + moved.y, getRoundedSize(cells[0]).y);
        test.eq(26, getRoundedSize(cells[1]).y);
        test.eq(81, getRoundedSize(cells[2]).y);

        // Resize the table, making it wider
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 200 + moved.x, clienty: coords.top + 100 }
                              , { up: 0, clientx: coords.left + 1 + 200 + moved.x + 50, clienty: coords.top + 100, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-table-edited-wider'
    , test: function(doc, win)
      {
        // The table should be 50 pixels wider
        var coords = getRoundedCoordinates(table);
        test.eq(200 + 1 + moved.x + 50, coords.width);
        test.eq(79 + 1 + moved.y + 50, coords.height);

        // The third column should be 41 pixels wide + extra for added content (40 content + 1 border), the
        // second column 51 pixels (50 content + 1 border), the fourth column 117 pixels (55 content + 1 border + 50
        // resized)
        var cells = table.querySelectorAll('tr:first-child th');
        //test.eq(97, getRoundedSize(cells[0]).x); // no specific width set on this
        test.eq(51, getRoundedSize(cells[1]).x);
        test.eq(41, getRoundedSize(cells[2]).x);
        test.eq(116, getRoundedSize(cells[3]).x);

        // Resize the contents of the first table cell
        var div = table.querySelector('div');
        div.style.width = 'auto';
        div.style.height = 'auto';
        rte.selectNodeInner(div);
        var text = document.createTextNode("aap");
        rte.replaceSelectionWithNode(text);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-resize-table-edited'
    , test: function(doc, win)
      {

        // The table should keep its size and not shrink to the new content
        var coords = getRoundedCoordinates(table);
        test.eq(200 + 1 + moved.x + 50, coords.width);
        test.eq(129, coords.height);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-scrolled'
    , test: function(doc, win)
      {
        // Injects some brs before the table
        var br = rte.getContentBodyNode().getElementsByTagName('br')[0];
        for (var i = 0; i < 40; ++i)
          dompack.after(br, doc.createElement('br'));

        // Update the resize handles positions
        rte.stateHasChanged();

        // Scroll to the last td
        var last_td = Array.from(rte.getContentBodyNode().getElementsByTagName('td')).slice(-1)[0];
        domscroll.scrollToElement(last_td);

        // See if we really scrolled
        test.true(rte.getContentBodyNode().parentNode.scrollTop > 100);

        // Resize the table, making it wider
        var coords = getRoundedCoordinates(table);
        test.sendMouseGesture([ { doc: doc, down: 0, clientx: coords.left + 1 + 250 + moved.x, clienty: coords.top + 100 }
                              , { up: 0, clientx: coords.left + 1 + 200 + moved.x, clienty: coords.top + 100, delay: gesture_time, transition: test.dragTransition }
                              ]);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  , { name: 'tableeditor-scrolled-table-resized'
    , test: function(doc, win)
      {
        // The table should be resized properly
        var coords = getRoundedCoordinates(table);
        test.eq(200 + 1 + moved.x, coords.width);
        test.eq(129, coords.height);
      }
    , waits: [ 'pointer', 'animationframe' ]
    }

  ]);
