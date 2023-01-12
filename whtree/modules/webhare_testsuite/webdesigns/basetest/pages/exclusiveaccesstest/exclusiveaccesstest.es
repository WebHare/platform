import { getExclusiveAccessWithDialog } from "@mod-system/js/wh/exclusiveaccess";
import * as dompack from 'dompack';
import "./exclusiveaccesstest.scss";
import '@mod-system/js/wh/errorreporting';

let lock;

async function requestAccess()
{
  try
  {
    document.getElementById("startexclusiveaccesstest").disabled = true;
    document.getElementById("status").textContent = "Requesting the lock";

    let tokens = location.hash.substr(1).split(",");
    let entityid = parseInt(tokens[0], 10) || 0;
    let login = `${tokens[1] || "unknown"}@example.com`;
    let realname = `${login.split("@")[0]} testuser`;

    lock = await getExclusiveAccessWithDialog("webhare_testsuite:test",
      { entityid, login, realname },
      { onLockStolen: () => void(document.getElementById("status").textContent = "LockStolen")
      , onAlreadyLocked: () => void(document.getElementById("status").textContent = "AlreadyLocked")
      , onWaitingForOwner: () => void(document.getElementById("status").textContent = "WaitingForOwner")
      , onReleaseRequest: () => void(document.getElementById("status").textContent = "ReleaseRequest")
      , onReleaseRequestDenied: () => void(document.getElementById("status").textContent = "ReleaseRequestDenied")
      , onLockStolenShown: () => void(document.getElementById("status").textContent = "LockStolenShown")
      }
      );

    document.getElementById("locked").textContent = "yes";
    document.getElementById("locked").dataset.locktoken = lock.token;

    lock.addEventListener("close", () =>
    {
      lock = null;
      document.getElementById("locked").textContent = "no";
      document.getElementById("locked").dataset.locktoken = null;
      document.getElementById("releaselock").disabled = true;
      document.getElementById("status").textContent = "Lock not taken";
      document.getElementById("startexclusiveaccesstest").disabled = false;
    });

    document.getElementById("releaselock").disabled = false;
    document.getElementById("status").textContent = `Got lock`;
  }
  catch (e)
  {
    document.getElementById("status").textContent = "Failed getting the lock";
    document.getElementById("startexclusiveaccesstest").disabled = false;
    console.error(e);
  }
}

dompack.register("#startexclusiveaccesstest", node => node.addEventListener("click", () => requestAccess()));
dompack.register("#releaselock", node => node.addEventListener("click", () =>
{
  lock && lock.release();
}));
