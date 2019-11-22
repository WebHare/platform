//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../threads.h"
#include "../path.h"
#include "../pipestream.h"
#include "../context.h"

extern std::string self_app;

void TestArgumentList(std::vector<std::string> const &arguments)
{
        Blex::PipeSet input;

        Blex::Process testecho;
        testecho.RedirectOutput(input.GetWriteEnd(),false);

        BLEX_TEST_CHECK(testecho.Start(self_app,arguments,"",false));

        /* Now, start splitting the results into a vector */
        std::vector<std::string> received_arguments(1);
        std::string *current=&received_arguments.back();

        uint8_t byte;
        while (input.GetReadEnd().Read(&byte,1))
        {
                if (byte=='\n') //end of line!
                {
                        received_arguments.push_back(std::string());
                        current = &received_arguments.back();
                }
                else if (byte != '\r')
                {
                        current->push_back(byte);
                }
        }
        received_arguments.resize(received_arguments.size()-1);

        //We got all the arguments, so verify them
        for (unsigned i=0;i<std::min(arguments.size(),received_arguments.size());++i)
            BLEX_TEST_CHECKEQUAL(arguments[i],received_arguments[i]);

        /* We have all the arguments back via the batch file. Verify them! */
        BLEX_TEST_CHECKEQUAL(arguments.size(),received_arguments.size());

        testecho.WaitFinish();
        BLEX_TEST_CHECKEQUAL(arguments.size(), testecho.GetReturnValue());
}

/*
·       Arguments are delimited by white space, which is either a space or a tab.
·       A string surrounded by double quotation marks is interpreted as a
single argument, regardless of white space contained within. A quoted
string can be embedded in an argument. Note that the caret (^) is not
recognized as an escape character or delimiter.
·       A double quotation mark preceded by a backslash, \", is interpreted as
a literal double quotation mark (").
·       Backslashes are interpreted literally, unless they immediately precede
a double quotation mark.
·       If an even number of backslashes is followed by a double quotation
mark, then one backslash (\) is placed in the argv array for every pair
of backslashes (\\), and the double quotation mark (") is interpreted as
a string delimiter.
·       If an odd number of backslashes is followed by a double quotation
mark, then one backslash (\) is placed in the argv array for every pair
of backslashes (\\) and the double quotation mark is interpreted as an
escape sequence by the remaining backslash, causing a literal double
quotation mark (") to be placed in argv.
*/

BLEX_TEST_FUNCTION(TestArguments)
{
        std::vector<std::string> arguments;

        /*  1: "echo" */
        arguments.push_back("echo");
        TestArgumentList(arguments);

        /*  2 */
        arguments.push_back("first arg");
        TestArgumentList(arguments);

        /*  3 */
        arguments.push_back(""); //empty...
        TestArgumentList(arguments);

        /*  4 */
        arguments.push_back("\"quoted \"\"argument\"");
        TestArgumentList(arguments);

        /*  5 */
        arguments.push_back("arg\\with back\\slashes");
        TestArgumentList(arguments);

        /*  6 */
        arguments.push_back("end2slash\\\\");
        TestArgumentList(arguments);

        /*  7    end3slashquote\\\"    */
        arguments.push_back("end3slashquote\\\\\\\"");
        TestArgumentList(arguments);

        /*  8   mid\"slash    */
        arguments.push_back("mid\\\"slash");
        TestArgumentList(arguments);

        /*  9   pleuros */
        arguments.push_back("€uro çedille héééé!");
        TestArgumentList(arguments);
}

BLEX_TEST_FUNCTION(TestBreak)
{
        Blex::PipeSet output;
        output.GetReadEnd().SetBlocking(false);
        output.GetWriteEnd().SetBlocking(true);

        Blex::Process testbreak;
        testbreak.RedirectOutput(output.GetWriteEnd(),false);

        //Launch the loopback process
        std::vector <std::string> args;
        args.push_back("breaktest");
        BLEX_TEST_CHECK(testbreak.Start(self_app,args,"",false));

        Blex::PipeWaiter waiter;
        waiter.AddReadPipe(output.GetReadEnd()); //listen for readability

        while (waiter.Wait(Blex::DateTime::Max()) == false || !waiter.GotRead(output.GetReadEnd()))
            /**/;
        //Now send a break signal
        testbreak.SendTerminate();

        while(true)
        {
                waiter.Wait(Blex::DateTime::Max());
                uint8_t temp;
                if(waiter.GotRead(output.GetReadEnd()))
                {
                        output.GetReadEnd().Read(&temp,1);
                }
                if (output.GetReadEnd().EndOfStream())
                   break;
        }
        //And wait for process to come back to us
        testbreak.WaitFinish();
}

