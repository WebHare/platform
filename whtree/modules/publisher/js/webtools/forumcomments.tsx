/* eslint-disable @typescript-eslint/no-floating-promises -- FIXME: needs API rework */

import './internal/baseforumstyle.css';
import * as dompack from "dompack";
// @ts-ignore -- .rpc.json imports cannot be checked by TypeScript
import forumrpc from "@mod-publisher/js/webtools/internal/forum.rpc.json?proxy";
import { getCaptchaResponse } from "@mod-publisher/js/captcha/api";
import FormBase from '@mod-publisher/js/forms/formbase';

//TODO perhaps merge with standard formcode... now that basic forms do recaptcha, we shouldn't need to implement it ourselves.. especially as we make it only more complex by overriding submit
class ForumCommentsForm extends FormBase {
  commentstool;

  constructor(commentstool: ForumCommentsWebtool, node: HTMLFormElement) {
    super(node);
    this.commentstool = commentstool;
  }
  async submit(extradata?: { captcharesponse: string }) {
    const result = await this.getFormValue();

    const lock = dompack.flagUIBusy();
    try {
      result.captcharesponse = (extradata ? extradata.captcharesponse : '') || '';

      const response = await forumrpc.postComment(this.commentstool.node.dataset.whForum, location.href, result);

      //ADDME optimize ? we might just as well add the new post ourselves if we had the creationdate
      if (response.success) {
        this.commentstool._initComments();
        this.reset();
      } else if (response.error === "CAPTCHA") {
        const timeoutHandler = async () => {
          const captcharesponse = await getCaptchaResponse(response.apikey);
          if (captcharesponse) //retry with the response
            return this.submit({ captcharesponse });
        };

        setTimeout(() => void timeoutHandler());
      }
    } finally {
      lock.release();
    }
    return {};
  }
}

export type ForumCommentsWebtoolOptions = {
  generateitems: (items: Array<{ name: string; postdate: string; message: string }>) => HTMLElement[];
  generateitem: (item: { name: string; postdate: string; message: string }) => HTMLElement;
};

export default class ForumCommentsWebtool {
  node;
  options: ForumCommentsWebtoolOptions;

  constructor(node: HTMLElement, options?: Partial<ForumCommentsWebtoolOptions>) {
    this.node = node;
    this.options = {
      generateitems: items => this.generateItems(items),
      generateitem: item => this.generateItem(item),
      ...options
    };

    this._initForm();
    this._initComments();
  }

  generateItems(items: Array<{ name: string; postdate: string; message: string }>) {
    return items.map(item => this.options.generateitem(item));

  }
  generateItem(item: { name: string; postdate: string; message: string }) {
    let messagenode;
    const node = <div class="wh-forumcomments__post">
      {messagenode = <div class="wh-forumcomments__message"></div>}
      <div class="wh-forumcomments__signature">
        <div class="wh-forumcomments__name">{item.name}</div>
        <div class="wh-forumcomments__postdate">{item.postdate}</div>
      </div>
    </div>;

    /* The server passes us an encoded message (currently just encodeHTML but
       may do more in the future). We should be able to trust the RPC */
    messagenode.innerHTML = item.message;
    return node;
  }

  _initForm() {
    const formnode = dompack.qS<HTMLFormElement>(this.node, 'form');
    if (formnode)
      new ForumCommentsForm(this, formnode);
  }

  async _initComments() {
    const lock = dompack.flagUIBusy();

    try {
      const state = await forumrpc.getCommentsState(this.node.dataset.whForum, location.href);

      this.node.classList.add(state.closed ? "wh-forumcomments--closed" : "wh-forumcomments--open");
      this.node.classList.remove("wh-forumcomments--notloaded");

      const postsholder = dompack.qS(this.node, '.wh-forumcomments__posts');
      if (postsholder) {
        dompack.empty(postsholder);

        const items = this.options.generateitems(state.entries);
        if (Array.isArray(items))
          dompack.append(postsholder, ...items);
        else
          dompack.append(postsholder, items);
      }

      dompack.dispatchCustomEvent(this.node, 'wh:forum-commentsloaded', { bubbles: true, cancelable: false });
    } finally {
      lock.release();
    }
  }
}
