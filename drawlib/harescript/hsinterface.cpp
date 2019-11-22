#include <drawlib/drawlibv2/allincludes.h>
#include <blex/logfile.h>

#include <harescript/vm/hsvm_dllinterface_blex.h>
#include <drawlib/drawlibv2/bitmapio.h>
#include <drawlib/drawlibv2/bitmapmanip.h>
#include "drawlib/drawlibv2/kmeansquantize.h"
#include <harescript/vm/hsvm_context.h>
#include "infoobjects.h"

namespace DrawLibInterface_v2
{
using namespace DrawLib;

typedef std::shared_ptr<FontInfo>   FontInfoPtr;

typedef uint32_t DrawID;
typedef int32_t FontID;

const unsigned DrawlibContextId = 7; //reserved number for drawlib. DO NOT CHANGE!!!

struct CountResult
{
        unsigned numalpha;
        unsigned numcolors;
};

class DrawlibInterfaceState
{
public:
        DrawlibInterfaceState();
        ~DrawlibInterfaceState();

        //creates
        DrawID  CreateDrawObject                   (uint32_t width, uint32_t height, DrawLib::Pixel32 color);        //default background: color
        DrawID  CreateDuplicateDrawObject          (DrawID id);
        DrawID  CreateDrawObjectFromDrawObject     (DrawID id, uint32_t offsetx, uint32_t offsety, uint32_t width, uint32_t height);
        DrawID  CreateDrawObjectFromPNG            (Blex::Stream *stream);
        DrawID  CreateDrawObjectFromJPG            (Blex::Stream *stream, int decimation);
        DrawID  CreateDrawObjectFromGIF            (Blex::Stream *stream);
        DrawID  CreateDrawObjectFromFile           (Blex::RandomStream *stream);
        DrawID  CreateDrawObjectFromRaw            (Blex::RandomStream *stream, int width, int height, std::string const &format, bool premultiplied);
        DrawID  CreateResizedDrawObjectFromFile    (Blex::RandomStream *stream, int outwidth, int outheight);
        int32_t RegisterDrawObject                 (DrawInfo const *drawinfo);

        //bitmap operations
        int32_t CropDrawObject                     (DrawID id, uint32_t offsetx, uint32_t offsety, uint32_t width, uint32_t height);
        int32_t RotateDrawObject                     (DrawID id, bool rotate_right);
        int32_t MirrorDrawObject                     (DrawID id);
        int32_t ShearDrawObject                     (DrawID id, double scale);
        int32_t ResizeDrawObject                   (DrawID id, uint32_t newwidth, uint32_t newheight, bool fast);
        CountResult CountDrawObjectColors       (DrawID id, unsigned minimum_alpha);

        void ClearDrawObject                    (DrawID id, DrawLib::Pixel32 color);

        //set options
        void SetAlphaMode              (DrawID id, uint32_t mode);
        void SetBinaryMode             (DrawID id, uint32_t mode);

        void SetOutlineColor       (DrawID id, DrawLib::Pixel32 color);
        void SetOutlineWidth       (DrawID id, double width);
        void SetOutlineTexture     (DrawID id, DrawID texture, double offsetx, double offsety);
        void SetOutlineThreeDTexture (DrawID id, DrawID texture, TwoParamFunc const &sufunc, TwoParamFunc const &svfunc, TwoParamFunc const &szfunc);
        void SetOutlineMode        (DrawID id, DrawLib::DrawObject::FillMode);

        void SetFillColor      (DrawID id, DrawLib::Pixel32 color);
        void SetFillTexture    (DrawID id, DrawID texture, double offsetx, double offsety);
        void SetFillThreeDTexture (DrawID id, DrawID texture, TwoParamFunc const &sufunc, TwoParamFunc const &svfunc, TwoParamFunc const &szfunc);
        void SetFillMode       (DrawID id, DrawLib::DrawObject::FillMode mode);

        //get options
        uint32_t  GetWidth (DrawID id);
        uint32_t  GetHeight(DrawID id);
        uint32_t  GetTextWidth (FontID fid, std::string &text);
        uint32_t  GetTextHeight(FontID fid, std::string &text);
        uint32_t  GetAlphaMode(DrawID id);
        uint32_t  GetBinaryMode(DrawID id);
        uint32_t  GetPixel(DrawID id, double x, double y);
        uint32_t GetRefCount(DrawID id);

        //draw options
        void DrawEasterEgg     (DrawID id);         ///Create a mandelbrot
        void DrawDrawObject    (DrawID id, DrawID fid, double offsetx, double offsety);
        void DrawEllipse       (DrawID id, double centerx, double centery, double radiusx, double radiusy, bool outline);
        void DrawPolyPolygon   (DrawID id, const DrawLib::PolyPolygon &polylist);
        void DrawPixel         (DrawID id, double x, double y,  DrawLib::Pixel32 color);
        void DrawPlanes        (DrawID id, double x, double y,  int width, Blex::StringPair const &planes);
        void DrawLine          (DrawID id, double sx, double sy, double ex, double ey);
        void DrawRectangle     (DrawID id, double sx, double sy, double ex, double ey, bool outline);
        void StrokeFillPath          (DrawID id, DrawLib::Path const &path, bool stroke, bool fill);

        void DrawText          (DrawID id, FontID fid, double basex, double basey, std::string const & text);

        //TEXT STUFF HERE.....

        ///Create a new font. If the font doesn't exist.. tough.. no errors (yet)
        FontID CreateFont        (const std::string &fontname, const std::string &fontstyle, uint32_t pointsize);


        void   SetFontColor      (FontID fid, DrawLib::Pixel32 color);
        void   SetFontSize       (FontID fid, uint32_t size);
        void   SetFontLetterSpacing(FontID id, double spacing);
        void   SetFontAlignment  (FontID fid, uint32_t horizontal, uint32_t vertical);
        void   SetFontOrientation(FontID fid, signed base      , signed glyph);
        void   SetFontRenderMode (FontID fid, uint32_t rendertype); ///1 -> antialiased, ==0 -> no antialiasing!

        ///Comparing bitmaps for testing purposes
        double CompareCanvases(DrawID id1, DrawID id2);
        DrawID CreateDifferenceCanvas(DrawID id1, DrawID id2);

        ///Destroy an object... for powerusers only :)
        void DestroyDrawObject (DrawID id);
        void DestroyFont       (FontID id);

        // Bitmap filters...
        void BlurCanvas        (DrawID id, int xsize, int ysize);
        void GrayscaleCanvas   (DrawID id);
        void AlphaCanvas       (DrawID id, double multiply);
        void AlphaCanvasAdd    (DrawID id, int add);
        void InvertCanvas      (DrawID id);
        void MultiplyCanvas    (DrawID id1, DrawID id2);
        void ApplyColorMapping (DrawID id, DrawLib::ColorMapping &colormap);

        //FIXME: Unnecessary copying of getdrawinfo etc.. Unsafe reference passing..
        FontInfoPtr& GetFontInfo(FontID fid);

        int32_t ValidateDrawId(DrawID id) const;
        int32_t ValidateFontId(FontID id) const;

        //Path stuff here

        void RGBtoHSV(DrawLib::Pixel32 rgb, double *h, double *s, double *v);
        void HSVtoRGB(DrawLib::Pixel32 *rgb, double h, double s, double v);

        void CalculateKMeansQuantizedPalette(DrawID id, uint32_t clustercount, uint8_t minimum_alpha, int32_t max_iters, float initialpoint, std::vector< Pixel32 > *result);

        int32_t RegisterDrawInfo(std::unique_ptr<DrawLib::Bitmap32> &to_adopt);
        DrawInfo const& GetDrawInfoForRead(DrawID id) const;
        DrawInfo& GetDrawInfoForWrite(DrawID id);

