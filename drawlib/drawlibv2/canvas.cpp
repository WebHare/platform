#include <drawlib/drawlibv2/allincludes.h>


//ADDME: allincludes.h for 'ap' and 'drawlib' are identical, why not merge them ?

#include "canvas.h"
//local
//#include <blex/filestream.h>

namespace DrawLib {

//namespace PixelOps {
//ADDME: test whether assembly or a variant returning 32-bit values instead
//       of pointerops is faster! (or whether even canvas shouldn't copy first
//                                 but let us do your job)



inline Pixel32 BLEND255Alpha(Pixel32 const &newpixel, Pixel32 const &oldpixel)
{
        uint8_t alpha_front = newpixel.GetA();
        uint8_t alpha_back = oldpixel.GetA();

        //Do we need full alpha-blend or can we just leave it?

        if (alpha_front == 0)
           return Pixel32(oldpixel);
        if (alpha_front == 255)
           return Pixel32(newpixel);

        unsigned alpha2 = ((255 - alpha_front) * alpha_back) / 255;
        unsigned newalpha = alpha2 + alpha_front;

        uint8_t r  = static_cast<uint8_t>((oldpixel.GetR() * alpha2 + newpixel.GetR() * alpha_front) / newalpha);
        uint8_t g  = static_cast<uint8_t>((oldpixel.GetG() * alpha2 + newpixel.GetG() * alpha_front) / newalpha);
        uint8_t b  = static_cast<uint8_t>((oldpixel.GetB() * alpha2 + newpixel.GetB() * alpha_front) / newalpha);
        return Pixel32(r, g, b, newalpha);
}
/* 'The Linear Burn mode sums the value in the two layers and subtracts 255.
    This is the same as inverting each layer, adding them together and then inverting the result. Blending with white leaves the image unchanged.'

    r/g/b to blend = (oldpixel + newpixel - 255) / newalpha
*/
inline uint8_t LINEARBURN_Op(uint8_t top, uint8_t bottom)
{
        return static_cast<uint8_t>(std::max(top + bottom  - 255, 0));
}
inline uint8_t LINEARDODGE_Op(uint8_t top, uint8_t bottom)
{
        return static_cast<uint8_t>(std::min(top + bottom, 255));
}
inline Pixel32 CUTOUTALPHAAlpha(Pixel32 const &newpixel, Pixel32 const &oldpixel)
{
        uint8_t newalpha = oldpixel.GetA() * (255 - newpixel.GetA()) / 255;
        return Pixel32::FromPixelValue((newalpha<<24) |(oldpixel.GetPixelValue() & 0x00FFFFFF));
}
inline uint8_t COLORBURN_Op(uint8_t top, uint8_t bottom)
{
        return top <= 0 ? 0 : std::max(255 - ((255 - bottom) * 255 / top), 0);
}
inline uint8_t COLORDODGE_Op(uint8_t top, uint8_t bottom)
{
        return top >= 255? 255 : std::min(bottom * 255 / (255 - top), 255);
}
inline uint8_t DARKEN_Op(uint8_t top, uint8_t bottom)
{
        return std::min(top,bottom);
}
inline uint8_t DIFFERENCE_Op(uint8_t top, uint8_t bottom)
{
        return top > bottom ? top-bottom : bottom-top;
}
inline uint8_t EXCLUSION_Op(uint8_t top, uint8_t bottom)
{
        return 255 - ( ( ( 255 - bottom ) * ( 255 - top ) / 255 ) + ( bottom * top / 255 ) );
}
inline uint8_t HARDLIGHT_Op(uint8_t top, uint8_t bottom)
{
        return top < 128 ? ( 2 * bottom * top ) / 255 : 255 - ( ( 2 * ( 255 - bottom ) * ( 255 - top ) ) / 255 );
}
inline uint8_t LIGHTEN_Op(uint8_t top, uint8_t bottom)
{
        return std::max(top,bottom);
}
inline uint8_t MULTIPLY_Op(uint8_t top, uint8_t bottom)
{
        return (bottom * top)/255;
}
inline uint8_t OVERLAY_Op(uint8_t top, uint8_t bottom)
{
        return bottom < 128 ? ( 2 * bottom * top ) / 255 : 255 - ( 2 * ( 255 - bottom ) * ( 255 - top ) / 255 );
}
inline uint8_t SCREEN_Op(uint8_t top, uint8_t bottom)
{
        return 255 - ( ( 255 - bottom ) * ( 255 - top ) ) / 255;
}

inline Pixel32 DIFFERENCEALLAlpha(Pixel32 const &newpixel, Pixel32 const &oldpixel)
{
        uint8_t a = newpixel.GetA() > oldpixel.GetA() ? newpixel.GetA()-oldpixel.GetA() : oldpixel.GetA() - newpixel.GetA();
        uint8_t r = newpixel.GetR() > oldpixel.GetR() ? newpixel.GetR()-oldpixel.GetR() : oldpixel.GetR() - newpixel.GetR();
        uint8_t g = newpixel.GetG() > oldpixel.GetG() ? newpixel.GetG()-oldpixel.GetG() : oldpixel.GetG() - newpixel.GetG();
        uint8_t b = newpixel.GetB() > oldpixel.GetB() ? newpixel.GetB()-oldpixel.GetB() : oldpixel.GetB() - newpixel.GetB();

        return Pixel32(r,g,b,a);
}
inline Pixel32 COPYALPHAAlpha(Pixel32 const &newpixel, const Pixel32 &oldpixel)
{
        return Pixel32::FromPixelValue((newpixel.GetPixelValue() & 0xFF000000)
                       |(oldpixel.GetPixelValue() & 0x00FFFFFF));
}
inline Pixel32 MINALPHAAlpha(Pixel32 const &newpixel, const Pixel32 &oldpixel)
{
        return Pixel32::FromPixelValue( std::min(oldpixel.GetPixelValue() & 0xFF000000, newpixel.GetPixelValue() & 0xFF000000)
                       |(oldpixel.GetPixelValue() & 0x00FFFFFF));
}
inline Pixel32 MAXALPHAAlpha(Pixel32 const &newpixel, const Pixel32 &oldpixel)
{
        return Pixel32::FromPixelValue( std::max(oldpixel.GetPixelValue() & 0xFF000000, newpixel.GetPixelValue() & 0xFF000000)
                       |(oldpixel.GetPixelValue() & 0x00FFFFFF));
}
inline Pixel32 COPYALLAlpha(Pixel32 const &newpixel, const Pixel32 &)
{
        return newpixel;
}
inline Pixel32 DefaultPixel(Pixel32 const &newpixel, const Pixel32&)
{
        return newpixel;
}
inline Pixel32 ANDPixel(Pixel32 const &newpixel, const Pixel32 &oldpixel)
{
        return Pixel32::FromPixelValue( ((newpixel.GetPixelValue() & oldpixel.GetPixelValue()) & 0x00FFFFFF)
                         | newpixel.GetA());
}
inline Pixel32 ORPixel(Pixel32 const &newpixel, const Pixel32 &oldpixel)
{
        return Pixel32::FromPixelValue( ((newpixel.GetPixelValue() | oldpixel.GetPixelValue()) & 0x00FFFFFF)
                         | newpixel.GetA());
}
inline Pixel32 XORPixel(Pixel32 const &newpixel, const Pixel32 &oldpixel)
{
        return Pixel32::FromPixelValue( ((newpixel.GetPixelValue() ^ oldpixel.GetPixelValue()) & 0x00FFFFFF)
                         | newpixel.GetA());
}
inline Pixel32 NOPPixel(Pixel32 const &newpixel, const Pixel32 &oldpixel)
{
        return Pixel32::FromPixelValue( ((oldpixel.GetPixelValue()) & 0x00FFFFFF)
                         | newpixel.GetA());
}

//ADDME: Could a template version be just as efficient ?

#define PIXEL_OPERATOR(pixelop, blendop)                                                   \
void Op_ ## pixelop ## _ ## blendop(Scanline32 *dest, const Scanline32 &to_apply) \
{                                                                                          \
        unsigned width = dest->GetWidth();                                                 \
        for(unsigned x=0; x<width; x++)                                                    \
        {                                                                                  \
                Pixel32 newpixel = to_apply.Pixel(x);                                      \
                Pixel32 oldpixel = dest->Pixel(x);                                         \
                dest->Pixel(x) = blendop##Alpha(                                           \
                                       pixelop##Pixel(newpixel, oldpixel),                 \
                                    oldpixel);                                             \
        }                                                                                  \
}

