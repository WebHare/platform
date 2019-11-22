#include <ap/libwebhare/allincludes.h>


#include <iostream>
#include <blex/path.h>
#include "processmgr.h"

const unsigned ShutdownTime = 4; //Number of seconds to force a process manager shutdown

ProcessManager::ProcessManager()
: processmgr_shutdown(Blex::DateTime::Max())
{
        commpipe.GetReadEnd().SetBlocking(false);
        commpipe.GetWriteEnd().SetBlocking(false);

        waiter.Reset();
        waiter.AddReadPipe(commpipe.GetReadEnd());
}

ProcessManager::~ProcessManager()
{
}

SubProcess *ProcessManager::StartProcess(std::string const &tag
                                        ,std::string const &processname
                                        ,std::vector<std::string> const &arguments
                                        ,ProcessCallback const &callback
                                        ,bool at_idle_priority)
{
        if (IsShuttingDown())
        {
                DEBUGPRINT("Process manager: A new process '" << tag << "' is requested during processmgr shutdown, ignoring");
                return NULL;
        }

        std::shared_ptr<SubProcess> newprocess (new SubProcess(tag));

        //Open control pipes

        Blex::PipeSet newcontrol, newresults, newerrors;
        newcontrol.GetWriteEnd().SetBlocking(false);
        newresults.GetReadEnd().SetBlocking(false);
        newerrors.GetReadEnd().SetBlocking(false);

        newprocess->process.RedirectInput(newcontrol.GetReadEnd());
        newprocess->process.RedirectOutput(newresults.GetWriteEnd(),false);
        newprocess->process.RedirectErrors(newerrors.GetWriteEnd());

        newprocess->control = newcontrol.ReleaseWriteEnd();
        newprocess->results = newresults.ReleaseReadEnd();
        newprocess->errors = newerrors.ReleaseReadEnd();
        newprocess->callback = callback;

        if (!newprocess->process.Start(processname, arguments, "", at_idle_priority))
            return NULL;

        DEBUGPRINT("Process manager: Process " << newprocess->tag << " started");
        subprocesses.push_back(newprocess);

        waiter.AddReadPipe(*newprocess->results);
        waiter.AddReadPipe(*newprocess->errors);

        return newprocess.get();
}

void ProcessManager::EndProcess(SubProcess *process)
{
        process->end_process=true;
}

void ProcessManager::Shutdown(std::string const &errormessage)
{
        CallSynchronizedInteractive(std::bind(&ProcessManager::SyncShutdown, this, errormessage));
}

ProcessManager::FunctionPtr ProcessManager::PopCommand()
{
        FunctionPtr retval;

        LockedQueue::WriteRef lock(functioncallqueue);
        if (!lock->interactive_calls.empty())
        {
                retval=lock->interactive_calls.front();
                lock->interactive_calls.pop();
        }
        else if (!lock->normal_calls.empty())
        {
                retval=lock->normal_calls.front();
                lock->normal_calls.pop();
        }
        return retval;
}

bool ProcessManager::AnyUnendedProcesses() const
{
        for (SubProcessList::const_iterator itr=subprocesses.begin(); itr != subprocesses.end(); ++itr)
          if (!(*itr)->end_process)
            return true;

        return false;
}

void ProcessManager::Run()
{
        DEBUGPRINT("Process manager: Entering process manager main loop");
        InnerLoop();
        DEBUGPRINT("Process manager: Leaving process manager main loop");
        for (SubProcessList::iterator itr=subprocesses.begin(); itr != subprocesses.end(); ++itr)
          if (!(*itr)->end_process)
        {
                DEBUGPRINT("Process manager: Killing process '" << (*itr)->tag << "' that refused to shutdown");
                (*itr)->process.Kill();
        }
}

