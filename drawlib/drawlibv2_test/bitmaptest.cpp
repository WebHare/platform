#include <drawlib/drawlibv2/allincludes.h>



#include "helperfuncs.h"
#include <blex/testing.h>
#include <blex/utils.h>
#include "../drawlibv2/streamingresizer.h"
#include "../drawlibv2/bitmapio.h"
#include "../drawlibv2/graphicsrw_jpeg.h"
#include "../drawlibv2/bitmapmanip.h"
#include "../drawlibv2/canvas.h"
#include "../drawlibv2/drawobject.h"
#include "../drawlibv2/wmfrenderer.h"

BLEX_TEST_FUNCTION(FindTrimTest)
{
        DrawLib::Bitmap32 mybitmap(70,50,DrawLib::Pixel32(0,0,0,0));
        DrawLib::Canvas32 mycanvas(&mybitmap);
        DrawLib::DrawObject drobj(&mycanvas);

        mycanvas.SetAlphaMode(DrawLib::Canvas32::COPYALL);

        auto rect = mycanvas.GetPaintedRectangle();
        BLEX_TEST_CHECKEQUAL(0, rect.upper_left.x);
        BLEX_TEST_CHECKEQUAL(0, rect.upper_left.y);
        BLEX_TEST_CHECKEQUAL(0, rect.lower_right.x);
        BLEX_TEST_CHECKEQUAL(0, rect.lower_right.y);

        //one square
        drobj.SetFillColor(DrawLib::Pixel32(0xFF,0x0,0x00,0xFF));
        drobj.DrawRectangle(DrawLib::FPPoint(10,25),DrawLib::FPPoint(12,27));

        rect = mycanvas.GetPaintedRectangle();
        BLEX_TEST_CHECKEQUAL(10, rect.upper_left.x);
        BLEX_TEST_CHECKEQUAL(25, rect.upper_left.y);
        BLEX_TEST_CHECKEQUAL(12, rect.lower_right.x);
        BLEX_TEST_CHECKEQUAL(27, rect.lower_right.y);

        //two squares
        drobj.DrawRectangle(DrawLib::FPPoint(20,15),DrawLib::FPPoint(22,17));
        rect = mycanvas.GetPaintedRectangle();
        BLEX_TEST_CHECKEQUAL(10, rect.upper_left.x);
        BLEX_TEST_CHECKEQUAL(15, rect.upper_left.y);
        BLEX_TEST_CHECKEQUAL(22, rect.lower_right.x);
        BLEX_TEST_CHECKEQUAL(27, rect.lower_right.y);

        //fill entire canvas
        drobj.DrawRectangle(DrawLib::FPPoint(0,0),DrawLib::FPPoint(70,50));
        rect = mycanvas.GetPaintedRectangle();
        BLEX_TEST_CHECKEQUAL(0, rect.upper_left.x);
        BLEX_TEST_CHECKEQUAL(0, rect.upper_left.y);
        BLEX_TEST_CHECKEQUAL(70, rect.lower_right.x);
        BLEX_TEST_CHECKEQUAL(50, rect.lower_right.y);

        //vertical bar
        drobj.SetFillColor(DrawLib::Pixel32(0,0,0,0));
        drobj.DrawRectangle(DrawLib::FPPoint(0,0),DrawLib::FPPoint(70,50));
        drobj.SetFillColor(DrawLib::Pixel32(0xFF,0x0,0x00,0xFF));
        drobj.DrawRectangle(DrawLib::FPPoint(10,0),DrawLib::FPPoint(11,50));
        rect = mycanvas.GetPaintedRectangle();
        BLEX_TEST_CHECKEQUAL(10, rect.upper_left.x);
        BLEX_TEST_CHECKEQUAL(0, rect.upper_left.y);
        BLEX_TEST_CHECKEQUAL(11, rect.lower_right.x);
        BLEX_TEST_CHECKEQUAL(50, rect.lower_right.y);

        //horizontal bar
        drobj.SetFillColor(DrawLib::Pixel32(0,0,0,0));
        drobj.DrawRectangle(DrawLib::FPPoint(0,0),DrawLib::FPPoint(70,50));
        drobj.SetFillColor(DrawLib::Pixel32(0xFF,0x0,0x00,0xFF));
        drobj.DrawRectangle(DrawLib::FPPoint(0,7),DrawLib::FPPoint(70,8));
        rect = mycanvas.GetPaintedRectangle();
        BLEX_TEST_CHECKEQUAL(0, rect.upper_left.x);
        BLEX_TEST_CHECKEQUAL(7, rect.upper_left.y);
        BLEX_TEST_CHECKEQUAL(70, rect.lower_right.x);
        BLEX_TEST_CHECKEQUAL(8, rect.lower_right.y);

        //fill all pixels except one px around the edge
        drobj.SetFillColor(DrawLib::Pixel32(0,0,0,0));
        drobj.DrawRectangle(DrawLib::FPPoint(0,0),DrawLib::FPPoint(70,50));
        drobj.SetFillColor(DrawLib::Pixel32(0xFF,0x0,0x00,0xFF));
        drobj.DrawRectangle(DrawLib::FPPoint(1,1),DrawLib::FPPoint(69,49));
        rect = mycanvas.GetPaintedRectangle();
        BLEX_TEST_CHECKEQUAL(1, rect.upper_left.x);
        BLEX_TEST_CHECKEQUAL(1, rect.upper_left.y);
        BLEX_TEST_CHECKEQUAL(69, rect.lower_right.x);
        BLEX_TEST_CHECKEQUAL(49, rect.lower_right.y);
}

