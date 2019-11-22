#include <drawlib/drawlibv2/allincludes.h>



#include "helperfuncs.h"
#include <drawlib/drawlibv2/drawobject.h>

BLEX_TEST_FUNCTION(AreaProtectionTest)
{
        DrawLib::Bitmap32 physical(100,100,DrawLib::Pixel32(0,0,0,255));
        DrawLib::ProtectedBitmap32 protmap(physical);
        DrawLib::Canvas32 mycanvas(&protmap);
        DrawLib::DrawObject drobj(&mycanvas);

        protmap.ProtectArea (DrawLib::IRect(10,10,20,20));
        drobj.SetFillColor(DrawLib::Pixel32(255,0,0,255));
        drobj.DrawRectangle (DrawLib::FPPoint(0,0), DrawLib::FPPoint(100,100));

        protmap.ProtectArea (DrawLib::IRect(10,10,90,90));
        drobj.SetFillColor(DrawLib::Pixel32(0,0,255,255));
        drobj.DrawRectangle (DrawLib::FPPoint(0,0), DrawLib::FPPoint(99,99));

        protmap.UnProtectArea (DrawLib::IRect(50,50,60,60));
        protmap.ProtectArea (DrawLib::IRect(0, 0,10,99));
        drobj.SetFillColor(DrawLib::Pixel32(0,255,0,255));
        drobj.DrawRectangle (DrawLib::FPPoint(0,0), DrawLib::FPPoint(99,99));

        BLEX_TEST_CHECK(DoCompare ("ref-prot_rect.png", protmap, true));
}

BLEX_TEST_FUNCTION(BitmapProtectionTest)
{
        DrawLib::Bitmap32 physical(100,100,DrawLib::Pixel32(0,0,0,255));
        DrawLib::ProtectedBitmap32 protmap(physical);
        DrawLib::Canvas32 mycanvas(&protmap);
        DrawLib::DrawObject drobj(&mycanvas);

        protmap.ProtectBitmap ();
        drobj.SetFillColor(DrawLib::Pixel32(255,0,0,255));
        drobj.DrawRectangle (DrawLib::FPPoint(0,0), DrawLib::FPPoint(100,100));

        protmap.UnProtectBitmap ();
        drobj.SetFillColor(DrawLib::Pixel32(0,0,255,255));
        drobj.DrawRectangle (DrawLib::FPPoint(50,0), DrawLib::FPPoint(100,100));

        BLEX_TEST_CHECK(DoCompare ("ref-prot_rect_2.png", protmap, true));
}

BLEX_TEST_FUNCTION(RegionProtectionTest)
{
        DrawLib::Bitmap32 physical(100,100,DrawLib::Pixel32(0,0,0,255));
        DrawLib::ProtectedBitmap32 protmap(physical);
        DrawLib::Canvas32 mycanvas(&protmap);
        DrawLib::DrawObject drobj(&mycanvas);
        DrawLib::Region region(100,100,true);

        region.SetProtectedArea(DrawLib::IRect(10,10,20,20), true);
        protmap.SetAreaProtection(region);
        drobj.SetFillColor(DrawLib::Pixel32(255,0,0,255)); //RED
        drobj.DrawRectangle (DrawLib::FPPoint(0,0), DrawLib::FPPoint(100,100));

        region.SetProtectedArea(DrawLib::IRect(10,10,90,90), true);
        protmap.SetAreaProtection(region);

        drobj.SetFillColor(DrawLib::Pixel32(0,0,255,255)); //BLUE
        drobj.DrawRectangle (DrawLib::FPPoint(0,0), DrawLib::FPPoint(99,99));

        region.SetProtectedArea(DrawLib::IRect(50,50,60,60), false);
        region.SetProtectedArea(DrawLib::IRect(0, 0,10,99) , true);
        protmap.SetAreaProtection(region);

        drobj.SetFillColor(DrawLib::Pixel32(0,255,0,255)); //GREEN
        drobj.DrawRectangle (DrawLib::FPPoint(0,0), DrawLib::FPPoint(99,99));

        BLEX_TEST_CHECK(DoCompare ("ref-prot_rect.png", protmap, true));
}

BLEX_TEST_FUNCTION(RegionProtectionTest2)
{
        DrawLib::Bitmap32 physical(100,100,DrawLib::Pixel32(0,0,0,255));
        DrawLib::ProtectedBitmap32 protmap(physical);
        DrawLib::Canvas32 mycanvas(&protmap);
        DrawLib::DrawObject drobj(&mycanvas);
        DrawLib::Region region(100,100,true);

        region.SetProtectedArea(DrawLib::IRect(10,10,90,90), true);
        region.AndProtectedArea(DrawLib::IRect(10,10,20,20));
        protmap.SetAreaProtection(region);
        drobj.SetFillColor(DrawLib::Pixel32(255,0,0,255));
        drobj.DrawRectangle (DrawLib::FPPoint(0,0), DrawLib::FPPoint(100,100));

        region.SetProtectedArea(DrawLib::IRect(0,0,99,99), false);
        region.SetProtectedArea(DrawLib::IRect(10,10,20,20), true);
        region.SetProtectedArea(DrawLib::IRect(15,15,25,25), true);
        protmap.SetAreaProtection(region);

        drobj.SetFillColor(DrawLib::Pixel32(0,0,255,255));
        drobj.DrawRectangle (DrawLib::FPPoint(0,0), DrawLib::FPPoint(50,50));

        BLEX_TEST_CHECK(DoCompare ("ref-prot_rect_3.png", protmap, true));
}
