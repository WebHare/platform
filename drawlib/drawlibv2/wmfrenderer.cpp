#include <drawlib/drawlibv2/allincludes.h>


#include "wmfrenderer.h"
#include "wmf_wmfconvert.h"
#include "pictlib.h"

namespace DrawLib
{

void RenderWmfEmf(DrawLib::Bitmap32 &bitmap, DrawLib::FPBoundingBox const &outputbox, void const *dataptr, unsigned long datalength, DrawLib::XForm2D const &ultimate_translation)
{
        WmfLib::WmfConvert converter;
        converter.ultimate_translation = ultimate_translation;
        converter.Go(static_cast<uint8_t const*>(dataptr), datalength, bitmap, outputbox);
}

void RenderPict(DrawLib::Bitmap32 &bitmap, DrawLib::FPBoundingBox const &outputbox, void const *dataptr, unsigned long datalength)
{
        PictLib::PictConvert converter;

        converter.Go(static_cast<uint8_t const*>(dataptr), datalength, bitmap, outputbox);
}

}
