/* Also test .tsx doesn't introduce additional surprises
   To verify the result:
      wh assetpack compile --foreground --production  webhare_testsuite:treeshaketest
      ls -l $(wh getdatadir)/generated/platform/ap/webhare_testsuite.treeshaketest/
   verify the MJS and CSS files
*/
import "@webhare/dompack";
import "@webhare/forms";
// import "@webhare/forms-rtdedit"; //TODO include.. but it comes with a lot of core CSS/JS overhead currently
import "@webhare/frontend";
import "@webhare/gettid";
// import "@webhare/image-edit"; //TODO include!
import "@webhare/js-api-tools";
import "@webhare/jsonrpc-client";
import "@webhare/std";
import "@webhare/upload";
// import "@webhare/witty"; //TODO should we make this frontend suitable? we only need to kill the path.join reference?
