import * as dompack from "@webhare/dompack";
import { createImage } from "@mod-tollium/js/icons";
import { getTid } from "@webhare/gettid";
import type { IndyShell } from "../shell";
import type { AppLaunchInstruction } from "@mod-platform/js/tollium/types";

function getLocalHHMM() {
  const date = new Date();
  return ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2);
}

/****************************************************************************************************************************
 * Towl notifications
 */

export interface TowlNotification {
  /** Notification id (multiple notifications with the same id won't be shown) */
  id: string;
  /** Icon name or (24x24 pixel) img node (may be left empty) */
  icon: string;
  /** Formatted timestamp (may be left empty) */
  notificationtime?: string;
  /** Notification title (may be left empty) */
  title: string;
  /** Notification message */
  description: string;
  /** Time in ms to show the notification, or 0 to disable auto-hide */
  timeout: number;
  /** If supplied, contains arguments for SendApplicationMessage */
  applicationmessage?: AppLaunchInstruction;

  onclick?: () => void;
  persistent?: boolean;
}

interface ActiveTowlNotification {
  id: string;
  div: HTMLElement | null;
  native: Notification | null;
  hidetimeout: NodeJS.Timeout | null;

  //TODO improve alignment with TowlNotification - or just store a readonly copy of the full original notification
  timeout?: number;
  appmsg?: AppLaunchInstruction;
  onclick?: () => void;
  persistent?: boolean;
}

class TowlNotifications {
  _notifications = new Array<ActiveTowlNotification>;
  _notificationcontainer;
  _firstbrowsernotification = true;

  /// Whether native notifications are supported on this browser
  _native_notifications = Boolean(window.Notification);
  _native_request_visible = false;
  _preferred_location = "";
  _enable_notifications = true;

  shell;

  constructor(shell: IndyShell) {
    this.shell = shell;
    this._notificationcontainer = dompack.create("t-towl");
    document.body?.appendChild(this._notificationcontainer); //body may not exist if the pageload is aborted early (Eg redirect)
    if (this._native_notifications)
      window.addEventListener("pagehide", evt => this._handleUnload());

    // Ensure the 'warning' icon is preloaded
    createImage("tollium:messageboxes/warning", 32, 32, "b");
  }

  // ---------------------------------------------------------------------------
  //
  // Helper functions
  //

  _handleUnload() {
    // Remove all notifications on unload
    this._notifications.forEach(function (data) {
      if (data.native)
        data.native.close();
    });
  }

  _handleClose(data: ActiveTowlNotification, event: MouseEvent) {
    this.hideNotification(data.id);
    event.preventDefault();
    event.stopPropagation();
  }

  /// Handles a click on a notification. Also hides it.
  _handleClick(data: ActiveTowlNotification) {
    if (data.appmsg) {
      this.shell.sendApplicationMessage(data.appmsg.app,
        data.appmsg.target,
        data.appmsg.message,
        data.appmsg.reuse_instance);
    } else if (data.onclick)
      data.onclick();

    this.hideNotification(data.id);
  }

  // If requested, try to show native notification, otherwise show towl notification div
  _showNotificationInternal(notification: TowlNotification) {
    if (!notification.id)
      notification.id = "towltemp-" + Math.random();

    if (!notification.description)
      return;

    // Lookup the notification in the list of currently visible notifications
    let data = this._notifications.find(n => n.id === notification.id);

    // Initialize the data if not present yet
    if (!data) {
      data =
      {
        id: notification.id,
        div: null,
        native: null,
        hidetimeout: null
      };

      this._notifications.push(data);
    }

    // Update info
    Object.assign(data, {
      timeout: notification.timeout,
      appmsg: notification.applicationmessage,
      onclick: notification.onclick,
      persistent: typeof (notification.persistent) === "undefined" ? false : notification.persistent
    });

    // Reset the hidetimeout if present
    if (data.hidetimeout) {
      clearTimeout(data.hidetimeout);
      data.hidetimeout = null;
    }

    // Native enabled and requested?
    if (this._preferred_location === "desktop" && this._native_notifications && Notification.permission === "granted") {
      this._firstbrowsernotification = true;

      // Clear local notification if present
      if (data.div)
        this._hideDiv(data);

      // Convert HTML to plain text
      const description = dompack.create("div", { innerHTML: notification.description }).textContent || '';

      const options: NotificationOptions = {
        body: description,
        tag: notification.id,
        //@ts-ignore FIXME doesn't exist asscording to TypeScript
        onerror: n => this._showNotificationInternal(n)
      };

      // The following two lines were commented out because this mechanism for setting an onclick handler does not work in Webkit browsers, see the comments a few lines down for more info.
      //if (notification.applicationmessage)
      //  options.onclick = this.handleNativeNotificationClick.bind(this, notification.applicationmessage);

      // Create the notification, replace it if the tag is the same
      console.log("Show web notification with options", options, "for event", notification);
      data.native = new Notification(notification.title ? notification.title : getTid("tollium:shell.towl.notificationtitle"), options);

      if (data.appmsg || data.onclick)
        data.native.addEventListener("click", function (ev) { return; });// This fixes an implementation bug in Webkit where events can't be bound to notifications unless an event listener is attached first.

      // This seems like a double call, but it is necessary for Webkit browsers! See the comment above. Maybe in the future it can be implemented in a more elegant way, but for now, leave it as it is!
      data.native.onclick = evt => this._handleClick(data);
    } else {
      this._firstbrowsernotification = false;

      // Reset the native notification if present
      if (data.native) {
        data.native.close();
        data.native = null;
      }

      if (!data.div) {
        // Create and show the div
        const newelement = dompack.create("t-towlnotification",
          {
            className: "hidden",
            on: { click: evt => this._handleClick(data) }
          });
        data.div = newelement;

        this._notificationcontainer.appendChild(data.div);
        window.setTimeout(function () { newelement.classList.remove("hidden"); }, 1);
      }

      // Clear out old content, add the new content
      const closediv = dompack.create("div", {
        className: "close",
        textContent: "x",
        on: { click: evt => this._handleClose(data, evt) }
      });
      data.div.replaceChildren(closediv);

      data.div.classList.toggle("hasicon", Boolean(notification.icon)); // Need an explicit boolean value
      if (notification.icon) {
        const icondiv = dompack.create("div", { className: "icon" });
        data.div.appendChild(icondiv);
        if (typeof notification.icon === 'string')
          icondiv.appendChild(createImage(notification.icon, 24, 24, 'b'));
        else
          icondiv.appendChild(notification.icon);
      }

      data.div.appendChild(dompack.create("div", {
        className: "datetime",
        textContent: getLocalHHMM()
      }));

      if (notification.title)
        data.div.appendChild(dompack.create("div", {
          className: "title",
          innerHTML: notification.title
        }));
      if (notification.description)
        data.div.appendChild(dompack.create("div", {
          className: "description",
          innerHTML: notification.description
        }));
    }

    // Set the timeout
    if (data.timeout! > 0)
      data.hidetimeout = setTimeout(() => this.hideNotification(data.id), data.timeout);
  }

