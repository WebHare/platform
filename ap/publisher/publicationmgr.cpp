#include <ap/libwebhare/allincludes.h>

#include "publicationmgr.h"
#include <blex/path.h>

//ADDME: Make this parameters registry configurable
const unsigned FullScanFrequency = 24*60*60;  //ADDME: Allow users to 'schedule' the fullscan (eg. at midnight)
const unsigned RestartAfterSeconds = 30*60;   //number of seconds after first task before restarting a Hare (reduce memory fragmentation)
const unsigned RestartAfterTasks = 1000;      //number of tasks before restarting a Hare (reduce memory fragmentation)

PublicationManager::PublicationManager(WHCore::Connection &_conn, ProcessManager &processmanager)
: processmanager(processmanager)
, conn(_conn)
, output_analyzer(NULL)
, loglevel(PLog_FatalErrors)
, output_analyzer_busy(true)
, analyze_all_folders(false)
, analyze_restart_first(false)
{
        workercount = 0;
        maxpublishtime = 0;
        task_queue_size = 0;

        queuetimer_running=false;
        RestartOutputAnalyzer();
}

void PublicationManager::GetPublisherState(PublisherStateCallback const &callback)
{
        PublisherState state;
        Blex::DateTime now = Blex::DateTime::Now();

        unsigned num_in_queuetop=0;

        state.outputanalyzerqueue = analyze_folders.size() + (output_analyzer_busy ? 1 : 0);

        state.queueestimate.howmany_workers = workercount;
        for (unsigned queue=0;queue<NumQueues;++queue)
          for (TaskQueue::const_iterator itr=task_queue[queue].begin();itr!=task_queue[queue].end();++itr)
        {
                if (itr->publishing)
                {
                        if (!state.processes.empty())
                            state.processes.push_back('\t');

                        state.processes += Blex::AnyToString(itr->publishing->id);
                        state.processes.push_back(',');
                        state.processes += Blex::AnyToString(itr->file.fileid);
                        state.processes.push_back(',');
                        state.processes += Blex::AnyToString((now - itr->starttime).GetMsecs()/1000);
                        DEBUGPRINT(state.processes);
                }
                else if (num_in_queuetop < 32) //just put it on the waiting queue
                {
                        ++num_in_queuetop;
                        if (!state.queuetop.empty())
                            state.queuetop.push_back(',');

                        state.queuetop += Blex::AnyToString(itr->file.fileid);
                }

                ++state.queueestimate.howmany_to_do;
                if (itr->file.publishtime)
                {
                        ++state.queueestimate.howmany_measured;
                        state.queueestimate.total_measured += itr->file.publishtime;
                }
        }

        callback(state);
}

void PublicationManager::GetFileEstimation(int32_t fileid, RepublishTimeCallback const &callback)
{
        RepublishTimeEstimation sofar;

        sofar.howmany_workers = workercount;

        ReversedTaskQueue::iterator reversed_itr = reversed_task_queue.find(fileid);
        if (reversed_itr != reversed_task_queue.end()) //We stand a chance of finding it
        {
                /* Disabled. Do this on folder impressions, not on file estimations
                //This is the time to cheat. The user is interested in the file,
                //so reprioritize it (we should also do this for folder watching?)
                //not doing a big boost now: we don't want users to learn and AVOID the props screen..
                if (reversed_itr->second->file.priority > InterestedFilePriorityBoost)
                {
                        QueuedFile reque_version = reversed_itr->second->file;
                        reque_version.priority = InterestedFilePriorityBoost;
                        AddToQueue(reque_version,false);
                }
                */

                for (unsigned queue=0;queue<NumQueues;++queue)
                  for (TaskQueue::const_iterator itr=task_queue[queue].begin();itr!=task_queue[queue].end();++itr)
                {
                        ++sofar.howmany_to_do;
                        if (itr->file.publishtime)
                        {
                                ++sofar.howmany_measured;
                                sofar.total_measured += itr->file.publishtime;
                        }
                        if (itr->file.fileid==fileid)
                        {
                                callback(sofar);
                                return;
                        }
                }
        }

        if (fileid != 0) //but we were looking for a file
        {
                //file not found
                RepublishTimeEstimation empty;
                empty.howmany_workers = workercount;
                callback(empty);
                return;
        }
        callback(sofar);
        return; //the user was asking for a complete queue calculation, so just return it
}

