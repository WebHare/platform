#ifndef helperfuncs_test_h
#define helperfuncs_test_h

#include <blex/testing.h>
#include <blex/path.h>
#include <drawlib/drawlibv2/bitmap.h>

namespace BitmapChecker
{
        bool IsEmpty(DrawLib::Bitmap32 & bitmap);

}

DrawLib::Bitmap32 * LoadReferenceBitmap(std::string filename);

bool                DoCompare(std::string filename , const DrawLib::Bitmap32 & bitmap,
                        bool generate_on_error);

/** DoErrorCompare - compares two bitmaps by measuring the meansquared error of the pixels.
    when the error is larger than max_error, the function returns false, else it returns true.
    @param filename - filename of the reference bitmap.
    @param bitmap   - reference to the other bitmap.
    @param max_error - maximum meansquared error
    @param generate_on_error - when true: if there is an error, write the bitmap to file for visual inspection
    @returns true if error <= max_error */

bool DoErrorCompare(std::string filename, const DrawLib::Bitmap32  & bitmap,
        double max_error, bool generate_on_error);

#endif
