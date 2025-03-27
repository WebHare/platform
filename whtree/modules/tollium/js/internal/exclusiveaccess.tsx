/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import { FIFO } from "@mod-system/js/internal/util/fifo";
import * as dialogapi from 'dompack/api/dialog';
import * as dompack from 'dompack';
import { getTid } from "@webhare/gettid";
import "./exclusiveaccess.lang.json";


/* see mod::system/web/systemroot/exclusiveaccess/exclusiveaccess.whsock for the protocol messages
*/

/** Lock already owned controller. Emitted when the lock is already owned by
    another user.
    Events:
    - update: when userinfo has updated
    - close: when cancelled or the lock has been granted
*/
class AlreadyLockedController extends EventTarget {
  constructor(fifo, info, isself) {
    super();
    this._fifo = fifo;
    this.info = info;
    this.isself = isself;
  }

  /** Called when the dialog needs to close (either answered or because the
      lock was granted (due to the previous owner releasing it)
  */
  _gotClose() {
    this.dispatchEvent(new Event("close"));
    this._fifo = null;
  }

  /// Call to cancel the getExclusiveAccess call
  cancel() {
    if (this._fifo)
      this._fifo.push({ type: "local-cancel" });
  }

  /// Call the request the lock from the current owner
  requestLock() {
    if (this._fifo)
      this._fifo.push({ type: "local-requestLock" });
  }
}

/** Waiting for lock release controller. Emitted when requesting the lock from
    another user that owns it
    Events:
    - close: when cancelled or the lock has been granted
*/
class WaitingForOwnerController extends EventTarget {
  constructor(fifo, info, timeleft) {
    super();
    this._fifo = fifo;
    this.info = info;
    this.deadline = Date.now() + timeleft;
  }

  /** Called when the dialog needs to close (the request was granted or denied,
      or the previous owner just released the lock)
  */
  _gotClose() {
    this.dispatchEvent(new Event("close"));
    this._fifo = null;
  }

  /// Call cancel to cancel the takeover request
  cancel() {
    if (this._fifo)
      this._fifo.push({ type: "local-cancel" });
  }
}

/** Release own lock request object. Emitted when the lock is acquired and another user
    wants it.
    Events:
    - update: when userinfo has updated
    - close: when request has been closed (either by requestor or by responding)
*/
class ReleaseRequestController extends EventTarget {
  constructor(fifo, info, timeleft) {
    super();
    this._fifo = fifo;
    this.info = info;
    this.deadline = Date.now() + timeleft;
  }

  _gotClose() {
    this.dispatchEvent(new Event("close"));
    this._fifo = null;
  }

  /** Call to respond to the request
      @(boolean) param release Pass `true` to release the lock
  */
  respond(release) {
    // only allow one response
    if (this._fifo)
      this._fifo.push({ type: "local-releaseRequestResponse", allow: Boolean(release) });
    this._fifo = null;
  }
}

/** Release own lock request object. Emitted when the lock is acquired and another user
    wants it.
    Events:
    - update: when userinfo has updated
    - close: when request has been closed (either by requestor or by responding)
*/
class LockController extends EventTarget {
  constructor(fifo, token) {
    super();
    this._fifo = fifo;
    this.token = token;
  }

  /// Called when the lock is closed (either by calling close or when the lock is stolen
  _gotClose() {
    this.token = null;
    this._fifo = null;
    this.dispatchEvent(new Event("close"));
  }

  /// Call to release the lock
  release() {
    this.token = null;
    if (this._fifo)
      this._fifo.push({ type: "local-cancel" });
    this._fifo = null;
  }
}