void PublicationManager::RestartHare(Hare *hare)
{
        processmanager.EndProcess(hare->process);
        hare->process = NULL;

        //ADDME: how to reset curfile? now only resetting curfile's fileid
        hare->curfile.fileid = 0;
        hare->numtasks = 0;
        hare->restart_at = Blex::DateTime::Max();
        StartHare(hare);
}
void PublicationManager::StartHare(Hare *hare)
{
        std::vector<std::string> args;
        conn.AddStandardArguments(&args);
        args.push_back("--workerthreads");
        args.push_back("4"); //FIXME back to 2 as soon as publsihjob.whscr doesn't use unsuspendable loads
        args.push_back("modulescript::publisher/internal/publishing.whscr");
        DEBUGONLY(args.push_back("--debug"));
        hare->process = processmanager.StartProcess("publishing_" + Blex::AnyToString(hare->id)
                                                   ,Blex::MergePath(conn.GetBinRoot(),"runscript")
                                                   ,args
                                                   ,std::bind(&PublicationManager::ProcessReply,this,std::placeholders::_1,std::placeholders::_2,std::placeholders::_3)
                                                   ,true/*lower priority*/);
        if (!hare->process)
        {
                processmanager.Shutdown("Cannot spawn publication subprocess");
                return;
        }

        CheckHareQueue(hare);
}

void PublicationManager::SetWorkerCount(int32_t count)
{
        workercount = unsigned(count);

        if (hares.size() < workercount)
            hares.resize(workercount);

        for (unsigned i=0;i<workercount;++i)
        {
                if (!hares[i].get())
                {
                        hares[i].reset(new Hare);
                        hares[i]->id = i+1;
                        DEBUGPRINT("Adding a new hare with id " << hares[i]->id);
                        StartHare(hares[i].get());
                }
        }

        DEBUGPRINT("Update worker count to " << count);
}

void PublicationManager::SetPublisherTimeout(int32_t newmaxpublishtime)
{
        maxpublishtime = unsigned(newmaxpublishtime);
}

void PublicationManager::SetLogLevel(PublisherLogLevel newloglevel)
{
        loglevel = newloglevel;
}

void PublicationManager::RegisterBrokenConversion(QueuedFile const &file, unsigned errorcode)
{
        //Open a database transaction to register the error..
        DEBUGONLY(Blex::ErrStream() << "Hare returned error " << errorcode << " on " << file.fileid);
        RemoveFromQueue(file);

        if (errorcode==3)
        {
                //conflict, just try again..
                Blex::ErrStream() << "A database conflict occured whilst publishing file #" << file.fileid << ", it will be retried later";
                AddToQueue(file,true);
                return;
        }

        try
        {
                //Get access to the file record..
                const std::unique_ptr<Database::TransactConnection> trconn(conn.GetDbase().BeginTransactConnection("publishmgr brokenconversion"));
                const std::unique_ptr<Database::TransFrontend> trans(trconn->BeginFullyPrivilegedTransaction(false, false));

                std::string errordata;

                int32_t newpublish;
                static const char *filecols[]={"PUBLISHED","ERRORDATA", 0};

                Database::ClientScanner scan(*trans,true, "Publisher: Register broken conversion");
                scan.AddTable("SYSTEM.FS_OBJECTS", filecols);
                scan.AddSearch<int32_t>(0,"ID",file.fileid, Database::SearchEqual);

                if (!scan.NextRow()) //no file, no error :)
                    return;

                if (scan.LockRow() == Database::DBLRGone)
                    return; //file deleted, no error either

                newpublish=WHCore::GetFlagsFromPublished(scan.GetCell(0).Integer());

                if (errorcode==4)
                {
                        errordata = "A fatal database error occured";
                        Blex::ErrStream() << "A fatal database error occured whilst publishing file #" << file.fileid;
                        newpublish += 3002; //DB error
                }
                else if (errorcode==5) //disconnect
                {
                        Blex::ErrStream() << "Connection refused by database server whilst publishing file #" << file.fileid;
                        newpublish += 1009; //DB disconnect
                }
                else if (errorcode==6) //timeout
                {
                        Blex::ErrStream() << "Timeout during TCP/IP I/O with the database server whilst publishing file #" << file.fileid;
                        newpublish += 1010; //DB disconnect
                }
                else if (errorcode==14) //timer exceeded
                {
                        errordata = "Maximum publication time exceeded";
                        Blex::ErrStream() << "Maximum publication time exceeded whilst publishing file #" << file.fileid;
                        newpublish += 3015; //Timer expirer
                }
                else
                {
                        errordata = "A fatal publisher error occured";
                        Blex::ErrStream() << "A fatal publisher error occured whilst publishing file #" << file.fileid;
                        newpublish += 3001; //Crash
                }

                Database::WritableRecord newrec;
                newrec.SetInteger(0, newpublish);
                newrec.SetString(1, errordata);
                scan.UpdateRow(newrec);
                scan.Close();

                trans->Finish(true);

                if (WHCore::GetStatusFromPublished(newpublish) >= 1001 && WHCore::GetStatusFromPublished(newpublish) <= 2000) //I/O error
                    AddToQueue(file,true); //readd it in queue to retry
        }
        catch (Database::Exception&)
        {
                //just re-insert it into the queue so we can re-fail
                if (loglevel >= PLog_Debug)
                    Blex::ErrStream() << "Failed to update file status for file #" << file.fileid << ", it will be rescheduled";
                AddToQueue(file,true);
        }
}