BLEX_TEST_FUNCTION(StreamingResizerSSE2Test)
{
        std::unique_ptr<Blex::FileStream> ImageFile;
        ImageFile.reset(Blex::Test::OpenTestFile("salma_hayek_large.jpg"));
        BLEX_TEST_CHECK(ImageFile.get()!=NULL);

        std::unique_ptr<DrawLib::JPG_GraphicsReader> jpgreader;
        jpgreader.reset(new DrawLib::JPG_GraphicsReader(ImageFile.get(), 1 /* decimation factor */));
        BLEX_TEST_CHECK(jpgreader.get()!=NULL);

        uint32_t outwidth = 333;
        uint32_t outheight = 213;

        DrawLib::Bitmap32 SmallBitmap(outwidth, outheight);
        DrawLib::Scanline32 tempscanline(outwidth, true);

        Blex::FastTimer timer;
        timer.Start();

        DrawLib::ResizeFilter resizer(jpgreader.get(), outwidth, outheight);
        for(unsigned int y=0; y<outheight; y++)
        {
                resizer.GetScanline32(tempscanline);
                SmallBitmap.SetScanline32(y,tempscanline);
        }
        timer.Stop();

        std::cerr << timer << "\n";

        // compare!
        //BLEX_TEST_CHECK(DoErrorCompare("ref-streamingresizetest_scenery.png", SmallBitmap, 3000, true)); //ADDME: Was 1.5 with old kernel
}

BLEX_TEST_FUNCTION(EmfTest)
{
        //Should be able to draw EMFs into resized viewports
        std::unique_ptr<Blex::FileStream> emffile;
        emffile.reset(Blex::Test::OpenTestFile("monkey.emf"));
        BLEX_TEST_CHECK(emffile.get()!=NULL);

        std::vector<uint8_t> imagedata;
        ReadStreamIntoVector(*emffile, &imagedata);

        //first one-on-one rendering
        std::unique_ptr<DrawLib::Bitmap32> outbitmap(new DrawLib::Bitmap32(232,231));
        DrawLib::RenderWmfEmf(*outbitmap, DrawLib::FPBoundingBox(0,0,232,231), &imagedata[0], imagedata.size(), DrawLib::XForm2D());

        BLEX_TEST_CHECK(DoCompare ("monkey.png", *outbitmap, true));

        //draw a 2x monkey into the lowerleft of a 4x canvas (test translation and scaling)
        DrawLib::XForm2D ultimate(2,0,0,2,DrawLib::FPPoint(150,400));

        outbitmap.reset(new DrawLib::Bitmap32(928,922));
        //DrawLib::RenderWmfEmf(*outbitmap, DrawLib::FPBoundingBox(150,400,150+232*2,400+231*2), &imagedata[0], imagedata.size());
        DrawLib::RenderWmfEmf(*outbitmap, DrawLib::FPBoundingBox(0,0,232,231), &imagedata[0], imagedata.size(), ultimate);
        //crop and resize back to our part
        outbitmap.reset(CreateCroppedBitmap(*outbitmap, DrawLib::IRect(150,400,150+232*2,400+231*2)));
        outbitmap.reset(CreateResizedBitmap(*outbitmap, DrawLib::ISize(232,231)));
        BLEX_TEST_CHECK(DoErrorCompare ("monkey.png", *outbitmap, 80, true));
}

//as I actually found a use for the Raw format (fast storage during photo
//album conversions) we might as well test it (as it didn't work at all at first)
BLEX_TEST_FUNCTION(RobRawTest) //rob als in au :-)
{
        std::unique_ptr<Blex::FileStream> RedFile;

        // load red.png
        RedFile.reset(Blex::Test::OpenTestFile("testimage.png"));

        BLEX_TEST_CHECK(RedFile.get()!=NULL);
        std::unique_ptr<DrawLib::Bitmap32 > redbitmap;
        std::unique_ptr<DrawLib::Bitmap32 > inputbitmap;

        redbitmap.reset(DrawLib::CreateBitmap32FromPNG(RedFile.get()));

        // open a tempfile for storage
        std::string tempfilepath = Blex::MergePath(Blex::Test::GetTempDir(),"robraw");
        std::unique_ptr<Blex::FileStream> tempfile;
        tempfile.reset(Blex::FileStream::OpenRW(tempfilepath, true, true, Blex::FilePermissions::PublicRead));
        BLEX_TEST_CHECK(tempfile.get()!=NULL);

        // write the bitmap as a RobRaw file
        SaveBitmap32AsRaw(*tempfile, *redbitmap, "RGBA");

        // now read it back
        tempfile->SetOffset(0);
        inputbitmap.reset(DrawLib::CreateBitmap32FromRaw(*tempfile, redbitmap->GetWidth(), redbitmap->GetHeight(), "RGBA", false));
        BLEX_TEST_CHECK(inputbitmap.get() != NULL);

        // check the size of *red..
        BLEX_TEST_CHECKEQUAL(redbitmap->GetWidth(), inputbitmap->GetWidth());
        BLEX_TEST_CHECKEQUAL(redbitmap->GetHeight(), inputbitmap->GetHeight());

        BLEX_TEST_CHECK(DoCompare("testimage.png", *inputbitmap, true));

        // read it as ARGB
        tempfile->SetOffset(0);
        redbitmap.reset(DrawLib::CreateBitmap32FromRaw(*tempfile, redbitmap->GetWidth(), redbitmap->GetHeight(), "ARGB", false));
        BLEX_TEST_CHECK(redbitmap.get() != NULL);
        BLEX_TEST_CHECKEQUAL(redbitmap->GetWidth(), inputbitmap->GetWidth());
        BLEX_TEST_CHECKEQUAL(redbitmap->GetHeight(), inputbitmap->GetHeight());
}

