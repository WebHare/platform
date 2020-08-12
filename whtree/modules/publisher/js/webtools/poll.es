import * as dompack from "dompack";
import * as pollrpc from "@mod-publisher/js/webtools/internal/poll.rpc.json";

/*

- error handling?


FIXME: send allowvotingagainafter value back together with the results so the value can be changed
       without needing to republish a site

*/

let pollstofetch = [];

export default class PollWebtool
{
  constructor(node)
  {
    this.node = node;
    if(!pollstofetch.length)
      setTimeout(fetchResults,0);
    pollstofetch.push(this);

    node.addEventListener("submit", e => this.doCheckForPollSubmit(e));

    Array.from(node.querySelectorAll('.wh-poll__showresultsbutton')).forEach(
      node => node.addEventListener("click",  e => this.doCheckForShowResultsClick(e)));

    Array.from(node.querySelectorAll('.wh-poll__hideresultsbutton')).forEach(
      node => node.addEventListener("click",  e => this.doCheckForHideResultsClick(e)));

    //if (localStorage["webtools:"+this._getToolId()] == "voted")
    let alreadyvoted = localStorage["wh-webtools-votetime:"+this._getToolId()];
    if (alreadyvoted)
    {
      this.node.classList.add("wh-poll--voted");
      this._disableInteraction();
    }
  }

  // make poll input's and submit button inactive
  _disableInteraction()
  {
    let inputnodes = this.node.querySelectorAll("input,.wh-poll__votebutton");
    //let submitnodes = toolnode.querySelectorAll("form button,form input");
    for(let node of inputnodes)
      node.disabled = true;
  }

  // make poll input's and submit button active again
  _enableInteraction()
  {
    let inputnodes = this.node.querySelectorAll("input,.wh-poll__votebutton");
    //let submitnodes = toolnode.querySelectorAll("form button,form input");
    for(let node of inputnodes)
      node.disabled = false;
  }

  doCheckForShowResultsClick(evt)
  {
    evt.preventDefault();
    this.node.classList.add("wh-poll--showresults");
  }

  doCheckForHideResultsClick(evt)
  {
    evt.preventDefault();
    this.node.classList.remove("wh-poll--showresults");
  }

  doCheckForPollSubmit(evt)
  {
    evt.preventDefault();

    /*
    let toolid = pollnode.getAttribute("data-toolid");
    if (!toolid || toolid = "")
    {
      console.error("wh-poll must have a data-toolid");
      return;
    }
    */
    let polldata = dompack.getJSONAttribute(this.node, "data-poll");
    if (!polldata)
    {
      console.error("Missing the data-poll attribute on the .wh-poll element");
      return;
    }
    if (!("toolid" in polldata))
    {
      console.error("No toolid?");
      return;
    }


    // Validate that a selection has been made

    // ADDME: do we need to blur to disable an active virtual keyboard?
    //        (or don't we need that for a checkbox/radiobutton?)
    //        Should we check if the focus is within our poll element before blurring?
    if (document.activeElement)
      document.activeElement.blur();

    let pollvalue = [];
    let options = this.node.querySelector("form").vote;
    for(let optionnode of Array.from(options)) // We need to cast to an Array because in IE a NodeList doesn't support iteration this way
    {
      if (optionnode.checked)
        pollvalue.push(optionnode.value);
    }

    console.log("casting vote for", polldata.toolid, pollvalue);

    this.castVote(polldata.toolid, pollvalue);
  }

  async castVote(toolid, optionguids)
  {
    let query = `[data-toolid="${CSS.escape(toolid)}"]`;
    let toolnode = document.querySelector(query);

    this._disableInteraction();

    //console.info(query, "results in", toolnode);;

    toolnode.classList.add("wh-poll--submitting");
    let lock = dompack.flagUIBusy();

    try
    {
      let result = await pollrpc.castVoteAndReturnResults(toolid, optionguids);
      toolnode.classList.remove("wh-poll--submitting");

      this._disableInteraction();

      if (result.success)
      {
        // FIXME: a setting of the poll should set whether or not
        //        to store what option was voted for..
        //        Then we can store the value in case we give the enduser the option to change their vote.

        // Store time on which we voted, so we can check if the user is allowed to vote again
        // (not failsafe, just to keep people from accidentally voting again)
        localStorage["wh-webtools-votetime:"+toolid] = Date.now();

        toolnode.classList.add("wh-poll--voted", "wh-poll--justvoted");
        this.applyPollResults(result.pollresults);
      }
    }
    catch(e)
    {
      console.log("Exception", e);
      toolnode.classList.remove("wh-poll--submitting");

      this._enableInteraction();
    }
    finally
    {
      lock.release();
    }
  }

  // internal
  applyPollResults(poll, unixtimestampnow)
  {
    let pollnode = document.querySelector('[data-toolid="' + poll.toolid + '"]');
    if (!pollnode)
      return;

    if (unixtimestampnow)
    {
      let canvote = true; // can vote unless we find a vote cookie which is too recent

      let voteinfo = localStorage["wh-webtools-votetime:"+this._getToolId()];
      if (voteinfo)
      {
        let votedtimestamp = parseInt(voteinfo);

        if (isNaN(votedtimestamp))
        {
          localStorage.removeItem("wh-webtools-votetime:"+this._getToolId());
        }
        else if (votedtimestamp != "")
        {
          let polldata = dompack.getJSONAttribute(this.node, "data-poll");

          console.log("Poll was voted on " + ((unixtimestampnow - votedtimestamp)/1000).toFixed(0) + " seconds ago. Polls allows voting again after " + polldata.allowvotingagainafter + " seconds.");

          //console.log(votedtimestamp, "+", polldata.allowvotingagainafter ,"=", votedtimestamp + polldata.allowvotingagainafter, "<", unixtimestampnow);

          canvote = (unixtimestampnow - votedtimestamp)/1000 > polldata.allowvotingagainafter;
        }
      }

      if (canvote)
        pollnode.classList.remove("wh-poll--voted");

      this._enableInteraction();
    }

    for (let polloption of poll.options)
    {
      let polloptionnode = document.querySelector('[data-polloption="' + polloption.guid + '"]');
      // FIXME: what to do about this? this might indicate the option was deleted after it was added in a statically published page.
      if (!polloptionnode)
      {
        console.warn("Cannot find option", polloption.guid, "in", pollnode);
        return;
      }

      let votecountnode = polloptionnode.querySelector(".wh-poll__option__votes");
      votecountnode.setAttribute("data-votes", polloption.votes);
      votecountnode.setAttribute("data-percentage", polloption.votepercentage);
      //console.info("option now", votecountnode.getAttribute("votes"), votecountnode.getAttribute("percentage"));
    }

    let totalvotesnode = pollnode.querySelector(".wh-poll__votecount__amount");
    if (totalvotesnode)
      totalvotesnode.innerText = poll.amountofvoters;
  }

  _getToolId()
  {
    return this.node.dataset.toolid;
  }
}

async function fetchResults()
{
  //clear the list
  let tofetch = pollstofetch;
  pollstofetch = [];

  let toolids = tofetch.map(poll => poll._getToolId());
  let result = await pollrpc.getResultsForPolls(toolids);

  let unixtimestampnow = Date.now();
  tofetch.forEach( (poll,idx) => poll.applyPollResults(result[idx], unixtimestampnow));
}