void PublicationManager::ProcessReply(SubProcess *subprocess, ProcessEvents::Event event, std::string const &data)
{
        Hare &hare=GetHare(subprocess);

        if (event == ProcessEvents::AllShuttingDown)
        {
                processmanager.EndProcess(subprocess); //Just kill it!
                return;
        }
        else if (event == ProcessEvents::ProcessDied)
        {
                DEBUGPRINT("Hare " << hare.id << " broken pipe");
                if (hare.curfile.fileid)
                {
                        RegisterBrokenConversion(hare.curfile,13);
                }
                else
                {
                        Blex::ErrStream() << "Publication process #" << hare.id << " died unexpectedly";
                }
                RestartHare(&hare);
                return;
        }
        else if (event == ProcessEvents::Output)
        {
                ProcessHareResponse(hare,data);
        }
        else if (event == ProcessEvents::Error)
        {
                if (hare.curfile.fileid)
                    Blex::ErrStream() << "Publishing file #" << hare.curfile.fileid << ":" << data;
                else
                    Blex::ErrStream() << "Publishing idle #" << hare.curfile.fileid << ":" << data;
        }
        else if (event == ProcessEvents::TimerExpired)
        {
                if (hare.curfile.fileid)
                {
                        RegisterBrokenConversion(hare.curfile,14/*timeout*/);
                        RestartHare(&hare);
                }
                else
                {
                        processmanager.Shutdown("Publication process #" + Blex::AnyToString(hare.id) + " is unable to initialize");
                }
        }
}

void PublicationManager::ProcessHareResponse(Hare &hare, std::string const &response)
{
        DEBUGPRINT("Hare " << hare.id << " for file #" << hare.curfile.fileid << " said " << response);

        if (response.size() < 8 || Blex::StrCompare(response,"STATUS:",7) != 0)
        {
                Blex::ErrStream() << "Publication process " << hare.id << " returned odd message '" << response << "'";
                RegisterBrokenConversion(hare.curfile,13);
                RestartHare(&hare);
                return;
        }
        else
        {
                unsigned retval = Blex::DecodeUnsignedNumber<unsigned>(response.begin()+7,response.end()).first;
                if (retval == 0 || retval == 10)
                {
                        RemoveFromQueue(hare.curfile);
                        if (loglevel >= PLog_Debug)
                            Blex::ErrStream() << "Publication process " << hare.id << " succesfully published " << hare.curfile.fileid << " (" << hare.numtasks << " total)";
                }
                else
                {
                        //The hare proces will have been unable to register the error in the DB, so we should do it!
                        RegisterBrokenConversion(hare.curfile,retval);
                }
        }
        hare.curfile.fileid=0;

        //Stop waiting for anything now...
        hare.process->SetTimeout(0);
        CheckHareQueue(&hare);
}

PublicationManager::~PublicationManager()
{
}
void PublicationManager::AddNewTask(QueuedFile const &file)
{
        TaskQueue &queue = task_queue[GetQueueForPriority(file.priority)];
        TaskQueue::iterator itr = queue.insert(queue.end(),Task(file));
        ++task_queue_size;
        reversed_task_queue.insert(std::make_pair(file.fileid,itr));
}

