import { isWorkOpen } from "@webhare/whdb";
import { ResourceDescriptor } from "./descriptor";
import { loadWittyResource } from "./witty";
import { readRegistryKey } from "./registry";
import type { WittyData, WittyTemplate } from "@webhare/witty";
import { loadlib } from "@webhare/harescript";

async function getMailRecipients(inaddresses: string[]) {
  if (!inaddresses.length)
    return "";
  return await loadlib("mod::system/lib/internal/composer.whlib").getMailRecipients(inaddresses);
}

class PreparedMail {
  // Source of the mail. Is not sent as part of the mail (headers)
  origin: string;
  subject = '';
  replyto = '';
  to: string[] = [];
  cc: string[] = [];
  data: WittyData = {};

  private templ: WittyTemplate;
  private attachments: ResourceDescriptor[] = [];

  constructor(templ: WittyTemplate, origin: string) {
    this.templ = templ;
    this.origin = origin;
  }

  async attachResource(path: string) {
    const toattach = await ResourceDescriptor.fromResource(path);
    this.attachments.push(toattach);
  }

  async queue(): Promise<number[]> {
    if (!isWorkOpen())
      throw new Error(`Cannot queue mail outside of a work - use beginWork`);

    const sender = await readRegistryKey<string>("system.services.smtp.mailfrom"); //FIXME read from witty's dom
    const html = await this.templ.run(this.data);
    const headers: Array<{
      field: string;
      value: string;
    }> = [
        { field: "MIME-Version", value: "1.0" },
        { field: "Date", value: (new Date).toUTCString() },
        { field: "Subject", value: this.subject },
        { field: "From", value: sender }//TODO sender/senderfrom split? also clean that up in the registry (two parts)
      ];

    if (this.replyto)
      headers.push({ field: "Reply-To", value: this.replyto });
    if (this.to.length)
      headers.push({ field: "To", value: await getMailRecipients(this.to) });
    if (this.cc.length)
      headers.push({ field: "Cc", value: await getMailRecipients(this.cc) });

    const recipients = [...new Set([...this.to, ...this.cc])];
    const results = await loadlib("mod::system/lib/mailer.whlib").__PrepareMailForJS({
      origin: this.origin,
      recipients,
      sender,
      html,
      headers,
      attachments: this.attachments
    });
    return results.taskids;
  }
}

export interface PrepareMailOptions {

}

export async function prepareMail(templateResource: string): Promise<PreparedMail> {
  const wittyresource = await loadWittyResource(templateResource);
  const mail = new PreparedMail(wittyresource, templateResource);
  return mail;
}

export type { PreparedMail };
