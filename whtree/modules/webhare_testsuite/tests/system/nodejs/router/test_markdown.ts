//test markdown processing. not really 'router' but we're factoring out some nearby testcode here...
import * as test from '@webhare/test-backend';
import { renderMarkdownText } from '@mod-platform/js/pagebuilders/markdown.ts';

async function testMarkdown() {
  //Verify basic rendering
  test.eq(`<h2 class="heading2">H2!</h2>`, await renderMarkdownText("# H2!"));

  //Verify lists. One level
  test.eq(`<ul class="unordered"><li>item 1</li><li>item 2</li></ul><p class="normal">done</p>`, await renderMarkdownText("- item 1\n- item 2\n\ndone"));
  //Second level. Note WH wouldn't add another .unordered!
  test.eq(`<ul class="unordered"><li>item 1</li><li>item 2<ul><li>item 2b</li></ul></li></ul><p class="normal">done</p>`, await renderMarkdownText("- item 1\n- item 2\n  - item 2b\n\ndone"));


  //<ul class="unordered"><li>a</li><li>b<ul><li>c</li><li>d</li></ul></li></ul>
}

test.runTests([testMarkdown]);