//keep a copy of the file (not const reference), because we may need to
//re-use it after deletion and shouldn't destroy our only copy then..
void PublicationManager::RemoveFromQueue(QueuedFile file)
{
        ReversedTaskQueue::iterator reversed_itr = reversed_task_queue.find(file.fileid);
        if (reversed_itr == reversed_task_queue.end())
        {
                DEBUGPRINT("Got removal for unqueued file!");
        }
        else
        {
                bool must_restart = reversed_itr->second->mustrestart;

                //Remove it from the existing list
                TaskQueue &queue = task_queue[GetQueueForPriority(reversed_itr->second->file.priority)];
                queue.erase(reversed_itr->second);
                reversed_task_queue.erase(reversed_itr);
                --task_queue_size;

                if (must_restart)
                    AddNewTask(file);
        }
}

/* ADDME: RestartHare is not nice, as a process might be just finished. Better
          would be to signal 'stop' with a new timeout for responding, and only
          kill then.
   ADDME: Also need to schedule the folder for analysis AFTER the kill was done
*/

void PublicationManager::DequeueFile(int32_t fileid)
{
        //Check if the file already in queue
        ReversedTaskQueue::iterator reversed_itr = reversed_task_queue.find(fileid);
        if (reversed_itr == reversed_task_queue.end()) //it's a new task
            return; //not on the queue, done!

        if (reversed_itr->second->publishing) //it's a running task?
        {
                if (loglevel >= PLog_Debug)
                    Blex::ErrStream() << "End publication of " << fileid;

                RestartHare(reversed_itr->second->publishing); //force termination
        }
        reversed_itr->second->mustrestart = false;
        RemoveFromQueue(reversed_itr->second->file);
        DEBUGPRINT("Removed file " << fileid << ", queuelen now: " << task_queue_size);
}

void PublicationManager::AddToQueue(QueuedFile const &file, bool restart_if_running)
{
        //ADDME? Remove when all code properly uses priorities: this warns for legacy code!
        if (file.priority<=1)
            Blex::ErrStream() << "File " << file.fileid << " added with legacy priority! " << file.priority;

        //Check if the file already in queue
        ReversedTaskQueue::iterator reversed_itr = reversed_task_queue.find(file.fileid);
        if (reversed_itr == reversed_task_queue.end()) //it's a new task
        {
                AddNewTask(file);
        }
        else
        {
                //Priority might be increased
                if (GetQueueForPriority(file.priority) < GetQueueForPriority(reversed_itr->second->file.priority))
                {
                        if (loglevel >= PLog_Debug)
                            Blex::ErrStream() << "Upgrade " << file.fileid << " from prio " << reversed_itr->second->file.priority << " to " << file.priority;

                        //Add it to its new queue
                        TaskQueue &newqueue = task_queue[GetQueueForPriority(file.priority)];
                        TaskQueue::iterator itr = newqueue.insert(newqueue.end(), file);

                        //Copy the 'publishing' member so we don't lose track of an active publication
                        itr->publishing = reversed_itr->second->publishing;

                        //Remove it from its current queue
                        TaskQueue &curqueue = task_queue[GetQueueForPriority(reversed_itr->second->file.priority)];
                        curqueue.erase(reversed_itr->second);

                        //And update the reverse map to point to the new queue
                        reversed_itr->second = itr;

                        //ADDME: Task should keep a pointer to file isntead of copy to make sure we can also get update of templateid, profileid, etc
                }

                if (restart_if_running && reversed_itr->second->publishing) //restart existing task?
                {
                        if (loglevel >= PLog_Debug)
                            Blex::ErrStream() << "Restart publication of " << file.fileid;

                        RestartHare(reversed_itr->second->publishing);
                        reversed_itr->second->publishing = NULL;
                }
        }

        DEBUGPRINT("Added file " << file.fileid << ", queuelen now: " << task_queue_size);
        CheckQueue();
}

void PublicationManager::SchedulePublication(int32_t fileid, int32_t maxtimeout, Hare *availablehare)
{
        availablehare->process->SendCommand(Blex::AnyToString(fileid));

        if (maxtimeout>0)
            availablehare->process->SetTimeout(maxtimeout);
}