        ///1-based drawinfo list
        std::vector<DrawInfo const *> drawinfos;
        private:
        std::vector<FontInfoPtr> fontinfolist;
};

DrawlibInterfaceState::DrawlibInterfaceState()
{

}
DrawlibInterfaceState::~DrawlibInterfaceState()
{
        for(unsigned i=0;i<drawinfos.size();++i)
           if(drawinfos[i])
               drawinfos[i]->DelRef();
}

inline Pixel32 HStoDrawlibPixel(uint32_t packed_hs_pixel)
{
        //Pixel32(packedcolor) 65536*red + 256* green + blue + 16.7m * alpha
        return Pixel32(packed_hs_pixel>>16
                      ,packed_hs_pixel>>8
                      ,packed_hs_pixel
                      ,packed_hs_pixel>>24);
}
inline uint32_t DrawlibtoHSPixel(DrawLib::Pixel32 drawlibpixel)
{
        //Pixel32(packedcolor) 65536*red + 256* green + blue + 16.7m * alpha
        return uint32_t( (drawlibpixel.GetA() << 24)
                  | (drawlibpixel.GetR() << 16)
                  | (drawlibpixel.GetG() <<  8)
                  | (drawlibpixel.GetB()      ) );
}

/*******************************************************************************
*
*  DRAWLIN INTERFACE STATE (internal functions supporting the externat
*
*******************************************************************************/

int32_t DrawlibInterfaceState::ValidateDrawId(DrawID id) const
{
        //now this is a nice place to build caching :)
        if (id<=0 || id > drawinfos.size() || !drawinfos[id-1])
            return -1;
        return 0; //ok
}

int32_t DrawlibInterfaceState::ValidateFontId(FontID id) const
{
        if (id <= 0x00010000L || unsigned(id - 0x00010000L) > fontinfolist.size() )
            return -1;

        return 0; //ok
}
DrawInfo const& DrawlibInterfaceState::GetDrawInfoForRead(DrawID id) const
{
        if (id<=0 || id > drawinfos.size() || !drawinfos[id-1])
            throw std::runtime_error("Drawlib: Invalid canvas id");

        //Blex::ErrStream() << "Returning " << id << " ptr " << (void*)drawinfos[id-1];
        return *drawinfos[id-1];

}
DrawInfo& DrawlibInterfaceState::GetDrawInfoForWrite(DrawID id)
{
        DrawInfo const& drawinfo = GetDrawInfoForRead(id);

        {
                Blex::Mutex::AutoLock lock(drawinfo_refcount_mutex);
                if(drawinfo.refcount==1)
                      return const_cast<DrawInfo&>(drawinfo); //we have the only reference, so it's safe to give out a write-only reference
        }

        //Blex::ErrStream() << "Forced to create a copy\n";
        //Blex::DumpStackTrace();

        //create a copy
        std::unique_ptr<DrawLib::Bitmap32> bm(new DrawLib::Bitmap32(drawinfo.GetBitmap()));
        drawinfos[id-1] = new DrawInfo(bm);
        drawinfos[id-1]->AddRef();

        drawinfo.DelRef(); //deref original
        return const_cast<DrawInfo&>(*drawinfos[id-1]);
}

int32_t DrawlibInterfaceState::RegisterDrawObject(DrawInfo const *drawinfo)
{
        unsigned freepos = std::distance(drawinfos.begin(), std::find(drawinfos.begin(), drawinfos.end(), (DrawInfo*)0));
        if(freepos >= drawinfos.size())
                drawinfos.push_back(NULL);

        drawinfo->AddRef();

        //Blex::ErrStream() << "Register drawinfo " << (void*)drawinfo << " as " << freepos;
        drawinfos[freepos] = drawinfo;
        return freepos+1;
}

int32_t DrawlibInterfaceState::RegisterDrawInfo(std::unique_ptr<DrawLib::Bitmap32> &to_adopt)
{
        std::unique_ptr<DrawInfo> di(new DrawInfo(to_adopt));
        int32_t pos = RegisterDrawObject(di.get());
        di.release();
        return pos;
}

DrawID DrawlibInterfaceState::CreateDrawObject(uint32_t width, uint32_t height, DrawLib::Pixel32 color)
{
        std::unique_ptr<DrawLib::Bitmap32> bm(new DrawLib::Bitmap32(width, height, color));
        return RegisterDrawInfo(bm);
}

DrawID  DrawlibInterfaceState::CreateDrawObjectFromPNG (Blex::Stream *stream)
{
        try
        {
                std::unique_ptr<DrawLib::Bitmap32> bm(DrawLib::CreateBitmap32FromPNG(stream));
                if (!bm.get())
                    return 0;//couldn't read anything..
                return RegisterDrawInfo(bm);
        }
        catch(std::exception &e) //corrupted file, I guess (ADDME: drawlib should create better exceptions so we only intercept file format errors)
        {
                DEBUGPRINT("Drawlib I/O exception: " << e.what());
                return 0;
        }
}

DrawID  DrawlibInterfaceState::CreateDrawObjectFromJPG (Blex::Stream *stream, int decimation)
{
        try
        {
                std::unique_ptr<DrawLib::Bitmap32> bm(DrawLib::CreateBitmap32FromJPG(stream, decimation));
                if (!bm.get())
                    return 0;//couldn't read anything..
                return RegisterDrawInfo(bm);
        }
        catch(std::exception &e) //corrupted file, I guess (ADDME: drawlib should create better exceptions so we only intercept file format errors)
        {
                DEBUGPRINT("Drawlib I/O exception: " << e.what());
                return 0;
        }
}

DrawID  DrawlibInterfaceState::CreateDrawObjectFromGIF (Blex::Stream *stream)
{
        try
        {
                std::unique_ptr<DrawLib::Bitmap32> bm(DrawLib::CreateBitmap32FromGIF(stream));
                if (!bm.get())
                    return 0;//couldn't read anything..
                return RegisterDrawInfo(bm);
        }
        catch(std::exception &e) //corrupted file?:
        {
                DEBUGPRINT("Drawlib I/O exception: " << e.what());
                return 0;
        }
}

DrawID  DrawlibInterfaceState::CreateDrawObjectFromFile (Blex::RandomStream *stream)
{
        try
        {
                std::unique_ptr<DrawLib::Bitmap32> bm(DrawLib::CreateBitmap32Magic(stream));
                if (!bm.get())
                    return 0;//couldn't read anything..
                return RegisterDrawInfo(bm);
        }
        catch(std::exception &e) //corrupted file?:
        {
                DEBUGPRINT("Drawlib I/O exception: " << e.what());
                return 0;
        }
}

DrawID  DrawlibInterfaceState::CreateDrawObjectFromRaw (Blex::RandomStream *stream, int width, int height, std::string const &format, bool premultiplied)
{
        try
        {
                std::unique_ptr<DrawLib::Bitmap32> bm(CreateBitmap32FromRaw(*stream, width, height, format, premultiplied));
                if (!bm.get())
                    return 0;//couldn't read anything..

                return RegisterDrawInfo(bm);
        }
        catch(std::exception &e) //corrupted file?:
        {
                DEBUGPRINT("Drawlib I/O exception: " << e.what());
                return 0;
        }
}

DrawID  DrawlibInterfaceState::CreateResizedDrawObjectFromFile (Blex::RandomStream *stream,
        int out_width, int out_height)
{
        try
        {
                std::unique_ptr<DrawLib::Bitmap32> bm(DrawLib::CreateBitmap32Magic(stream, DrawLib::ISize(out_width, out_height)));
                if (!bm.get())
                    return 0;//couldn't read anything..
                return RegisterDrawInfo(bm);
        }
        catch(std::exception &e) //corrupted file?:
        {
                DEBUGPRINT("Drawlib I/O exception: " << e.what());
                return 0;
        }
}


void   DrawlibInterfaceState::ClearDrawObject(DrawID id, DrawLib::Pixel32 color)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);

        DrawLib::Scanline32 filler(drawinfo.GetBitmap().GetWidth(), true, color);
        for (unsigned i=0;i < drawinfo.GetBitmap().GetHeight(); ++i)
            drawinfo.GetBitmap().SetScanline32(i, filler);
}

int32_t   DrawlibInterfaceState::RotateDrawObject(DrawID id, bool rotate_right)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);

        //check already done in GetDrawInfo !!if (id <= drawinfolist.size())
        DrawLib::Bitmap32 * rotatedbitmap = DrawLib::CreateRotatedBitmap(drawinfo.GetBitmap(), rotate_right);
        if (rotatedbitmap !=NULL)
        {
                drawinfo.AdoptNewBitmap(rotatedbitmap);
                return 0;
        }
        else
                return -1;
}
int32_t   DrawlibInterfaceState::MirrorDrawObject(DrawID id)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);

        //check already done in GetDrawInfo !!if (id <= drawinfolist.size())
        DrawLib::Bitmap32 * mirroredbitmap = DrawLib::CreateMirroredBitmap(drawinfo.GetBitmap());
        if (mirroredbitmap !=NULL)
        {
                drawinfo.AdoptNewBitmap(mirroredbitmap);
                return 0;
        }
        else
                return -1;
}

int32_t   DrawlibInterfaceState::ShearDrawObject(DrawID id, double scale)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);
        DrawLib::Bitmap32 * shearedbitmap = DrawLib::CreateShearedBitmap(drawinfo.GetBitmap(), scale);
        if (shearedbitmap !=NULL)
        {
                drawinfo.AdoptNewBitmap(shearedbitmap);
                return 0;
        }
        else
                return -1;
}

int32_t   DrawlibInterfaceState::CropDrawObject(DrawID id, uint32_t offsetx, uint32_t offsety, uint32_t width, uint32_t height)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);

        //check already done in GetDrawInfo !!if (id <= drawinfolist.size())
        DrawLib::Bitmap32 * croppedbitmap = DrawLib::CreateCroppedBitmap(drawinfo.GetBitmap(),
                                                                         DrawLib::IRect(offsetx,offsety,offsetx+width,offsety+height) );
        if (croppedbitmap !=NULL)
        {
                drawinfo.AdoptNewBitmap(croppedbitmap);
                return 0;
        }
        else
                return -1;
}

int32_t   DrawlibInterfaceState::ResizeDrawObject(DrawID id, uint32_t newwidth, uint32_t newheight, bool /*fast*/)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);         //check already done in GetDrawInfo !!if (id <= drawinfolist.size())

        DrawLib::Bitmap32 * resizedbitmap;

        resizedbitmap = DrawLib::CreateResizedBitmap(drawinfo.GetBitmap(), DrawLib::ISize(newwidth, newheight) );
        if (resizedbitmap!=NULL)
        {
                drawinfo.AdoptNewBitmap(resizedbitmap);
                return 0;
        }
        else
                return -1;
}

CountResult DrawlibInterfaceState::CountDrawObjectColors       (DrawID id, unsigned minimum_alpha)
{
        CountResult counters;
        DrawInfo const& drawinfo = GetDrawInfoForRead(id);         //check already done in GetDrawInfo !!if (id <= drawinfolist.size())

        DrawLib::Octree my_octree;
        counters.numalpha = DrawLib::FillOctreeAndCountAlpha(drawinfo.GetBitmap(), my_octree, minimum_alpha) > 0;
        counters.numcolors = my_octree.GetTotalColors();

        return counters;
}

void   DrawlibInterfaceState::SetAlphaMode(DrawID id, uint32_t alphamode)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);
        DrawLib::Canvas32::AlphaOperationMode mode = static_cast<DrawLib::Canvas32::AlphaOperationMode>(alphamode);
        drawinfo.GetCanvas().SetAlphaMode(mode);
}

uint32_t     DrawlibInterfaceState::GetAlphaMode(DrawID id)
{
        DrawInfo const& drawinfo = GetDrawInfoForRead(id);
        uint32_t retval = static_cast<uint32_t>(drawinfo.GetCanvas().GetAlphaMode());
        return retval;
}

void   DrawlibInterfaceState::SetBinaryMode(DrawID id, uint32_t binarymode)
{
        DrawInfo &drawinfo = GetDrawInfoForWrite(id);
        DrawLib::Canvas32::PixelOperationMode mode = static_cast<DrawLib::Canvas32::PixelOperationMode>(binarymode);
        drawinfo.GetCanvas().SetBinaryMode(mode);
}

uint32_t     DrawlibInterfaceState::GetBinaryMode(DrawID id)
{
        DrawInfo const&drawinfo = GetDrawInfoForRead(id);
        uint32_t retval = static_cast<uint32_t>(drawinfo.GetCanvas().GetBinaryMode());
        return retval;
}

/**********************************************************************************************
BITMAP COMPARE FUNCTIONS
*********************************************************************************************/
//        double  CompareCanvases(DrawID id1, DrawID id2);

DrawID  DrawlibInterfaceState::CreateDifferenceCanvas(DrawID id1, DrawID id2)
{
        DrawInfo const& src1 = GetDrawInfoForRead(id1);
        DrawInfo const& src2 = GetDrawInfoForRead(id2);

        try
        {
                std::unique_ptr<DrawLib::Bitmap32 > bitmapptr (DrawLib::DifferenceBitmap( src1.GetBitmap(), src2.GetBitmap(), false)   );
                return RegisterDrawInfo(bitmapptr);
        }
        catch(std::exception &e) //corrupted file, I guess (ADDME: drawlib should create better exceptions so we only intercept file format errors)
        {
                DEBUGPRINT("Drawlib I/O exception: " << e.what());
                return 0;
        }
}

double  DrawlibInterfaceState::CompareCanvases(DrawID id1, DrawID id2)
{
        DrawInfo const& src1 = GetDrawInfoForRead(id1);
        DrawInfo const& src2 = GetDrawInfoForRead(id2);

        return DrawLib::MeanSquareError(src1.GetBitmap(), src2.GetBitmap(), false, false);
}

/**********************************************************************************************
OUTLINE SET FUNCTIONS
*********************************************************************************************/
void   DrawlibInterfaceState::SetOutlineMode(DrawID id, DrawLib::DrawObject::FillMode mode)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);
        drawinfo.GetDrawObject().SetOutlineMode(mode);
}
void   DrawlibInterfaceState::SetOutlineColor(DrawID id, DrawLib::Pixel32 color)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);
        drawinfo.GetDrawObject().SetOutlineColor(color);
}
void   DrawlibInterfaceState::SetOutlineWidth(DrawID id, double width)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);
        drawinfo.GetDrawObject().SetOutlineWidth( width);
}
void DrawlibInterfaceState::SetOutlineTexture (DrawID id, DrawID texture, double offsetx, double offsety)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);
        DrawLib::IPoint offset( static_cast<int32_t> (offsetx) ,
                                static_cast<int32_t> (offsety));
        drawinfo.GetDrawObject().SetOutlineTexture( &GetDrawInfoForRead(texture).GetBitmap(), offset );
}
void DrawlibInterfaceState::SetOutlineThreeDTexture (DrawID id, DrawID texture, TwoParamFunc const &sufunc, TwoParamFunc const &svfunc, TwoParamFunc const &szfunc)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);
        drawinfo.GetDrawObject().SetOutlineThreeDTexture(&GetDrawInfoForRead(texture).GetBitmap(), sufunc, svfunc, szfunc);
}