#if 0
BLEX_TEST_FUNCTION(BrokenPNGTest)
{
        std::unique_ptr<Blex::FileStream> ImageFile;
        ImageFile.reset(Blex::Test::OpenTestFile("brokenpngtest.png"));
        BLEX_TEST_CHECK(ImageFile.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > Bitmap;
        std::unique_ptr<DrawLib::PNG_GraphicsReader> PngReader;

        PngReader.reset(new DrawLib::PNG_GraphicsReader(
                ImageFile.get(),DrawLib::PNG_GraphicsReader::ChunkCallback()));

        PngReader->SkipImageData();

        /*if (PngReader.get()==NULL)
                throw(std::runtime_error("PNG_GraphicsReader failed!"));

        DrawLib::BlackWhiteFilter bwfilter(PngReader.get(), 1.0);
        DrawLib::Bitmap32 greyscale_bitmap(bwfilter.GetWidth(), bwfilter.GetHeight());

        DrawLib::Scanline32 tempscanline(bwfilter.GetWidth(), true);
        for(unsigned y=0; y<bwfilter.GetHeight(); y++)
        {
                bwfilter.GetScanline32(tempscanline);
                greyscale_bitmap.SetScanline32(y,tempscanline);
        }

        //DrawLib::Bitmap32 *greyscale = DrawLib::CreateGreyscaleBitmap(*(Bitmap.get()));

        BLEX_TEST_CHECK(DoErrorCompare("ref-greyscale_scenery.png", greyscale_bitmap, 1.0, true));*/
}
#endif

BLEX_TEST_FUNCTION(GreyscaleTest)
{
        std::unique_ptr<Blex::FileStream> ImageFile;
        ImageFile.reset(Blex::Test::OpenTestFile("scenery.png"));
        BLEX_TEST_CHECK(ImageFile.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > Bitmap;
        std::unique_ptr<DrawLib::PNG_GraphicsReader> PngReader;

        PngReader.reset(new DrawLib::PNG_GraphicsReader(
                ImageFile.get(),DrawLib::PNG_GraphicsReader::ChunkCallback()));

        if (PngReader.get()==NULL)
                throw(std::runtime_error("PNG_GraphicsReader failed!"));

        DrawLib::BlackWhiteFilter bwfilter(PngReader.get(), 1.0);
        DrawLib::Bitmap32 greyscale_bitmap(bwfilter.GetWidth(), bwfilter.GetHeight());

        DrawLib::Scanline32 tempscanline(bwfilter.GetWidth(), true);
        for(unsigned y=0; y<bwfilter.GetHeight(); y++)
        {
                bwfilter.GetScanline32(tempscanline);
                greyscale_bitmap.SetScanline32(y,tempscanline);
        }

        //DrawLib::Bitmap32 *greyscale = DrawLib::CreateGreyscaleBitmap(*(Bitmap.get()));

        BLEX_TEST_CHECK(DoErrorCompare("ref-greyscale_scenery.png", greyscale_bitmap, 1.0, true));
}

////////////////////////////////////////////////////////////////////////////////
//
// The PNG reader

//ADDME: Don't think pure RED is such a good test bitmap: the pattern FF 00 00 FF won't detect LSB/MSB mismatching
BLEX_TEST_FUNCTION(PngTest)
{
        std::unique_ptr<Blex::FileStream> RedFile;
        // load red.png and check if all pixels are equal to (0xFF,0,0,0)
        RedFile.reset(Blex::Test::OpenTestFile("red_48_48.png"));
        BLEX_TEST_CHECK(RedFile.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > redbitmap;
        redbitmap.reset(DrawLib::CreateBitmap32FromPNG(RedFile.get()));

        // check the size of *red.. should be 48x48
        BLEX_TEST_CHECKEQUAL(48,redbitmap->GetWidth());
        BLEX_TEST_CHECKEQUAL(48,redbitmap->GetHeight());

        // check if the bitmap is indeed all red..
        DrawLib::Pixel32 RedPixel(0xFF,0,0,0xFF);
        for(unsigned line =0; line<redbitmap->GetHeight(); line++)
        {
                const DrawLib::Scanline32 &s_ptr = redbitmap->GetScanline32(line);
                for(unsigned x=0; x<s_ptr.GetWidth(); x++)
                {
                        DrawLib::Pixel32 pixel = s_ptr.Pixel(x);
                        BLEX_TEST_CHECK( pixel == RedPixel);
                }
        }
}

bool png_chunk_callback_called = false;

void png_chunk_callback(const char *DEBUGONLYARG(chunkname), const void*, unsigned)
{
        DEBUGPRINT("  Got PNG chuck callback: " << chunkname);
        png_chunk_callback_called = true;
}

BLEX_TEST_FUNCTION(PngChunkCallbackTest)
{
        std::unique_ptr<Blex::FileStream> ImageFile;
        ImageFile.reset(Blex::Test::OpenTestFile("unknownchunk.png"));
        BLEX_TEST_CHECK(ImageFile.get()!=NULL);

        std::unique_ptr<DrawLib::PNG_GraphicsReader> PngReader;

        DrawLib::PNG_GraphicsReader::ChunkCallback unknown_chunk_callback;

        unknown_chunk_callback = &png_chunk_callback;

        std::cerr << "\n";

        PngReader.reset(new DrawLib::PNG_GraphicsReader(
                ImageFile.get(),unknown_chunk_callback));

        if (PngReader.get()==NULL)
                throw(std::runtime_error("PNG_GraphicsReader failed!"));

        // skip the image data and hopefully get unkown chunk callbacks!
        try{
                PngReader->SkipImageData();
        }
        catch(...)
        {
                std::cerr << "PngReader caused an exception..\n";
        }

        // check if it was indeed called...
        BLEX_TEST_CHECK(png_chunk_callback_called == true);
}

BLEX_TEST_FUNCTION(PngAlphaCircleTest) //this png is fully blue but with alpha 0-255 to create the circle. test blending to white
{
        std::unique_ptr<Blex::FileStream> imgfile;
        Blex::MemoryRWStream generatedfile;
        imgfile.reset(Blex::Test::OpenTestFile("testpaul.png"));
        BLEX_TEST_CHECK(imgfile.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32> bitmapinput;
        bitmapinput.reset(DrawLib::CreateBitmap32Magic(imgfile.get(), DrawLib::ISize(75,75)));

        BLEX_TEST_CHECK(DoCompare("ref-testpaul-75x75.png", *bitmapinput, true));

        //Convert to PNG without alpha
        imgfile->SetOffset(0);
        bitmapinput.reset(DrawLib::CreateBitmap32Magic(imgfile.get(), DrawLib::ISize(75,75)));

        DrawLib::SaveBitmap32AsPNG(&generatedfile, *bitmapinput, false, true);
        generatedfile.SetOffset(0);
        bitmapinput.reset(DrawLib::CreateBitmap32Magic(&generatedfile, DrawLib::ISize(75,75)));

        BLEX_TEST_CHECK(DoCompare("ref-testpaul-75x75-noalpha.png", *bitmapinput, true));
        generatedfile.SetOffset(0);
        generatedfile.SetFileLength(0);

        //Convert to JPEG (always without alpha)
        imgfile->SetOffset(0);
        bitmapinput.reset(DrawLib::CreateBitmap32Magic(imgfile.get(), DrawLib::ISize(75,75)));

        DrawLib::SaveBitmap32AsJPG(&generatedfile, *bitmapinput, 75);
        generatedfile.SetOffset(0);
        bitmapinput.reset(DrawLib::CreateBitmap32Magic(&generatedfile, DrawLib::ISize(75,75)));

        BLEX_TEST_CHECK(DoErrorCompare("ref-testpaul-75x75-jpeg.png", *bitmapinput, 60, true));
        generatedfile.SetOffset(0);
        generatedfile.SetFileLength(0);

        //ADDME: blend with white at paletted save too? gif?

}

////////////////////////////////////////////////////////////////////////////////
//
// The GIF reader

BLEX_TEST_FUNCTION(GifReadTest)
{
        std::unique_ptr<Blex::FileStream> imagefile;
        imagefile.reset(Blex::Test::OpenTestFile("gifTest.gif"));
        BLEX_TEST_CHECK(imagefile.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > bitmap;
        bitmap.reset(DrawLib::CreateBitmap32FromGIF(imagefile.get()));

        //Blex::FileStream *fs = Blex::FileStream::OpenWrite("C:\\test.tga", true, false, Blex::FilePermissions::PublicRead);
        //DrawLib::SaveBitmap32AsTGA(fs, *bitmap);
        //delete fs;

        BLEX_TEST_CHECK(DoErrorCompare("ref-gifTest.png", *bitmap, 0, true));

        //For now, decided not to actually support files like this
        imagefile.reset(Blex::Test::OpenTestFile("issue107.gif"));
        BLEX_TEST_CHECK(imagefile.get()!=NULL);
        BLEX_TEST_CHECKTHROW(DrawLib::CreateBitmap32FromGIF(imagefile.get()),std::runtime_error);
}

BLEX_TEST_FUNCTION(GifWriteTest)
{
        // Read GIF from testfile:
        std::unique_ptr<Blex::FileStream> imagefile;
        imagefile.reset(Blex::Test::OpenTestFile("gifTest.gif"));
        BLEX_TEST_CHECK(imagefile.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > bitmap;
        bitmap.reset(DrawLib::CreateBitmap32FromGIF(imagefile.get()));

        Blex::MemoryRWStream mrws;

        // Write GIF (this is the test) to memory:
        DrawLib::SaveBitmap32AsGIF(&mrws, *bitmap);

        mrws.SetOffset(0);

        // Now read the GIF from the memory again:
        bitmap.reset(DrawLib::CreateBitmap32FromGIF(&mrws));

        // Do the checking:
        BLEX_TEST_CHECK(DoErrorCompare("ref-gifTest.png", *bitmap, 0, true));
}

////////////////////////////////////////////////////////////////////////////////
//
// The BMP/DIB reader

BLEX_TEST_FUNCTION(BmpReaderTest)
{
        std::unique_ptr<Blex::FileStream> sourcefile;
        std::unique_ptr<DrawLib::Bitmap32 > sourcebitmap;

        sourcefile.reset(Blex::Test::OpenTestFile("32bitdib.dib"));
        sourcebitmap.reset(DrawLib::CreateBitmap32FromBMP(sourcefile.get(), false, false));
        BLEX_TEST_CHECK(sourcebitmap.get() != NULL);
        BLEX_TEST_CHECK(DoErrorCompare("ref-32bitdib.png", *(sourcebitmap.get()), 0, true));

        sourcefile.reset(Blex::Test::OpenTestFile("32bit_bitfields.dib"));
        sourcebitmap.reset(DrawLib::CreateBitmap32FromBMP(sourcefile.get(), false, false));
        BLEX_TEST_CHECK(sourcebitmap.get() != NULL);
        BLEX_TEST_CHECK(DoErrorCompare("ref-32bit_bitfields_dib.png", *(sourcebitmap.get()), 0, true));

        sourcefile.reset(Blex::Test::OpenTestFile("setup.bmp"));
        sourcebitmap.reset(DrawLib::CreateBitmap32FromBMP(sourcefile.get(), true, true));
        BLEX_TEST_CHECK(sourcebitmap.get() != NULL);
        BLEX_TEST_CHECK(DoErrorCompare("ref-setup_bmp.png", *(sourcebitmap.get()), 0, true));

        sourcefile.reset(Blex::Test::OpenTestFile("n2k.bmp"));
        sourcebitmap.reset(DrawLib::CreateBitmap32FromBMP(sourcefile.get(), true,true));
        BLEX_TEST_CHECK(sourcebitmap.get() != NULL);
        BLEX_TEST_CHECK(DoErrorCompare("ref-n2k.png", *(sourcebitmap.get()), 0, true));
}

////////////////////////////////////////////////////////////////////////////////
//
// The JPEG reader

BLEX_TEST_FUNCTION(JpegCMYKTest)
{
        std::unique_ptr<Blex::FileStream> imagefile;
        imagefile.reset(Blex::Test::OpenTestFile("cmyk.jpg"));
        BLEX_TEST_CHECK(imagefile.get()!=NULL);

        DrawLib::JPG_GraphicsReader jpgreader(imagefile.get(), 4);
        DrawLib::Bitmap32 bitmap(jpgreader.GetWidth(), jpgreader.GetHeight());
        DrawLib::Scanline32 templine(jpgreader.GetWidth(), true);
        for(unsigned y=0; y<jpgreader.GetHeight(); y++)
        {
                jpgreader.GetScanline32(templine);
                bitmap.SetScanline32(y, templine);
        }

        // compare! (ADDME: we'd like a SMALLER version of the cmyk JPEG file!)
        BLEX_TEST_CHECK(DoErrorCompare("ref-cmyk4.png", bitmap, 60, true));
}



BLEX_TEST_FUNCTION(JpegDecimationTest)
{
        std::unique_ptr<Blex::FileStream> imagefile;
        imagefile.reset(Blex::Test::OpenTestFile("scenery.jpg"));
        BLEX_TEST_CHECK(imagefile.get()!=NULL);

        DrawLib::JPG_GraphicsReader jpegreader(imagefile.get(), 4);
        DrawLib::Bitmap32 bitmap(jpegreader.GetWidth(), jpegreader.GetHeight());
        DrawLib::Scanline32 templine(jpegreader.GetWidth(), true);
        for(unsigned y=0; y<jpegreader.GetHeight(); y++)
        {
                jpegreader.GetScanline32(templine);
                bitmap.SetScanline32(y, templine);
        }

        BLEX_TEST_CHECK(DoErrorCompare("ref-scenery_decim4.png", bitmap, 60, true));
}

////////////////////////////////////////////////////////////////////////////////
//
// The resizers

BLEX_TEST_FUNCTION(KernelResizeTest)
{
        std::unique_ptr<Blex::FileStream> ImageFile;
        ImageFile.reset(Blex::Test::OpenTestFile("scenery.png"));
        BLEX_TEST_CHECK(ImageFile.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > Bitmap;
        Bitmap.reset(DrawLib::CreateBitmap32FromPNG(ImageFile.get()));
        Blex::FastTimer timer;
        timer.Start();
        DrawLib::Bitmap32 *SmallBitmap = DrawLib::CreateResizedBitmap(*(Bitmap.get()),
                DrawLib::ISize(320,240));
        //DrawLib::Bitmap32 *SmallBitmap = DrawLib::CreateDecimatedBitmap(*(Bitmap.get()),
        //        4,4);

        timer.Stop();

        std::cerr << timer << "\n";
        // compare!
        BLEX_TEST_CHECK(DoErrorCompare("ref-resizetest_kernel_scenery.png", *SmallBitmap, 3000, true)); //ADDME was 1.5 for kernel 8
        delete SmallBitmap;

        //
        ImageFile.reset(Blex::Test::OpenTestFile("screenshot.png"));
        BLEX_TEST_CHECK(ImageFile.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > Bitmap2;
        Bitmap2.reset(DrawLib::CreateBitmap32FromPNG(ImageFile.get()));
        SmallBitmap = DrawLib::CreateResizedBitmap(*(Bitmap2.get()),
                DrawLib::ISize(320,240));

        BLEX_TEST_CHECK(DoErrorCompare ("ref-resizetest_kernel_screenshot.png", *SmallBitmap, 3000, true)); //ADDME was 1.5 for kernel 8
        delete SmallBitmap;
}

BLEX_TEST_FUNCTION(StreamingResizerTest)
{
        std::unique_ptr<Blex::FileStream> ImageFile;
        ImageFile.reset(Blex::Test::OpenTestFile("scenery.png"));
        BLEX_TEST_CHECK(ImageFile.get()!=NULL);

        std::unique_ptr<DrawLib::PNG_GraphicsReader> pngreader;
        pngreader.reset(new DrawLib::PNG_GraphicsReader(ImageFile.get(),DrawLib::PNG_GraphicsReader::ChunkCallback()));
        BLEX_TEST_CHECK(pngreader.get()!=NULL);

        uint32_t outwidth = 320;
        uint32_t outheight = 200;

        DrawLib::Bitmap32 SmallBitmap(outwidth, outheight);
        DrawLib::Scanline32 tempscanline(outwidth, true);

        Blex::FastTimer timer;
        timer.Start();

        DrawLib::ResizeFilter resizer(pngreader.get(), outwidth, outheight);
        for(unsigned int y=0; y<outheight; y++)
        {
                resizer.GetScanline32(tempscanline);
                SmallBitmap.SetScanline32(y,tempscanline);
        }
        timer.Stop();

        std::cerr << timer << "\n";

        // compare!
        BLEX_TEST_CHECK(DoErrorCompare("ref-streamingresizetest_scenery.png", SmallBitmap, 3000, true)); //ADDME: Was 1.5 with old kernel

}

BLEX_TEST_FUNCTION(ResizerTest)
{
        std::unique_ptr<Blex::FileStream> imgfile;
        std::unique_ptr<DrawLib::Bitmap32 > img;
        Blex::MemoryRWStream temp;

        imgfile.reset(Blex::Test::OpenTestFile("bata_2.gif"));
        BLEX_TEST_CHECK(imgfile.get()!=NULL);

        img.reset(DrawLib::CreateBitmap32Magic(imgfile.get(), DrawLib::ISize(201,134)));
        BLEX_TEST_CHECK(DoErrorCompare("ref-bata_2.201x134.png", *img, 0, true));

        //rewrite as gif
        DrawLib::SaveBitmap32AsGIF(&temp, *img);
        temp.SetOffset(0);
        img.reset(DrawLib::CreateBitmap32FromGIF(&temp));

        BLEX_TEST_CHECK(DoErrorCompare("ref-bata_2.201x134.png", *img, 80, true));
}

BLEX_TEST_FUNCTION(MagicReaderTest)
{
        //LOAD files using the magicreader. Then compare them to the references

        std::unique_ptr<Blex::FileStream> pngfile;
        pngfile.reset(Blex::Test::OpenTestFile("monkey.png"));
        BLEX_TEST_CHECK(pngfile.get()!=NULL);

        std::unique_ptr<Blex::FileStream> jpgfile;
        jpgfile.reset(Blex::Test::OpenTestFile("monkey.jpg"));
        BLEX_TEST_CHECK(jpgfile.get()!=NULL);

        std::unique_ptr<Blex::FileStream> bmp_8file;
        bmp_8file.reset(Blex::Test::OpenTestFile("monkey_8bit.bmp"));
        BLEX_TEST_CHECK(bmp_8file.get()!=NULL);

        std::unique_ptr<Blex::FileStream> bmpfile;
        bmpfile.reset(Blex::Test::OpenTestFile("monkey.bmp"));
        BLEX_TEST_CHECK(bmpfile.get()!=NULL);

        std::unique_ptr<Blex::FileStream> tiffile;
        tiffile.reset(Blex::Test::OpenTestFile("monkey.tif"));
        BLEX_TEST_CHECK(tiffile.get()!=NULL);

        std::unique_ptr<Blex::FileStream> emffile;
        emffile.reset(Blex::Test::OpenTestFile("monkey.emf"));
        BLEX_TEST_CHECK(emffile.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > my_bmp_8_bitmap;
        my_bmp_8_bitmap.reset(DrawLib::CreateBitmap32Magic(bmp_8file.get()));
        BLEX_TEST_CHECK(my_bmp_8_bitmap.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > my_emf_bitmap;
        my_emf_bitmap.reset(DrawLib::CreateBitmap32Magic(emffile.get()));
        BLEX_TEST_CHECK(my_emf_bitmap.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > my_png_bitmap;
        my_png_bitmap.reset(DrawLib::CreateBitmap32Magic(pngfile.get()));
        BLEX_TEST_CHECK(my_png_bitmap.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > my_jpg_bitmap;
        my_jpg_bitmap.reset(DrawLib::CreateBitmap32Magic(jpgfile.get()));
        BLEX_TEST_CHECK(my_jpg_bitmap.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > my_tif_bitmap;
        my_tif_bitmap.reset(DrawLib::CreateBitmap32Magic(tiffile.get()));
        BLEX_TEST_CHECK(my_tif_bitmap.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > my_bmp_bitmap;
        my_bmp_bitmap.reset(DrawLib::CreateBitmap32Magic(bmpfile.get()));
        BLEX_TEST_CHECK(my_bmp_bitmap.get()!=NULL);

        BLEX_TEST_CHECK(DoCompare ("monkey.png", *(my_bmp_bitmap.get()), true));
        BLEX_TEST_CHECK(DoCompare ("monkey.png", *(my_tif_bitmap.get()), true));
        BLEX_TEST_CHECK(DoCompare ("monkey.png", *(my_emf_bitmap.get()), true));
        BLEX_TEST_CHECK(DoCompare ("monkey.png", *(my_png_bitmap.get()), true));

        //change this to take jpg as comparemap to.
        BLEX_TEST_CHECK(DoErrorCompare ("monkey.png", *(my_jpg_bitmap.get()), 5.0, true));
        BLEX_TEST_CHECK(DoErrorCompare ("monkey.png", *(my_bmp_8_bitmap.get()), 70.5, true));


        std::unique_ptr<Blex::FileStream> bitfile;
        bitfile.reset(Blex::Test::OpenTestFile("1bitdib.bmp"));
        BLEX_TEST_CHECK(bitfile.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > my_1_bitmap;
        my_1_bitmap.reset(DrawLib::CreateBitmap32Magic(bitfile.get()));
        BLEX_TEST_CHECK(my_1_bitmap.get()!=NULL);

        BLEX_TEST_CHECK(DoCompare ("ref-1bitdib.png", *(my_1_bitmap.get()),  true));

        std::unique_ptr<Blex::FileStream> bit4file;
        bit4file.reset(Blex::Test::OpenTestFile("4bitdib.bmp"));
        BLEX_TEST_CHECK(bit4file.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > my_4_bitmap;
        my_4_bitmap.reset(DrawLib::CreateBitmap32Magic(bit4file.get()));
        BLEX_TEST_CHECK(my_4_bitmap.get()!=NULL);

        BLEX_TEST_CHECK(DoCompare ("ref-4bitdib.png", *(my_4_bitmap.get()),  true));
}


////////////////////////////////////////////////////////////////////////////////
//
// Shearing images

BLEX_TEST_FUNCTION(ShearTest)
{
        std::unique_ptr<Blex::FileStream> ImageFile;
        ImageFile.reset(Blex::Test::OpenTestFile("scenery.png"));
        BLEX_TEST_CHECK(ImageFile.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > Bitmap;
        Bitmap.reset(DrawLib::CreateBitmap32FromPNG(ImageFile.get()));
        Blex::FastTimer timer;

        timer.Start();
        DrawLib::Bitmap32 *ShearedBitmap = DrawLib::CreateShearedBitmap(*(Bitmap.get()), 1);
        timer.Stop();
        std::cerr << timer << "\n";
        // compare!
        BLEX_TEST_CHECK(DoErrorCompare("ref-sheartest_scenery_1.png", *ShearedBitmap, 0, true));
        delete ShearedBitmap;

        ShearedBitmap = DrawLib::CreateShearedBitmap(*(Bitmap.get()), -1);
        // compare!
        BLEX_TEST_CHECK(DoErrorCompare("ref-sheartest_scenery_-1.png", *ShearedBitmap, 0, true));
        delete ShearedBitmap;

        ShearedBitmap = DrawLib::CreateShearedBitmap(*(Bitmap.get()), .05);
        // compare!
        BLEX_TEST_CHECK(DoErrorCompare("ref-sheartest_scenery_.05.png", *ShearedBitmap, 0, true));
        delete ShearedBitmap;

        ShearedBitmap = DrawLib::CreateShearedBitmap(*(Bitmap.get()), -.34);
        // compare!
        BLEX_TEST_CHECK(DoErrorCompare("ref-sheartest_scenery_-.34.png", *ShearedBitmap, 0, true));
        delete ShearedBitmap;
}


////////////////////////////////////////////////////////////////////////////////
//
// Blurry stuff

BLEX_TEST_FUNCTION(BlurTest)
{
        std::unique_ptr<Blex::FileStream> img(Blex::Test::OpenTestFile("testimage.png"));
        BLEX_TEST_CHECK(img.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > bitmap(DrawLib::CreateBitmap32FromPNG(img.get()));
        DrawLib::Blur(bitmap.get(), 0, 0); //identity test, shouldn't really change anything
        BLEX_TEST_CHECK(DoErrorCompare("ref-testimage_blur_1.png", *bitmap, 0, true));

        img->SetOffset(0);
        bitmap.reset(DrawLib::CreateBitmap32FromPNG(img.get()));

        DrawLib::Blur(bitmap.get(), 1, 0); //simple hblur
        BLEX_TEST_CHECK(DoErrorCompare("ref-testimage_blur_h1.png", *bitmap, 0, true));

        //test vblur by simply rotating, blurring, and rotating back, and comparing to the blur_h1 version
        img->SetOffset(0);
        bitmap.reset(DrawLib::CreateBitmap32FromPNG(img.get()));
        bitmap.reset(DrawLib::CreateRotatedBitmap(*bitmap, true));
        DrawLib::Blur(bitmap.get(), 0, 1); //simple vblur
        bitmap.reset(DrawLib::CreateRotatedBitmap(*bitmap, false));
        BLEX_TEST_CHECK(DoErrorCompare("ref-testimage_blur_h1.png", *bitmap, 0, true));

        //test a bigger blur
        img->SetOffset(0);
        bitmap.reset(DrawLib::CreateBitmap32FromPNG(img.get()));
        DrawLib::Blur(bitmap.get(), 2, 3);
        BLEX_TEST_CHECK(DoErrorCompare("ref-testimage_blur_2_3.png", *bitmap, 0, true));
}

////////////////////////////////////////////////////////////////////////////////
//
// Test various blends

void TestAnOperation(std::string const &reffile, DrawLib::Canvas32::AlphaOperationMode alphaop, double mse)
{
        std::unique_ptr<Blex::FileStream> img(Blex::Test::OpenTestFile("testimage.png"));
        BLEX_TEST_CHECK(img.get()!=NULL);

        std::unique_ptr<DrawLib::Bitmap32 > bitmap_orig(DrawLib::CreateBitmap32FromPNG(img.get()));

        img->SetOffset(0);
        std::unique_ptr<DrawLib::Bitmap32 > bitmap_rotate(DrawLib::CreateBitmap32FromPNG(img.get()));
        bitmap_rotate.reset(DrawLib::CreateRotatedBitmap(*bitmap_rotate, true));

        DrawLib::Canvas32 canvas(bitmap_orig.get());
        canvas.SetAlphaMode(alphaop);

        DrawLib::DrawObject drawobj(&canvas);

        drawobj.SetFillTexture(bitmap_rotate.get(), DrawLib::IPoint(0,0));
        drawobj.SetFillMode   (DrawLib::DrawObject::TEXTURED);

        DrawLib::FPPoint ul(0,0);
        DrawLib::FPPoint lr(bitmap_rotate->GetWidth(), bitmap_rotate->GetHeight());
        drawobj.DrawRectangle(ul,lr);

        BLEX_TEST_CHECK(DoErrorCompare(reffile, *bitmap_orig, mse, true));
}
/*
BLEX_TEST_FUNCTION(ColorBurnTest)
{
        TestAnOperation("blend-colorburn.png", DrawLib::Canvas32::COLORBURN, 0);
}
BLEX_TEST_FUNCTION(ColorDodgeTest)
{
        TestAnOperation("blend-colordodge.png", DrawLib::Canvas32::COLORDODGE, 0);
}*/
BLEX_TEST_FUNCTION(DarkenTest)
{
        TestAnOperation("ref-blend-darken.png", DrawLib::Canvas32::DARKEN, 0.05);
}
BLEX_TEST_FUNCTION(DifferenceTest)
{
        TestAnOperation("ref-blend-difference.png", DrawLib::Canvas32::DIFFERENCE, 0.05);
}
BLEX_TEST_FUNCTION(ExclusionTest)
{
        TestAnOperation("ref-blend-exclusion.png", DrawLib::Canvas32::EXCLUSION, 0.05);
}/*
BLEX_TEST_FUNCTION(HardLightTest)
{
        TestAnOperation("blend-hardlight.png", DrawLib::Canvas32::HARDLIGHT, 0);
}*/
BLEX_TEST_FUNCTION(LightbeTest)
{
        TestAnOperation("ref-blend-lighten.png", DrawLib::Canvas32::LIGHTEN, 0.05);
}
BLEX_TEST_FUNCTION(LinearBurnTest)
{
        TestAnOperation("ref-blend-linearburn.png", DrawLib::Canvas32::LINEARBURN, 0.05);
}
BLEX_TEST_FUNCTION(LinearDodgeTest)
{
        TestAnOperation("ref-blend-lineardodge.png", DrawLib::Canvas32::LINEARDODGE, 0.05);
}
BLEX_TEST_FUNCTION(MultiplyTest)
{
        TestAnOperation("ref-blend-multiply.png", DrawLib::Canvas32::MULTIPLY, 0.05);
}/*
BLEX_TEST_FUNCTION(OverlayTest)
{
        TestAnOperation("blend-overlay.png", DrawLib::Canvas32::OVERLAY, 0);
}*/
BLEX_TEST_FUNCTION(ScreenTest)
{
        TestAnOperation("ref-blend-screen.png", DrawLib::Canvas32::SCREEN, 0.05);
}
