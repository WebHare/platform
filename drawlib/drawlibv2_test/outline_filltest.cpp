#include <drawlib/drawlibv2/allincludes.h>

#include "helperfuncs.h"
#include <drawlib/drawlibv2/drawobject.h>

BLEX_TEST_FUNCTION(FillerBugTest)
{
        //make a bitmap!
        DrawLib::Bitmap32 mybitmap(300,150,DrawLib::Pixel32(0,0,0,255));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        drobj.SetOutlineWidth(5.0);
        drobj.SetFillColor   (DrawLib::Pixel32(0xFF,0,0,0xFF));
        drobj.SetOutlineColor(DrawLib::Pixel32(0xFF,0xFF,0,0xFF));

        DrawLib::Path mypath;
        mypath.MoveTo(DrawLib::FPPoint(0,0));
        mypath.LineTo(DrawLib::FPPoint(100,100));
        mypath.LineTo(DrawLib::FPPoint(20,100));
        mypath.ClosePath();

        drobj.StrokeFillPath(mypath, true, false);

        mypath.SetTransform(DrawLib::XForm2D(1,0,0,1, DrawLib::FPPoint(150,0)));
        drobj.StrokeFillPath(mypath, true, false);

        BLEX_TEST_CHECK( DoCompare("ref-fillerbug.png", mybitmap, true));
}
