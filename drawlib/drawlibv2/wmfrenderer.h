#ifndef blex_drawlib_wmfrenderer
#define blex_drawlib_wmfrenderer

#ifndef blex_drawlib_bitmap
#include "bitmap.h"
#endif

namespace DrawLib
{
        /** @short Render WMF/EMF file
            @param ultimate_translation The ultimate translation to do, which is NOT seen by the EMF/WMF rendering code and mappings as device properties */
        void BLEXLIB_PUBLIC RenderWmfEmf(DrawLib::Bitmap32 &drawinfo, DrawLib::FPBoundingBox const &outputbox, const void *dataptr, unsigned long datalength, DrawLib::XForm2D const &ultimate_translation);
        ///ADDME: documentation
        void BLEXLIB_PUBLIC RenderPict(DrawLib::Bitmap32 &bitmap, DrawLib::FPBoundingBox const &outputbox, const void *dataptr, unsigned long datalength);
}

#endif
