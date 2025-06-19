/* This library extends @webhare/test with WebHare specific parts shareable between @webhare/test-frontend and @webhare/test-backend
   We can do this in mod:platform as there is no intention to NPM-publish @webhare/test-frontend and @webhare/test-backend as neither
   can realistically work without @webhare/services being locally available (either directly or through a service)
*/

import type { TestService } from "@mod-system/web/systemroot/jstests/testsuite";
import { dispatchCustomEvent } from "@webhare/dompack";
import { createClient } from "@webhare/jsonrpc-client";
import { parseTyped, stringify } from "@webhare/std";

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

  /** @deprecated Switch to textContent in WH5.8+ */
  textcontent: string;
}

export interface ExtractedMail {
  envelopeSender: string;
  headers: Array<{ field: string; value: string }>;
  html: string;
  links: Array<Readonly<ExtractedMailLink>>;
  linkById: Record<string, Readonly<ExtractedMailLink>>;
  plainText: string;
  subject: string;
  messageId: string;
  from: string;
  replyTo: string;
  attachments: Array<{
    // fileName: string;
    mediaType: string;
    data: Uint8Array;
  }>;

  ///The envelope receiver (as actually queued)
  receiver: string;

  // toppart: unknown; //MIME structure. not specified yet (TODO remove?)

  // Properties that have inconsistent names between the two waitForEmails APIs
  /** @deprecated Switch to linkById in WH5.8+ */
  linkbyid: Record<string, ExtractedMailLink>;
  /** @deprecated Switch to plainText in WH5.8+ */
  plaintext: string;
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

const jstestsrpc = createClient<TestService>("system:jstests");

/** Invoke any remote function as long as its name starts with TESTFW_. This allows you to quickly run code in the backend without having to set up explicit RPCs
 * @param libfunc - `<library>#TESTFW_<function>` to call
*/

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- just returning 'any' as you're not hurting anyone but yourself if you misinterpret an invoke result
export async function invoke(libfunc: string, ...params: unknown[]): Promise<any> {
  if (!libfunc.includes('#'))
    throw new Error(`Invalid function name '${libfunc}' - must be <library><function>`);

  // console.log(`test.invoke ${libfunc}`, params);
  const isjs = libfunc.includes('.ts#') || libfunc.includes('.js#');
  const result = await jstestsrpc.invoke(libfunc, isjs ? [stringify(params, { typed: true })] : params);
  if (isjs)
    return parseTyped(result as string);

  if (typeof result === "object" && result && (result as { __outputtoolsdata: unknown }).__outputtoolsdata) {
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
  const outmails = emails.map(mail => {
    //Links are readonly because we caught instances of 'links.filter(_ => _.textContent = "click here").'
    const links: Array<Readonly<ExtractedMailLink>> = mail.links.map(link => Object.freeze({
      tagName: link.tagname,
      id: link.id,
      className: link.classname,
      href: link.href,
      textContent: link.textcontent,

      //Deprecated pre WH5.8 names
      textcontent: link.textcontent
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
      })),

      //Deprecated pre WH5.8 names
      linkbyid: Object.fromEntries(links.map(link => [link.id, link])),
      plaintext: mail.plaintext
    } satisfies ExtractedMail;
  });

  return outmails;
}
