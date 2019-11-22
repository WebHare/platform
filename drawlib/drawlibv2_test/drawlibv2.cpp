#include <drawlib/drawlibv2/allincludes.h>


#include <blex/path.h>
#include <blex/utils.h>
#include <blex/testing.h>
#include <cstdlib>
#include <ctime>

//------------------------------------------------------------------------------
#include <drawlib/drawlibv2/fontmanager.h>

//ADDME: Vraag me niet hoe, maar het control87 fiddlen wat de UTF8Main wrapper verstoort de testresultaten

void CreateTestFont(std::string const &fontname)
{
        //ADDME: just open the downloaded font file (get blexlib to give us the test file pathname)

        std::unique_ptr<Blex::FileStream> infile(Blex::Test::OpenTestFile(fontname));
        std::string tmp = Blex::MergePath(Blex::Test::GetTempDir(), Blex::CreateTempName(fontname) + ".ttf");
        std::unique_ptr<Blex::FileStream> outfile(Blex::FileStream::OpenWrite(tmp, true, true, Blex::FilePermissions::PublicRead));
        infile->SendAllTo(*outfile);
        outfile.reset();
}


int UTF8Main(std::vector<std::string> const &args)
{
        if(args.size()<3)
                throw std::runtime_error("Syntax: drawlibv2 <testdir> <fontdir>");

        Blex::Test::SetTestDataDir(args[1]);
        Blex::Test::SetTestName("drawlibv2");
        DrawLib::GetGlobalFontManager().AddFontDirectory(args[2]);

/*        CreateTestFont("times.ttf");
        CreateTestFont("timesbd.ttf");
        CreateTestFont("timesbi.ttf");
        CreateTestFont("timesi.ttf");

        CreateTestFont("arial.ttf");
        CreateTestFont("arialbd.ttf");
        CreateTestFont("arialbi.ttf");
        CreateTestFont("ariali.ttf");

        DrawLib::GetGlobalFontManager().AddFontDirectory(Blex::Test::GetTempDir());
*/

        if (Blex::Test::Run(Blex::Test::TestNoisy, "*"))
        {
                return EXIT_SUCCESS;
        }
        else
        {
                std::cerr << "Look for errors in " << Blex::Test::GetTempDir() << "\n";
                return EXIT_FAILURE;
        }
 }

//---------------------------------------------------------------------------
int main(int argc, char *argv[])
{
                return Blex::InvokeMyMain(argc,argv,&UTF8Main);
}

