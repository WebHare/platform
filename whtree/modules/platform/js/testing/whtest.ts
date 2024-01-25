/* This library extends @webhare/test with WebHare specific parts shareable between @webhare/test-frontend and @webhare/test-backend
   We can do this in mod:platform as there is no intention to NPM-publish @webhare/test-frontend and @webhare/test-backend as neither
   can realistically work without @webhare/services being locally available (either directly or through a service)
*/

import { dispatchCustomEvent } from "@webhare/dompack";
import { createClient } from "@webhare/jsonrpc-client";

//By definition we re-export all of @webhare/test
export * from "@webhare/test";

export interface WaitForEmailOptions {
  /** If true, don't remove emails from queue */
  peekonly?: boolean;
  /** options.timeout Timeout in milliseconds, max 60000 */
  timeout?: number;
  /** options.count Number of mails expected within the timeout. Defaults to 1 */
  count?: number;
  /** options.returnallmail Return all mail, not up to 'count'. */
  returnallmail?: boolean;
  /** options.scanaheaduntil If set, also look at future tasks until this date */
  scanaheaduntil?: Date | string;
}

interface ExtractedMailLink {
  tagName: string;
  id: string;
  className: string;
  href: string;
  textContent: string;
}

export interface ExtractedMail {
  envelopeSender: string;
  headers: Array<{ field: string; value: string }>;
  html: string;
  links: ExtractedMailLink[];
  linkById: Record<string, ExtractedMailLink>;
  plainText: string;
  subject: string;
  messageId: string;
  from: string;
  replyTo: string;
  attachments: Array<{
    // fileName: string;
    mediaType: string;
    data: ArrayBuffer;
  }>;

  ///The envelope receiver (as actually queued)
  receiver: string;

  // toppart: unknown; //MIME structure. not specified yet (TODO remove?)
}

interface RawExtractedMailResult { //See HS ProcessExtractedMail
  envelope_sender: string;
  headers: Array<{ field: string; value: string }>;
  html: string;
  links: Array<{
    tagname: string;
    id: string;
    classname: string;
    href: string;
    textcontent: string;
  }>;
  plaintext: string;
  subject: string;
  messageid: string;
  mailfrom: string;
  replyto: string;
  toppart: unknown; //MIME structure. not specified yet
  ///The envelope receiver (as actually queued)
  receiver: string;
  attachments: Array<{
    data: string;
    mimetype: string;
  }>;
}

interface TestService {
  invoke(libfunc: string, params: unknown[]): Promise<unknown>;
}

const jstestsrpc = createClient<TestService>("system:jstests");

/** Invoke any remote function as long as its name starts with TESTFW_. This allows you to quickly run code in the backend without having to set up explicit RPCs
 * @param libfunc - `<library>#TESTFW_<function>` to call
*/

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- just returning 'any' as you're not hurting anyone but yourself if you misinterpret an invoke result
export async function invoke(libfunc: string, ...params: unknown[]): Promise<any> {
  if (!libfunc.includes('#'))
    throw new Error(`Invalid function name '${libfunc}' - must be <library><function>`);

  // console.log(`test.invoke ${libfunc}`, params);
  const result = await jstestsrpc.invoke(libfunc, params);

  if (typeof result == "object" && result && (result as { __outputtoolsdata: unknown }).__outputtoolsdata) {
    if (typeof window !== 'undefined')
      dispatchCustomEvent(window, 'wh:outputtools-extradata', { bubbles: false, cancelable: false, detail: (result as { __outputtoolsdata: unknown }).__outputtoolsdata });

    delete (result as { __outputtoolsdata?: unknown }).__outputtoolsdata;
  }

  // console.log(`test.invoke result`, result);
  return result;
}

/** Extract a test email
 * @param email - The email address to look for
*/
export async function waitForEmails(email: string, options?: WaitForEmailOptions): Promise<ExtractedMail[]> {
  const emails = await invoke("mod::system/lib/testframework.whlib#ExtractAllMailFor", email, options) as RawExtractedMailResult[];
  return emails.map(mail => {
    const links: Array<ExtractedMail["links"][number]> = mail.links.map(link => ({
      tagName: link.tagname,
      id: link.id,
      className: link.classname,
      href: link.href,
      textContent: link.textcontent
    }));
    return {
      envelopeSender: mail.envelope_sender,
      headers: mail.headers,
      html: mail.html,
      links: links,
      linkById: Object.fromEntries(links.map(link => [link.id, link])),
      plainText: mail.plaintext,
      subject: mail.subject,
      messageId: mail.messageid,
      from: mail.mailfrom,
      replyTo: mail.replyto,
      receiver: mail.receiver,
      attachments: mail.attachments.map(attachment => ({
        // fileName: '', //TODO not receiving this yet, getting lost somehwere in mime.whlib?
        mediaType: attachment.mimetype,
        data: Uint8Array.from(atob(attachment.data), c => c.charCodeAt(0))
      }))
    };
  });

  // //Add simple DOMs so we can also querySelector the mail HTML
  // return emails.map(email => {
  //   const doc = document.createElement('div');
  //   doc.style.display = "none";
  //   doc.innerHTML = email.html;
  //   return { ...email, doc };
  // });
}
