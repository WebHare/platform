window.addEventListener("DOMContentLoaded", () =>
{
  const form = document.getElementById("feedbacklogin");
  form.addEventListener("submit", async event =>
  {
    event.preventDefault();

    const userdata =
    { name: event.target.name.value
    , email: event.target.email.value
    };
    const result = await fetch(location.href,
        { method: "POST"
        , headers: { "Content-Type": "application/json" }
        , body: JSON.stringify(userdata)
        });
    if (!result.ok)
      throw new Error(result.statusText);
    const response = await result.json();
    localStorage.whAuthorMode = JSON.stringify(response);
  });
});
