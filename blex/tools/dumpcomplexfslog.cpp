//---------------------------------------------------------------------------
#include "../blexlib.h"
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
#include "../complexfs.h"
#include "../binarylogfile.h"
#include "../mmapfile.h"

class DumpComplexFileSystem: public Blex::ComplexFileSystem
{
    public:
        void Dump(std::string const &logfile)
        {
            Blex::debug_complexfs_printlogmsgs = true;
            std::unique_ptr< Blex::BinaryLogFile > log;

            log.reset(Blex::BinaryLogFile::Open(logfile, false));
            if (!log.get())
                throw std::runtime_error("ComplexFileSystem: Cannot open file log " + logfile);

            Blex::ComplexFileSystem::LockedFileData::WriteRef lock(filedata);
            std::cout << "Replaying log for initialization. Contents of replay log:" << std::endl;
            log->SendAllMessages(std::bind(&DumpComplexFileSystem::ReplayMessage, std::ref(*this), std::placeholders::_1, std::ref(lock->files), (Blex::CFS_DirectoryMapKeeper *)0, true));
        }

};

int UTF8Main(std::vector<std::string> const &args)
{
        Blex::debug_complexfs_printlogmsgs = true;

        if (args.size() != 2)
        {
                std::cout << "Syntax: dumpcomplexfslog.exe log.cfslog\n";
                return EXIT_FAILURE;
        }

        DumpComplexFileSystem fs;
        fs.Dump(args[1]);
        return 0;
}

//---------------------------------------------------------------------------
int main(int argc, char *argv[])
{
        return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}