/** Get exclusive access for a resource
    @param(string) tag Tag identifying the resource
    @param(record) userinfo User info
    @cell(integer) userinfo.entityid
    @cell(string) userinfo.login
    @cell(string) userinfo.realname
    @cell(function ptr) options.onAlreadyLocked Called when the resource is already
      locked by another user. Signature: void onalreadylocked(ctrl: AlreadyLockedControl)
    @cell(function ptr) options.onWaitingForOwner Called when the user has requested
      the resource from the other user, synchronously with the 'close' event on
      the LockAlreadyOwned controller passed to the onalreadylocked callback
    @cell(function ptr) options.onLocked Called when the lock has been granted.
      Signature: void onalreadylocked(ctrl: ExclusivityLock)
    @cell(function ptr) options.onFailed Called when getting the lock failed
      (cancelled takeover, takeover denied)
    @cell(function ptr) options.onReleaseRequest Called when a release request has
      been received. Signature: void onalreadylocked(ctrl: ReleaseOwnLockRequest)
    @cell(function ptr) options.onLockStolen Called when the lock has been stolen
    @cell(function ptr) options.onReleaseRequestDenied Called when the request to release
      the lock has been denied.
    @return Returns when the lock has been closed or getting the lock failed. No
      value is returned.
*/
export async function getExclusiveAccess(identifier, userinfo, { onAlreadyLocked, onWaitingForOwner, onLocked, onFailed, onReleaseRequest, onLockStolen, onReleaseRequestDenied }) {
  if (!onLocked || !onFailed || !onLockStolen)
    throw new Error("getExclusiveAccess parameters onLocked, onFailed and onLockStolen are both required");
  if (!onAlreadyLocked !== !onWaitingForOwner)
    throw new Error("getExclusiveAccess parameters onalreadylocked and onrequestingclose must both be omitted or both be provided");

  userinfo = { entityid: userinfo.entityid ?? 0, login: userinfo.login ?? "", realname: userinfo.realname ?? "" };

  let busylock = dompack.flagUIBusy({ modal: true });

  const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/.tollium/exclusiveaccess/exclusiveaccess.whsock`);
  const fifo = new FIFO<{ type: string; allow?: boolean }>;
  socket.addEventListener("open", e => fifo.push({ type: "open" }));
  socket.addEventListener("error", e => fifo.push({ type: "error" }));
  socket.addEventListener("close", e => fifo.push({ type: "close" }));
  socket.addEventListener("message", e => fifo.push(JSON.parse(e.data)));

  await fifo.waitSignalled();
  const item = fifo.shift();
  if (!item) {
    busylock.release();
    onFailed();
    return;
  }

  socket.send(JSON.stringify({ type: "lock", identifier, userinfo }));

  let alreadylocked_ctrl, waitingforowner_ctrl;
  let lock_ctrl, releaserequest_ctrl;

  function resetDialogs({ flagbusy } = {}) {
    if (waitingforowner_ctrl) {
      waitingforowner_ctrl._gotClose();
      waitingforowner_ctrl = null;
    }
    if (alreadylocked_ctrl) {
      alreadylocked_ctrl._gotClose();
      alreadylocked_ctrl = null;
    }
    if (flagbusy)
      busylock = busylock ?? dompack.flagUIBusy({ modal: true });
    else {
      if (busylock)
        busylock.release();
      busylock = null;
    }
  }

  while (true) {
    await fifo.waitSignalled();
    const item = fifo.shift();

    switch (item.type) {
      case "local-cancel":
        {
          resetDialogs();
          if (lock_ctrl) {
            socket.send(JSON.stringify({ type: "release" }));
            lock_ctrl._gotClose();
            lock_ctrl = null;
          }
          socket.close();
          onFailed();
          return;
        }
      case "local-requestLock":
        {
          socket.send(JSON.stringify({ type: "requestLock" }));

          // The info about the current owner can change
          resetDialogs({ flagbusy: true });
        } break;
      case "alreadyLocked":
        {
          // another user got the lock - takeover requests are cancelled
          resetDialogs();
          if (onAlreadyLocked) {
            alreadylocked_ctrl = new AlreadyLockedController(fifo, item.info, item.isself);
            onAlreadyLocked(alreadylocked_ctrl);
          } else {
            socket.close();
            onFailed();
            return;
          }
        } break;
      case "waitingForOwner":
        {
          waitingforowner_ctrl = new WaitingForOwnerController(fifo, item.info, item.timeleft);
          onWaitingForOwner(waitingforowner_ctrl);
        } break;
      case "lockGranted":
        {
          resetDialogs();
          lock_ctrl = new LockController(fifo, item.token);
          onLocked(lock_ctrl);
        } break;
      case "releaseRequest":
      case "updateReleaseRequest":
        {
          if (releaserequest_ctrl)
            releaserequest_ctrl._gotClose();
          if (onReleaseRequest) {
            releaserequest_ctrl = new ReleaseRequestController(fifo, item.info, item.timeleft);
            onReleaseRequest(releaserequest_ctrl);
          } else {
            socket.send(JSON.stringify({ type: "denyReleaseRequest" }));
          }
        } break;
      case "releaseRequestDenied":
        {
          resetDialogs();
          if (onReleaseRequestDenied)
            onReleaseRequestDenied();
          socket.close();
          onFailed();
        } break;
      case "local-releaseRequestResponse":
        {
          if (releaserequest_ctrl)
            releaserequest_ctrl._gotClose();
          releaserequest_ctrl = null;

          socket.send(JSON.stringify({ type: item.allow ? "allowReleaseRequest" : "denyReleaseRequest" }));

          if (item.allow) {
            if (lock_ctrl)
              lock_ctrl._gotClose();
            lock_ctrl = null;
          }
        } break;
      case "cancelReleaseRequest":
        {
          if (releaserequest_ctrl)
            releaserequest_ctrl._gotClose();
          releaserequest_ctrl = null;
        } break;
      case "lockStolen":
        {
          if (releaserequest_ctrl)
            releaserequest_ctrl._gotClose();
          if (lock_ctrl)
            lock_ctrl._gotClose();
          lock_ctrl = null;
          onLockStolen(item.info);
          socket.close();
        } break;
      case "lockDenied":
        {
          resetDialogs();
          if (onReleaseRequestDenied)
            onReleaseRequestDenied();
          socket.close();
          onFailed();
        } break;
    }
  }
}

/** Get exclusive access for a resource
    @param(string) tag Tag identifying the resource
    @param(record) userinfo User info
    @cell(integer) userinfo.entityid
    @cell(string) userinfo.login
    @cell(string) userinfo.realname
    @cell(function ptr) options.onAlreadyLocked Called when the resource is already
      locked by another user. Signature: void onalreadylocked(ctrl: AlreadyLockedControl)
    @cell(function ptr) options.onWaitingForOwner Called when the user has requested
      the resource from the other user, synchronously with the 'close' event on
      the LockAlreadyOwned controller passed to the onalreadylocked callback
    @cell(function ptr) options.onReleaseRequest Called when a release request has
      been received. Signature: void onalreadylocked(ctrl: ReleaseOwnLockRequest)
    @cell(function ptr) options.onLockStolen Called when the lock has been stolen
    @cell(function ptr) options.onReleaseRequestDenied Called when the request to release
      the lock has been denied.
    @return Returns a LockController when the lock is obtained, or throws when
      it could not be obtained.
*/
export async function getExclusiveAccessPromise(tag, userinfo, { onAlreadyLocked, onWaitingForOwner, onReleaseRequest, onLockStolen, onReleaseRequestDenied }) {
  return new Promise((resolve, reject) => getExclusiveAccess(tag, userinfo,
    {
      onAlreadyLocked,
      onWaitingForOwner,
      onReleaseRequest,
      onLockStolen,
      onReleaseRequestDenied,
      onLocked: (ctrl) => resolve(ctrl),
      onFailed: () => reject(new Error(`Failed to get the lock`))
    }));
}

function getSecsToDeadline(deadline) {
  return (deadline - Date.now() + 10) / 1000 | 0;
}

/** Get exclusive access with dialogs using the dialog API
    @param(string) tag Tag identifying the resource
    @param(record) userinfo User info
    @cell(integer) userinfo.entityid User entity ID. If set, resources owned by the same entityid will
      be released immediately.
    @cell(string) userinfo.login User login
    @cell(string) userinfo.realname User real name
    @cell options.onAlreadyLocked Called when the dialog must be shown that indicates the item has
      already been locked. Parameters: object with members { login, realname, isself }. Return a
      HTML node to override the default dialog contents.
    @cell options.onAlreadyLocked Called when the dialog must be shown that indicates that the
      user is waiting for the current owner of the lock to releas it. Parameters: object with
      members { login, realname, timeleft (timeout in milliseconds) }. Return a
      HTML node to override the default dialog contents.
    @cell options.onAlreadyLocked Called when the dialog must be shown that indicates that the
      request to another user to release the lock has been denied Parameters: object with
      members { login, realname }. Return a HTML node to override the default dialog contents.
    @cell options.onReleaseRequest Called when the dialog must be shown that indicates another
      user wants the current user to release the lock. Parameters: object with members { login,
      realname, timeleft (timeout in milliseconds) }. Return a HTML node to override the default
      dialog contents.
    @cell options.onLockStolen Called when the dialog must be shown that indicates the lock has been
      stolen by another user. Parameters: object with members { login, realname }. Return a HTML
      node to override the default dialog contents.
    @cell options.onLockStolenShown Called when the 'lock stolen' dialog has been shown and
      the user closed it.
    @cell options.buttontitles Overrides for button titles
    @cell options.buttontitles.yes Override for button "yes"
    @cell options.buttontitles.no Override for button "no"
    @cell options.buttontitles.cancel Override for button "cancel"
    @cell options.buttontitles.close Override for button "close"
    @return Promise that will resolve to a LockController object, or rejected if the lock
      can't be obtained.
*/
export async function getExclusiveAccessWithDialog(identifier, userinfo,
  { onAlreadyLocked
    , onWaitingForOwner
    , onReleaseRequestDenied
    , onReleaseRequest
    , onLockStolen
    , onLockStolenShown
    , buttontitles = {} } = {}) {
  return await getExclusiveAccessPromise(identifier,
    userinfo,
    {
      onAlreadyLocked: async (ctrl) => {
        const actrl = new AbortController;
        ctrl.addEventListener("close", () => actrl.abort());

        const message = (onAlreadyLocked && onAlreadyLocked({ login: ctrl.info.login, realname: ctrl.info.realname, isself: ctrl.isself })) ||
          ctrl.isself
          ? <div>
            {getTid("tollium:exclusive.frontend.alreadyselflocked")}
          </div>
          : <div>
            {getTid("tollium:exclusive.frontend.alreadylocked", ctrl.info.login || ctrl.info.realname, ctrl.info.realname)}
          </div>;

        const res = await dialogapi.runMessageBox(message,
          [
            { title: buttontitles.yes || getTid("tollium:exclusive.frontend.buttons.yes"), result: "yes" },
            { title: buttontitles.no || getTid("tollium:exclusive.frontend.buttons.no"), result: "no" }
          ], { signal: actrl.signal, allowcancel: false });
        if (res === "yes")
          ctrl.requestLock();
        else
          ctrl.cancel();
      },
      onWaitingForOwner: async (ctrl) => {
        const actrl = new AbortController;
        ctrl.addEventListener("close", () => actrl.abort());

        const message = (onWaitingForOwner && onWaitingForOwner({ login: ctrl.info.login, realname: ctrl.info.realname, timeleft: ctrl.timeleft })) ||
          <div>
            {getTid("tollium:exclusive.frontend.waitingforowner", ctrl.info.login || ctrl.info.realname, ctrl.info.realname, getSecsToDeadline(ctrl.deadline))}
          </div>;

        await dialogapi.runMessageBox(message,
          [{ title: buttontitles.cancel || getTid("tollium:exclusive.frontend.buttons.cancel"), result: "cancel" }], { signal: actrl.signal, allowcancel: false });
        if (!actrl.signal.aborted)
          ctrl.cancel();
      },
      onReleaseRequest: async (ctrl) => {
        const actrl = new AbortController;
        ctrl.addEventListener("close", () => actrl.abort());

        const message = (onReleaseRequest && onReleaseRequest({ login: ctrl.info.login, realname: ctrl.info.realname, timeleft: ctrl.timeleft })) ||
          <div>
            {getTid("tollium:exclusive.frontend.releaserequest", ctrl.info.login || ctrl.info.realname, ctrl.info.realname, getSecsToDeadline(ctrl.deadline))}
          </div>;

        const res = await dialogapi.runMessageBox(message,
          [
            { title: buttontitles.yes || getTid("tollium:exclusive.frontend.buttons.yes"), result: "yes" },
            { title: buttontitles.no || getTid("tollium:exclusive.frontend.buttons.no"), result: "no" }
          ], { signal: actrl.signal, allowcancel: false });
        ctrl.respond(res === "yes");
      },
      onLockStolen: async (info) => {
        const message = (onLockStolen && onLockStolen({ login: info.login || info.realname, realname: info.realname })) ||
          <div>
            {getTid("tollium:exclusive.frontend.lockstolen", info.login, info.realname)}
          </div>;

        await dialogapi.runMessageBox(message,
          [{ title: buttontitles.close || getTid("tollium:exclusive.frontend.buttons.close"), result: "close" }]);

        if (onLockStolenShown)
          onLockStolenShown();
      },
      onReleaseRequestDenied: async () => {
        const message = (onReleaseRequestDenied && onReleaseRequestDenied()) ||
          <div>
            {getTid("tollium:exclusive.frontend.releaserequestdenied")}
          </div>;

        await dialogapi.runMessageBox(message,
          [{ title: buttontitles.close || getTid("tollium:exclusive.frontend.buttons.close"), result: "close" }]);
      }
    });
}
