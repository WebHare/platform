//---------------------------------------------------------------------------
#include <blex/blexlib.h>
#include <iostream>
#include <string>
#include <vector>
#include "../testing.h"

//---------------------------------------------------------------------------

#include "../pipestream.h"
#include "../path.h"
#include "../testing.h"
#include "../unicode.h"
#include "../utils.h"

std::string self_app;
std::string dll_path;

bool OnInterrupt(int)
{
        write(1,"interrupt",9);
        _exit(0);
}

int UTF8Main(std::vector<std::string> const &args)
{
        self_app=Blex::MergePath(".libs",args[0]); //libtool workaround

        try
        {
                Blex::Test::SetTestName("blextest");

                if (args.size()<2)
                {
                        std::cout << "Missing test-type parameter\n";
                        return EXIT_FAILURE;
                }

                std::string runtype = args[1];

                if (runtype=="breaktest")
                {
                        Blex::SetInterruptHandler(&OnInterrupt, false);
                        std::cout<<"Break me\n"<<std::endl;
                        while(true)
                            Blex::SleepThread(1000);
                        return 0;
                }
                if (runtype=="echo")
                {
                        for (unsigned i=1;i<args.size();++i)
                            std::cout << args[i] << "\n";
                        return args.size()-1;
                }
                if (runtype=="loopback")
                {
                        char ch;

                        while (Blex::ReadConsoleBytes(&ch,1))
                            std::cout << ch << std::flush;

                        return EXIT_SUCCESS;
                }
                if (runtype=="info")
                {
                        //just run the info tests..
                        std::cout << "Type: " << Blex::GetSystemDescription() << "\n"
                                  << "Tick frequency: " << Blex::GetSystemTickFrequency() << " per second\n"
                                  << "# cpus: " << Blex::GetSystemCPUs(true) << "\n";
                        return EXIT_SUCCESS;
                }

                if (runtype=="test")
                {
                        if (args.size()<5)
                        {
                                std::cerr << "Syntax: blextest test <path_to_exe> <path_to_dll> <path_to_testdata> [ <options> [ <testnamemask> ] ]\n";
                                return EXIT_FAILURE;
                        }
                        self_app=args[2];
                        dll_path=args[3];
                        Blex::Test::SetTestDataDir(args[4]);

                        std::string mask = "*";

                        long options = 0;
                        if (args.size()>5)
                                options = std::atol(args[5].c_str());
                        if (args.size()>6)
                                mask = args[6].c_str();

                        return Blex::Test::Run(options, mask) ? EXIT_SUCCESS : EXIT_FAILURE;
                }
                std::cerr << "Unknown test-type parameter\n";
                return EXIT_FAILURE;
        }
        catch (std::exception &e)
        {
                std::cout << "Exception: " << e.what() << "\n";
                return EXIT_FAILURE;
        }
}

//---------------------------------------------------------------------------
int main(int argc, char *argv[])
{
                return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}