Blex::DateTime ProcessManager::BuildWaitList(Blex::PipeWaiter &waiter, Blex::DateTime shutdowntime)
{
        //Calculate the time till the next timeout and remove unnecessary pipes from waiter
        Blex::DateTime maxwait = shutdowntime;
        SubProcessList::iterator itr=subprocesses.begin();

        while (itr != subprocesses.end())
        {
                if ((*itr)->end_process)
                {
                        waiter.RemoveWritePipe(*(*itr)->control);
                        waiter.RemoveReadPipe(*(*itr)->results);
                        waiter.RemoveReadPipe(*(*itr)->errors);
                        (*itr)->process.Kill();
                        itr = subprocesses.erase(itr);
                }
                else
                {
                        if (!(*itr)->outputbuffer.empty())
                            waiter.AddWritePipe(*(*itr)->control);
                        else
                            waiter.RemoveWritePipe(*(*itr)->control);
                        maxwait = std::min((*itr)->warntimer, maxwait);
                        ++itr;
                }
        }

        return maxwait;
}

void ProcessManager::InnerLoop()
{
        while (true)
        {
                waiter.Wait(BuildWaitList(waiter, processmgr_shutdown));

                //Process any incoming commands
                if (waiter.GotRead(commpipe.GetReadEnd()))
                {
                        if (commpipe.GetReadEnd().EndOfStream())
                        {
                                Blex::ErrStream() << "Lost publisher command pipe connection, restarting";
                                return;
                        }

                        commpipe.GetReadEnd().ReadLsb<uint8_t>();
                        while(true)
                        {
                                FunctionPtr cmd = PopCommand();
                                if (!cmd.get())
                                    break; //no more commands to process

                                DEBUGPRINT("Processing a command");
                                (*cmd)();
                        }
                }

                //Now parse any process input
                Blex::DateTime now = Blex::DateTime::Now();
                for (SubProcessList::iterator itr=subprocesses.begin(); itr != subprocesses.end(); ++itr)
                  if (!(*itr)->end_process)
                {
                        std::string tag = (*itr)->tag;

                        //check first, because our events may modify the processes
                        bool got_data = waiter.GotRead(*(*itr)->results);
                        bool got_error = waiter.GotRead(*(*itr)->errors);
                        bool may_send = waiter.GotWrite(*(*itr)->control);

                        if (got_data && !(*itr)->end_process)
                            ProcessIncomingData(itr->get(),true/*output*/);

                        if (got_error && !(*itr)->end_process)
                            ProcessIncomingData(itr->get(),false/*error*/);

                        //process died? check after data&errors parsing, to make sure we got ALL the errors
                        if ( ((*itr)->results->EndOfStream() || (*itr)->errors->EndOfStream())
                             && !(*itr)->end_process)
                        {
                                DEBUGPRINT("Process manager: Process " << (*itr)->tag << " has exited");
                                (*itr)->callback(itr->get(), ProcessEvents::ProcessDied, std::string());
                                (*itr)->end_process=true;
                        }

                        if (may_send && !(*itr)->end_process)
                            (*itr)->TryFlushOutput();

                        //Check timeout now - incoming data events may have cleared the timeout
                        bool timeout = (*itr)->warntimer < now;
                        if (timeout && !(*itr)->end_process)
                        {
                                (*itr)->warntimer=Blex::DateTime::Max();
                                (*itr)->callback(itr->get(), ProcessEvents::TimerExpired, std::string());
                        }
                }

                //Time to shut down, or a shutdown requested and all processes finished?
                if (IsShuttingDown() && (now > processmgr_shutdown || !AnyUnendedProcesses()))
                    break;
        }
}

void ProcessManager::AddSyncCall(SynchronizedFunction const &tocall, bool interactive)
{
        FunctionPtr newcommand(new SynchronizedFunction(tocall));

        bool shouldsignal;
        {
                LockedQueue::WriteRef lock(functioncallqueue);
                shouldsignal = lock->interactive_calls.empty() && lock->normal_calls.empty();
                if (interactive)
                    lock->interactive_calls.push(newcommand);
                else
                    lock->normal_calls.push(newcommand);
                DEBUGPRINT("Added call, " << lock->interactive_calls.size() << " interactive and " << lock->normal_calls.size() << " normal calls. shouldsignal " << shouldsignal);
        }
        if (shouldsignal)
            commpipe.GetWriteEnd().WriteLsb<uint8_t>(0);
}

