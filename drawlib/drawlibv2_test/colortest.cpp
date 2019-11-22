#include <drawlib/drawlibv2/allincludes.h>



#include "helperfuncs.h"
#include <blex/path.h>
#include <blex/testing.h>

BLEX_TEST_FUNCTION(HSVTest)
{
        double h,s,v;
        DrawLib::Pixel32 convertedcolor;

        // Test white
        DrawLib::Pixel32 rgbcolor(0xff, 0xff, 0xff);
        RGBtoHSV(rgbcolor, &h, &s, &v);
                BLEX_TEST_CHECK(std::fabs(0) < 0.0001);
        BLEX_TEST_CHECKEQUAL(1,v);
        // And convert it back
        HSVtoRGB(h, s, v, &convertedcolor);
        BLEX_TEST_CHECKEQUAL(rgbcolor, convertedcolor);


        // Test black
        rgbcolor = DrawLib::Pixel32(0x00, 0x00, 0x00);
        RGBtoHSV(rgbcolor, &h, &s, &v);
        BLEX_TEST_CHECKEQUAL(0,s);
        BLEX_TEST_CHECKEQUAL(0,v);
        // And convert it back
        HSVtoRGB(h, s, v, &convertedcolor);
        BLEX_TEST_CHECKEQUAL(rgbcolor, convertedcolor);
        // Test grey
        rgbcolor = DrawLib::Pixel32(0x80, 0x80, 0x80);
        RGBtoHSV(rgbcolor, &h, &s, &v);
        BLEX_TEST_CHECKEQUAL(0,s);
        BLEX_TEST_CHECK(std::fabs(v - 0.5) < 0.01);
        // And convert it back
        HSVtoRGB(h, s, v, &convertedcolor);
        BLEX_TEST_CHECKEQUAL(rgbcolor, convertedcolor);

        // Test red
        rgbcolor = DrawLib::Pixel32(0xf, 0x00, 0x00);
        RGBtoHSV(rgbcolor, &h, &s, &v);
        BLEX_TEST_CHECKEQUAL(0,h);
        BLEX_TEST_CHECKEQUAL(1,s);
        BLEX_TEST_CHECK(std::fabs(v - 0.059) < 0.005);
        // And convert it back
        HSVtoRGB(h, s, v, &convertedcolor);
        BLEX_TEST_CHECKEQUAL(rgbcolor, convertedcolor);

        // Test green
        rgbcolor = DrawLib::Pixel32(0x00, 0xff, 0x00);
        RGBtoHSV(rgbcolor, &h, &s, &v);
        BLEX_TEST_CHECKEQUAL(120,h);
        BLEX_TEST_CHECKEQUAL(1,s);
        BLEX_TEST_CHECKEQUAL(1,v);
        // And convert it back
        HSVtoRGB(h, s, v, &convertedcolor);
        BLEX_TEST_CHECKEQUAL(rgbcolor, convertedcolor);

        // Test blue
        rgbcolor = DrawLib::Pixel32(0x00, 0x00, 0xff);
        RGBtoHSV(rgbcolor, &h, &s, &v);
        BLEX_TEST_CHECKEQUAL(240,h);
        BLEX_TEST_CHECKEQUAL(1,s);
        BLEX_TEST_CHECKEQUAL(1,v);
        // And convert it back
        HSVtoRGB(h, s, v, &convertedcolor);
        BLEX_TEST_CHECKEQUAL(rgbcolor, convertedcolor);
}

