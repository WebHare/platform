/* eslint-disable @typescript-eslint/no-floating-promises -- FIXME: needs API rework */

import './internal/baseforumstyle.css';
import * as dompack from "@webhare/dompack";
// @ts-ignore -- .rpc.json imports cannot be checked by TypeScript
import forumrpc from "@mod-publisher/js/webtools/internal/forum.rpc.json?proxy";
import type { FormSubmitEmbeddedResult } from '@mod-publisher/js/forms/formbase';
import { RPCFormBase } from '../forms';

//TODO perhaps merge with standard formcode... now that basic forms do recaptcha, we shouldn't need to implement it ourselves.. especially as we make it only more complex by overriding submit
class ForumCommentsForm extends RPCFormBase {
  commentstool;

  constructor(commentstool: ForumCommentsWebtool, node: HTMLFormElement) {
    super(node);
    this.commentstool = commentstool;
  }
  getFormExtraSubmitData(): object | Promise<object> {
    return {
      forum: this.commentstool.node.dataset.whForum //Pre WH5.9 location and takes a republish to update
        || this.node.dataset.whForum
    };
  }

  onSubmitSuccess(result: FormSubmitEmbeddedResult<unknown>): void {
    this.reset();
    this.commentstool._initComments();
  }
}

export type ForumCommentsWebtoolOptions = {
  generateitems: (items: Array<{ name: string; postdate: string; message: string }>) => HTMLElement[];
  generateitem: (item: { name: string; postdate: string; message: string }) => HTMLElement;
};

export default class ForumCommentsWebtool {
  node;
  form;
  options: ForumCommentsWebtoolOptions;

  constructor(node: HTMLElement, options?: Partial<ForumCommentsWebtoolOptions>) {
    this.node = node;
    this.options = {
      generateitems: items => this.generateItems(items),
      generateitem: item => this.generateItem(item),
      ...options
    };

    const formnode = dompack.qR<HTMLFormElement>(this.node, 'form');
    this.form = new ForumCommentsForm(this, formnode);
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

  async _initComments() {
    const lock = dompack.flagUIBusy();

    try {
      const state = await forumrpc.getCommentsState(this.form.node.dataset.whForum, location.href);

      this.node.classList.add(state.closed ? "wh-forumcomments--closed" : "wh-forumcomments--open");
      this.node.classList.remove("wh-forumcomments--notloaded");

      const postsholder = dompack.qS(this.node, '.wh-forumcomments__posts');
      if (postsholder) {
        postsholder.replaceChildren();

        const items = this.options.generateitems(state.entries);
        postsholder.append(...items);
      }

      dompack.dispatchCustomEvent(this.node, 'wh:forum-commentsloaded', { bubbles: true, cancelable: false });
    } finally {
      lock.release();
    }
  }
}