/**********************************************************************************************
FILL SET FUNCTIONS
*********************************************************************************************/
void   DrawlibInterfaceState::SetFillMode(DrawID id, DrawLib::DrawObject::FillMode mode)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);
        drawinfo.GetDrawObject().SetFillMode(mode);
}

void   DrawlibInterfaceState::SetFillColor(DrawID id, DrawLib::Pixel32 color)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);
        drawinfo.GetDrawObject().SetFillColor(color);
}

void DrawlibInterfaceState::SetFillTexture (DrawID id, DrawID texture, double offsetx, double offsety)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);
        DrawLib::IPoint offset( static_cast<int32_t> (offsetx) ,
                                static_cast<int32_t> (offsety));
        drawinfo.GetDrawObject().SetFillTexture( &GetDrawInfoForRead(texture).GetBitmap(), offset );
}

void DrawlibInterfaceState::SetFillThreeDTexture (DrawID id, DrawID texture, TwoParamFunc const &sufunc, TwoParamFunc const &svfunc, TwoParamFunc const &szfunc)
{
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);
        drawinfo.GetDrawObject().SetFillThreeDTexture(&GetDrawInfoForRead(texture).GetBitmap(), sufunc, svfunc, szfunc);
}
uint32_t DrawlibInterfaceState::GetRefCount(DrawID id)
{
        DrawInfo const&drawinfo = GetDrawInfoForRead(id);
        return drawinfo.refcount;
}

uint32_t DrawlibInterfaceState::GetWidth(DrawID id)
{
        DrawInfo const&drawinfo = GetDrawInfoForRead(id);
        return drawinfo.GetDrawObject().GetCanvas()->GetWidth();
}

uint32_t DrawlibInterfaceState::GetHeight(DrawID id)
{
        DrawInfo const&drawinfo = GetDrawInfoForRead(id);
        return drawinfo.GetDrawObject().GetCanvas()->GetHeight();
}

FontInfoPtr& DrawlibInterfaceState::GetFontInfo(FontID id)
{
        // font handles start at 0x00010000 HEX!  (maak daar dan een constante van!)
        uint32_t index = id - 0x00010000;

        if (index<=0 || index>fontinfolist.size())
            throw std::runtime_error("Drawlib: Font handle out of legal range");

        if (fontinfolist[index-1]==NULL)
            throw std::runtime_error("Drawlib: Canvas already closed");

        return fontinfolist[index-1];
}

DrawID DrawlibInterfaceState::CreateDuplicateDrawObject(DrawID id)
{
        DrawInfo const& drawinfo = GetDrawInfoForRead(id);
        //Blex::ErrStream() << "Sharing canvas " << (void*)&drawinfo;
        return RegisterDrawObject(&drawinfo);
}

DrawID DrawlibInterfaceState::CreateDrawObjectFromDrawObject(DrawID id, uint32_t offsetx, uint32_t offsety, uint32_t width, uint32_t height)
{
        DrawInfo const& drawinfo = GetDrawInfoForRead(id);

        std::unique_ptr<DrawLib::Bitmap32 > bitmapptr (DrawLib::CreateCroppedBitmap(drawinfo.GetBitmap(), DrawLib::IRect(offsetx, offsety, offsetx+width, offsety+height)));
        return RegisterDrawInfo(bitmapptr);
}


/*********************************************************************************
 DRAW FUNCTIONS
*********************************************************************************/

void DrawlibInterfaceState::DrawDrawObject(DrawID id, DrawID fid, double offsetx, double offsety)
{
        DrawInfo & canvas_drawinfo = GetDrawInfoForWrite(id);
        DrawInfo const& texture_ptr = GetDrawInfoForRead(fid);
        DrawLib::IPoint offset(offsetx,offsety);

        canvas_drawinfo.GetDrawObject().SetFillTexture(&texture_ptr.GetBitmap(), offset );
        canvas_drawinfo.GetDrawObject().SetFillMode   (DrawLib::DrawObject::TEXTURED);

        DrawLib::FPPoint ul(offsetx, offsety);
        DrawLib::FPPoint lr(    offsetx+texture_ptr.GetCanvas().GetWidth()  ,
                                offsety+texture_ptr.GetCanvas().GetHeight());
        canvas_drawinfo.GetDrawObject().DrawRectangle(ul,lr);

        //ADDME: Set back to original mode
        canvas_drawinfo.GetDrawObject().SetFillMode   (DrawLib::DrawObject::SOLID);
}

void DrawlibInterfaceState::DrawEasterEgg (DrawID /*id*/)
{       ///Create a mandelbrot
        // NOT IMPLEMENTED YET!

}

void DrawlibInterfaceState::DrawPixel(DrawID id, double x, double y,  DrawLib::Pixel32 pixel)
{
        GetDrawInfoForWrite(id).GetDrawObject().DrawPixel(DrawLib::FPPoint(x,y),pixel);
}

void DrawlibInterfaceState::DrawPlanes(DrawID id, double x, double y,  int width, Blex::StringPair const &planes)
{
        if( (planes.size() % width != 0) || (planes.size() / width) != 4)
            return;

        DrawInfo& drawinfo = GetDrawInfoForWrite(id);
        DrawLib::Scanline32 scanline(drawinfo.GetBitmap().GetWidth(), false);       // create a scanline

        int startx = RoundFloat(x);
        if(startx + width > 0 && unsigned(startx + width) > drawinfo.GetBitmap().GetWidth())
            return;

        for(;startx<width;++startx)
        {
                scanline.SetMask(startx, true);
                scanline.Pixel(startx).SetRGBA(planes.begin[startx], planes.begin[startx+width], planes.begin[startx+width*2], planes.begin[startx+width*3]);
        }
        drawinfo.GetBitmap().SetScanline32(RoundFloat(y), scanline);       // write the scanline to the canvas
}


uint32_t DrawlibInterfaceState::GetPixel(DrawID id, double x, double y)
{
        DrawInfo const&drawinfo = GetDrawInfoForRead(id);
        return DrawlibtoHSPixel(drawinfo.GetDrawObject().GetPixel(DrawLib::FPPoint(x,y)));
}


void DrawlibInterfaceState::DrawLine (DrawID id, double sx, double sy, double ex, double ey)
{
        DrawLib::PolyLine polyline;

        polyline.points.push_back(DrawLib::FPPoint(sx,sy));
        polyline.points.push_back(DrawLib::FPPoint(ex,ey));
        GetDrawInfoForWrite(id).GetDrawObject().DrawPolyLine(polyline);
}

void DrawlibInterfaceState::DrawEllipse  (DrawID id, double centerx, double centery, double radiusx, double radiusy, bool outline)
{
        DrawLib::FPPoint center (centerx, centery);
        DrawLib::FPSize  size   (radiusx ,radiusy);
        if (outline)
                GetDrawInfoForWrite(id).GetDrawObject().DrawEllipseOutline(center,size);
        else
                GetDrawInfoForWrite(id).GetDrawObject().DrawEllipse(center,size);

}

void DrawlibInterfaceState::StrokeFillPath (DrawID id, DrawLib::Path const &path, bool stroke, bool fill)
{
       GetDrawInfoForWrite(id).GetDrawObject().StrokeFillPath(path, stroke, fill);
}

void DrawlibInterfaceState::DrawRectangle (DrawID id, double sx, double sy, double ex, double ey, bool outline)
{
        DrawLib::FPPoint upper_left (sx, sy);
        DrawLib::FPPoint lower_right(ex, ey);
        if (outline)
                GetDrawInfoForWrite(id).GetDrawObject().DrawRectangleOutline(upper_left,lower_right);
        else
                GetDrawInfoForWrite(id).GetDrawObject().DrawRectangle(upper_left,lower_right);
}

void DrawlibInterfaceState::DrawText  (DrawID id, FontID fid, double basex, double basey, std::string const & text)
{
        FontInfoPtr fontptr = GetFontInfo(fid);
        DrawInfo& drawinfo = GetDrawInfoForWrite(id);

        DrawLib::FPPoint basepoint(basex,basey);


        Blex::UnicodeString unicode_text;
        Blex::UTF8Decode(reinterpret_cast<const uint8_t*>(&text[0]),reinterpret_cast<const uint8_t*>(&text[text.size()]), std::back_inserter(unicode_text));
        std::vector<double> deltas; // dummy var!
        drawinfo.GetDrawObject().DrawTextExtended(
                basepoint,
                unicode_text ,
                *(fontptr->font.get()),
                deltas,
                (fontptr->rendermode==1),
                fontptr->horizontal_alignment,
                fontptr->vertical_alignment,
                fontptr->baseline_angle,
                fontptr->glyph_angle,
                fontptr->letterspacing
                );

        //FIXME: NOT IMPLEMENTED YET
//        GetDrawInfoForWrite(id).GetDrawObject().DrawString(basex, basey, text.c_str());
}

FontID DrawlibInterfaceState::CreateFont(const std::string &fontname, const std::string &fontstyle, uint32_t pointsize)
{
        //ADDME Why print the old ID?
        DEBUGPRINT(fontinfolist.size() + 0x00010000L+1);

        //FIXME: check for NULL font somewhere! maybe in FontInfo()??
        FontInfoPtr newfontinfo(new FontInfo(fontname,fontstyle)); //create a new fontinfo-object and a pointer to it.

        if (newfontinfo.get()->font.get()==NULL)
                return -1;

        fontinfolist.push_back(newfontinfo);

        DrawLib::FPSize size(pointsize, pointsize);
        newfontinfo->font->SetSize(size);

        return (fontinfolist.size()+ 0x00010000L); //fontlist is 1+offset - based, so this is correct
}

void DrawlibInterfaceState::DestroyFont(FontID id)
{
        uint32_t index = id -0x00010000L;
        if ((index>0) && (index<=fontinfolist.size()))
                fontinfolist[(index-1)].reset();
        DEBUGPRINT("DestroyFont called");
}


void DrawlibInterfaceState::DestroyDrawObject(DrawID id)
{
        GetDrawInfoForRead(id).DelRef();
        drawinfos[id-1] = NULL;
        DEBUGPRINT("DestroyDrawObject called");
}

/********************************************************************************
* Font functions
*
********************************************************************************/
void   DrawlibInterfaceState::SetFontColor(FontID id, DrawLib::Pixel32 color)
{
        FontInfoPtr fip = GetFontInfo (  id );
        fip->font->SetColor(color);
}

void   DrawlibInterfaceState::SetFontSize(FontID id, uint32_t size)
{
        FontInfoPtr fip = GetFontInfo (  id );
        fip->font->SetISize(DrawLib::ISize(size,size));
}

void   DrawlibInterfaceState::SetFontLetterSpacing(FontID id, double spacing)
{
        FontInfoPtr fip = GetFontInfo (  id );
        fip->letterspacing = spacing;
}

void   DrawlibInterfaceState::SetFontAlignment(FontID id, uint32_t hor, uint32_t ver)
{
        FontInfoPtr fip = GetFontInfo (  id );
        fip->horizontal_alignment = DrawLib::TextRenderer::HorizontalAlignment(hor);
        fip->vertical_alignment   = DrawLib::TextRenderer::VerticalAlignment(ver);
}

void   DrawlibInterfaceState::SetFontOrientation(FontID id, signed base, signed glyph)
{
        FontInfoPtr fip = GetFontInfo (  id );
        fip->baseline_angle = base;
        fip->glyph_angle    = glyph;
}

void   DrawlibInterfaceState::SetFontRenderMode(FontID id, uint32_t mode)
{ //mode is guaranteed 0 or 1.
        FontInfoPtr fip = GetFontInfo (  id );
        fip->rendermode = mode;
}