bool PublicationManager::CheckHareQueue(Hare *availablehare)
{
        if (task_queue_size!=0 && queuetimer_running == false)
        {
                queuetimer_running = true;
                queuetimer = Blex::FastTimer();
                queuetimer.Start();
        }
        else if (task_queue_size==0 && queuetimer_running == true)
        {
                queuetimer_running = false;
                queuetimer.Stop();
                if (loglevel >= PLog_Statistics)
                    Blex::ErrStream () << "Last queue run took " << queuetimer;
        }

        if (availablehare->id > workercount) //just terminate this hare
        {
                DEBUGPRINT("Terminating hare #" << availablehare->id << ", exceeded worker limit");
                processmanager.EndProcess(availablehare->process);
                hares[availablehare->id - 1].reset();
                return true;
        }

        /* FIXME: Klopt dit wel? We tellen hem _nu_ al als uitgevoerde taak, ondanks dat we misschien niets queuen! */
        ++availablehare->numtasks;
        if (availablehare->numtasks==1) //Schedule our restart
            availablehare->restart_at = Blex::DateTime::Now() + Blex::DateTime::Seconds(RestartAfterSeconds);

        if (availablehare->restart_at < Blex::DateTime::Now() || availablehare->numtasks >= RestartAfterTasks)
        {
                if (loglevel >= PLog_Debug)
                    Blex::ErrStream () << "Publication process " << availablehare->id << " has worked long enough (" << availablehare->numtasks << " tasks), it will be restarted";
                RestartHare(availablehare);
                return true;
        }

        for (unsigned queue=0;queue<NumQueues;++queue)
          for (TaskQueue::iterator itr=task_queue[queue].begin();itr!=task_queue[queue].end();++itr)
            if (!itr->publishing)
        {
                int32_t fileid=itr->file.fileid;
                if (loglevel >= PLog_Debug)
                    Blex::ErrStream() << "Publishing file #" << fileid << " on process #" << availablehare->id;

                SchedulePublication(fileid,maxpublishtime,availablehare);
                itr->publishing = availablehare;
                itr->starttime = Blex::DateTime::Now();
                availablehare->curfile = itr->file;
                return true;
        }

        return false;
}

void PublicationManager::RestartOutputAnalyzer()
{
        analyze_restart_first=false;
        output_analyzer_busy=true;

        if (output_analyzer)
            processmanager.EndProcess(output_analyzer);

        std::vector<std::string> args;
        conn.AddStandardArguments(&args);
        args.push_back("modulescript::publisher/internal/outputanalyzer.whscr");
        output_analyzer = processmanager.StartProcess("outputanalyzer"
                                                     ,Blex::MergePath(conn.GetBinRoot(),"runscript")
                                                     ,args
                                                     ,std::bind(&PublicationManager::ProcessOutputAnalyzer,this,std::placeholders::_2,std::placeholders::_3)
                                                     ,true/*low priority*/);
        if (!output_analyzer)
        {
                processmanager.Shutdown("Cannot spawn output analyzer subprocess");
                return;
        }
        output_analyzer->SetTimeout(FullScanFrequency); //every hour, do a full scan
}

void PublicationManager::ProcessOutputAnalyzer(ProcessEvents::Event event, std::string const &data)
{
        if (event == ProcessEvents::AllShuttingDown)
        {
                CheckOutputAnalyzerQueue();
                return;
        }
        if(processmanager.IsShuttingDown()) //When already shutting down, who cares about what the output analyzer has to say?
            return;

        if (event == ProcessEvents::TimerExpired) //this is the 'every hour' scan
        {
                RescanAll();
                output_analyzer->SetTimeout(FullScanFrequency); //every hour, do a full scan
                return;
        }
        if (event == ProcessEvents::Error)
        {
                Blex::ErrStream() << "Output analyzer error: " << data;
                return;
        }
        if (event == ProcessEvents::ProcessDied)
        {
                if (!analyze_restart_first) //it's a planned death?
                    Blex::ErrStream() << "Output analyzer broken pipe";
                analyze_all_folders=true; //scan ALL when we come back!
                RestartOutputAnalyzer();
                return;
        }

        ///Standard output is TAB separated, parse it!
        std::vector<std::string> tokens;
        Blex::TokenizeString(data,'\t',&tokens);

        if (tokens.size()<1)
            return; //empty ocmmand

        //Pop the first token
        if (tokens[0] == "DEBUG" && tokens.size()>=2)
        {
                if (loglevel >= PLog_Debug)
                    Blex::ErrStream() << tokens[1];
                else
                    DEBUGPRINT(tokens[1]);
                return;
        }
        if (tokens[0] == "LOG" && tokens.size()>=2)
        {
                Blex::ErrStream() << tokens[1]; //Just log unconditionally whatever was told
                return;
        }

        if (tokens[0] == "WAITING")
        {
                output_analyzer_busy=false;
                CheckOutputAnalyzerQueue();
                return;
        }

        if (tokens[0] == "ANALYZE" && tokens.size() >= 3)
        {
                int32_t folderid = std::atol(tokens[1].c_str());
                bool recurse = tokens[2]=="1";
                RescanFolder(folderid,recurse);
                return;
        }
        if (tokens[0] == "QUEUE" && tokens.size()>=6)
        {
                QueuedFile newfile(/*fileid=*/std::atol(tokens[1].c_str())
                                  ,/*folder=*/std::atol(tokens[2].c_str())
                                  ,/*publishtime=*/std::atol(tokens[3].c_str())
                                  ,/*template=*/std::atol(tokens[4].c_str())
                                  ,/*profile=*/std::atol(tokens[5].c_str())
                                  ,/*priority=*/std::atol(tokens[6].c_str()));
                AddToQueue(newfile,false);
                return;
        }
        DEBUGPRINT("OUTPUT ANALYZER ODD MESSAGE: " << data);
}

