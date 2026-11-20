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

void MakeBitmapGreyscale(Bitmap32 *bitmap, double mul_fac)
{
        GreyscaleBitmap(*bitmap, bitmap, mul_fac);
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