uint32_t   DrawlibInterfaceState::GetTextWidth(FontID fid, std::string &text)
{
        FontInfoPtr fptr = GetFontInfo(fid);

        if (fptr->font.get()==NULL)
                throw(std::runtime_error("GetTextWidth tried to reference NULL font."));

        DrawLib::TextRenderer renderer;

        Blex::UnicodeString unicode_text;
        Blex::UTF8Decode(reinterpret_cast<const uint8_t*>(&text[0]),reinterpret_cast<const uint8_t*>(&text[text.size()]), std::back_inserter(unicode_text));
        std::vector<double> deltas;      // dummy
        DrawLib::FPBoundingBox bbox = renderer.CalculateBoundingBox(unicode_text,
                DrawLib::FPPoint(0,0),
                *(fptr->font.get()),
                deltas,
                (fptr->rendermode==1),
                fptr->baseline_angle,
                fptr->glyph_angle,
                (DrawLib::TextRenderer::HorizontalAlignment)fptr->horizontal_alignment,
                (DrawLib::TextRenderer::VerticalAlignment)fptr->vertical_alignment,
                fptr->letterspacing);

        return static_cast<uint32_t>(bbox.lower_right.x - bbox.upper_left.x);
}



uint32_t   DrawlibInterfaceState::GetTextHeight(FontID fid, std::string &text)
{
        FontInfoPtr fptr = GetFontInfo(fid);

        if (fptr->font.get()==NULL)
                throw(std::runtime_error("GetTextHeight tried to reference NULL font."));

        DrawLib::TextRenderer renderer;

        Blex::UnicodeString unicode_text;
        Blex::UTF8Decode(reinterpret_cast<const uint8_t*>(&text[0]),reinterpret_cast<const uint8_t*>(&text[text.size()]), std::back_inserter(unicode_text));
        std::vector<double> deltas;      // dummy
        DrawLib::FPBoundingBox bbox = renderer.CalculateBoundingBox(unicode_text,
                DrawLib::FPPoint(0,0),
                *(fptr->font.get()),
                deltas,
                (fptr->rendermode==1),
                fptr->baseline_angle,
                fptr->glyph_angle,
                (DrawLib::TextRenderer::HorizontalAlignment)fptr->horizontal_alignment,
                (DrawLib::TextRenderer::VerticalAlignment)fptr->vertical_alignment,
                fptr->letterspacing);

        return static_cast<uint32_t>(bbox.lower_right.y - bbox.upper_left.y);
}

void    DrawlibInterfaceState::BlurCanvas(DrawID cid, int xsize, int ysize)
{
        DrawInfo& dptr = GetDrawInfoForWrite(cid);
        DrawLib::Blur(&dptr.GetBitmap(), xsize, ysize );
}
void    DrawlibInterfaceState::GrayscaleCanvas(DrawID cid)
{
        DrawInfo& dptr = GetDrawInfoForWrite(cid);
        DrawLib::MakeBitmapGreyscale(&dptr.GetBitmap());
}
void    DrawlibInterfaceState::AlphaCanvas(DrawID cid, double multiply)
{
        DrawInfo& dptr = GetDrawInfoForWrite(cid);
        DrawLib::MultiplyAlphaChannel(&dptr.GetBitmap(), multiply);
}
void    DrawlibInterfaceState::AlphaCanvasAdd(DrawID cid, int add)
{
        DrawInfo& dptr = GetDrawInfoForWrite(cid);
        DrawLib::AddAlphaChannel(&dptr.GetBitmap(), add);
}
void    DrawlibInterfaceState::InvertCanvas(DrawID cid)
{
        DrawInfo& dptr = GetDrawInfoForWrite(cid);
        DrawLib::InvertBitmap(&dptr.GetBitmap());
}
void    DrawlibInterfaceState::MultiplyCanvas(DrawID cid1, DrawID cid2)
{
        DrawInfo& dptr1 = GetDrawInfoForWrite(cid1);
        DrawInfo& dptr2 = GetDrawInfoForWrite(cid2);
        DrawLib::MultiplyBitmap(&dptr1.GetBitmap(), dptr2.GetBitmap());
}
void    DrawlibInterfaceState::ApplyColorMapping(DrawID cid, DrawLib::ColorMapping &colormap)
{
        DrawInfo& dptr = GetDrawInfoForWrite(cid);
        DrawLib::ApplyColorMapping(&dptr.GetBitmap(), colormap);
}

void DrawlibInterfaceState::RGBtoHSV(Pixel32 rgb, double *h, double *s, double *v)
{
        DrawLib::RGBtoHSV(rgb, h, s, v);
}

void DrawlibInterfaceState::HSVtoRGB(Pixel32 *rgb, double h, double s, double v)
{
        DrawLib::HSVtoRGB(h, s, v, rgb);
}

void DrawlibInterfaceState::CalculateKMeansQuantizedPalette(DrawID id, uint32_t clustercount, uint8_t minimum_alpha, int32_t max_iters, float initialpoint, std::vector< Pixel32 > *result)
{
        DrawInfo const& drawinfo = GetDrawInfoForRead(id);
        *result = KMeansQuantize(drawinfo.GetBitmap(), clustercount, minimum_alpha, max_iters, initialpoint);
}


/*******************************************************************************
*
*  HareScript/C interface to our C++ DrawLib interface. The functions here should
*  only bother about converting HareScript parameters/returnvalues to C++ parameters
*
*  Exceptions may NOT pass through the C DLL interface !
*
*******************************************************************************/

/* the OPEN_WRAPPER macro sets up the catching of C++ exceptions, and places our
   context into a 'context' structure */
#define OPEN_WRAPPER                    \
try {                                   \
DrawlibInterfaceState *context = static_cast<DrawlibInterfaceState *>(HSVM_GetContext(vm,DrawlibContextId, true));

/* the CLOSE_WRAPPER macro closes the above catch block and translates any C++ exceptions to
   HareScript errors */
#define CLOSE_WRAPPER                   \
} catch(std::exception &e) {            \
        HSVM_ReportCustomError(vm, e.what());   \
}

//Call CreateCanvas
void  DLv2_ValidateDrawId(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        int32_t returncode = context->ValidateDrawId(HSVM_IntegerGet(vm,HSVM_Arg(0)));
        HSVM_IntegerSet(vm,id_set,returncode);

        CLOSE_WRAPPER
}

void  DLv2_ValidateFontId(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        int32_t returncode = context->ValidateFontId(HSVM_IntegerGet(vm,HSVM_Arg(0)));
        HSVM_IntegerSet(vm,id_set,returncode);

        CLOSE_WRAPPER
}

void  DLv2_MakeCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        //Create a canvas object
        DrawID newcanvasid = context->CreateDrawObject(HSVM_IntegerGet(vm,HSVM_Arg(0)),
                                                     HSVM_IntegerGet(vm,HSVM_Arg(1)),
                                                     HStoDrawlibPixel(HSVM_IntegerGet(vm,HSVM_Arg(2)) ));

        HSVM_IntegerSet(vm,id_set,newcanvasid);

        CLOSE_WRAPPER
}

void  DLv2_EasterEgg(HSVM *vm)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));

        //FIXME:
        context->DrawEasterEgg(id);

        CLOSE_WRAPPER
}

void  DLv2_BlurCanvas(HSVM *vm)
{
        OPEN_WRAPPER
        context->BlurCanvas(HSVM_IntegerGet(vm, HSVM_Arg(0)), HSVM_IntegerGet(vm, HSVM_Arg(1)), HSVM_IntegerGet(vm, HSVM_Arg(2)));
        CLOSE_WRAPPER
}
void  DLv2_GrayscaleCanvas(HSVM *vm)
{
        OPEN_WRAPPER
        context->GrayscaleCanvas(HSVM_IntegerGet(vm, HSVM_Arg(0)));
        CLOSE_WRAPPER
}
void  DLv2_AlphaCanvas(HSVM *vm)
{
        OPEN_WRAPPER
        context->AlphaCanvas(HSVM_IntegerGet(vm, HSVM_Arg(0)), HSVM_FloatGet(vm, HSVM_Arg(1)));
        CLOSE_WRAPPER
}

void  DLv2_AlphaCanvasAdd(HSVM *vm)
{
        OPEN_WRAPPER
        context->AlphaCanvasAdd(HSVM_IntegerGet(vm, HSVM_Arg(0)), HSVM_IntegerGet(vm, HSVM_Arg(1)));
        CLOSE_WRAPPER
}

void  DLv2_ApplyColorMapping(HSVM *vm)
{
        OPEN_WRAPPER
        DrawLib::ColorMapping colormap;

        HSVM_ColumnId from_id = HSVM_GetColumnId(vm,"from_color");
        HSVM_ColumnId to_id =   HSVM_GetColumnId(vm,"to_color");

        unsigned length = HSVM_ArrayLength(vm, HSVM_Arg(1));

        for (unsigned i = 0; i < length; ++i)
        {
                HSVM_VariableId rec = HSVM_ArrayGetRef(vm, HSVM_Arg(1), i);

                HSVM_VariableId from = HSVM_RecordGetRef(vm, rec, from_id);
                HSVM_VariableId to = HSVM_RecordGetRef(vm, rec, to_id);

                if (HSVM_GetType(vm, from) != HSVM_VAR_Integer || HSVM_GetType(vm, to) != HSVM_VAR_Integer)
                  throw std::runtime_error("Expected from_color and to_color of type INTEGER");

                uint32_t fromval = HStoDrawlibPixel(HSVM_IntegerGet(vm, from)).GetPixelValue();
                uint32_t toval = HStoDrawlibPixel(HSVM_IntegerGet(vm, to)).GetPixelValue();

                colormap[fromval] = toval;
        }
        context->ApplyColorMapping(HSVM_IntegerGet(vm, HSVM_Arg(0)), colormap);
        CLOSE_WRAPPER
}

void  DLv2_InvertCanvas(HSVM *vm)
{
        OPEN_WRAPPER
        context->InvertCanvas(HSVM_IntegerGet(vm, HSVM_Arg(0)));
        CLOSE_WRAPPER
}
void  DLv2_MultiplyCanvas(HSVM *vm)
{
        OPEN_WRAPPER
        context->MultiplyCanvas(HSVM_IntegerGet(vm, HSVM_Arg(0)), HSVM_IntegerGet(vm, HSVM_Arg(1)));
        CLOSE_WRAPPER
}


void  DLv2_DrawPlanes(HSVM *vm)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t sx = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t sy = HSVM_IntegerGet(vm,HSVM_Arg(2));
        int32_t w = HSVM_IntegerGet(vm,HSVM_Arg(3));
        Blex::StringPair pair;
        HSVM_StringGet(vm, HSVM_Arg(4), &pair.begin, &pair.end);

        context->DrawPlanes(id , sx, sy, w, pair);

        CLOSE_WRAPPER
}

void  DLv2_DrawPixel(HSVM *vm)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t sx = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t sy = HSVM_IntegerGet(vm,HSVM_Arg(2));
        DrawLib::Pixel32 packedcolor = HStoDrawlibPixel(HSVM_IntegerGet(vm,HSVM_Arg(3)));
        context->DrawPixel(id , sx, sy, packedcolor);

        CLOSE_WRAPPER
}

void  DLv2_GetPixel(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t sx = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t sy = HSVM_IntegerGet(vm,HSVM_Arg(2));

        uint32_t c = context->GetPixel(id,sx,sy);

        HSVM_IntegerSet(vm,id_set, c);

        CLOSE_WRAPPER
}

