#include <ap/libwebhare/allincludes.h>


#include <blex/logfile.h>
#include "consilio.h"
#include "consilio_main.h"
#include "consilio_janitor.h"

/// Time to wait until we want the first task to be done (give the system some time to settle down..)
const unsigned WaitFirstTask = 60*10; // wait 10 minutes..

/// Time to wait until we move to the next task
const unsigned WaitNextTask = 60*60*12; // wait 12 hours

class JanitorAbort { };

Janitor::Janitor(IndexManager &_indexmanager)
: indexmanager(_indexmanager)
, threadrunner(std::bind(&Janitor::ThreadCode,this))
{
        DEBUGONLY(abortflag.SetupDebugging("Janitor.abortflag"));
        *AbortFlag::WriteRef(abortflag)=false;

        if (!threadrunner.Start())
            throw std::runtime_error("Cannot launch the janitor thread");
}

Janitor::~Janitor()
{
        if (*AbortFlag::ReadRef(abortflag)==false)
            Stop();
}

void Janitor::Stop()
{
        DEBUGPRINT("Signalling janitor thread to stop");

        // Signal thread to stop
        *AbortFlag::WriteRef(abortflag)=true;
        abortflag.SignalAll();

        // Wait for thread to come back to us
        threadrunner.WaitFinish();
        DEBUGPRINT("Janitor thread stopped");
}

std::string Janitor::GetStatus()
{
//ADDME: This function is called asynchronously, so this assignment may be thread unsafe?
        Blex::DateTime nexttask = next_time;
        return "janitor.nexttask=" + Blex::AnyToString(nexttask.GetDays()) + "\t" +
               Blex::AnyToString(nexttask.GetMsecs()) + "\n";
}

void Janitor::DoOptimize()
{
        LogLevel l = indexmanager.GetLogLevel();

        if (l >= Log_Debug)
            Blex::ErrStream() << "Janitor: Optimizing index";

        //ADDME: Put all this connecting, sending and receiving stuff into one
        //       function, so it can be reused whenever other commands have to be
        //       sent to the IndexManager
        //ADDME: Support for abort?

        // We send out optimization request using our own HTTP connection, so it's
        // automatically using the webcon's connection category mechanism
        Blex::Socket sock(Blex::Socket::Stream);
        sock.SetBlocking(false);
        IndexManagerConfig const &conf = indexmanager.GetConfig();

        Blex::DateTime maxwait = Blex::DateTime::Now() + Blex::DateTime::Msecs(10*1000);

        // Try to connect
        int32_t connres = sock.TimedConnect(conf.listenport, maxwait);
        if (connres != Blex::SocketError::NoError)
        {
                if (l >= Log_Statistics)
                    Blex::ErrStream() << "Janitor: Could not open connection (" << connres << "), trying again later";

                next_time = Blex::DateTime::Now() + Blex::DateTime::Seconds(WaitFirstTask);
                return;
        }

        // Send optimization command
        std::string command("GET /optimize HTTP/1.0\r\n"
                            "\r\n");

        maxwait = Blex::DateTime::Now() + Blex::DateTime::Msecs(30*1000);
        std::pair<int32_t, int32_t> sendres = sock.TimedSend(&command.data()[0]
                                                    ,command.size()
                                                    ,maxwait);
        if (sendres.first != Blex::SocketError::NoError)
        {
                if (l >= Log_Statistics)
                    Blex::ErrStream() << "Janitor: Error while sending (" << sendres.first << "), trying again later";

                next_time = Blex::DateTime::Now() + Blex::DateTime::Seconds(WaitFirstTask);
                return;
        }

        // Receive response
        std::string response;
        int32_t received;
        do
        {
                char buf[255];
                received = 0;
                maxwait = Blex::DateTime::Now() + Blex::DateTime::Msecs(15*60*1000);
                std::pair<int32_t, int32_t> recvres = sock.TimedReceive(&buf
                                                               ,255
                                                               ,maxwait);
                if (recvres.first != Blex::SocketError::Closed && recvres.first != Blex::SocketError::NoError)
                {
                        if (l >= Log_Statistics)
                            Blex::ErrStream() << "Janitor: Error while receiving (" << recvres.first << "), trying again later";

                        next_time = Blex::DateTime::Now() + Blex::DateTime::Seconds(WaitFirstTask);
                        return;
                }
                received = recvres.second;
                response.append(&buf[0],received);
                if (recvres.first == Blex::SocketError::Closed)
                    break;
        }
        while (received > 0);

        // Parse response
        std::string::size_type lineend = response.find("\r\n");
        if (lineend != std::string::npos)
            response = response.substr(0,lineend);
        std::vector<std::string> parts;
        Blex::TokenizeString(response, ' ', &parts);
        if (parts.size() < 3 || parts[1] != "200")
        {
                if (l >= Log_Statistics)
                    Blex::ErrStream() << "Janitor: Unexpected response: " << response;
        }
        else
        {
                if (l >= Log_Debug)
                    Blex::ErrStream() << "Janitor: Index is optimized";
        }

        next_time = Blex::DateTime::Now() + Blex::DateTime::Seconds(WaitNextTask);
}

void Janitor::ThreadCode()
{
        try
        {
                next_time = Blex::DateTime::Now() + Blex::DateTime::Seconds(WaitFirstTask);

                while (true) // repeat ad infinitum
                {
                        while (true) // wait for something to do
                        {
                                AbortFlag::ReadRef shouldabort(abortflag);
                                if (*shouldabort)
                                    return;

                                Blex::DateTime current_time = Blex::DateTime::Now();
                                if (current_time >= next_time)
                                    break; // it's time to do our task!
/* Disabled, we're already waiting 12 hours between runs. If timer gets set back
   a couple of hours, it doesn't really matter, I guess; Consilio works perfectly
   without optimizing.
   However, maybe in the future the janitor will be run more often and perform
   tasks that can't wait that long.
                                if (current_time < next_time-Blex::DateTime::Seconds(TimeLeapGuard))
                                {
                                        DEBUGPRINT("Willie: Backwards time jump detected! Assuming timer expired");
                                        break;
                                }
*/

                                LogLevel l = indexmanager.GetLogLevel();
                                if (l >= Log_Debug)
                                    Blex::ErrStream() << "Janitor: Sleeping for " << ((next_time - current_time).GetMsecs()/1000) << " seconds";
                                shouldabort.TimedWait(next_time);
                        }

                        // execute task
                        DoOptimize();
                }
        }
        catch (JanitorAbort &)
        {
                // eat this exception - it's our Cancel!
        }
}


