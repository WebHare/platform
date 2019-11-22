#include <ap/libwebhare/allincludes.h>

#include <ap/libwebhare/dbase_client.h>
#include <ap/libwebhare/whcore.h>
#include <blex/getopt.h>
#include <csignal>
#include <iostream>
#include "notify.h"
#include "publicationmgr.h"


/* ADDME: As far as I'm concerned, merge notify.cpp and schedule.cpp */
/* ADDME: Consider a nightly or weekly restart of all scripts (or scheduler itself?) to clear any memory overflow? */
/* ADDME: Allow forcing a rescan etc through the web interface (allows to test for memory overflow conditions) */

bool Shutdown(NotifyAsyncThread *notify, ProcessManager *processmanager, int )
{
        notify->Stop(false); //false: nowait
        processmanager->Shutdown("");
        return true;
}

int UTF8Main(std::vector<std::string> const &args)
{
        Blex::OptionParser::Option optionlist[] =
        {
                Blex::OptionParser::Option::ListEnd()
        };

        Blex::OptionParser optparse(optionlist);
        WHCore::Connection::AddOptions(optparse);
        if (!optparse.Parse(args))
        {
                Blex::ErrStream() << optparse.GetErrorDescription();
                return EXIT_FAILURE;
        }

        const std::unique_ptr<WHCore::Connection> webhare(new WHCore::Connection(optparse, "publisher",WHCore::WHManagerConnectionType::Connect));

        //Set up the two main code threads (ProcessMgr & Notify) and the subprocess management classes (one per module)
        const std::unique_ptr<ProcessManager> processmanager(new ProcessManager);

         //The publisher module's script
        const std::unique_ptr<PublicationManager> publishmgr(new PublicationManager(*webhare, *processmanager));

        const std::unique_ptr<NotifyAsyncThread> notify(new NotifyAsyncThread(*webhare,
                                           publishmgr.get(),
                                           *processmanager));

        //Launch the main loop
        Blex::SetInterruptHandler(std::bind(&Shutdown, notify.get(), processmanager.get(), std::placeholders::_1), false);
        processmanager->Run();
        Blex::ResetInterruptHandler();
        return 0;
}

int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}