void  DLv2_DrawRectangle(HSVM *vm)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t sx = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t sy = HSVM_IntegerGet(vm,HSVM_Arg(2));
        int32_t ex = HSVM_IntegerGet(vm,HSVM_Arg(3));
        int32_t ey = HSVM_IntegerGet(vm,HSVM_Arg(4));
        context->DrawRectangle(id , sx, sy, ex, ey, false); //false = no outline

        CLOSE_WRAPPER
}

void  DLv2_DrawRectangleOutline(HSVM *vm)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t sx = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t sy = HSVM_IntegerGet(vm,HSVM_Arg(2));
        int32_t ex = HSVM_IntegerGet(vm,HSVM_Arg(3));
        int32_t ey = HSVM_IntegerGet(vm,HSVM_Arg(4));
        context->DrawRectangle(id , sx, sy, ex, ey, true);

        CLOSE_WRAPPER
}

void  DLv2_DrawEllipse(HSVM *vm)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t cx = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t cy = HSVM_IntegerGet(vm,HSVM_Arg(2));
        int32_t rx = HSVM_IntegerGet(vm,HSVM_Arg(3));
        int32_t ry = HSVM_IntegerGet(vm,HSVM_Arg(4));
        context->DrawEllipse(id , cx, cy, rx, ry, false); //false = no outline

        CLOSE_WRAPPER
}

void  DLv2_DrawEllipseOutline(HSVM *vm)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t cx = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t cy = HSVM_IntegerGet(vm,HSVM_Arg(2));
        int32_t rx = HSVM_IntegerGet(vm,HSVM_Arg(3));
        int32_t ry = HSVM_IntegerGet(vm,HSVM_Arg(4));
        context->DrawEllipse(id , cx, cy, rx, ry, true); //false = no outline

        CLOSE_WRAPPER
}


void  DLv2_DrawLine(HSVM *vm)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t sx = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t sy = HSVM_IntegerGet(vm,HSVM_Arg(2));
        int32_t ex = HSVM_IntegerGet(vm,HSVM_Arg(3));
        int32_t ey = HSVM_IntegerGet(vm,HSVM_Arg(4));
        context->DrawLine(id, sx, sy, ex, ey);

        CLOSE_WRAPPER
}

void  DLv2_DrawPath(HSVM *vm)
{
        OPEN_WRAPPER

        DrawLib::Path path;

        DrawID id = HSVM_IntegerGet(vm, HSVM_Arg(0));
        bool stroke = HSVM_BooleanGet(vm, HSVM_Arg(2));
        bool fill = HSVM_BooleanGet(vm, HSVM_Arg(3));

        HSVM_ColumnId type_id = HSVM_GetColumnId(vm,"TYPE");
        HSVM_ColumnId x_id = HSVM_GetColumnId(vm,"X");
        HSVM_ColumnId y_id = HSVM_GetColumnId(vm,"Y");
        HSVM_ColumnId cx_id = HSVM_GetColumnId(vm,"CX");
        HSVM_ColumnId cy_id = HSVM_GetColumnId(vm,"CY");
        HSVM_ColumnId c1x_id = HSVM_GetColumnId(vm,"C1X");
        HSVM_ColumnId c1y_id = HSVM_GetColumnId(vm,"C1Y");
        HSVM_ColumnId c2x_id = HSVM_GetColumnId(vm,"C2X");
        HSVM_ColumnId c2y_id = HSVM_GetColumnId(vm,"C2Y");
        HSVM_ColumnId rx_id = HSVM_GetColumnId(vm,"RX");
        HSVM_ColumnId ry_id = HSVM_GetColumnId(vm,"RY");

        unsigned length = HSVM_ArrayLength(vm, HSVM_Arg(1));
        int type;

        for (unsigned i = 0; i < length; ++i)
        {
                HSVM_VariableId rec = HSVM_ArrayGetRef(vm, HSVM_Arg(1), i);

                HSVM_VariableId temp = HSVM_RecordGetRef(vm, rec, type_id);
                if (HSVM_GetType(vm, temp) == HSVM_VAR_Integer)
                    type = HSVM_IntegerGet(vm, temp);
                else
                    throw std::runtime_error("Expected 'type' to be of type integer");

                //FIXME: std::cerr << "path " << i << ", type " << type << "\n";

                switch (type)
                {
                        case 0: //Close path
                        {
                                path.ClosePath();
                        } break;
                        case 1: //MoveTo
                        {
                                double x = 0, y = 0;

                                temp = HSVM_RecordGetRef(vm, rec, x_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        x = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, y_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        y = HSVM_FloatGet(vm, temp);

                                path.MoveTo(DrawLib::FPPoint(x,y));
                        } break;
                        case 2: //LineTo
                        {
                                double x = 0, y = 0;

                                temp = HSVM_RecordGetRef(vm, rec, x_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        x = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, y_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        y = HSVM_FloatGet(vm, temp);

                                path.LineTo(DrawLib::FPPoint(x,y));
                        } break;
                        case 3: //BezierTo
                        {
                                double x = 0, y = 0, c1x = 0, c1y = 0, c2x = 0, c2y = 0;

                                temp = HSVM_RecordGetRef(vm, rec, x_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        x = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, y_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        y = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, c1x_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        c1x = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, c1y_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        c1y = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, c2x_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        c2x = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, c2y_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        c2y = HSVM_FloatGet(vm, temp);

                                path.BezierTo(DrawLib::FPPoint(c1x,c1y), DrawLib::FPPoint(c2x,c2y), DrawLib::FPPoint(x,y));
                        } break;
                        case 4: //ArcTo
                        {
                                double x = 0, y = 0, cx = 0, cy = 0, rx = 0, ry = 0;

                                temp = HSVM_RecordGetRef(vm, rec, x_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        x = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, y_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        y = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, cx_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        cx = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, cy_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        cy = HSVM_FloatGet(vm, temp);


                                temp = HSVM_RecordGetRef(vm, rec, rx_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        rx = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, ry_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        ry = HSVM_FloatGet(vm, temp);

                                path.ArcTo(DrawLib::FPPoint(cx,cy), DrawLib::FPSize(rx,ry), DrawLib::FPPoint(x,y));
                        } break;
                        case 5: //ArcToR
                        {
                                double x = 0, y = 0, cx = 0, cy = 0, rx = 0, ry = 0;

                                temp = HSVM_RecordGetRef(vm, rec, x_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        x = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, y_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        y = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, cx_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        cx = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, cy_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        cy = HSVM_FloatGet(vm, temp);


                                temp = HSVM_RecordGetRef(vm, rec, rx_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        rx = HSVM_FloatGet(vm, temp);

                                temp = HSVM_RecordGetRef(vm, rec, ry_id);
                                if (HSVM_GetType(vm, temp) == HSVM_VAR_Float)
                                        ry = HSVM_FloatGet(vm, temp);

                                path.ArcToR(DrawLib::FPPoint(cx,cy), DrawLib::FPSize(rx,ry), DrawLib::FPPoint(x,y));
                        } break;

                }
        }

        // Get transformation matrix
        length = HSVM_ArrayLength(vm, HSVM_Arg(4));

        if(length != 9)
                throw std::runtime_error("Drawlib: Invalid matrix size");

        double v[9];

        for (unsigned i = 0; i < length; ++i)
        {
          HSVM_VariableId f = HSVM_ArrayGetRef(vm, HSVM_Arg(4), i);
          v[i] = HSVM_FloatGet(vm, f);
        }

        // Set the transformation, we don't use all values from the 3x3 matrix
        path.SetTransform(DrawLib::XForm2D(v[0],v[3],v[1],v[4],DrawLib::FPPoint(v[2],v[5])));

        context->StrokeFillPath(id, path, stroke, fill);

        CLOSE_WRAPPER
}

void  DLv2_DrawCanvas(HSVM *vm)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        DrawID fid = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t x = HSVM_IntegerGet(vm,HSVM_Arg(2));
        int32_t y = HSVM_IntegerGet(vm,HSVM_Arg(3));
        context->DrawDrawObject(id, fid, x,y);

        CLOSE_WRAPPER
}

void  DLv2_ClearCanvas(HSVM *vm)
{
        OPEN_WRAPPER

        DrawID id                       =  HSVM_IntegerGet(vm,HSVM_Arg(0));
        DrawLib::Pixel32 packedcolor = HStoDrawlibPixel(HSVM_IntegerGet(vm,HSVM_Arg(1)));

        context->ClearDrawObject(id, packedcolor);

        CLOSE_WRAPPER
}


void  DLv2_CreateFont(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        std::string fontname    = HSVM_StringGetSTD(vm,HSVM_Arg(0));
        std::string fontstyle   = HSVM_StringGetSTD(vm,HSVM_Arg(1));

        uint32_t fontsize            = HSVM_IntegerGet(vm,HSVM_Arg(2));

        FontID fid = context->CreateFont(fontname,fontstyle, fontsize);

        HSVM_IntegerSet(vm,id_set,fid);

        CLOSE_WRAPPER
}

void  DLv2_GetAvailableFonts(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        (void)context;// no unused variable warning

        std::vector<DrawLib::FontManager::FontItem> fonts;
        DrawLib::GetGlobalFontManager().GetFontList(&fonts);

        HSVM_SetDefault(vm, id_set, HSVM_VAR_RecordArray);

        HSVM_ColumnId col_family = HSVM_GetColumnId(vm, "FAMILY");
        HSVM_ColumnId col_style = HSVM_GetColumnId(vm, "STYLE");
        HSVM_ColumnId col_filename = HSVM_GetColumnId(vm, "FILENAME");
        HSVM_ColumnId col_istruetype = HSVM_GetColumnId(vm, "ISTRUETYPE");
        HSVM_ColumnId col_isbold = HSVM_GetColumnId(vm, "ISBOLD");
        HSVM_ColumnId col_isitalic = HSVM_GetColumnId(vm, "ISITALIC");

        for (unsigned i=0;i<fonts.size();++i)
        {
                DrawLib::FontManager::FontItem &font = fonts[i];
                HSVM_VariableId newrec = HSVM_ArrayAppend(vm, id_set);

                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrec, col_family), font.fontfamily);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrec, col_style), font.fontstyle);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrec, col_filename), font.fullpath);
                HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, newrec, col_istruetype), font.isTrueType);
                HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, newrec, col_isbold), font.bold);
                HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, newrec, col_isitalic), font.italic);
        }

        CLOSE_WRAPPER
}


void  DLv2_DrawText(HSVM *vm)
{
        OPEN_WRAPPER

        int32_t canvashandle = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t fonthandle   = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t xpos = HSVM_IntegerGet(vm,HSVM_Arg(2));
        int32_t ypos = HSVM_IntegerGet(vm,HSVM_Arg(3));
        std::string text = HSVM_StringGetSTD(vm,HSVM_Arg(4));
        context->DrawText(canvashandle, fonthandle, xpos, ypos, text);

        CLOSE_WRAPPER
}

void  DLv2_GetTextWidth(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        FontID fid = HSVM_IntegerGet(vm,HSVM_Arg(0));
        std::string text = HSVM_StringGetSTD(vm,HSVM_Arg(1));

        uint32_t width = context->GetTextWidth(fid, text);
        HSVM_IntegerSet(vm,id_set,width);

        CLOSE_WRAPPER
}

void  DLv2_GetTextHeight(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        FontID fid = HSVM_IntegerGet(vm,HSVM_Arg(0));
        std::string text = HSVM_StringGetSTD(vm,HSVM_Arg(1));

        uint32_t height = context->GetTextHeight(fid, text);
        HSVM_IntegerSet(vm,id_set,height);

        CLOSE_WRAPPER
}