void ProcessManager::CallSynchronized(SynchronizedFunction const &tocall)
{
        AddSyncCall(tocall,false);
}

void ProcessManager::CallSynchronizedInteractive(const std::function< void() > &tocall)
{
        AddSyncCall(tocall,true);
}

SubProcess::SubProcess(std::string const &tag)
: results(NULL)
, errors(NULL)
, control(NULL)
, warntimer(Blex::DateTime::Max())
, end_process(false)
, tag(tag)
{
}

SubProcess::~SubProcess()
{
        delete control;
        delete results;
        delete errors;
}

void SubProcess::SendCommand(std::string const &cmdline)
{
        DEBUGPRINT("Process manager: to " << tag << ": " << cmdline);
        bool tryflush = outputbuffer.empty();

        outputbuffer.insert(outputbuffer.end(), &cmdline[0], &cmdline[0] + cmdline.size());
        outputbuffer.push_back('\n');

        if (tryflush) //send as much as already possible..
            TryFlushOutput();
}
void SubProcess::TryFlushOutput()
{
        unsigned bytessent = control->Write(&outputbuffer[0], outputbuffer.size());
        if (bytessent == 0)
        {
                if (control->IsPipeBroken()) //the receiving process blocked input?
                    outputbuffer.clear(); //Then don't schedule any output, or the pipe waiter may crash

                DEBUGPRINT("\aProcess manager: Sending output to process blocked!"); //untested code: remove this message, or at least the beep, if this situation occurred and was handled properly (nothing got stuck)
                return;
        }

        if (bytessent < outputbuffer.size())
            DEBUGPRINT("\aProcess manager: Sending output to process blocked, sent " << bytessent << " of " << outputbuffer.size()); //untested code: remove this message, or at least the beep, if this situation occurred and was handled properly (nothing got stuck)

        outputbuffer.erase(outputbuffer.begin(), outputbuffer.begin() + bytessent);
}

void SubProcess::SetTimeout(unsigned seconds)
{
        warntimer = seconds == 0 ? Blex::DateTime::Max() : Blex::DateTime::Now() + Blex::DateTime::Seconds(seconds);
}

/* ADDME: We can probably factor out the common code of reading a pipe
   and moving it to a string buffer. This code can then be called twice in
   queuemgr and once in webprocesseservice.bin */
void ProcessManager::ProcessIncomingData(SubProcess *subproc, bool is_output)
{
        std::string &line = is_output ? subproc->resultline : subproc->errorline;
        uint8_t buf[512];
        Blex::PipeReadStream *input = is_output ? subproc->results : subproc->errors;
        unsigned bytesread = input->Read(buf,sizeof(buf));

        for (unsigned i=0;i<bytesread;++i)
        {
                if (buf[i]=='\r')
                    continue;
                else if (buf[i]=='\n')
                {
                        subproc->callback(subproc, is_output ? ProcessEvents::Output : ProcessEvents::Error, line);
                        if (subproc->end_process)
                             break;
                        line.clear();
                }
                else
                {
                        line.push_back(buf[i]);
                }
        }
}

void ProcessManager::SyncShutdown(std::string const &errormessage)
{
        if (IsShuttingDown())
            return;

        DEBUGPRINT("Process manager: Got abort request");
        processmgr_shutdown = std::min(processmgr_shutdown, Blex::DateTime::Now() + Blex::DateTime::Seconds(ShutdownTime));

        if (!errormessage.empty())
            Blex::ErrStream() << errormessage;

        for (SubProcessList::iterator itr=subprocesses.begin(); itr != subprocesses.end(); ++itr)
            (*itr)->callback(itr->get(),ProcessEvents::AllShuttingDown,"");
}

