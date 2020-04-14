#include <drawlib/drawlibv2/allincludes.h>


#include "bitmap.h"

namespace DrawLib
{

inline Blex::Bitmap CalcMaskFromPixelPtr(Pixel32 *pixelptr, unsigned width)
{
        return reinterpret_cast<Blex::Bitmap>(pixelptr + width);
}

inline unsigned CalcMaskSize(unsigned width)
{
        return Blex::BitmapRequiredSize(width) * sizeof(Pixel32);
}
inline unsigned CalcScanlineSize(unsigned width)
{
        return width * sizeof(Pixel32) + CalcMaskSize(width);
}
Bitmap32::Bitmap32(unsigned _width, unsigned _height, DrawLib::Pixel32 bgcolor)
: width(_width)
, height(_height)
{
        if (width==0 || height==0)
            throw std::runtime_error("Bitmap constructor called with zero width or height");

        pixman_color fillcolor = bgcolor.GetPixmanPixel();

        // see if the bitmap isn't too big!
        // we must avoid overflow.. so prescale the width and height!
        ValidateDimensions(_width, _height);
        img = pixman_image_create_bits_no_clear(PIXMAN_a8b8g8r8, GetWidth(), GetHeight(), NULL, 0);
        if(!img)
                throw std::bad_alloc();

        pixman_image_t* solid = pixman_image_create_solid_fill (&fillcolor);
        if(!solid)
        {
                pixman_image_unref(img);
                throw std::bad_alloc();
        }
        pixman_image_composite32(PIXMAN_OP_SRC, solid, NULL, img, 0, 0, 0, 0, 0, 0, GetWidth(), GetHeight());
        pixman_image_unref(solid);
}

Bitmap32::Bitmap32(Bitmap32 const &src)
: width(src.GetWidth())
, height(src.GetHeight())
{
        img = pixman_image_create_bits_no_clear(PIXMAN_a8b8g8r8, GetWidth(), GetHeight(), NULL, 0);
        if(!img)
                throw std::bad_alloc();

        pixman_image_composite32(PIXMAN_OP_SRC, src.img, NULL, img, 0, 0, 0, 0, 0, 0, GetWidth(), GetHeight());
}

Bitmap32::~Bitmap32()
{
        pixman_image_unref(img);
}
void Bitmap32::SetScanline32(unsigned line, Scanline32 const &scanline)
{
        SetPixelsWithMask(line, scanline.GetRawPixels(), scanline.GetRawMask());
}
void Bitmap32::SetPixelsWithMask(unsigned line, Pixel32 const *sourcepixels, Blex::ConstBitmap mask)
{
        //the caller should make sure the scanline width is equal.
        //assert(scanline->GetWidth()==GetWidth());
        //assert(line                <GetHeight());

        //bail if stuff isn't what it needs to be..
        if (line>=GetHeight())
                throw(std::runtime_error("Bitmap32::SetScanline32Ptr out-of-bounds 'line'"));

        /* Since DRAW and NODRAW pixels generally stick together (eg, we might
           have 40 nodraw pixels, 60 draw pixels, then 20 nodraw pixelx) we try
           to do the 'copy' operations in chunks

           FIXME: Now very inefficient... use the fact that we can process 32 pixels at a time?*/

        const Pixel32 *source = sourcepixels;
        Pixel32 *destination = reinterpret_cast<Pixel32*>(pixman_image_get_data(img) + (pixman_image_get_stride(img)/4) * line); //divide by 4, we're adding to a uint32_t!
        unsigned mask_ptr = 0;
        unsigned mask_end = GetWidth();

        while (mask_ptr != mask_end)
        {
                bool draw = Blex::GetBit(mask, mask_ptr);
                unsigned range_start = mask_ptr;

                //What range has the same 'DRAW' setting?  set mask_ptr to the end of the draw or nodraw range
                if (draw)
                {
                        while (mask_ptr != mask_end && Blex::GetBit(mask, mask_ptr) == true)
                            ++mask_ptr;
                }
                else
                {
                        while (mask_ptr != mask_end && Blex::GetBit(mask, mask_ptr) == false)
                            ++mask_ptr;
                }

                //Can we do a raw copy?
                unsigned range_size = mask_ptr - range_start;
                if (draw)
                    memcpy(destination, source, range_size * sizeof(*source));

                source += range_size;
                destination += range_size;
        }
}

Scanline32 Bitmap32::GetScanline32(unsigned line) const
{
        // Check for the correct height!
        //assert(line<GetHeight());
        if (line>=GetHeight())
                throw(std::runtime_error("Bitmap32::GetScanline32 out-of-bounds 'line'"));
        return Scanline32(img, line, GetWidth());
}


bool IsScanlineEmpty(Pixel32 const* pixelarray, unsigned width)
{
        for(;width > 0; --width, ++pixelarray)
          if(pixelarray->GetA() != 0) //not fully transparent
            return false;

        return true;
}

unsigned GetFirstPaintedPixel(Pixel32 const* pixelarray, unsigned limitx)
{
        for(unsigned pos = 0; pos < limitx; ++pos, ++pixelarray)
          if(pixelarray->GetA() != 0) //not fully transparent
             return pos;

        return limitx;
}

unsigned GetLimitPaintedPixel(Pixel32 const* pixelarray, unsigned startx, unsigned width)
{
        pixelarray += width - 1; //point at last pixel

        //we need to scan pixels [startx .. width-1] and find the first non-transparent one
        for(unsigned pos = width - 1; pos >= startx; --pos, --pixelarray)
          if(pixelarray->GetA() != 0) //not fully transparent
             return pos + 1;//we return the painted limit, so +1

        return startx;
}

IRect Bitmap32::GetPaintedRectangle() const
{
        unsigned firsty=0, limity = height;
        //find first painted line
        while(firsty < height && IsScanlineEmpty(GetRawPixels(firsty), width))
            ++firsty;

        if(firsty == height) //the canvas is empty
            return IRect();

        //find limit painted line. note that firsty is always >= 0, so limity >= 1, so this is all within bounds;
        while(limity > firsty && IsScanlineEmpty(GetRawPixels(limity - 1), width))
            --limity;

        //we now need to figure out the first and last painted x.. and we'll need to test all lines [firsty,limity[
        unsigned firstx = width, limitx = 0;
        for(unsigned line = firsty; line < limity; ++line)
        {
                Pixel32 const *row = GetRawPixels(line);
                if(firstx > 0) //the leftside boundary can still be extended
                    firstx = GetFirstPaintedPixel(row, firstx);
                if(limitx < width) //the rightside boundary can still be extended
                    limitx = GetLimitPaintedPixel(row, limitx, width);
        }

        return IRect(firstx, firsty, limitx, limity);
}

//ADDME: Drop our separate ProtectArea etc functions, just allow users to interface with the embedded Region...
ProtectedBitmap32::ProtectedBitmap32(Bitmap32 &basebitmap)
: Bitmap32(basebitmap.GetWidth(), basebitmap.GetHeight())
, basebitmap(basebitmap)
, region(GetWidth(), GetHeight(), true)
, scratchpad(new Blex::BitmapType[ Blex::BitmapRequiredSize(GetWidth()) ])
{
}

ProtectedBitmap32::~ProtectedBitmap32()
{
}

Scanline32 ProtectedBitmap32::GetScanline32(unsigned line) const
{
        return basebitmap.GetScanline32(line);
}
void ProtectedBitmap32::SetPixelsWithMask(unsigned line, Pixel32 const *sourcepixels, Blex::ConstBitmap mask)
{
        //bail if stuff isn't what it needs to be..
        if (line>=GetHeight())
                throw(std::runtime_error("Bitmap32::SetScanline32Ptr out-of-bounds 'line'"));

        unsigned numwords = Blex::BitmapRequiredSize(GetWidth());

        //Copy specified drawing mask AND-ed with protection mask into the scratchpad..
        Blex::Bitmap row = region.GetRow(line);
        for (unsigned i=0;i<numwords;++i)
            scratchpad[i] = mask[i] & row[i];

        //Paint the scanline with our new mask
        basebitmap.SetPixelsWithMask(line, sourcepixels, &scratchpad[0]);
}

void ProtectedBitmap32::ProtectArea   (IRect area)
{
        region.SetProtectedArea(area,true);
}
void ProtectedBitmap32::UnProtectArea (IRect area)
{
        region.SetProtectedArea(area,false);
}
void ProtectedBitmap32::ProtectBitmap()
{
        region.SetProtectedArea(DrawLib::IRect(0,0,GetWidth(),GetHeight()), true);
}
void ProtectedBitmap32::UnProtectBitmap()
{
        region.SetProtectedArea(DrawLib::IRect(0,0,GetWidth(),GetHeight()), false);
}
void ProtectedBitmap32::SetAreaProtection(const Region &r)
{
        region=r;
}

Scanline32::Scanline32(unsigned width, bool draw, DrawLib::Pixel32 bgcolor)
: width(width)
, pixels(0)
, img(0)
, linenum(0)
{
        if (width==0)
                throw(std::runtime_error("Scanline32::Scanline32 width cannot be 0."));

        //We allocate a single array for both the pixels and the mask
        //We're allowed to do this, because Pixel32 is a POD
        uint8_t *pixel_mask_array = new uint8_t[CalcScanlineSize(width)];
        pixels = reinterpret_cast<Pixel32*>(pixel_mask_array);
        mask = CalcMaskFromPixelPtr(pixels,width);

        std::fill_n(pixels, width, bgcolor);
        memset(mask,draw ? ~Blex::BitmapType() : 0,CalcMaskSize(width));
}
Scanline32::Scanline32(pixman_image_t *img, unsigned linenum, unsigned width)
: width(width)
, pixels(0)
, img(img)
, linenum(linenum)
{
        uint8_t *pixel_mask_array = new uint8_t[CalcScanlineSize(width)]; //FIXME it's wasteful to allocate the entire line just for the pixels. but the 'mask' is a waste either way, and should be fully replaced with alpha
        pixels = reinterpret_cast<Pixel32*>(pixel_mask_array);
        mask = CalcMaskFromPixelPtr(pixels,width);
        memset(mask,~Blex::BitmapType(),CalcMaskSize(width));
}

Scanline32::Scanline32(Scanline32 const &src)
: width(src.width)
, pixels(0)
, img(src.img)
, linenum(src.linenum)
{
        //We allocate a single array for both the pixels and the mask
        //We're allowed to do this, because Pixel32 is a POD
        uint8_t *pixel_mask_array = new uint8_t[CalcScanlineSize(width)];
        pixels = reinterpret_cast<Pixel32*>(pixel_mask_array);
        mask = CalcMaskFromPixelPtr(pixels,width);

        //copy pixels
        memcpy(&pixels[0], src.GetRawPixels(), width * sizeof(Pixel32));
        //copy mask (no longer guaranteed to follow the rawpixels array)
        memcpy(mask, src.mask, CalcMaskSize(width));
}

Scanline32& Scanline32::operator= (Scanline32 const &src)
{
        //Use the swap trick, so we don't have to reimplement the allocation code
        Scanline32 newline(src);
        std::swap(*this,newline);
        return *this;
}

Scanline32::~Scanline32()
{
        delete[] reinterpret_cast<uint8_t*>(pixels);
}


void Scanline32::ExportScanline(uint8_t * rawdata) const
{
        //export as RGBA (ADDME: Select optimized implementation if alignment and byte-ordering matches)
        Pixel32 const *pixel = GetRawPixels();
        uint8_t *rawdata_end = rawdata + GetWidth()*4;
        while (rawdata!=rawdata_end)
        {
                Blex::putu32lsb(rawdata,pixel->GetPixelValue());
                rawdata += 4;
                ++pixel;
        }
}

void Scanline32::ImportScanline(uint8_t const * rawdata)
{
        if(img)
                throw std::runtime_error("A Scanline referring to an pixman image should be readonly");

        //import as RGBA (ADDME: Select optimized implementation if alignment and byte-ordering matches)
        Pixel32 *pixel = reinterpret_cast<Pixel32*>(pixels);
        uint8_t const *rawdata_end = rawdata + GetWidth()*4;
        while (rawdata!=rawdata_end)
        {
                pixel->SetPixelValue(Blex::getu32lsb(rawdata));
                rawdata+=4;
                ++pixel;
        }
        memset(mask,~Blex::BitmapType(),CalcMaskSize(width));
}

void Scanline32::CopyWithOffset(unsigned dest_offset, unsigned src_length, Scanline32 const &src)
{
        if(img)
                throw std::runtime_error("A Scanline referring to an pixman image should be readonly");

        // check if the destination offset index is smaller than the width.
        // if not.. return because there are no destination pixels to receive the
        // copy..
        dest_offset = std::min(dest_offset,width);
        src_length = std::min(width-dest_offset,src_length);
        if (src_length>0)
           memcpy(&pixels[dest_offset], src.GetRawPixels(), sizeof(Pixel32) * src_length);
}

void Scanline32::ConvertToFloat(float *outfloats) const
{
        unsigned int N = GetWidth();
        unsigned int o=0;
        Pixel32 const *mypixels = GetRawPixels();
        for(unsigned int i=0; i<N; i++)
        {
            uint32_t p = mypixels[i].GetPixelValue();
            outfloats[o++] = static_cast<float>(p & 0x0ff);
            p >>= 8;
            outfloats[o++] = static_cast<float>(p & 0x0ff);
            p >>= 8;
            outfloats[o++] = static_cast<float>(p & 0x0ff);
            p >>= 8;
            outfloats[o++] = static_cast<float>(p & 0x0ff);
        }
}

} //end namespace DrawLib
