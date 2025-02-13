import { createTolliumImage, postTolliumMessage } from "@webhare/tollium-iframe-api";

window.addEventListener("message", event => {
  if (event.data.answer)
    postTolliumMessage({ question: event.data.answer * event.data.answer });
  if (event.data.image) {
    void createTolliumImage(event.data.image, 16, 16, "c").then(image => {
      postTolliumMessage(image);
    });
  }
});
