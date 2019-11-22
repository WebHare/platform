#include <drawlib/drawlibv2/allincludes.h>



#include "helperfuncs.h"
#include <drawlib/drawlibv2/drawobject.h>

BLEX_TEST_FUNCTION(SpacingTest)
{
        DrawLib::Bitmap32 mybitmap(600,600,DrawLib::Pixel32(0,0,0,255));

        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        // White Liberation Sans Regular 48
        DrawLib::Font *myfont1 = DrawLib::GetGlobalFontManager().CreateFontFromFile("Liberation Sans","Regular");
        BLEX_TEST_CHECK(myfont1);
        myfont1->SetColor(DrawLib::Pixel32(0xFF,0xFF,0xFF));
        myfont1->SetSize(DrawLib::FPSize(48,48));

        Blex::UnicodeString string;
        string.push_back('B');
        string.push_back('l');
        string.push_back('e');
        string.push_back('x');

        std::vector<double> deltas;
        drobj.DrawTextExtended(DrawLib::FPPoint(0,0),  string, *myfont1, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);
        drobj.DrawTextExtended(DrawLib::FPPoint(0,50),  string, *myfont1, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 1.0);
        drobj.DrawTextExtended(DrawLib::FPPoint(0,100),  string, *myfont1, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 2.0);
        drobj.DrawTextExtended(DrawLib::FPPoint(0,150),  string, *myfont1, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 3.0);
        drobj.DrawTextExtended(DrawLib::FPPoint(0,200),  string, *myfont1, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 4.0);
        drobj.DrawTextExtended(DrawLib::FPPoint(0,250),  string, *myfont1, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 5.0);

        delete myfont1;

        //FIXME: BLEX_TEST_CHECK(DoCompare ("spacingtest.png", mybitmap, true));
}
BLEX_TEST_FUNCTION(FontTest)
{
        DrawLib::Bitmap32 mybitmap(600,600,DrawLib::Pixel32(0,0,0,255));

        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        // White Liberation Sans Regular 48
        DrawLib::Font *myfont1 = DrawLib::GetGlobalFontManager().CreateFontFromFile("Liberation Sans","Regular");
        BLEX_TEST_CHECK(myfont1);
        myfont1->SetColor(DrawLib::Pixel32(0xFF,0xFF,0xFF));
        myfont1->SetSize(DrawLib::FPSize(48,48));
        // Red Liberation Sans Bold 48
        DrawLib::Font *myfont2 = DrawLib::GetGlobalFontManager().CreateFontFromFile("Liberation Sans","Bold");
        BLEX_TEST_CHECK(myfont2);
        myfont2->SetColor(DrawLib::Pixel32(0xFF,0,0));
        myfont2->SetSize(DrawLib::FPSize(48,48));
        // Blue Liberation Sans Italic 72
        DrawLib::Font *myfont3 = DrawLib::GetGlobalFontManager().CreateFontFromFile("Liberation Sans","Italic");
        BLEX_TEST_CHECK(myfont3);
        myfont3->SetColor(DrawLib::Pixel32(0,0,0xFF));
        myfont3->SetSize(DrawLib::FPSize(72,72));

        // Mac Type-1 font test..
        std::unique_ptr<Blex::FileStream> infile(Blex::Test::OpenTestFile("FrutigerNextLT-Black.pfb"));
        std::string tmp = Blex::MergePath(Blex::Test::GetTempDir(), Blex::CreateTempName("frutigertest"));
        std::unique_ptr<Blex::FileStream> outfile(Blex::FileStream::OpenWrite(tmp, true, true, Blex::FilePermissions::PublicRead));
        infile->SendAllTo(*outfile);
        outfile.reset();

        DrawLib::Font *myfont4 = DrawLib::Font::CreateFontFromFile(tmp, "", 0);
        myfont4->SetColor(DrawLib::Pixel32(0xFF,0xFF,0xFF));
        myfont4->SetSize(DrawLib::FPSize(48,48));

        // Helvetica Neue LT Std, from otf file
        infile.reset(Blex::Test::OpenTestFile("HelveticaNeueLTStd-Roman.otf"));
        BLEX_TEST_CHECK(infile.get());
        std::string tmp2 = Blex::MergePath(Blex::Test::GetTempDir(), Blex::CreateTempName("helveticaotftest"));
        outfile.reset(Blex::FileStream::OpenWrite(tmp2, true, true, Blex::FilePermissions::PublicRead));
        infile->SendAllTo(*outfile);
        outfile.reset();

        DrawLib::Font *myfont5 = DrawLib::Font::CreateFontFromFile(tmp2, "", 0);
        BLEX_TEST_CHECK(myfont5);
        myfont5->SetColor(DrawLib::Pixel32(0xFF,0,0xFF));
        myfont5->SetSize(DrawLib::FPSize(55,55));

        Blex::UnicodeString string;
        string.push_back('B');
        string.push_back('l');
        string.push_back('e');
        string.push_back('x');

        std::vector<double> deltas;
        drobj.DrawTextExtended(DrawLib::FPPoint(10,50),  string, *myfont1, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);
        drobj.DrawTextExtended(DrawLib::FPPoint(10,150), string, *myfont2, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);
        drobj.DrawTextExtended(DrawLib::FPPoint(10,250), string, *myfont3, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);
        drobj.DrawTextExtended(DrawLib::FPPoint(10,450), string, *myfont4, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);
        drobj.DrawTextExtended(DrawLib::FPPoint(10,550), string, *myfont5, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);

        drobj.DrawTextExtended(DrawLib::FPPoint(150,50),  string, *myfont1, deltas, true, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);
        drobj.DrawTextExtended(DrawLib::FPPoint(150,150), string, *myfont2, deltas, true, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);
        drobj.DrawTextExtended(DrawLib::FPPoint(150,250), string, *myfont3, deltas, true, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);
        drobj.DrawTextExtended(DrawLib::FPPoint(150,450), string, *myfont4, deltas, true, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);
        drobj.DrawTextExtended(DrawLib::FPPoint(150,550), string, *myfont5, deltas, true, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);

        delete myfont1;
        delete myfont2;
        delete myfont3;
        delete myfont4;
        delete myfont5;

        // Calibrated on fedora 26 docker build, fedora 25: MSE 92.48, RPM build: MSE 93.0474
        // freetype 2.9 MSE 104.59
        // freetype 2.10.1 on mac MSE 113.362
        BLEX_TEST_CHECK(DoErrorCompare("fonttest.png", mybitmap, 125, true));
}
