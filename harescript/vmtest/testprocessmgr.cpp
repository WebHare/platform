//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>


#include <blex/testing.h>
#include <harescript/vm/hsvm_processmgr.h>
#include <harescript/vm/hsvm_context.h>
#include <harescript/vm/filesystem.h>
#include <harescript/compiler/engine.h>
#include <harescript/compiler/diskfilesystem.h>
#include <harescript/compiler/compilecontrol.h>
#include "vmtest.h"

void ShowErrors(HareScript::ErrorHandler const &handler)
{
        for (HareScript::ErrorHandler::MessageList::const_iterator itr = handler.GetErrors().begin(); itr != handler.GetErrors().end(); ++itr)
        {
                std::cout << "Error: " << itr->filename << "(" << itr->position.line << "," << itr->position.column << "): " << HareScript::GetMessageString(*itr) << std::endl;
        }
        std::cout << "Stack trace:" << std::endl;
        for (HareScript::ErrorHandler::StackTrace::const_iterator itr=handler.GetStackTrace().begin(); itr!=handler.GetStackTrace().end();++itr)
        {
                std::cout << "Trace: " << itr->filename<< "(" << itr->position.line << "," << itr->position.column << ")" << std::endl;
                std::cerr << " (" << itr->func << ")";
                std::cerr << "\n";
        }
}

BLEX_TEST_FUNCTION(LockWhileWaiting)
{
        /* Tests locking a VM in RunningState::WaitForMultiple. Error was that a signals received during the lock
           is ignored until the next entry into the waitloop.
        */

        std::string tempdir = Blex::Test::GetTempDir();

        //Setup the file system
        HareScript::DiskFileSystem filesystem(tempdir, tempdir, "", Blex::MergePath(VMTest::srcdir, "whtree/modules/system/whres"));
        filesystem.SetupNamespace("wh", Blex::MergePath(VMTest::srcdir, "whtree/modules/system/whlibs"));
        filesystem.SetupNamespace("test", Blex::MergePath(VMTest::srcdir, "harescript/vmtest/data"));
        filesystem.SetupDynamicModulePath(VMTest::moduledir);

        // Compile the testscript
        {
                HareScript::Compiler::Engine compile_engine(filesystem,"");

                Blex::ContextRegistrator creg;
                filesystem.Register(creg);
                Blex::ContextKeeper keeper(creg);
                HareScript::Compiler::CompileControl control(compile_engine, filesystem);

                control.CompileLibrary(keeper, "test::suspendtest.hslib");

                if (compile_engine.GetErrorHandler().AnyErrors())
                    ShowErrors(compile_engine.GetErrorHandler());

                BLEX_TEST_CHECKEQUAL(false, compile_engine.GetErrorHandler().AnyErrors());
        }

        // Setup the script
        HareScript::GlobalBlobManager blobmgr(Blex::GetSystemTempDir());
        Blex::NotificationEventManager eventmgr;
        HareScript::Environment environment(eventmgr, filesystem, blobmgr, false);
        HareScript::JobManager jobmgr(environment);
        jobmgr.Start(1, 0);

        std::shared_ptr< HareScript::IPCLinkEndPoint > endpoint;
        HareScript::VMGroup *cif = jobmgr.CreateVMGroup(true);

        jobmgr.CreateIPCLink(&endpoint, &cif->parentipclink);
        HSVM *myvm = cif->CreateVirtualMachine();

        std::vector<std::string> args;
        cif->SetupConsole(myvm, args);

        bool any_errors = !HSVM_LoadScript(myvm, "test::suspendtest.hslib");
        if (any_errors)
            ShowErrors(cif->GetErrorHandler());

        BLEX_TEST_CHECKEQUAL(any_errors, false);

        // Start the script
        jobmgr.StartVMGroup(cif);

        // Lock the VM when it is suspending
        while (true)
        {
                Blex::SleepThread(150); // Wait first, to allow script to enter wfm state
                if (jobmgr.TryLockVMGroup(cif, 0))
                    break;
        }

        // Signal the VM (by closing the ipc link)
        endpoint.reset();
        Blex::SleepThread(100); // Wait for the wait loop to notice the signal, and reenter after finding the vm is locked

        jobmgr.UnlockVMGroup(cif);

        {
                // Wait for the script to notice the signal and finish
                Blex::PipeWaiter waiter;
                waiter.AddEvent(cif->GetFinishEvent());
                waiter.Wait(Blex::DateTime::Now() + Blex::DateTime::Seconds(1)); // Wait max 1 second
        }

        // Script finishevent MUST be finished
        BLEX_TEST_CHECKEQUAL(true, cif->GetFinishEvent().IsSignalled());

        jobmgr.WaitFinished(cif);

        if (cif->GetErrorHandler().AnyErrors())
            ShowErrors(cif->GetErrorHandler());
        BLEX_TEST_CHECKEQUAL(false, cif->GetErrorHandler().AnyErrors());

        jobmgr.ReleaseVMGroup(cif);
}