void PublicationManager::CheckOutputAnalyzerQueue()
{
        //FIXME: Slow down waking up when we had nothing to do. Eg, if the
        //       folder queue was empty, and a folder to scan comes in,
        //       hold it for two seconds before continuing so that multiple
        //       incoming events can be combined

        /*ADDME: Support 'nice' shutting down?
                if (lock->stop)
                    return std::make_pair(-1,false); //ABORT!
        */

        if (output_analyzer == NULL)
            return; //cannot do anything now..
        if (processmanager.IsShuttingDown())
        {
                output_analyzer_busy = true;
                output_analyzer->SendCommand("QUIT");
                return;
        }
        if(output_analyzer_busy)
        {
                DEBUGPRINT("Igoring update, we're busy");
                return; //cannot do anything now..
        }

        if (analyze_all_folders)
        {
                if (analyze_restart_first)
                {
                        output_analyzer_busy = true;
                        output_analyzer->SendCommand("QUIT");
                        return;
                }

                //Clear all folders in the scan list now
                analyze_folders.clear();
                analyze_lookupmap.clear();
                analyze_all_folders=false; //pop the request

                //Tell the script to scan it all
                output_analyzer_busy=true;
                output_analyzer->SendCommand("GATHERFOLDERS");
                return;
        }

        if (!analyze_folders.empty()) //scan the first folder we find..
        {
                int32_t folderid = analyze_folders.front().first;
                bool recurse = analyze_folders.front().second;

                analyze_folders.pop_front();
                analyze_lookupmap.erase(folderid);

                std::ostringstream cmd;
                cmd << "SCAN\t"<<folderid<<"\t"<<(recurse?"1":"0");

                output_analyzer->SendCommand(cmd.str());
                output_analyzer_busy=true;

                return;
        }
}

PublicationManager::Hare::Hare()
: process(NULL)
, id(0)
, curfile(0,0,0,0,0,0)
, numtasks(0)
{
}

PublicationManager::Hare& PublicationManager::GetHare(SubProcess *process)
{
        for (Hares::iterator itr=hares.begin();itr!=hares.end();++itr)
          if (itr->get() && (*itr)->process == process)
            return **itr;

        throw std::logic_error("GetHare on non-existing process");
}

void PublicationManager::CheckQueue()
{
        for (Hares::iterator itr=hares.begin();itr!=hares.end();++itr)
          if (itr->get() && (*itr)->curfile.fileid==0)
            if (!CheckHareQueue(itr->get()))
              break; //queue is empty!
}

void PublicationManager::RescanFolder(int32_t folderid, bool recursive)
{
        //check if it's already in the queue
        AnalyzeLookupMap::iterator itr = analyze_lookupmap.find(folderid);
        if (itr != analyze_lookupmap.end())
        {
                //No need to re-add it
                if (recursive)
                    itr->second->second=true; //re-add it as a recursive folder
        }
        else
        {
                //Queue it
                analyze_folders.push_back(std::make_pair(folderid,recursive));
                analyze_lookupmap.insert(std::make_pair(folderid,analyze_folders.end()-1));
        }
        CheckOutputAnalyzerQueue();
}

void PublicationManager::RescanAll()
{
        analyze_all_folders=true;
        analyze_restart_first=true; //ADDME: Clean up when HareScript doesn't leak memory during script run...
        CheckOutputAnalyzerQueue();
}
