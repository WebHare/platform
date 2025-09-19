import * as dompack from "@webhare/dompack";
//@ts-ignore -- still need to port to proper JSON/RPC or just straight to a whrpc
import pollrpc from "@mod-publisher/js/webtools/internal/poll.rpc.json?proxy";
import { addDuration, throwError } from "@webhare/std";

/*

- error handling?


FIXME: send allowvotingagainafter value back together with the results so the value can be changed
       without needing to republish a site

*/

let pollstofetch = new Array<PollWebtool>;

type PollData = {
  toolid: string;
  ismultiplechoice: boolean;
  allowvotingagainafter?: number; //in minutes. Pre-WH5.9 this field was published
  revote_after?: string; //in ISO 8601 duration format. Since WH5.9 this field is published
};

type PollResults = {
  amountofvoters: number;
  options: Array<{
    guid: string;
    title: string;
    votepercentage: number;
    votes: number;
  }>;
};

//parse JSON data, throw with more info on parse failure
function getJSONAttribute<T>(node: Element, attributename: string): T | null {
  try {
    if (node.hasAttribute(attributename))
      return JSON.parse(node.getAttribute(attributename) as string);
  } catch (e) {
    console.error("JSON parse failure on attribute '" + attributename + "' of node", node);
    throw e;
  }
  return null;
}

export default class PollWebtool {
  constructor(public node: HTMLElement) {
    scheduleFetchResults(this);

    node.addEventListener("submit", e => this.doCheckForPollSubmit(e));

    for (const button of dompack.qSA(node, '.wh-poll__showresultsbutton'))
      button.addEventListener("click", e => this.doCheckForShowResultsClick(e));

    for (const button of dompack.qSA(node, '.wh-poll__hideresultsbutton'))
      button.addEventListener("click", e => this.doCheckForHideResultsClick(e));

    this._disableInteraction(); //make sure the poll is blocked until we've retrieved the current results

    //if (localStorage["webtools:"+this._getToolId()] === "voted")
    const alreadyvoted = localStorage["wh-webtools-votetime:" + this._getToolId()];
    if (alreadyvoted)
      this.node.classList.add("wh-poll--voted");
  }

  // make poll input's and submit button inactive
  _disableInteraction() {
    const inputnodes = this.node.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,.wh-poll__votebutton");
    //let submitnodes = toolnode.querySelectorAll("form button,form input");
    for (const node of inputnodes)
      node.disabled = true;
  }

  // make poll input's and submit button active again
  _enableInteraction() {
    const inputnodes = this.node.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,.wh-poll__votebutton");
    //let submitnodes = toolnode.querySelectorAll("form button,form input");
    for (const node of inputnodes)
      node.disabled = false;
  }

  doCheckForShowResultsClick(evt: MouseEvent) {
    evt.preventDefault();
    this.node.classList.add("wh-poll--showresults");
  }

  doCheckForHideResultsClick(evt: MouseEvent) {
    evt.preventDefault();
    this.node.classList.remove("wh-poll--showresults");
  }

  doCheckForPollSubmit(evt: Event) {
    evt.preventDefault();

    /*
    let toolid = pollnode.getAttribute("data-toolid");
    if (!toolid || toolid = "")
    {
      console.error("wh-poll must have a data-toolid");
      return;
    }
    */
    const polldata = getJSONAttribute<PollData>(this.node, "data-poll");
    if (!polldata) {
      console.error("Missing the data-poll attribute on the .wh-poll element");
      return;
    }
    if (!("toolid" in polldata)) {
      console.error("No toolid?");
      return;
    }


    // Validate that a selection has been made

    // ADDME: do we need to blur to disable an active virtual keyboard?
    //        (or don't we need that for a checkbox/radiobutton?)
    //        Should we check if the focus is within our poll element before blurring?
    if (document.activeElement)
      (document.activeElement as HTMLElement).blur();

    const pollvalue: string[] = [];
    for (const optionnode of dompack.qSA<HTMLInputElement>(this.node, "form input[name=vote]")) {
      if (optionnode.checked)
        pollvalue.push(optionnode.value);
    }

    console.log("casting vote for", polldata.toolid, pollvalue);

    void this.castVote(polldata.toolid, pollvalue);
  }

