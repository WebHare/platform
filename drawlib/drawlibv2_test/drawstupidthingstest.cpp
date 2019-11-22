#include <drawlib/drawlibv2/allincludes.h>



#include "helperfuncs.h"

#include <drawlib/drawlibv2/drawobject.h>

/********************************************************************************
        ELLIPSE
********************************************************************************/

/* FIXME ehm marcoen?
BLEX_TEST_FUNCTION(DrObjTest_StupidEllipse)
{
        //should result in an epmty bitmap
        DrawLib::Bitmap32 mybitmap(400,400,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        //do the drawing
        drobj.DrawEllipse(DrawLib::FPPoint(10,10),DrawLib::FPSize(0,0));

        drobj.DrawEllipse(DrawLib::FPPoint(10,10),DrawLib::FPSize(-10,-10));

        drobj.DrawEllipse(DrawLib::FPPoint(10,10),DrawLib::FPSize(10,0));
        drobj.DrawEllipse(DrawLib::FPPoint(10,10),DrawLib::FPSize(0,10));

        BLEX_TEST_CHECK(DoCompare ("400x400xblack.png", mybitmap,  true));

}
*/

BLEX_TEST_FUNCTION(DrObjTest_StupidRectangle)
{
        DrawLib::Bitmap32 mybitmap(400,400,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        //do the drawing
        drobj.DrawRectangle(DrawLib::FPPoint(10,10),DrawLib::FPPoint(10,10));
        drobj.DrawRectangle(DrawLib::FPPoint(-10,-10),DrawLib::FPPoint(-1,-1));
        BLEX_TEST_CHECK(DoCompare ("ref-400x400xblack.png", mybitmap,  true));
}

BLEX_TEST_FUNCTION(DrObjTest_StupidRectangleOutline)
{
        DrawLib::Bitmap32 mybitmap(400,400,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        //do the drawing
        drobj.DrawRectangleOutline(DrawLib::FPPoint(400,400),DrawLib::FPPoint(401,401));
        drobj.DrawRectangleOutline(DrawLib::FPPoint(-10,-10),DrawLib::FPPoint(-1,-1));
        BLEX_TEST_CHECK(DoCompare ("ref-400x400xblack.png", mybitmap,  true));
}

BLEX_TEST_FUNCTION(DrObjTest_StupidRoundRectangle)
{
        DrawLib::Bitmap32 mybitmap(400,400,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        //do the drawing
        drobj.DrawRoundRectangle(DrawLib::FPPoint(10,10),DrawLib::FPPoint(10,10), DrawLib::FPSize(10,10) );
        drobj.DrawRoundRectangle(DrawLib::FPPoint(-10,-10),DrawLib::FPPoint(-1,-1), DrawLib::FPSize(10,10));
        drobj.DrawRoundRectangle(DrawLib::FPPoint(-10,-10),DrawLib::FPPoint(-1,-1), DrawLib::FPSize(-10,-10));
        BLEX_TEST_CHECK(DoCompare ("ref-400x400xblack.png", mybitmap,  true));
}

BLEX_TEST_FUNCTION(DrObjTest_StupidRoundRectangleOutline)
{
        DrawLib::Bitmap32 mybitmap(400,400,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        //do the drawing
        drobj.DrawRoundRectangleOutline(DrawLib::FPPoint(10,10),DrawLib::FPPoint(10,10), DrawLib::FPSize(10,10) );
        drobj.DrawRoundRectangleOutline(DrawLib::FPPoint(-10,-10),DrawLib::FPPoint(-1,-1), DrawLib::FPSize(10,10));
        drobj.DrawRoundRectangleOutline(DrawLib::FPPoint(-10,-10),DrawLib::FPPoint(-1,-1), DrawLib::FPSize(-10,-10));
        BLEX_TEST_CHECK(DoCompare ("ref-400x400xblack.png", mybitmap,  true));
}