#define PIXEL_OPERATOR_BLEND(pixelop, blendop)                                             \
void Op_ ## pixelop ## _ ## blendop(Scanline32 *dest, const Scanline32 &to_apply) \
{                                                                                          \
        unsigned width = dest->GetWidth();                                                 \
        for(unsigned x=0; x<width; x++)                                                    \
        {                                                                                  \
                Pixel32 newpixel = to_apply.Pixel(x);                                      \
                Pixel32 oldpixel = dest->Pixel(x);                                         \
                newpixel = pixelop##Pixel(newpixel, oldpixel);                             \
                if(oldpixel.GetA() != 0)                                                   \
                  newpixel = Pixel32(blendop ## _Op(newpixel.GetR(), oldpixel.GetR())      \
                                    ,blendop ## _Op(newpixel.GetG(), oldpixel.GetG())      \
                                    ,blendop ## _Op(newpixel.GetB(), oldpixel.GetB())      \
                                    ,newpixel.GetA());                                     \
                dest->Pixel(x) = BLEND255Alpha(newpixel, oldpixel);                        \
        }                                                                                  \
}

#define ALPHA_OPERATOR(x) \
    PIXEL_OPERATOR(Default, x) \
    PIXEL_OPERATOR(AND, x) \
    PIXEL_OPERATOR(OR, x) \
    PIXEL_OPERATOR(XOR, x) \
    PIXEL_OPERATOR(NOP, x)