  async castVote(toolid: string, optionguids: string[]) {
    const toolnode = dompack.qR(`[data-toolid="${CSS.escape(toolid)}"]`);

    this._disableInteraction();

    toolnode.classList.add("wh-poll--submitting");
    const lock = dompack.flagUIBusy();

    try {
      const result = await pollrpc.castVote(toolid, optionguids) as { success: boolean; pollresults: PollResults };
      toolnode.classList.remove("wh-poll--submitting");

      if (result.success) {
        // FIXME: a setting of the poll should set whether or not
        //        to store what option was voted for..
        //        Then we can store the value in case we give the enduser the option to change their vote.

        // Store time on which we voted, so we can check if the user is allowed to vote again
        // (not failsafe, just to keep people from accidentally voting again)
        localStorage["wh-webtools-votetime:" + toolid] = Date.now();

        toolnode.classList.add("wh-poll--voted", "wh-poll--justvoted");
        this._applyPollResults(toolid, result.pollresults, null); //null indicates this is not the initial poll/fetch
      }
    } catch (e) {
      console.log("Exception", e);
      toolnode.classList.remove("wh-poll--submitting");

      this._enableInteraction();
    } finally {
      lock.release();
    }
  }

  // if unixtimestamps is set, this is the initial poll load getting results
  _applyPollResults(toolid: string, poll: PollResults, unixtimestampnow: number | null) {
    const pollnode = document.querySelector(`[data-toolid="${CSS.escape(toolid)}"]`);
    if (!pollnode)
      return;

    if (unixtimestampnow) {
      let canvote = true; // can vote unless we find a vote cookie which is too recent

      const voteinfo = localStorage["wh-webtools-votetime:" + this._getToolId()];
      if (voteinfo) {
        const votedtimestamp = parseInt(voteinfo);

        if (isNaN(votedtimestamp)) {
          localStorage.removeItem("wh-webtools-votetime:" + this._getToolId());
        } else { // after parseInt voted
          const polldata = getJSONAttribute<PollData>(this.node, "data-poll") ?? throwError("Missing the data-poll attribute on the .wh-poll element");
          const revoteAfter = polldata.revote_after ?? `P${polldata.allowvotingagainafter ?? 1440}M`; //falback until all are WH5.9+ and republished

          console.log("Poll was voted on " + ((unixtimestampnow - votedtimestamp) / 1000).toFixed(0) + " seconds ago. Polls allows voting again after " + revoteAfter);

          //console.log(votedtimestamp, "+", polldata.allowvotingagainafter ,"=", votedtimestamp + polldata.allowvotingagainafter, "<", unixtimestampnow);

          canvote = addDuration(new Date(votedtimestamp), revoteAfter) < new Date(unixtimestampnow);
        }
      }

      if (canvote)
        pollnode.classList.remove("wh-poll--voted");

      this._enableInteraction();
    }

    for (const polloption of poll.options) {
      const polloptionnode = pollnode.querySelector(`[data-polloption="${CSS.escape(polloption.guid)}"]`);
      // FIXME: what to do about this? this might indicate the option was deleted after it was added in a statically published page.
      if (!polloptionnode) {
        console.warn("Cannot find option", polloption.guid, "in", pollnode);
        return;
      }

      const votecountnode = dompack.qR(polloptionnode, ".wh-poll__option__votes");
      votecountnode.setAttribute("data-votes", String(polloption.votes));
      votecountnode.setAttribute("data-percentage", String(polloption.votepercentage));
      //console.info("option now", votecountnode.getAttribute("votes"), votecountnode.getAttribute("percentage"));
    }

    const totalvotesnode = pollnode.querySelector(".wh-poll__votecount__amount");
    if (totalvotesnode)
      totalvotesnode.textContent = String(poll.amountofvoters);
  }

  _getToolId(): string {
    return this.node.dataset.toolid ?? throwError("PollWebtool: missing data-toolid attribute");
  }
}

function scheduleFetchResults(poll: PollWebtool) {
  if (!pollstofetch.length) {
    const lock = dompack.flagUIBusy();
    setTimeout(() => void fetchResults(lock), 0);
  }

  pollstofetch.push(poll);
}

async function fetchResults(lock: dompack.UIBusyLock) {
  //clear the list
  try {
    const tofetch = pollstofetch;
    pollstofetch = [];

    const toolids = tofetch.map(poll => poll._getToolId());
    const result = await pollrpc.getResultsForPolls(toolids);

    const unixtimestampnow = Date.now();
    tofetch.forEach((poll, idx) => poll._applyPollResults(toolids[idx], result[idx], unixtimestampnow));
  } finally {
    lock.release();
  }
}