Blex::ConditionMutex cm;
bool shared_bool_1 = false;
bool shared_bool_2 = false;

void TestPipesAndCVs_Thread(Blex::PipeSet *)
{
        Blex::ConditionMutex::AutoLock lock(cm);
        while(!shared_bool_2)
            lock.Wait();

        shared_bool_1=true;
        cm.SignalOne();

        while(shared_bool_2)
            lock.Wait();

        shared_bool_1=false;
        cm.SignalAll();
}

BLEX_TEST_FUNCTION(TestPipesAndCVs)
{
        Blex::PipeSet output;
        output.GetReadEnd().SetBlocking(false);
        output.GetWriteEnd().SetBlocking(true);

        Blex::Thread subthread(std::bind(&TestPipesAndCVs_Thread, &output));
        subthread.Start();
        Blex::SleepThread(50);

        Blex::PipeWaiter waiter;
        waiter.AddReadPipe(output.GetReadEnd()); //listen for readability

        {
                Blex::ConditionMutex::AutoLock lock(cm);
                shared_bool_2 = true;
                cm.SignalOne();
                while(!shared_bool_1) //may not timeout!
                    BLEX_TEST_CHECKEQUAL(true, waiter.ConditionMutexWait(lock, Blex::DateTime::Now() + Blex::DateTime::Seconds(300)));

                shared_bool_2 = false;
                cm.SignalAll();
                while(shared_bool_1)
                    BLEX_TEST_CHECKEQUAL(true, waiter.ConditionMutexWait(lock, Blex::DateTime::Now() + Blex::DateTime::Seconds(300)));
        }
}

BLEX_TEST_FUNCTION(TestDeadLockDetection)
{
        Blex::Detail::SetThrowOnDeadlock(true);

        try
        {
                Blex::DebugMutex mutex;
                mutex.SetupDebugging("a");

                Blex::DebugMutex::AutoLock lock1(mutex);
                Blex::DebugMutex::AutoLock lock2(mutex);

                BLEX_TEST_CHECKEQUAL(true, false);
        }
        catch (std::logic_error &e)
        {
        }

        Blex::Detail::SetThrowOnDeadlock(false);
}

struct TestContextData
{
        inline TestContextData() : data(0) { }

        unsigned data;
};

typedef Blex::Context< TestContextData, 1, void > TestContext;

Blex::ConditionMutex co_cm;
unsigned co_shared_pg = 0;

void TextContextSubThread()
{
        Blex::ConditionMutex::AutoLock lock(co_cm);

        TestContext context(Blex::CurrentThreadContext());
        BLEX_TEST_CHECKEQUAL(0, context->data);

        context->data = 7;

        co_shared_pg = 1;
        co_cm.SignalAll();

        while (co_shared_pg != 2)
            BLEX_TEST_CHECKEQUAL(true, lock.TimedWait(Blex::DateTime::Now() + Blex::DateTime::Seconds(30)));

        BLEX_TEST_CHECKEQUAL(7, context->data);

        co_shared_pg = 3;
        co_cm.SignalAll();
}

BLEX_TEST_FUNCTION(TestThreadContext)
{
        TestContext::Register(Blex::GetThreadContextRegistrator());

        TestContext context(Blex::CurrentThreadContext());

        BLEX_TEST_CHECKEQUAL(0, context->data);
        ++context->data;
        TestContext context2(Blex::CurrentThreadContext());
        BLEX_TEST_CHECKEQUAL(1, context2->data);

        Blex::Thread subthread(&TextContextSubThread);
        subthread.Start();
        Blex::ConditionMutex::AutoLock lock(co_cm);

        while (co_shared_pg != 1)
            BLEX_TEST_CHECKEQUAL(true, lock.TimedWait(Blex::DateTime::Now() + Blex::DateTime::Seconds(30)));

        TestContext context3(Blex::CurrentThreadContext());
        BLEX_TEST_CHECKEQUAL(1, context3->data);

        context3->data = 5;

        co_shared_pg = 2;
        co_cm.SignalAll();

        while (co_shared_pg != 3)
            BLEX_TEST_CHECKEQUAL(true, lock.TimedWait(Blex::DateTime::Now() + Blex::DateTime::Seconds(30)));

        TestContext context4(Blex::CurrentThreadContext());
        BLEX_TEST_CHECKEQUAL(5, context4->data);
}