void  DLv2_SetFontAntiAliasMode(HSVM *vm)
{
        OPEN_WRAPPER

        FontID  fid    = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t rendertype = HSVM_IntegerGet(vm,HSVM_Arg(1));

        if ((rendertype<0) || (rendertype>1))
            throw std::runtime_error("Drawlib: Invalid font render mode");

        context->SetFontRenderMode(fid, rendertype);

        CLOSE_WRAPPER
}

void  DLv2_SetFontSize(HSVM *vm)
{
        OPEN_WRAPPER

        FontID fid = HSVM_IntegerGet(vm,HSVM_Arg(0));
        uint32_t size   = HSVM_IntegerGet(vm,HSVM_Arg(1));

        context->SetFontSize(fid, size);

        CLOSE_WRAPPER
}

void  DLv2_SetFontLetterSpacing(HSVM *vm)
{
        OPEN_WRAPPER

        FontID fid = HSVM_IntegerGet(vm,HSVM_Arg(0));
        float size   = HSVM_FloatGet(vm,HSVM_Arg(1));

        context->SetFontLetterSpacing(fid, size);

        CLOSE_WRAPPER
}

void  DLv2_SetFontColor(HSVM *vm)
{
        OPEN_WRAPPER

        FontID fid = HSVM_IntegerGet(vm,HSVM_Arg(0));
        DrawLib::Pixel32 packedcolor = HStoDrawlibPixel(HSVM_IntegerGet(vm,HSVM_Arg(1)));

        context->SetFontColor(fid, packedcolor);

        CLOSE_WRAPPER
}

void  DLv2_SetFontAlignment(HSVM *vm)
{
        OPEN_WRAPPER

        FontID fid = HSVM_IntegerGet(vm,HSVM_Arg(0));
        uint32_t hor    = HSVM_IntegerGet(vm,HSVM_Arg(1));
        uint32_t ver    = HSVM_IntegerGet(vm,HSVM_Arg(2));

        context->SetFontAlignment(fid, hor, ver);

        CLOSE_WRAPPER
}

void  DLv2_SetFontOrientation(HSVM *vm)
{
        OPEN_WRAPPER

        FontID fid   = HSVM_IntegerGet(vm,HSVM_Arg(0));
        uint32_t baseline = HSVM_IntegerGet(vm,HSVM_Arg(1));
        uint32_t glyph    = HSVM_IntegerGet(vm,HSVM_Arg(2));

        context->SetFontOrientation(fid, baseline, glyph);

        CLOSE_WRAPPER
}


///\todo Do all the loading functions really need bufferedstreams?
///\bug Properly handle 0-byte files and I/O errors
///\bug Handle file data errors (what happens now? exceptions?)

//FIXME: Use a proper C interface to access blobs
void  DLv2_CreateCanvasFromFile(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        HareScript::Interface::InputStream orig_in(vm, HSVM_Arg(0));

        DrawID new_id = context->CreateDrawObjectFromFile( &orig_in );
        HSVM_IntegerSet(vm,id_set, new_id);

        CLOSE_WRAPPER
}

void  DLv2_CreateResizedCanvasFromFile(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        uint32_t out_width  = HSVM_IntegerGet(vm,HSVM_Arg(1));
        uint32_t out_height = HSVM_IntegerGet(vm,HSVM_Arg(2));


        HareScript::Interface::InputStream orig_in(vm, HSVM_Arg(0));

        DrawID new_id = context->CreateResizedDrawObjectFromFile( &orig_in, out_width, out_height);
        HSVM_IntegerSet(vm,id_set, new_id);

        CLOSE_WRAPPER
}


void  DLv2_CreateDifferenceCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        DrawID id1 = HSVM_IntegerGet(vm,HSVM_Arg(0));
        DrawID id2 = HSVM_IntegerGet(vm,HSVM_Arg(1));

        DrawID new_id = context->CreateDifferenceCanvas(id1, id2);
        HSVM_IntegerSet(vm, id_set, new_id);

        CLOSE_WRAPPER
}

void  DLv2_CompareCanvases(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        DrawID id1 = HSVM_IntegerGet(vm,HSVM_Arg(0));
        DrawID id2 = HSVM_IntegerGet(vm,HSVM_Arg(1));

        double mse = context->CompareCanvases(id1, id2);
        HSVM_FloatSet(vm, id_set, mse);

        CLOSE_WRAPPER
}

void  DLv2_SetOutlineColor(HSVM *vm)
{
        OPEN_WRAPPER

        DrawID id       = HSVM_IntegerGet(vm,HSVM_Arg(0));
        DrawLib::Pixel32 packedcolor = HStoDrawlibPixel(HSVM_IntegerGet(vm,HSVM_Arg(1)));
        context->SetOutlineColor(id, packedcolor);

        CLOSE_WRAPPER
}
void  DLv2_SetOutlineWidth(HSVM *vm)
{
        OPEN_WRAPPER

        DrawID id       = HSVM_IntegerGet(vm,HSVM_Arg(0));
        uint32_t width       = HSVM_IntegerGet(vm,HSVM_Arg(1));
        context->SetOutlineWidth(id, width);

        CLOSE_WRAPPER
}
void  DLv2_SetOutlineMode(HSVM *vm)
{
        OPEN_WRAPPER

        DrawID id       = HSVM_IntegerGet(vm,HSVM_Arg(0));
        DrawLib::DrawObject::FillMode mode        = (DrawLib::DrawObject::FillMode)HSVM_IntegerGet(vm,HSVM_Arg(1));
        context->SetOutlineMode(id, mode);

        CLOSE_WRAPPER
}


void  DLv2_SetFillColor(HSVM *vm)
{
        OPEN_WRAPPER

        DrawID id       = HSVM_IntegerGet(vm,HSVM_Arg(0));
        DrawLib::Pixel32 packedcolor = HStoDrawlibPixel(HSVM_IntegerGet(vm,HSVM_Arg(1)));
        context->SetFillColor(id, packedcolor);

        CLOSE_WRAPPER
}

void  DLv2_SetFillMode(HSVM *vm)
{
        OPEN_WRAPPER

        DrawID id       = HSVM_IntegerGet(vm,HSVM_Arg(0));
        DrawLib::DrawObject::FillMode mode        = (DrawLib::DrawObject::FillMode)HSVM_IntegerGet(vm,HSVM_Arg(1));
        context->SetFillMode(id, mode);

        CLOSE_WRAPPER
}

void  DLv2_SetFillTexture(HSVM *vm)
{
        OPEN_WRAPPER

        DrawID id       = HSVM_IntegerGet(vm,HSVM_Arg(0));
        DrawID texture     = HSVM_IntegerGet(vm,HSVM_Arg(1));
        uint32_t offsetx        = HSVM_IntegerGet(vm,HSVM_Arg(2));
        uint32_t offsety        = HSVM_IntegerGet(vm,HSVM_Arg(3));

        context->SetFillTexture(id, texture, offsetx, offsety);

        CLOSE_WRAPPER
}

void  DLv2_SetFillThreeDTexture(HSVM *vm)
{
        OPEN_WRAPPER

        DrawID id          = HSVM_IntegerGet(vm,HSVM_Arg(0));
        DrawID texture     = HSVM_IntegerGet(vm,HSVM_Arg(1));
        double sua         = HSVM_FloatGet(vm,HSVM_Arg(2));
        double sub         = HSVM_FloatGet(vm,HSVM_Arg(3));
        double suc         = HSVM_FloatGet(vm,HSVM_Arg(4));
        double sva         = HSVM_FloatGet(vm,HSVM_Arg(5));
        double svb         = HSVM_FloatGet(vm,HSVM_Arg(6));
        double svc         = HSVM_FloatGet(vm,HSVM_Arg(7));
        double sza         = HSVM_FloatGet(vm,HSVM_Arg(8));
        double szb         = HSVM_FloatGet(vm,HSVM_Arg(9));
        double szc         = HSVM_FloatGet(vm,HSVM_Arg(10));

        context->SetFillThreeDTexture(id, texture, TwoParamFunc(sua, sub, suc), TwoParamFunc(sva, svb, svc), TwoParamFunc(sza, szb, szc));

        CLOSE_WRAPPER
}

void  DLv2_SetOutlineThreeDTexture(HSVM *vm)
{
        OPEN_WRAPPER

        DrawID id          = HSVM_IntegerGet(vm,HSVM_Arg(0));
        DrawID texture     = HSVM_IntegerGet(vm,HSVM_Arg(1));
        double sua         = HSVM_FloatGet(vm,HSVM_Arg(2));
        double sub         = HSVM_FloatGet(vm,HSVM_Arg(3));
        double suc         = HSVM_FloatGet(vm,HSVM_Arg(4));
        double sva         = HSVM_FloatGet(vm,HSVM_Arg(5));
        double svb         = HSVM_FloatGet(vm,HSVM_Arg(6));
        double svc         = HSVM_FloatGet(vm,HSVM_Arg(7));
        double sza         = HSVM_FloatGet(vm,HSVM_Arg(8));
        double szb         = HSVM_FloatGet(vm,HSVM_Arg(9));
        double szc         = HSVM_FloatGet(vm,HSVM_Arg(10));

        context->SetOutlineThreeDTexture(id, texture, TwoParamFunc(sua, sub, suc), TwoParamFunc(sva, svb, svc), TwoParamFunc(sza, szb, szc));

        CLOSE_WRAPPER
}

/************************************
        Alpha & Binary modes
*************************************/

void  DLv2_SetAlphaMode(HSVM *vm)
{
        OPEN_WRAPPER

        DrawID id       = HSVM_IntegerGet(vm,HSVM_Arg(0));
        uint32_t alphamode   = HSVM_IntegerGet(vm,HSVM_Arg(1));

        context->SetAlphaMode(id, alphamode);

        CLOSE_WRAPPER
}

void  DLv2_GetAlphaMode(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        DrawID id = HSVM_IntegerGet(vm, HSVM_Arg(0));

        uint32_t mode = static_cast<uint32_t>(context->GetAlphaMode(id));
        HSVM_IntegerSet(vm,id_set, mode);

        CLOSE_WRAPPER
}

void  DLv2_SetBinaryMode(HSVM *vm)
{
        OPEN_WRAPPER

        DrawID id       = HSVM_IntegerGet(vm,HSVM_Arg(0));
        uint32_t binarymode  = HSVM_IntegerGet(vm,HSVM_Arg(1));

        context->SetBinaryMode(id, static_cast<DrawLib::Canvas32::PixelOperationMode>(binarymode));

        CLOSE_WRAPPER
}

void  DLv2_GetBinaryMode(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        DrawID id = HSVM_IntegerGet(vm, HSVM_Arg(0));

        uint32_t mode = static_cast<uint32_t>(context->GetBinaryMode(id));
        HSVM_IntegerSet(vm,id_set, mode);

        CLOSE_WRAPPER
}

void  DLv2_GetRefCount(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));

        int32_t w = context->GetRefCount(id);
        HSVM_IntegerSet(vm,id_set, w);

        CLOSE_WRAPPER
}
void  DLv2_GetCanvasWidth(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));

        int32_t w = context->GetWidth(id);
        HSVM_IntegerSet(vm,id_set, w);

        CLOSE_WRAPPER
}

void  DLv2_GetCanvasHeight(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t h = context->GetHeight(id);
        HSVM_IntegerSet(vm,id_set, h);

        CLOSE_WRAPPER
}

