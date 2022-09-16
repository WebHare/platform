const screenshot = JSON.parse(document.documentElement.dataset.screenshot);
const iframe = document.querySelector("iframe");

let isScaled, isLoaded, docPadding, factor, translateX, translateY;

function recalculateSizes()
{
  docPadding = parseInt(getComputedStyle(document.body).paddingTop);
  const docWidth = innerWidth - 2 * docPadding;
  const docHeight = innerHeight - 2 * docPadding;
  const frameWidth = screenshot.width;
  const frameHeight = screenshot.height;
  let scaleWidth = screenshot.width;
  let scaleHeight = screenshot.height;
  factor = 1;

  if (frameWidth > docWidth || frameHeight > docHeight)
  {
    let widthFactor = docWidth / frameWidth;
    let heightFactor = docHeight / frameHeight;
    factor = Math.min(widthFactor, heightFactor);
    scaleWidth = Math.round(frameWidth * factor);
    scaleHeight = Math.round(frameHeight * factor);
  }
  translateX = Math.round(((scaleWidth - frameWidth) / 2) + ((docWidth - scaleWidth) / 2));
  translateY = Math.round(((scaleHeight - frameHeight) / 2) + ((docHeight - scaleHeight) / 2));

  iframe.style.width = `${frameWidth}px`;
  iframe.style.height = `${frameHeight}px`;
  setScaled(screenshot.scaled);
}

iframe.contentWindow.addEventListener("load", () =>
{
  for (const node of iframe.contentDocument.querySelectorAll("[data-wh-screenshot-scroll-top]"))
    node.scrollTop = parseInt(node.dataset.whScreenshotScrollTop);
  for (const node of iframe.contentDocument.querySelectorAll("[data-wh-screenshot-scroll-left]"))
    node.scrollLeft = parseInt(node.dataset.whScreenshotScrollLeft);
  for (const node of iframe.contentDocument.querySelectorAll("iframe"))
  {
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
      </html>`;
    node.sandbox = "";
  }
  if (isScaled)
    document.body.style.overflow = "hidden";
  isLoaded = true;
});

function setScaled(scaled)
{
  isScaled = scaled;
  if (scaled)
  {
    iframe.style.transform = `scale(${factor})`;
    if (isLoaded)
      document.body.style.overflow = "hidden";
    window.scrollTo(docPadding, docPadding);
  }
  else
  {
    iframe.style.transform = "none";
    document.body.style.overflow = "";
    window.scrollTo(-translateX, -translateY);
  }
}

window.addEventListener("message", event =>
{
  switch (event.data.type)
  {
    case "scaled":
    {
      setScaled(event.data.scaled);
      break;
    }
  }
});
window.addEventListener("resize", () => recalculateSizes());

recalculateSizes();