  _hideDiv(data: ActiveTowlNotification) {
    if (!data.div)
      return;

    const mydiv = data.div;
    data.div.classList.add("hidden");
    data.div = null;
    setTimeout(function () { mydiv.remove(); }, 250);
  }

  _showPermissionRequestNotification() {
    this._native_request_visible = true;
    this._showNotificationInternal(
      {
        id: "towl:request_native_permissions",
        title: getTid("tollium:shell.towl.gonativetitle"),
        description: getTid("tollium:shell.towl.gonativedescription"),
        timeout: 0,
        icon: "tollium:messageboxes/information",
        onclick: this.checkNativeNotificationPermission.bind(this)
      });
  }

  // ---------------------------------------------------------------------------
  //
  // Public API
  //

  /** Request permission to show native notifications
  */
  checkNativeNotificationPermission() {
    if (this._native_notifications && Notification.permission === "default") {
      console.log("Requesting permission to show web notifications");
      void Notification.requestPermission(); // no need to await
    }
  }

  setNotificationLocation(type: "browser" | "desktop" | "none") {
    if (!["browser", "desktop", "none"].includes(type))
      throw new Error("Illegal notification location '" + type + "'");

    this._enable_notifications = type !== "none";
    if (type !== "desktop") {
      // Request for native not needed anymore
      this.hideNotification("towl:request_native_permissions");
    } else if (this._preferred_location !== "desktop" && !this._firstbrowsernotification && !this._native_request_visible) {
      if (this._native_notifications && Notification.permission === "default") {
        // When the location switched to 'desktop', show the request dialog
        this._showPermissionRequestNotification();
      }
    }

    this._preferred_location = type;
  }

  updateForCurrentNotificationPermission() {
    if (this._preferred_location !== "desktop" || !this._native_request_visible)
      return;

    // Native request is only visible when browser supports native notifications.
    if (Notification.permission !== "default")
      this.hideNotification("towl:request_native_permissions");
  }

  /** Show a Towl notification
      This function tries to display the notification as a native Desktop notification if available (requesting
      permission if needed). If a native notification is not available or permitted, it displays the notification in
      a Towl notification popup.

      @param notification - The notification to show
  */
  showNotification(notification: TowlNotification) {
    if (!this._enable_notifications)
      return;

    // Show a 'click here to get desktop notifications' notification when native notifications are available but not
    // yet granted or denied
    let request_native_permissions = false;
    if (this._preferred_location === "desktop"
      && this._firstbrowsernotification
      && this._native_notifications
      && Notification.permission === "default")
      request_native_permissions = true;

    this._showNotificationInternal(notification);

    if (request_native_permissions)
      this._showPermissionRequestNotification();
  }

  /** Hide a Towl notification
      @param notificationid - The id the of the notification to hide
  */
  hideNotification(notificationid: string) {
    if (notificationid === "towl:request_native_permissions")
      this._native_request_visible = false;

    for (let i = 0; i < this._notifications.length; ++i)
      if (this._notifications[i].id === notificationid) {
        const data = this._notifications[i];
        if (data.div)
          this._hideDiv(data);
        if (data.native)
          data.native.close();
        if (data.hidetimeout)
          clearTimeout(data.hidetimeout);

        this._notifications.splice(i, 1);
        break;
      }
  }
}

export default TowlNotifications;