#define BLEND_OPERATOR(x) \
    PIXEL_OPERATOR_BLEND(Default, x) \
    PIXEL_OPERATOR_BLEND(AND, x) \
    PIXEL_OPERATOR_BLEND(OR, x) \
    PIXEL_OPERATOR_BLEND(XOR, x) \
    PIXEL_OPERATOR_BLEND(NOP, x)


Canvas32::Canvas32(Bitmap32 *mybitmap)
: bitmap(mybitmap)
, scratch(mybitmap ? mybitmap->GetWidth() : 1,false)
, alpha_operation_state(BLEND255)
, pixel_operation_state(DEFAULT)
{
        scanline_op = GetScanlineOp(DEFAULT,BLEND255);
        if (mybitmap==NULL)
                throw std::runtime_error("Tried to create Canvas32 with NULL-bitmap");

        #ifdef DEBUG
        #ifdef DEBUGINFO

        std::cerr << "Canvas32 constructor (" <<bitmap.GetWidth() << "," << bitmap.GetHeight() << ")\n";
        #endif
        #endif

}

Canvas32::~Canvas32()
{
}

Bitmap32* Canvas32::Exchange(Bitmap32*to_swap)
{
        if (to_swap==NULL)
                throw(std::runtime_error("Canvas32::Exchange used with NULL-bitmap"));

        std::swap(to_swap, bitmap);
        return to_swap;
}

void Canvas32::SetScanline32(uint32_t line, const Scanline32 *scanline)
{
        //the caller should make sure the scanlinewidth equals
        //assert(scanline->GetWidth()==bitmap->GetWidth());
        //assert(line                < bitmap->GetHeight());

        //bail if stuff isn't what it needs to be..
        if (line>=bitmap->GetHeight())
                throw(std::runtime_error("Canvas32::SetScanline32 out-of-bounds 'line'"));

        if (scanline->GetWidth()!=bitmap->GetWidth())
                throw(std::runtime_error("Canvas32::SetScanline32 scanline width not equal to bitmap width"));


        //copy scanline (ADDME: without the mask operator or through some other clever technique perhaps we can learn to directly apply scanlines to the image buffers?)
        scratch = bitmap->GetScanline32(line);
        (*scanline_op)(&scratch, *scanline);
        memcpy(scratch.GetRawMask(), scanline->GetRawMask(), (scanline->GetWidth()+7)/8); //apply mask
        bitmap->SetScanline32(line, scratch);
}

Scanline32 Canvas32::GetScanline32(uint32_t line) const
{
        //the caller should make sure the scanlinewidth equals
        //assert(scanline->GetWidth()==bitmap->GetWidth());
        //assert(line                < bitmap->GetHeight());

        //bail if stuff isn't what it needs to be..
        if (line>=bitmap->GetHeight())
                throw(std::runtime_error("Canvas32::GetScanline32 out-of-bounds 'line'"));

        // return the scanline
        return bitmap->GetScanline32(line);
}



