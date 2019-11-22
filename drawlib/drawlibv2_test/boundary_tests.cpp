#include <drawlib/drawlibv2/allincludes.h>



#include <drawlib/drawlibv2/drawobject.h>
#include <drawlib/drawlibv2/bitmapio.h>
#include "helperfuncs.h"

BLEX_TEST_FUNCTION(ScanlineBoundaryTest)
{
        //scanline should have width > 0;
        BLEX_TEST_CHECKTHROW( DrawLib::Scanline32(0, false) , std::runtime_error);
}

BLEX_TEST_FUNCTION(BitmapBoundaryTest)
{
        //bitmap should have width > 0;
        BLEX_TEST_CHECKTHROW( DrawLib::Bitmap32(0,1) ,
                              std::runtime_error);
        //bitmap should have height > 0;
        BLEX_TEST_CHECKTHROW( DrawLib::Bitmap32(1,0) ,
                              std::runtime_error);

        DrawLib::Bitmap32 mybitmap(10,10);

        BLEX_TEST_CHECKTHROW( mybitmap.GetScanline32(-1), std::runtime_error);
        BLEX_TEST_CHECKTHROW( mybitmap.GetScanline32(11), std::runtime_error);

        DrawLib::Scanline32   my_legal_scanline(10,false);

        BLEX_TEST_CHECKTHROW( mybitmap.SetScanline32(-1,my_legal_scanline ), std::runtime_error);
        BLEX_TEST_CHECKTHROW( mybitmap.SetScanline32(11,my_legal_scanline ), std::runtime_error);
}

BLEX_TEST_FUNCTION(CanvasBoundaryTest)
{
        DrawLib::Bitmap32     mybitmap(10,10);
        DrawLib::Canvas32     mycanvas(&mybitmap);
        DrawLib::Scanline32   my_legal_scanline(10,false);
        DrawLib::Scanline32   my_illegal_scanline( 5,false);
        DrawLib::Pixel32      mypixel(255,255,255,255);

        BLEX_TEST_CHECKTHROW( DrawLib::Canvas32(NULL), std::runtime_error);

        BLEX_TEST_CHECKTHROW( mycanvas.Exchange(NULL), std::runtime_error);

//        BLEX_TEST_CHECKTHROW( mycanvas.ClearScanline32(-1,mypixel) , std::runtime_error);
//        BLEX_TEST_CHECKTHROW( mycanvas.ClearScanline32(11,mypixel) , std::runtime_error);

        BLEX_TEST_CHECKTHROW( mycanvas.SetScanline32(-1,&my_legal_scanline) , std::runtime_error);
        BLEX_TEST_CHECKTHROW( mycanvas.SetScanline32(11,&my_legal_scanline) , std::runtime_error);

        BLEX_TEST_CHECKTHROW( mycanvas.SetScanline32(5 ,&my_illegal_scanline) , std::runtime_error);
}

BLEX_TEST_FUNCTION(DrawObjectBoundaryTest)
{
        DrawLib::Bitmap32     mybitmap(10,10);
        DrawLib::Canvas32     mycanvas(&mybitmap);
        DrawLib::DrawObject   mydrobj(&mycanvas);
        DrawLib::Scanline32   my_legal_scanline(10,false);
        DrawLib::Scanline32   my_illegal_scanline( 5,false);
        DrawLib::Pixel32      mypixel(255,255,255,255);
        DrawLib::FPPoint      lowerright(10,10);
        DrawLib::FPPoint      upperleft(0,0);
        DrawLib::PolyLine     emptyline;

        BLEX_TEST_CHECKTHROW( DrawLib::DrawObject(NULL), std::runtime_error);

        BLEX_TEST_CHECKTHROW( mydrobj.DrawBezierOutline(emptyline), std::runtime_error);
}

BLEX_TEST_FUNCTION(StreamingReadersBoundaryTest)
{
        DrawLib::Bitmap32     mybitmap(10,10);
        BLEX_TEST_CHECKTHROW( DrawLib::CreateBitmap32FromJPG(NULL, 1), std::runtime_error);
        BLEX_TEST_CHECKTHROW( DrawLib::CreateBitmap32FromPNG(NULL), std::runtime_error);
        BLEX_TEST_CHECKTHROW( DrawLib::CreateBitmap32FromJPG(NULL, 9), std::runtime_error);
}

BLEX_TEST_FUNCTION(StreamingWritersBoundaryTest)
{
        DrawLib::Bitmap32     mybitmap(10,10);

        BLEX_TEST_CHECKTHROW( DrawLib::SaveBitmap32AsJPG(NULL, mybitmap, 75), std::runtime_error);
        BLEX_TEST_CHECKTHROW( DrawLib::SaveBitmap32AsTGA(NULL, mybitmap), std::runtime_error);
        BLEX_TEST_CHECKTHROW( DrawLib::SaveBitmap32AsPNG(NULL, mybitmap , true, true), std::runtime_error);
}

