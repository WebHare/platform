#include <drawlib/drawlibv2/allincludes.h>


#include <blex/utils.h>
#include <blex/logfile.h>
#include "bitmapmanip.h"
#include "bitmap.h"
#include "bitmapio.h"
#include "graphicsreadwrite.h"

namespace DrawLib
{

/** CreateCroppedBitmap - cut a part from a sourcebitmap. */
Bitmap32* CreateCroppedBitmap(const Bitmap32 &sourcebitmap, const IRect &rectangle)
{
        int maxwidth = static_cast<int>(sourcebitmap.GetWidth());
        int maxheight = static_cast<int>(sourcebitmap.GetHeight());
        // do the boundary checking!
        if ((rectangle.lower_right.x<0) || (rectangle.lower_right.x>maxwidth))
                throw(std::runtime_error("CreateCroppedBitmap called with bogus lower_right.x"));

        if ((rectangle.lower_right.y<0) || (rectangle.lower_right.y>maxheight))
                throw(std::runtime_error("CreateCroppedBitmap called with bogus lower_right.y"));

        if ((rectangle.upper_left.x<0) || (rectangle.upper_left.x>maxwidth))
                throw(std::runtime_error("CreateCroppedBitmap called with bogus upper_left.x"));

        if ((rectangle.upper_left.y<0) || (rectangle.upper_left.y>maxheight))
                throw(std::runtime_error("CreateCroppedBitmap called with bogus upper_left.y"));


        if (rectangle.upper_left.x == 0 && rectangle.upper_left.y == 0 &&
            rectangle.lower_right.x == maxwidth && rectangle.lower_right.y == maxheight)
        {
                // Full copy, just use the copy constructor
                return new Bitmap32(sourcebitmap);
        }

        // the rectangle is completely _in_ the source bitmap!
        unsigned int dx = abs(rectangle.lower_right.x - rectangle.upper_left.x);
        unsigned int dy = abs(rectangle.lower_right.y - rectangle.upper_left.y);
        Bitmap32 *newbitmap = new Bitmap32(dx,dy); //FIXME: exception-suspicious
        Scanline32 newscanline(dx,true);

        // copy bitmap!
        for(unsigned int y=0; y<dy; y++)
        {
                int ly = y+rectangle.upper_left.y;
                const Scanline32 &sourcescanline = sourcebitmap.GetScanline32(ly);
                // create a scanline for the new bitmap
                for(unsigned int x=0; x<dx; x++)
                {
                        int lx = x+rectangle.upper_left.x;
                        newscanline.Pixel(x) = sourcescanline.Pixel(lx);
                }
                newbitmap->SetScanline32(y,newscanline);
        }
        return newbitmap;
}

/** RedAlphaBitmap - translate alpha to red*/
Bitmap32* RedAlphaBitmap(const Bitmap32 &bitmap1)
{
        uint32_t width =  static_cast<int>(bitmap1.GetWidth());
        uint32_t height =  static_cast<int>(bitmap1.GetHeight());

        Bitmap32 *newbitmap = new Bitmap32(width,height);
        Scanline32 newscanline(width,true);
        for(unsigned int y=0; y<height; y++)
        {
                const Scanline32 &scanline1 = bitmap1.GetScanline32(y);
                for(unsigned int x=0; x<width; x++)
                      newscanline.Pixel(x).SetRGBA(scanline1.Pixel(x).GetR(),0,0,255);
                newbitmap->SetScanline32(y,newscanline);
        }
        return newbitmap;

}

/** DifferenceBitmap - create a bitmap with the absolute differences
    betweeen two bitmaps. The differce is calculated per color. */
Bitmap32* DifferenceBitmap(const Bitmap32 &bitmap1, const Bitmap32  &bitmap2, bool setalpha255)
{
        uint32_t width =  static_cast<int>(bitmap1.GetWidth());
        uint32_t width2 = static_cast<int>(bitmap2.GetWidth());
        if (width != width2)
                throw(std::runtime_error("DifferenceBitmap called with two bitmaps of unequal widths"));

        uint32_t height =  static_cast<int>(bitmap1.GetHeight());
        uint32_t height2 = static_cast<int>(bitmap2.GetHeight());
        if (height != height2)
                throw(std::runtime_error("DifferenceBitmap called with two bitmaps of unequal heights"));

        Bitmap32*newbitmap = new Bitmap32(width,height);
        Scanline32 newscanline(width,true);

        // copy bitmap!
        for(unsigned int y=0; y<height; y++)
        {
                const Scanline32 &scanline1 = bitmap1.GetScanline32(y);
                const Scanline32 &scanline2 = bitmap2.GetScanline32(y);
                // create a scanline for the new bitmap
                for(unsigned int x=0; x<width; x++)
                {
                        //Ignore invisble pixels
                        if (scanline1.Pixel(x).GetA() == 0 && scanline2.Pixel(x).GetA()==0)
                        {
                                newscanline.Pixel(x).SetRGBA(0,0,0,setalpha255 ? 255 : 0);
                        }
                        else
                        {
                                newscanline.Pixel(x).SetRGBA(
                                        abs((int)scanline1.Pixel(x).GetR() - (int)scanline2.Pixel(x).GetR()),
                                        abs((int)scanline1.Pixel(x).GetG() - (int)scanline2.Pixel(x).GetG()),
                                        abs((int)scanline1.Pixel(x).GetB() - (int)scanline2.Pixel(x).GetB()),
                                        setalpha255 ? 255 : abs((int)scanline1.Pixel(x).GetA() - (int)scanline2.Pixel(x).GetA()));
                        }
                }
                newbitmap->SetScanline32(y,newscanline);
        }
        return newbitmap;
}

void GreyscaleBitmap(const Bitmap32  &in_bitmap, Bitmap32  *out_bitmap, double mul_fac)
{
        DrawLib::Scanline32 newscanline(in_bitmap.GetWidth(),true);

        for(unsigned int y = 0; y < in_bitmap.GetHeight(); y++)
        {
                const Scanline32 &scanline1 = in_bitmap.GetScanline32(y);
                // create a scanline for the new bitmap
                for(unsigned int x = 0; x < in_bitmap.GetWidth(); x++)
                {
                        double grey = 0.30*(double)scanline1.Pixel(x).GetR() +
                                     0.59*(double)scanline1.Pixel(x).GetG() +
                                     0.11*(double)scanline1.Pixel(x).GetB();

                        uint8_t g = Blex::Bound<int>(0, 255, static_cast<int>(RoundFloat(grey * mul_fac)));

                        newscanline.Pixel(x).SetRGBA(g, g, g, scanline1.Pixel(x).GetA());
                }
                out_bitmap->SetScanline32(y, newscanline);
        }
}

Bitmap32* CreateGreyscaleBitmap(const Bitmap32  &bitmap, double mul_fac)
{
        DrawLib::Bitmap32 *newbitmap = new DrawLib::Bitmap32(bitmap.GetWidth(),bitmap.GetHeight());

        GreyscaleBitmap(bitmap, newbitmap, mul_fac);

        return newbitmap;
}

void MakeBitmapGreyscale(Bitmap32 *bitmap, double mul_fac)
{
        GreyscaleBitmap(*bitmap, bitmap, mul_fac);
}

void ApplyColorMapping_internal(const Bitmap32  &in_bitmap, Bitmap32 *out_bitmap, ColorMapping &colormap)
{
        DrawLib::Scanline32 newscanline(in_bitmap.GetWidth(), true);

        for(unsigned int y = 0; y < in_bitmap.GetHeight(); y++)
        {
                const Scanline32 &scanline1 = in_bitmap.GetScanline32(y);
                // create a scanline for the new bitmap
                for(unsigned int x = 0; x < in_bitmap.GetWidth(); x++)
                {
                        uint32_t old_color = scanline1.Pixel(x).GetPixelValue();

                        if (colormap.count(old_color) == 1)
                                newscanline.Pixel(x).SetPixelValue(colormap[old_color]);
                        else
                                newscanline.Pixel(x).SetPixelValue(old_color);
                }

                out_bitmap->SetScanline32(y,newscanline);
        }
}

void ApplyColorMapping(Bitmap32 *bitmap, ColorMapping &colormap)
{
        ApplyColorMapping_internal(*bitmap, bitmap, colormap);
}

void AddAlphaChannel(Bitmap32 *bitmap, int add)
{
        DrawLib::Scanline32 newscanline(bitmap->GetWidth(), true);

        for(unsigned int y = 0; y < bitmap->GetHeight(); y++)
        {
                const Scanline32 &scanline1 = bitmap->GetScanline32(y);
                // create a scanline for the new bitmap
                for(unsigned int x = 0; x < bitmap->GetWidth(); x++)
                {
                        newscanline.Pixel(x).SetPixelA(scanline1.Pixel(x),
                             Blex::Bound<int>(0, 255, scanline1.Pixel(x).GetA() + add));
                }
                bitmap->SetScanline32(y,newscanline);
        }
}

void MultiplyAlphaChannel_internal(const Bitmap32  &in_bitmap, Bitmap32  *out_bitmap,double mul_fac)
{
        DrawLib::Scanline32 newscanline(in_bitmap.GetWidth(), true);

        for(unsigned int y = 0; y < in_bitmap.GetHeight(); y++)
        {
                const Scanline32 &scanline1 = in_bitmap.GetScanline32(y);
                // create a scanline for the new bitmap
                for(unsigned int x = 0; x < in_bitmap.GetWidth(); x++)
                {
                        newscanline.Pixel(x).SetPixelA(scanline1.Pixel(x),
                             Blex::Bound<int>(0, 255, static_cast<int>(RoundFloat(static_cast<double>(scanline1.Pixel(x).GetA()) * mul_fac))));
                }
                out_bitmap->SetScanline32(y,newscanline);
        }
}

void MultiplyAlphaChannel(Bitmap32 *bitmap, double mul_fac)
{
        MultiplyAlphaChannel_internal(*bitmap, bitmap, mul_fac);
}

Bitmap32* CreateScaledAlphaBitmap(const Bitmap32 &bitmap, double mul_fac)
{
        DrawLib::Bitmap32 *newbitmap = new DrawLib::Bitmap32(bitmap.GetWidth(),
                bitmap.GetHeight());

        MultiplyAlphaChannel_internal(bitmap, newbitmap, mul_fac);

        return newbitmap;
}

Bitmap32* CreateMultiplyAndAddBitmap(const Bitmap32 &bitmap, double mul_fac, double adder)
{
        DrawLib::Bitmap32*newbitmap = new DrawLib::Bitmap32(bitmap.GetWidth(), bitmap.GetHeight());

        DrawLib::Scanline32 newscanline(bitmap.GetWidth(),true);

        for(unsigned int y=0; y<bitmap.GetHeight(); y++)
        {
                const Scanline32 &scanline1 = bitmap.GetScanline32(y);
                for(unsigned int x=0; x<bitmap.GetWidth(); x++)
                {
                        double r = static_cast<double>(scanline1.Pixel(x).GetR())
                                * mul_fac + adder;
                        double g = static_cast<double>(scanline1.Pixel(x).GetG())
                                * mul_fac + adder;
                        double b = static_cast<double>(scanline1.Pixel(x).GetB())
                                * mul_fac + adder;
                        newscanline.Pixel(x).SetRGBA(
                                Blex::Bound<int>(0, 255, static_cast<int>(RoundFloat(r))),
                                Blex::Bound<int>(0, 255, static_cast<int>(RoundFloat(g))),
                                Blex::Bound<int>(0, 255, static_cast<int>(RoundFloat(b))),
                                scanline1.Pixel(x).GetA());
                }
                newbitmap->SetScanline32(y,newscanline);
        }
        return newbitmap;
}

void InvertBitmap_internal(const Bitmap32  &in_bitmap, Bitmap32  *out_bitmap)
{
        // ADDME: check that bitmaps have the same dimension
        DrawLib::Scanline32 newscanline(in_bitmap.GetWidth(), true);

        for(unsigned int y = 0; y < in_bitmap.GetHeight(); y++)
        {
                const Scanline32 &scanline1 = in_bitmap.GetScanline32(y);
                // create a scanline for the new bitmap
                for(unsigned int x = 0; x < in_bitmap.GetWidth(); x++)
                {
                        int r = 255 - scanline1.Pixel(x).GetR();
                        int g = 255 - scanline1.Pixel(x).GetG();
                        int b = 255 - scanline1.Pixel(x).GetB();

                        newscanline.Pixel(x).SetRGBA(r, g, b, scanline1.Pixel(x).GetA());
                }
                out_bitmap->SetScanline32(y, newscanline);
        }
}

void InvertBitmap(Bitmap32 *bitmap)
{
        InvertBitmap_internal(*bitmap, bitmap);
}

Bitmap32* CreateInvertedBitmap(const Bitmap32 &bitmap)
{
        DrawLib::Bitmap32 *newbitmap = new DrawLib::Bitmap32(bitmap.GetWidth(),
                bitmap.GetHeight());

        InvertBitmap_internal(bitmap, newbitmap);

        return newbitmap;
}

inline int ColorMult(int x, int y)
{
        return (x * y) / 255;
}

void MultiplyBitmap_internal(const Bitmap32  &in_bitmap1, const Bitmap32  &in_bitmap2, Bitmap32  *out_bitmap)
{
        // ADDME: check that bitmaps have the same dimension
        DrawLib::Scanline32 newscanline(in_bitmap1.GetWidth(), true);

        for(unsigned int y = 0; y < in_bitmap1.GetHeight(); y++)
        {
                const Scanline32 &scanline1 = in_bitmap1.GetScanline32(y);
                const Scanline32 &scanline2 = in_bitmap2.GetScanline32(y);
                // create a scanline for the new bitmap
                for(unsigned int x = 0; x < in_bitmap1.GetWidth(); x++)
                {
                        /* calculate the multiply color from the second bitmap and it's alpha */
                        int a2 = scanline2.Pixel(x).GetA();
                        int ia2 = 255 - a2;

                        int r2 = ia2 + ColorMult(scanline2.Pixel(x).GetR(), a2);
                        int g2 = ia2 + ColorMult(scanline2.Pixel(x).GetG(), a2);
                        int b2 = ia2 + ColorMult(scanline2.Pixel(x).GetB(), a2);

                        /* calculate the multiplied colors */
                        int r = ColorMult(scanline1.Pixel(x).GetR(), r2);
                        int g = ColorMult(scanline1.Pixel(x).GetG(), g2);
                        int b = ColorMult(scanline1.Pixel(x).GetB(), b2);

                        newscanline.Pixel(x).SetRGBA(r, g, b, scanline1.Pixel(x).GetA());
                }
                out_bitmap->SetScanline32(y, newscanline);
        }
}

void MultiplyBitmap(Bitmap32 *bitmap, Bitmap32 &mult_bitmap)
{
        MultiplyBitmap_internal(*bitmap, mult_bitmap, bitmap);
}

Bitmap32* CreateMultipliedBitmap(const Bitmap32 &bitmap, Bitmap32 &mult_bitmap)
{
        DrawLib::Bitmap32 *newbitmap = new DrawLib::Bitmap32(bitmap.GetWidth(),
                bitmap.GetHeight());

        MultiplyBitmap_internal(bitmap, mult_bitmap, newbitmap);

        return newbitmap;
}

Bitmap32* CreateEmbossedBitmap(const Bitmap32 &bitmap)
{
        DrawLib::Bitmap32*newbitmap = new DrawLib::Bitmap32(bitmap.GetWidth(),
                bitmap.GetHeight());

        DrawLib::Scanline32 newscanline(bitmap.GetWidth(),true);

        // create an embossed version of bitmap by offsetting and subtracting!
        for(unsigned int y=0; y<bitmap.GetHeight(); y++)
        {
                const Scanline32 &src_scanline1 = bitmap.GetScanline32(y);
                const Scanline32 &src_scanline2 = bitmap.GetScanline32(Blex::Bound(0u,bitmap.GetHeight()-1,y+1));

                for(unsigned int x=0; x<bitmap.GetWidth(); x++)
                {
                        DrawLib::Pixel32 src1 = src_scanline1.Pixel(x);
                        DrawLib::Pixel32 src2;
                        if (x<(bitmap.GetWidth()-1))
                                src2 = src_scanline2.Pixel(x+1);
                        else
                                src2 = src_scanline2.Pixel(x);

                        int16_t r = 0x80 + static_cast<int16_t>(src1.GetR()) - static_cast<int16_t>(src2.GetR());
                        int16_t g = 0x80 + static_cast<int16_t>(src1.GetG()) - static_cast<int16_t>(src2.GetG());
                        int16_t b = 0x80 + static_cast<int16_t>(src1.GetB()) - static_cast<int16_t>(src2.GetB());

                        uint8_t a = ((src1.GetA()>0) || (src2.GetA()>0)) ? 255 : 0;

                        newscanline.Pixel(x).SetRGBA(
                                Blex::Bound<int>(0, 255, r),
                                Blex::Bound<int>(0, 255, g),
                                Blex::Bound<int>(0, 255, b),
                                a);
                }
                newbitmap->SetScanline32(y, newscanline);
        }
        return newbitmap;
}

Bitmap32* CreateResizedBitmap(const Bitmap32&source, const ISize &newsize)
{
        Bitmap32_GraphicsReader reader(source);
        return CreateResizedBitmapFromReader(reader, newsize);
}

/* Get's a pixel from the bitmap, if out-of-bound, the nearest pixels is chosen */
Pixel32 inline GetBoundedPixel(const Bitmap32&bitmap, int x, int y)
{
        const Scanline32 &scanlineptr = bitmap.GetScanline32(Blex::Bound<int>(0, bitmap.GetHeight()-1, y));
        return scanlineptr.Pixel(Blex::Bound<int>(0, bitmap.GetWidth()-1, x));
}
Pixel32 inline GetBoundedPixelFromLine(const Scanline32 &line, int x)
{
        return line.Pixel(Blex::Bound<int>(0, line.GetWidth()-1, x));
}

void Blur(Bitmap32 *bitmap, unsigned xsize, unsigned ysize)
{
        // bound pixel position..
        if (bitmap == NULL)
                throw(std::runtime_error("Blur got a NULL bitmap"));

        unsigned bitmapwidth = bitmap->GetWidth();

        //blurring requires data from [y-ysize,y+ysize], but we're potentially overwriting [y-ysize,y]. so buffer finished lines
        std::vector<Scanline32> linebuffer(ysize+1, Scanline32(bitmapwidth,true)); //takes 'ysize+1' lines

        unsigned blurrectsize = (xsize*2+1) * (ysize*2+1);
        unsigned height = bitmap->GetHeight();

        for(unsigned y=0; y <= height + ysize; ++y)
        {
                //The line we'll write in.
                unsigned writelinenum = y%linebuffer.size();
                Scanline32 &storeline = linebuffer[writelinenum];
                //DEBUGPRINT("y = " << y << " storeline = linebuffer[" << writelinenum << "]");

                //We may need to flush it first, if we've already written to it
                if(y > ysize)
                {
                        unsigned flushtoline = (y-ysize-1);
                        //DEBUGPRINT("flushing first, as line " << flushtoline);
                        bitmap->SetScanline32(flushtoline, storeline);
                }
                if(y > height)
                        continue; //only flushing this line

                for(unsigned x=0; x < bitmapwidth; ++x)
                {/*
                        double r = 0;
                        double g = 0;
                        double b = 0;
                        double a = 0;*/
                        unsigned r=0,b=0,g=0,a=0;

                        int startx = int(x) - xsize;
                        int endx   = int(x) + xsize;
                        int starty = int(y) - ysize;
                        int endy   = int(y) + ysize;

                        for(int processy = starty;processy <= endy; ++processy)
                        {
                                Scanline32 const &input = bitmap->GetScanline32(Blex::Bound<int>(0,height-1,processy));
                                for(int processx = startx;processx <= endx; ++processx)
                                {
                                      Pixel32 mypixel = GetBoundedPixelFromLine(input, processx);
                                      r += mypixel.GetR();
                                      g += mypixel.GetG();
                                      b += mypixel.GetB();
                                      a += mypixel.GetA();
                                }
                        }

                        // put the pixel..
                        Pixel32 result;
                        result.SetRGBA(/*static_cast<uint8_t>(RoundFloat*/((r+blurrectsize)/blurrectsize-1)
                                     , /*static_cast<uint8_t>(RoundFloat*/((g+blurrectsize)/blurrectsize-1)
                                     , /*static_cast<uint8_t>(RoundFloat*/((b+blurrectsize)/blurrectsize-1)
                                      ,/*static_cast<uint8_t>(RoundFloat*/((a+blurrectsize)/blurrectsize-1));
                        storeline.Pixel(x) = result;
                }
        }
}

Bitmap32* CreateRotatedBitmap(const Bitmap32 &bitmap, bool rotate_right)
{
        unsigned new_width = bitmap.GetHeight();
        unsigned new_height = bitmap.GetWidth();
        Bitmap32 *newbitmap = new Bitmap32(new_width, new_height);

        Scanline32 newline(new_width, true);

        if (rotate_right)
        {
                for(unsigned y = 0; y < new_height; y++)
                {
                        for(unsigned x = 0; x < new_width; x++)
                        {
                                newline.Pixel(x) = GetBoundedPixel(bitmap, y, new_width - x - 1);
                        }
                        newbitmap->SetScanline32(y, newline);
                }
        }
        else
        {
                for(unsigned y = 0; y < new_height; y++)
                {
                        for(unsigned x = 0; x < new_width; x++)
                        {
                                newline.Pixel(x) = GetBoundedPixel(bitmap, new_height - y - 1, x);
                        }
                        newbitmap->SetScanline32(y, newline);
                }
        }

        return newbitmap;
}
Bitmap32* CreateMirroredBitmap(const Bitmap32 &bitmap)
{
        unsigned width = bitmap.GetWidth();
        unsigned height = bitmap.GetHeight();
        Bitmap32 *newbitmap = new Bitmap32(width, height);

        Scanline32 newline(width, true);
        for(unsigned y = 0; y < height; y++)
        {
                const Scanline32 &scanlineptr = bitmap.GetScanline32(y);
                for(unsigned x = 0; x < width; x++)
                {
                        newline.Pixel(x) = scanlineptr.Pixel(width - x - 1);
                }
                newbitmap->SetScanline32(y, newline);
        }
        return newbitmap;
}

//ADDME: Copy of same function in canvas.cpp, which unfortunately isn't public
inline Pixel32 BlendAlpha(Pixel32 const &newpixel, Pixel32 const &oldpixel)
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

// Algorithm based on Graphic Gems page 187-188, but with alpha transparency of semi-pixels not taken into account
Bitmap32* XShear(const Bitmap32 &inbitmap, double shear)
{
        unsigned inheight = inbitmap.GetHeight();
        unsigned shearwidth = static_cast<unsigned>(floor(std::fabs(shear * (inheight - 1))));
        unsigned offsetx = shear < 0 ? shearwidth : 0;
        unsigned outwidth = inbitmap.GetWidth() + shearwidth;
        Bitmap32 *newbitmap = new Bitmap32(outwidth, inheight);

        for (unsigned y = 0; y < inheight; ++y)
        {
                Scanline32 newline(outwidth, true);

                double skew = shear * (inheight - y - 1);
                signed skewi = skew < 0 ? ceil(skew) : floor(skew); // Truncate towards 0
                //double skewf = skew - skewi;

                Pixel32 oleft(0, 0, 0, 0);
                for (unsigned x = 0, width = inbitmap.GetWidth(); x < width; ++x)
                {
                        Pixel32 pixel = GetBoundedPixel(inbitmap, width - x - 1, y);

                        //uint8_t leftalpha = static_cast<uint8_t>(RoundFloat(skewf * pixel.GetA()));
                        //uint8_t rightalpha = pixel.GetA() - leftalpha;

                        Pixel32 left = pixel;
                        //left.SetA(leftalpha);
                        //pixel.SetA(rightalpha);

                        newline.Pixel(width - x - 1 + skewi + offsetx) = pixel;//BlendAlpha(pixel, oleft);

                        oleft = left;
                }
                newline.Pixel(skewi + offsetx) = oleft;

                newbitmap->SetScanline32(y, newline);
        }
        return newbitmap;
}

Bitmap32* CreateShearedBitmap(const Bitmap32 &bitmap, double scale)
{
        return XShear(bitmap, scale);
}

double MeanSquareError(const DrawLib::Bitmap32 &reference, const DrawLib::Bitmap32&actual, bool ignore_alpha, bool log_coordinates)
{
        if (reference.GetHeight()!=actual.GetHeight())
                return 999999999;
        if (reference.GetWidth()!=actual.GetWidth())
                return 999999999;

        double error_amount = 0.0;
        for(unsigned int y=0; y<reference.GetHeight(); y++)
        {
                const DrawLib::Scanline32 &s1 = reference.GetScanline32(y);
                const DrawLib::Scanline32 &s2 = actual.GetScanline32(y);
                for(unsigned int x=0; x<reference.GetWidth(); x++)
                {
                        int da = s1.Pixel(x).GetA() - s2.Pixel(x).GetA();
                        if (da==0 && s1.Pixel(x).GetA()==0)
                            continue; //don't compare invisible (fully transparent) pixels

                        int dr = s1.Pixel(x).GetR() - s2.Pixel(x).GetR();
                        int dg = s1.Pixel(x).GetG() - s2.Pixel(x).GetG();
                        int db = s1.Pixel(x).GetB() - s2.Pixel(x).GetB();

                        error_amount += double(dr*dr + dg*dg + db*db);
                        if (!ignore_alpha)
                                error_amount += double(da*da);

                        if(error_amount > 0 && log_coordinates)
                        {
                                Blex::ErrStream() << "First failing coordinate: " << x << "," << y << ", reference = "
                                                  << (int)s1.Pixel(x).GetR() << "," << (int)s1.Pixel(x).GetG() << "," << (int)s1.Pixel(x).GetB() << "," << (int)s1.Pixel(x).GetA()
                                                  << ", actual = "
                                                  << (int)s2.Pixel(x).GetR() << "," << (int)s2.Pixel(x).GetG() << "," << (int)s2.Pixel(x).GetB() << "," << (int)s2.Pixel(x).GetA();
                                log_coordinates = false;
                        }

                }
        }
        return (error_amount/static_cast<double>((reference.GetWidth()*reference.GetHeight())));
}

} //end namespace DrawLib
