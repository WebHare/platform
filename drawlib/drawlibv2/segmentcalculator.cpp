#include <drawlib/drawlibv2/allincludes.h>


#include <cmath>
#include "segmentcalculator.h"
using namespace DrawLib;


uint32_t DrawLib::GetNumberOfSegments(double xradius, double yradius)
{
        //The Circumference of an ellipse can only be approximated. This one has an error of +11%
        //http://home.att.net/~numericana/answer/ellipse.htm

        //This is a bit less than half the circumference of the ellipse, gives good results.
        uint32_t guess_segments = 2 * (sqrt(xradius * xradius + yradius * yradius));

        // Keep the number of segmets sane (or is this too small?)
        if (guess_segments > 1024)
            return 1024;
        // Make the number of segments dividable by 4:
        if (guess_segments > 4)
            return ((guess_segments + 3) / 4) * 4;

        //give the circle at least 4 points
        return 4;
}



