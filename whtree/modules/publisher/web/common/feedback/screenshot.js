let screenshot = JSON.parse(document.documentElement.dataset.screenshot);

var isScaled, isLoaded;

var docSize = document.body.getBoundingClientRect();
var docWidth = docSize.width;
var docHeight = docSize.height;
var frameWidth = screenshot.width;
var frameHeight = screenshot.height;
var scaleWidth = screenshot.width;
var scaleHeight = screenshot.height;
var factor = 1;

if (frameWidth > docWidth || frameHeight > docHeight)
{
  var widthFactor = docWidth / frameWidth;
  var heightFactor = docHeight / frameHeight;
  factor = Math.min(widthFactor, heightFactor);
  scaleWidth = Math.round(frameWidth * factor);
  scaleHeight = Math.round(frameHeight * factor);
}
var translateX = Math.round(((scaleWidth - frameWidth) / 2) + ((docWidth - scaleWidth) / 2));
var translateY = Math.round(((scaleHeight - frameHeight) / 2) + ((docHeight - scaleHeight) / 2));

var iframe = document.querySelector("iframe");
iframe.style.width = `${frameWidth}px`;
iframe.style.height = `${frameHeight}px`;

iframe.contentWindow.addEventListener("load", function(event) {
  for (const node of iframe.contentDocument.querySelectorAll("[data-wh-screenshot-scroll-top]"))
    node.scrollTop = parseInt(node.dataset.whScreenshotScrollTop);
  for (const node of iframe.contentDocument.querySelectorAll("[data-wh-screenshot-scroll-left]"))
    node.scrollLeft = parseInt(node.dataset.whScreenshotScrollLeft);
  for (const node of iframe.contentDocument.querySelectorAll("iframe")) {
    node.srcdoc = `<!doctype html>
  <html>
    <head>
      <style>
        html, body {
          background: #ffffff;
          height: 100%;
          width: 100%;
        }
        body {
          display: flex;
          justify-content: center;
        }
        div {
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
      </style>
    </head>
    <body>
      <div>
        &lt;iframe&gt;
      </div>
    </body>
  </html>
`;
    node.sandbox = "";
  }
  if (isScaled)
    document.body.style.overflow = "hidden";
  isLoaded = true;
});

function setScaled(scaled) {
  isScaled = scaled;
  if (scaled) {
    iframe.style.transform = `translate(${translateX}px, ${translateY}px) scale(${factor})`;
    if (isLoaded)
      document.body.style.overflow = "hidden";
    window.scrollTo(0, 0);
  } else {
    iframe.style.transform = "none";
    document.body.style.overflow = "";
    window.scrollTo(-translateX, -translateY);
  }
}
window.addEventListener("message", function(event) {
  switch (event.data.type) {
    case "scaled": {
      setScaled(event.data.scaled);
      break;
    }
  }
}, false);

setScaled(screenshot.scaled);