void  DLv2_DestroyCanvas(HSVM *vm)
{
        OPEN_WRAPPER
        DrawID id  = HSVM_IntegerGet(vm,HSVM_Arg(0));
        context->DestroyDrawObject(id);

        CLOSE_WRAPPER
}

void  DLv2_DestroyFont(HSVM *vm)
{
        OPEN_WRAPPER
        FontID id  = HSVM_IntegerGet(vm,HSVM_Arg(0));
        context->DestroyFont(id);

        CLOSE_WRAPPER
}

void  DLv2_CountCanvasColors(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id  = HSVM_IntegerGet(vm,HSVM_Arg(0));
        unsigned minalpha = HSVM_IntegerGet(vm,HSVM_Arg(1));
        CountResult results = context->CountDrawObjectColors(id,minalpha);

        HSVM_ColumnId col_alphas = HSVM_GetColumnId(vm, "ALPHAS");
        HSVM_ColumnId col_colors = HSVM_GetColumnId(vm, "COLORS");

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, id_set, col_alphas), results.numalpha);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, id_set, col_colors), results.numcolors);

        CLOSE_WRAPPER
}

void  DLv2_ResizeCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id  = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t newwidth = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t newheight= HSVM_IntegerGet(vm,HSVM_Arg(2));
        int32_t result = context->ResizeDrawObject(id, newwidth, newheight, false);
        HSVM_IntegerSet(vm,id_set, result);

        CLOSE_WRAPPER
}

void  DLv2_CropCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id  = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t left   = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t top    = HSVM_IntegerGet(vm,HSVM_Arg(2));
        int32_t width  = HSVM_IntegerGet(vm,HSVM_Arg(3));
        int32_t height = HSVM_IntegerGet(vm,HSVM_Arg(4));
        int32_t result = context->CropDrawObject(id, left, top, width, height);
        HSVM_IntegerSet(vm,id_set, result);

        CLOSE_WRAPPER
}

void  DLv2_RotateCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id  = HSVM_IntegerGet(vm,HSVM_Arg(0));
        bool  rotate_right = HSVM_BooleanGet(vm,HSVM_Arg(1));
        int32_t result = context->RotateDrawObject(id, rotate_right);
        HSVM_IntegerSet(vm, id_set, result);

        CLOSE_WRAPPER
}

void  DLv2_MirrorCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id  = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t result = context->MirrorDrawObject(id);
        HSVM_IntegerSet(vm, id_set, result);

        CLOSE_WRAPPER
}

void  DLv2_ShearCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id  = HSVM_IntegerGet(vm,HSVM_Arg(0));
        double x_scale = HSVM_FloatGet(vm,HSVM_Arg(1));
        int32_t result = x_scale != 0 ? context->ShearDrawObject(id, x_scale) : 0;
        if (result == 0)
            result = context->RotateDrawObject(id, true);
        double y_scale = HSVM_FloatGet(vm,HSVM_Arg(2));
        if (result == 0)
            result = y_scale != 0 ? context->ShearDrawObject(id, -y_scale) : 0;
        if (result == 0)
            result = context->RotateDrawObject(id, false);
        HSVM_IntegerSet(vm, id_set, result);

        CLOSE_WRAPPER
}

void  DLv2_DuplicateCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id  = HSVM_IntegerGet(vm,HSVM_Arg(0));
        DrawID new_id = context->CreateDuplicateDrawObject(id);

        HSVM_IntegerSet(vm,id_set, new_id);

        CLOSE_WRAPPER
}

void  DLv2_MakeCanvasFromCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id  = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t left   = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t top    = HSVM_IntegerGet(vm,HSVM_Arg(2));
        int32_t width  = HSVM_IntegerGet(vm,HSVM_Arg(3));
        int32_t height = HSVM_IntegerGet(vm,HSVM_Arg(4));
        DrawID new_id = context->CreateDrawObjectFromDrawObject(id, left, top, width, height);

        HSVM_IntegerSet(vm,id_set, new_id);

        CLOSE_WRAPPER
}

void  DLv2_HSVtoRGB(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        double h = HSVM_FloatGet(vm,HSVM_Arg(0));
        double s = HSVM_FloatGet(vm,HSVM_Arg(1));
        double v = HSVM_FloatGet(vm,HSVM_Arg(2));

        Pixel32 rgb;

        context->HSVtoRGB(&rgb, h, s, v);

        HSVM_IntegerSet(vm, id_set, DrawlibtoHSPixel(rgb));

        CLOSE_WRAPPER
}

void  DLv2_RGBtoHSV(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        double h, s, v;

        Pixel32 rgb = HStoDrawlibPixel(HSVM_IntegerGet(vm,HSVM_Arg(0)));

        context->RGBtoHSV(rgb, &h, &s, &v);

        HSVM_ColumnId col_h = HSVM_GetColumnId(vm, "H");
        HSVM_ColumnId col_s = HSVM_GetColumnId(vm, "S");
        HSVM_ColumnId col_v = HSVM_GetColumnId(vm, "V");

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
        HSVM_FloatSet(vm, HSVM_RecordCreate(vm, id_set, col_h), h);
        HSVM_FloatSet(vm, HSVM_RecordCreate(vm, id_set, col_s), s);
        HSVM_FloatSet(vm, HSVM_RecordCreate(vm, id_set, col_v), v);

        CLOSE_WRAPPER
}




/*******************************************************************************
        Blob saving stuff....
*******************************************************************************/

void DLv2_CreatePNGBlobFromCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        bool   paletted = HSVM_BooleanGet(vm, HSVM_Arg(1));
        bool   discard_alpha = HSVM_BooleanGet(vm, HSVM_Arg(2));

        // get the bitmap data using it's ID.
        DrawInfo const &drawinfo = context->GetDrawInfoForRead(id);

        int32_t streamid = HSVM_CreateStream(vm);
        HareScript::Interface::OutputStream outstream(vm,streamid);

        // Generate PNG data.
        DrawLib::SaveBitmap32AsPNG(&outstream, drawinfo.GetBitmap(), paletted, discard_alpha);
        HSVM_MakeBlobFromStream(vm, id_set, streamid);

        CLOSE_WRAPPER
}

void DLv2_CreateJPGBlobFromCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t quality = HSVM_IntegerGet(vm,HSVM_Arg(1));

        // get the bitmap data using it's ID.
        DrawInfo const&drawinfo = context->GetDrawInfoForRead(id);
        int32_t streamid = HSVM_CreateStream(vm);
        HareScript::Interface::OutputStream outstream(vm,streamid);

        DrawLib::SaveBitmap32AsJPG(&outstream, drawinfo.GetBitmap(), quality);
        HSVM_MakeBlobFromStream(vm, id_set, streamid);

        CLOSE_WRAPPER
}

void DLv2_CreateGIFBlobFromCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));

        // get the bitmap data using it's ID.
        DrawInfo const&drawinfo = context->GetDrawInfoForRead(id);

        int32_t streamid = HSVM_CreateStream(vm);
        HareScript::Interface::OutputStream outstream(vm,streamid);

        DrawLib::SaveBitmap32AsGIF(&outstream, drawinfo.GetBitmap());
        HSVM_MakeBlobFromStream(vm, id_set, streamid);

        CLOSE_WRAPPER
}

void DLv2_CreateRAWBlobFromCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));

        // get the bitmap data using it's ID.
        DrawInfo const&drawinfo = context->GetDrawInfoForRead(id);

        int32_t streamid = HSVM_CreateStream(vm);
        HareScript::Interface::OutputStream outstream(vm,streamid);

        DrawLib::SaveBitmap32AsRaw(outstream, drawinfo.GetBitmap(), HSVM_StringGetSTD(vm, HSVM_Arg(1)));
        HSVM_MakeBlobFromStream(vm, id_set, streamid);

        CLOSE_WRAPPER
}

void DLv2_CreateCanvasFromRAWBlob(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        HareScript::Interface::InputStream orig_in(vm, HSVM_Arg(0));
        int32_t width = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t height = HSVM_IntegerGet(vm,HSVM_Arg(2));
        bool premultiplied = HSVM_BooleanGet(vm,HSVM_Arg(4));

        DrawID new_id = context->CreateDrawObjectFromRaw( &orig_in, width, height, HSVM_StringGetSTD(vm, HSVM_Arg(3)), premultiplied );
        HSVM_IntegerSet(vm,id_set, new_id);

        CLOSE_WRAPPER
}

void DLv2_GetKMeansQuantizedPalette(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER

        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t clustercount = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t minimum_alpha = HSVM_IntegerGet(vm,HSVM_Arg(2));
        int32_t max_iters = HSVM_IntegerGet(vm,HSVM_Arg(3));
        float initialpoint = HSVM_FloatGet(vm,HSVM_Arg(4));

        if (minimum_alpha < 0)
            minimum_alpha = 0;
        else if (minimum_alpha > 255)
            minimum_alpha = 255;

        std::vector< Pixel32 > result;
        context->CalculateKMeansQuantizedPalette(id, clustercount, minimum_alpha, max_iters, initialpoint, &result);

        HSVM_SetDefault(vm, id_set, HSVM_VAR_RecordArray);

        HSVM_ColumnId col_r = HSVM_GetColumnId(vm, "R");
        HSVM_ColumnId col_g = HSVM_GetColumnId(vm, "G");
        HSVM_ColumnId col_b = HSVM_GetColumnId(vm, "B");

        for (auto &itr: result)
        {
                HSVM_VariableId newrec = HSVM_ArrayAppend(vm, id_set);

                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, newrec, col_r), itr.GetR());
                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, newrec, col_g), itr.GetG());
                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, newrec, col_b), itr.GetB());
        }

        CLOSE_WRAPPER
}


/*******************************************************************************
*
*  MARSHALLERS
*
*******************************************************************************/

class DrawInfoObjectMarshallerData
{
    public:
        DrawInfoObjectMarshallerData(DrawInfo const *drawinfo)
        : drawinfo(drawinfo)
        {
        }

        ~DrawInfoObjectMarshallerData()
        {
                drawinfo->DelRef();
        }

        bool RestoreTo(struct HSVM *vm, HSVM_VariableId var);

    private:
        DrawInfo const *drawinfo;
};

bool DrawInfoObjectMarshallerData::RestoreTo(struct HSVM *vm, HSVM_VariableId var)
{
        OPEN_WRAPPER

        int32_t newid = context->RegisterDrawObject(drawinfo);

        //Blex::ErrStream() << "Received as marshalled " << newid << " at " << (void*)drawinfo;

        // Create the object in var
        HSVM_OpenFunctionCall(vm, 1);
        HSVM_IntegerSet(vm, HSVM_CallParam(vm, 0), newid);
        const HSVM_VariableType args[1] = { HSVM_VAR_Integer };
        HSVM_VariableId obj = HSVM_CallFunction(vm, "wh::graphics/canvas.whlib", "__CreateCanvasWithCanvasID", HSVM_VAR_Object, 1, args);
        if (!obj)
            return false;

        HSVM_CopyFrom(vm, var, obj);
        HSVM_CloseFunctionCall(vm);

        return true;
        CLOSE_WRAPPER
        return false;
}

