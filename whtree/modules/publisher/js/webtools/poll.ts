/* eslint-disable */
/// @ts-nocheck -- Bulk rename to enable TypeScript validation

import * as dompack from "dompack";
import pollrpc from "@mod-publisher/js/webtools/internal/poll.rpc.json?proxy";

/*

- error handling?


FIXME: send allowvotingagainafter value back together with the results so the value can be changed
       without needing to republish a site

*/

let pollstofetch = [];

export default class PollWebtool {
  constructor(node) {
    this.node = node;
    scheduleFetchResults(this);

    node.addEventListener("submit", e => this.doCheckForPollSubmit(e));

    Array.from(node.querySelectorAll('.wh-poll__showresultsbutton')).forEach(
      node => node.addEventListener("click", e => this.doCheckForShowResultsClick(e)));

    Array.from(node.querySelectorAll('.wh-poll__hideresultsbutton')).forEach(
      node => node.addEventListener("click", e => this.doCheckForHideResultsClick(e)));

    this._disableInteraction(); //make sure the poll is blocked until we've retrieved the current results

    //if (localStorage["webtools:"+this._getToolId()] === "voted")
    const alreadyvoted = localStorage["wh-webtools-votetime:" + this._getToolId()];
    if (alreadyvoted)
      this.node.classList.add("wh-poll--voted");
  }

  // make poll input's and submit button inactive
  _disableInteraction() {
    const inputnodes = this.node.querySelectorAll("input,.wh-poll__votebutton");
    //let submitnodes = toolnode.querySelectorAll("form button,form input");
    for (const node of inputnodes)
      node.disabled = true;
  }

  // make poll input's and submit button active again
  _enableInteraction() {
    const inputnodes = this.node.querySelectorAll("input,.wh-poll__votebutton");
    //let submitnodes = toolnode.querySelectorAll("form button,form input");
    for (const node of inputnodes)
      node.disabled = false;
  }

  doCheckForShowResultsClick(evt) {
    evt.preventDefault();
    this.node.classList.add("wh-poll--showresults");
  }

  doCheckForHideResultsClick(evt) {
    evt.preventDefault();
    this.node.classList.remove("wh-poll--showresults");
  }

  doCheckForPollSubmit(evt) {
    evt.preventDefault();

    /*
    let toolid = pollnode.getAttribute("data-toolid");
    if (!toolid || toolid = "")
    {
      console.error("wh-poll must have a data-toolid");
      return;
    }
    */
    const polldata = dompack.getJSONAttribute(this.node, "data-poll");
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
      document.activeElement.blur();

    const pollvalue = [];
    const options = this.node.querySelector("form").vote;
    for (const optionnode of Array.from(options)) // We need to cast to an Array because in IE a NodeList doesn't support iteration this way
    {
      if (optionnode.checked)
        pollvalue.push(optionnode.value);
    }

    console.log("casting vote for", polldata.toolid, pollvalue);

    this.castVote(polldata.toolid, pollvalue);
  }

  async castVote(toolid, optionguids) {
    const query = `[data-toolid="${CSS.escape(toolid)}"]`;
    const toolnode = document.querySelector(query);

    this._disableInteraction();

    //console.info(query, "results in", toolnode);;

    toolnode.classList.add("wh-poll--submitting");
    const lock = dompack.flagUIBusy();

    try {
      const result = await pollrpc.castVote(toolid, optionguids);
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
  _applyPollResults(toolid, poll, unixtimestampnow) {
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
        } else if (votedtimestamp !== "") {
          const polldata = dompack.getJSONAttribute(this.node, "data-poll");

          console.log("Poll was voted on " + ((unixtimestampnow - votedtimestamp) / 1000).toFixed(0) + " seconds ago. Polls allows voting again after " + polldata.allowvotingagainafter + " seconds.");

          //console.log(votedtimestamp, "+", polldata.allowvotingagainafter ,"=", votedtimestamp + polldata.allowvotingagainafter, "<", unixtimestampnow);

          canvote = (unixtimestampnow - votedtimestamp) / 1000 > polldata.allowvotingagainafter;
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

      const votecountnode = polloptionnode.querySelector(".wh-poll__option__votes");
      votecountnode.setAttribute("data-votes", polloption.votes);
      votecountnode.setAttribute("data-percentage", polloption.votepercentage);
      //console.info("option now", votecountnode.getAttribute("votes"), votecountnode.getAttribute("percentage"));
    }

    const totalvotesnode = pollnode.querySelector(".wh-poll__votecount__amount");
    if (totalvotesnode)
      totalvotesnode.innerText = poll.amountofvoters;
  }

  _getToolId() {
    return this.node.dataset.toolid;
  }
}

function scheduleFetchResults(poll) {
  if (!pollstofetch.length) {
    const lock = dompack.flagUIBusy();
    setTimeout(() => fetchResults(lock), 0);
  }

  pollstofetch.push(poll);
}

async function fetchResults(lock) {
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
