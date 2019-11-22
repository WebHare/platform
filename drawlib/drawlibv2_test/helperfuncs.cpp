#include <drawlib/drawlibv2/allincludes.h>


#include "helperfuncs.h"
#include <drawlib/drawlibv2/bitmapio.h>

#include <drawlib/drawlibv2/bitmapmanip.h>

bool BitmapChecker::IsEmpty(DrawLib::Bitmap32 & bitmap)
{
        uint32_t width  = bitmap.GetWidth();
        uint32_t height = bitmap.GetHeight();

        for(unsigned int y=0; y<height; y++)
        {
                const DrawLib::Scanline32 &scanline = bitmap.GetScanline32(y);
                // create a scanline for the new bitmap
                for(unsigned int x=0; x<width; x++)
                {
                        if (scanline.Pixel(x) != DrawLib::Pixel32(0,0,0,0))
                        {
                                std::cerr << "Empty pixel @(" << x << "," << y << ")" << scanline.Pixel(x) << "\n";
                                return false;
                        }
                }

        }
        return true;
}

/********************************************************************************
        HELPER FUNCTIONS
********************************************************************************/


DrawLib::Bitmap32 * LoadReferenceBitmap(std::string filename)
{
        std::unique_ptr<Blex::FileStream> reference_file;
        try
        {
                reference_file.reset(Blex::Test::OpenTestFile(filename));
        }
        catch(std::exception &e)
        {
                return NULL;
        }
        return DrawLib::CreateBitmap32FromPNG(reference_file.get());
}

void SaveBitmap(DrawLib::Bitmap32 const &bitmap, std::string const &name, bool noalpha)
{
        std::unique_ptr<Blex::FileStream> generatedfile;
        std::string mypath = Blex::MergePath(Blex::Test::GetTempDir(),name);
        generatedfile.reset(Blex::FileStream::OpenWrite(mypath,true,true,Blex::FilePermissions::PublicRead));
        if (!generatedfile.get())
            throw std::runtime_error("Cannot save generated bitmap as " + mypath);

        generatedfile->SetFileLength(0);
        //ADDME: Count alpha, do paletted save were possible..
        DrawLib::SaveBitmap32AsPNG(generatedfile.get(), bitmap, false, noalpha);
        std::cerr << "Saved bitmap as " << mypath << "\n";
}

bool DoCompare(std::string filename, const DrawLib::Bitmap32 & bitmap, bool generate_on_error)
{
        return DoErrorCompare(filename, bitmap, 0, generate_on_error);
}

bool DoErrorCompare(std::string filename, const DrawLib::Bitmap32 & result_bitmap, double max_error, bool generate_on_error)
{
        std::unique_ptr<DrawLib::Bitmap32 > reference_bitmap;

        reference_bitmap.reset(LoadReferenceBitmap(filename));

        if (reference_bitmap.get()==NULL)
        {
                std::string outpath = filename +"_gen.png";
                std::cout << "\nReference bitmap " << filename << " not present\n";
                SaveBitmap(result_bitmap, outpath,false);
                return false;
        }
        if (reference_bitmap->GetWidth()!=result_bitmap.GetWidth() || reference_bitmap->GetHeight()!=result_bitmap.GetHeight())
            throw std::runtime_error("Reference and original bitmaps are of different size");

        // Get the difference and check mismatches
        double meansquare_error = MeanSquareError(*(reference_bitmap.get()), result_bitmap, false, true);
        if(meansquare_error <= max_error)
        {
                if(meansquare_error==0)
                {
                        if(max_error != 0)
                                std::cout << "mSE=0 (why " << max_error << " max?) ";
                }
                else
                {
                        std::cout << "MSE=" << meansquare_error << " (max=" << max_error << ") ";
                }
                return true;
        }

        std::cout << "Comparsion failed.\nMSE = " << meansquare_error << " (maximum accepted: " << max_error << ")\n";

        if (generate_on_error)
        {
                SaveBitmap(result_bitmap, filename +"_gen.png",false);

                std::unique_ptr<DrawLib::Bitmap32 > difference_bitmap;
                difference_bitmap.reset(DrawLib::DifferenceBitmap(*(reference_bitmap.get()), result_bitmap, false));
                SaveBitmap(*difference_bitmap, filename +"_diff_withalpha.png",false);

                std::unique_ptr<DrawLib::Bitmap32 > difference_bitmap_noalpha;
                difference_bitmap_noalpha.reset(DrawLib::DifferenceBitmap(*(reference_bitmap.get()), result_bitmap, true));
                SaveBitmap(*difference_bitmap_noalpha, filename +"_diff_opaque.png",true);

                std::unique_ptr<DrawLib::Bitmap32 > alphaonly_bitmap;
                alphaonly_bitmap.reset(DrawLib::RedAlphaBitmap(*(difference_bitmap.get())));
                SaveBitmap(*alphaonly_bitmap, filename +"_diff_redalpha.png",true);
        }
        return false;
}