int DrawInfoObjectMarshaller(struct HSVM *vm, HSVM_VariableId sent_var, void **resultdata, HSVM_ObjectRestorePtr *restoreptr, HSVM_ObjectClonePtr *cloneptr)
{
        OPEN_WRAPPER

        // Don't allow clone
        if (cloneptr)
            return false;

        HSVM_ColumnId col_pvt_jobid = HSVM_GetColumnId(vm, "PVT_CANVASID");
        HSVM_VariableId var_pvt_jobid = HSVM_ObjectMemberRef(vm, sent_var, col_pvt_jobid, true);
        if (!var_pvt_jobid || HSVM_GetType(vm, var_pvt_jobid) != HSVM_VAR_Integer)
        {
                HSVM_ThrowException(vm, "Using canvas marshaller on a object that is not a canvas");
                return 0;
        }

        int32_t id = var_pvt_jobid ? HSVM_IntegerGet(vm, var_pvt_jobid) : -1;

        DrawInfo const &drawinfo = context->GetDrawInfoForRead(id);
        //Blex::ErrStream() << "Prepare for marshall " << id << " at " << (void*)&drawinfo;
        try
        {
                *restoreptr = &HSVM_ObjectMarshalRestoreWrapper< DrawInfoObjectMarshallerData >;
                *resultdata = new DrawInfoObjectMarshallerData(&drawinfo);
                context->drawinfos[id-1] = NULL; //no need to delref, the reference is now the marshaller's problem
                HSVM_IntegerSet(vm, var_pvt_jobid, 0);
                return 1;
        }
        catch (std::exception &)
        {
                drawinfo.DelRef();
                return 0;
        }
        CLOSE_WRAPPER
        return 0;
}

void DLv2_SetCanvasMarshaller(HSVM *vm)
{
        HSVM_ObjectSetMarshaller(vm, HSVM_Arg(0), &DrawInfoObjectMarshaller);
}

/*******************************************************************************
*
*  REGISTRATION OF DRAWLIB
*
*******************************************************************************/

extern "C" {

BLEXLIB_PUBLIC DrawLib::Bitmap32 * HSDRAWLIBINTERFACE_GetCanvasBitmap(HSVM *vm, int32_t canvasid)
{
        OPEN_WRAPPER
        return &context->GetDrawInfoForWrite(canvasid).GetBitmap();
        CLOSE_WRAPPER
        return NULL;
}

BLEXLIB_PUBLIC DrawID HSDRAWLIBINTERFACE_CreateDrawObject(HSVM *vm, uint32_t width, uint32_t height, DrawLib::Pixel32 color)
{
        OPEN_WRAPPER
        return context->CreateDrawObject(width, height, color);
        CLOSE_WRAPPER
        return 0;
}

BLEXLIB_PUBLIC void HSDRAWLIBINTERFACE_DestroyDrawObject(HSVM *vm, DrawID drawid)
{
        OPEN_WRAPPER
        context->DestroyDrawObject(drawid);
        CLOSE_WRAPPER
}


BLEXLIB_PUBLIC void HSDRAWLIBINTERFACE_AddFontDir(const char *fontdirname)
{
        DrawLib::GetGlobalFontManager().AddFontDirectory(fontdirname);
}

static void* CreateContext(void *)
{
        return new DrawlibInterfaceState;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<DrawlibInterfaceState*>(context_ptr);
}

static void DrawlibSoftResetHandler()
{
        DEBUGPRINT("*** DrawlibSoftResetHandler invoked");
        DrawLib::GetGlobalFontManager().ForceRescan();
}

} //end extern "C"

extern "C" BLEXLIB_PUBLIC int HSVM_ModuleEntryPoint(HSVM_RegData *regdata, void*)
{
        HSVM_RegisterSoftResetCallback(regdata, &DrawlibSoftResetHandler);

        HSVM_RegisterContext (regdata, DrawlibContextId, NULL, &CreateContext, &DestroyContext);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_VALIDATEDRAWID:WHMOD_GRAPHICS:I:I",DLv2_ValidateDrawId);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_VALIDATEFONTID:WHMOD_GRAPHICS:I:I",DLv2_ValidateFontId);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_MAKECANVAS:WHMOD_GRAPHICS:I:III",DLv2_MakeCanvas);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_EASTEREGG:WHMOD_GRAPHICS::I", DLv2_EasterEgg);

        HSVM_RegisterFunction(regdata, "GFXCOUNTCANVASCOLORS:WHMOD_GRAPHICS:R:II",DLv2_CountCanvasColors);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWLINE:WHMOD_GRAPHICS::IIIII",DLv2_DrawLine);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWRECTANGLE:WHMOD_GRAPHICS::IIIII",DLv2_DrawRectangle);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWRECTANGLEBORDER:WHMOD_GRAPHICS::IIIII",DLv2_DrawRectangleOutline);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWELLIPSE:WHMOD_GRAPHICS::IIIII",DLv2_DrawEllipse);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWELLIPSEBORDER:WHMOD_GRAPHICS::IIIII",DLv2_DrawEllipseOutline);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWPIXEL:WHMOD_GRAPHICS::IIII", DLv2_DrawPixel);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWPLANES:WHMOD_GRAPHICS::IIIIS", DLv2_DrawPlanes);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETPIXEL:WHMOD_GRAPHICS:I:III",DLv2_GetPixel);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWPATH:WHMOD_GRAPHICS::IRABBFA",DLv2_DrawPath);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWCANVAS:WHMOD_GRAPHICS::IIII", DLv2_DrawCanvas);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWTEXT:WHMOD_GRAPHICS::IIIIS",DLv2_DrawText);

        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_MAKEFONT:WHMOD_GRAPHICS:I:SSI",DLv2_CreateFont);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETAVAILABLEFONTS:WHMOD_GRAPHICS:RA:",DLv2_GetAvailableFonts);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETFONTCOLOR:WHMOD_GRAPHICS::II",DLv2_SetFontColor);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETFONTSIZE:WHMOD_GRAPHICS::II",DLv2_SetFontSize);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETFONTLETTERSPACING:WHMOD_GRAPHICS::IF",DLv2_SetFontLetterSpacing);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETFONTANTIALIASMODE:WHMOD_GRAPHICS::II",DLv2_SetFontAntiAliasMode);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETFONTALIGNMENT:WHMOD_GRAPHICS::III", DLv2_SetFontAlignment);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETFONTORIENTATION:WHMOD_GRAPHICS::III", DLv2_SetFontOrientation);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_CLEAR:WHMOD_GRAPHICS::II",DLv2_ClearCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_CREATECANVASFROMFILE:WHMOD_GRAPHICS:I:X", DLv2_CreateCanvasFromFile);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_CREATERESIZEDCANVASFROMFILE:WHMOD_GRAPHICS:I:XII", DLv2_CreateResizedCanvasFromFile);

        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETCANVASWIDTH:WHMOD_GRAPHICS:I:I", DLv2_GetCanvasWidth);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETCANVASHEIGHT:WHMOD_GRAPHICS:I:I", DLv2_GetCanvasHeight);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETFILLCOLOR:WHMOD_GRAPHICS::II", DLv2_SetFillColor);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETFILLMODE:WHMOD_GRAPHICS::II", DLv2_SetFillMode);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETFILLTEXTURE:WHMOD_GRAPHICS::IIII", DLv2_SetFillTexture);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETFILLTHREEDTEXTURE:WHMOD_GRAPHICS::IIFFFFFFFFF", DLv2_SetFillThreeDTexture);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETOUTLINECOLOR:WHMOD_GRAPHICS::II", DLv2_SetOutlineColor);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETOUTLINEMODE:WHMOD_GRAPHICS::II", DLv2_SetOutlineMode);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETOUTLINEWIDTH:WHMOD_GRAPHICS::II", DLv2_SetOutlineWidth);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETOUTLINETHREEDTEXTURE:WHMOD_GRAPHICS::IIFFFFFFFFF", DLv2_SetOutlineThreeDTexture);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_RESIZECANVAS:WHMOD_GRAPHICS:I:III", DLv2_ResizeCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_ROTATECANVAS:WHMOD_GRAPHICS:I:IB", DLv2_RotateCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_MIRRORCANVAS:WHMOD_GRAPHICS:I:I", DLv2_MirrorCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_SHEARCANVAS:WHMOD_GRAPHICS:I:IFF", DLv2_ShearCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_DUPLICATECANVAS:WHMOD_GRAPHICS:I:I", DLv2_DuplicateCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_MAKECANVASFROMCANVAS:WHMOD_GRAPHICS:I:IIIII", DLv2_MakeCanvasFromCanvas);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DESTROYCANVAS:WHMOD_GRAPHICS::I", DLv2_DestroyCanvas);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DESTROYFONT:WHMOD_GRAPHICS::I", DLv2_DestroyFont);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_CREATEPNGBLOBFROMCANVAS:WHMOD_GRAPHICS:X:IBB", DLv2_CreatePNGBlobFromCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_CREATEJPGBLOBFROMCANVAS:WHMOD_GRAPHICS:X:II", DLv2_CreateJPGBlobFromCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_CREATEGIFBLOBFROMCANVAS:WHMOD_GRAPHICS:X:I", DLv2_CreateGIFBlobFromCanvas);

        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_CREATERAWBLOBFROMCANVAS:WHMOD_GRAPHICS:X:IS", DLv2_CreateRAWBlobFromCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_CREATECANVASFROMRAWBLOB:WHMOD_GRAPHICS:I:XIISB", DLv2_CreateCanvasFromRAWBlob);

        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETALPHAMODE:WHMOD_GRAPHICS::II", DLv2_SetAlphaMode);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETPIXELMODE:WHMOD_GRAPHICS::II", DLv2_SetBinaryMode);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETALPHAMODE:WHMOD_GRAPHICS:I:I", DLv2_GetAlphaMode);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETPIXELMODE:WHMOD_GRAPHICS:I:I", DLv2_GetBinaryMode);

        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETTEXTWIDTH:WHMOD_GRAPHICS:I:IS", DLv2_GetTextWidth);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETTEXTHEIGHT:WHMOD_GRAPHICS:I:IS", DLv2_GetTextHeight);

        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_BLURCANVAS:WHMOD_GRAPHICS::III", DLv2_BlurCanvas);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_GRAYSCALECANVAS:WHMOD_GRAPHICS::I", DLv2_GrayscaleCanvas);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_ALPHACANVAS:WHMOD_GRAPHICS::IF", DLv2_AlphaCanvas);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_ALPHACANVASADD:WHMOD_GRAPHICS::II", DLv2_AlphaCanvasAdd);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_INVERTCANVAS:WHMOD_GRAPHICS::I", DLv2_InvertCanvas);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_MULTIPLYCANVAS:WHMOD_GRAPHICS::II", DLv2_MultiplyCanvas);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_APPLYCOLORMAPPING:WHMOD_GRAPHICS::IRA", DLv2_ApplyColorMapping);


        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_COMPARECANVASES:WHMOD_GRAPHICS:F:II", DLv2_CompareCanvases);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_CREATEDIFFERENCECANVAS:WHMOD_GRAPHICS:I:II", DLv2_CreateDifferenceCanvas);

        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_RGBTOHSV:WHMOD_GRAPHICS:R:I", DLv2_RGBtoHSV);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_HSVTORGB:WHMOD_GRAPHICS:I:FFF", DLv2_HSVtoRGB);

        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETCANVASMARSHALLER:WHMOD_GRAPHICS::O", DLv2_SetCanvasMarshaller);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETREFCOUNT:WHMOD_GRAPHICS:I:I", DLv2_GetRefCount);

        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETKMEANSQUANTIZEDPALETTE:WHMOD_GRAPHICS:RA:IIIIF", DLv2_GetKMeansQuantizedPalette);

        return 1;
}

} //namespace end
