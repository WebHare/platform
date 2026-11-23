#include <drawlib/drawlibv2/allincludes.h>


#include "helperfuncs.h"

#include <drawlib/drawlibv2/drawobject.h>

/********************************************************************************
        ELLIPSE
********************************************************************************/

BLEX_TEST_FUNCTION(DrObjTest_Ellipse)
{
        DrawLib::Bitmap32 mybitmap(400,400,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        //do the drawing
        drobj.DrawEllipse(DrawLib::FPPoint(200,200),DrawLib::FPSize(100.5,100.5));
        drobj.DrawEllipse(DrawLib::FPPoint(0,0), DrawLib::FPSize(50.5,50.5));
        drobj.SetOutlineWidth(4.0);
        drobj.DrawEllipseOutline(DrawLib::FPPoint(400,400), DrawLib::FPSize(50.5,50.5));
        drobj.SetOutlineWidth(0.2);
        drobj.DrawEllipseOutline(DrawLib::FPPoint(200,200), DrawLib::FPSize(110.5,110.5));

BLEX_TEST_CHECK(DoCompare ("ref-drobj_ellipse.png", mybitmap, true));
}