void Canvas32::SetAlphaMode(AlphaOperationMode mode)
{
        alpha_operation_state = mode;
        scanline_op = GetScanlineOp(pixel_operation_state, alpha_operation_state);
}

Canvas32::AlphaOperationMode Canvas32::GetAlphaMode() const
{
        return alpha_operation_state;
}

void Canvas32::SetBinaryMode(PixelOperationMode mode)
{
        pixel_operation_state = mode;
        scanline_op = GetScanlineOp(pixel_operation_state, alpha_operation_state);
}

Canvas32::PixelOperationMode Canvas32::GetBinaryMode() const
{
        return pixel_operation_state;
}

ALPHA_OPERATOR(BLEND255) //Blend
ALPHA_OPERATOR(COPYALPHA)
ALPHA_OPERATOR(COPYALL)
ALPHA_OPERATOR(MINALPHA)
ALPHA_OPERATOR(MAXALPHA)
ALPHA_OPERATOR(CUTOUTALPHA)
ALPHA_OPERATOR(DIFFERENCEALL)

BLEND_OPERATOR(COLORBURN)
BLEND_OPERATOR(COLORDODGE)
BLEND_OPERATOR(DARKEN)
BLEND_OPERATOR(DIFFERENCE)
BLEND_OPERATOR(EXCLUSION)
BLEND_OPERATOR(HARDLIGHT)
BLEND_OPERATOR(LIGHTEN)
BLEND_OPERATOR(LINEARBURN)
BLEND_OPERATOR(LINEARDODGE)
BLEND_OPERATOR(MULTIPLY)
BLEND_OPERATOR(OVERLAY)
BLEND_OPERATOR(SCREEN)


#define SWITCH_ALPHA_OPERATOR(x) \
    if(pixelop == DEFAULT && alphaop == x) return &Op_Default_ ## x;   \
    if(pixelop == AND && alphaop == x) return &Op_AND_ ## x;           \
    if(pixelop == OR && alphaop == x) return &Op_OR_ ## x;             \
    if(pixelop == XOR && alphaop == x) return &Op_XOR_ ## x;           \
    if(pixelop == NOP && alphaop == x) return &Op_NOP_ ## x;

#define SWITCH_BLEND_OPERATOR(x) \
    if(pixelop == DEFAULT && alphaop == x) return &Op_Default_ ## x;   \
    if(pixelop == AND && alphaop == x) return &Op_AND_ ## x;           \
    if(pixelop == OR && alphaop == x) return &Op_OR_ ## x;             \
    if(pixelop == XOR && alphaop == x) return &Op_XOR_ ## x;           \
    if(pixelop == NOP && alphaop == x) return &Op_NOP_ ## x;

Canvas32::ScanlineOperator Canvas32::GetScanlineOp(PixelOperationMode pixelop, AlphaOperationMode alphaop)
{
        SWITCH_ALPHA_OPERATOR(BLEND255) //Blend
        SWITCH_ALPHA_OPERATOR(COPYALPHA)
        SWITCH_ALPHA_OPERATOR(COPYALL)
        SWITCH_ALPHA_OPERATOR(MINALPHA)
        SWITCH_ALPHA_OPERATOR(MAXALPHA)
        SWITCH_ALPHA_OPERATOR(CUTOUTALPHA)
        SWITCH_ALPHA_OPERATOR(DIFFERENCEALL)

        SWITCH_BLEND_OPERATOR(COLORBURN)
        SWITCH_BLEND_OPERATOR(COLORDODGE)
        SWITCH_BLEND_OPERATOR(DARKEN)
        SWITCH_BLEND_OPERATOR(DIFFERENCE)
        SWITCH_BLEND_OPERATOR(EXCLUSION)
        SWITCH_BLEND_OPERATOR(HARDLIGHT)
        SWITCH_BLEND_OPERATOR(LIGHTEN)
        SWITCH_BLEND_OPERATOR(LINEARBURN)
        SWITCH_BLEND_OPERATOR(LINEARDODGE)
        SWITCH_BLEND_OPERATOR(MULTIPLY)
        SWITCH_BLEND_OPERATOR(OVERLAY)
        SWITCH_BLEND_OPERATOR(SCREEN)

        throw std::runtime_error("Impossible scanline operator mix");
}

}      //end namespace DrawLib
