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

typedef uint32_t DrawID;

const unsigned DrawlibContextId = 7; //reserved number for drawlib. DO NOT CHANGE!!!

class DrawlibInterfaceState
{
public:
        DrawlibInterfaceState();
        ~DrawlibInterfaceState();

        //creates
        DrawID  CreateDrawObject                   (uint32_t width, uint32_t height, DrawLib::Pixel32 color);        //default background: color
        DrawID  CreateDuplicateDrawObject          (DrawID id);
        DrawID  CreateDrawObjectFromDrawObject     (DrawID id, uint32_t offsetx, uint32_t offsety, uint32_t width, uint32_t height);
        DrawID  CreateDrawObjectFromFile           (Blex::RandomStream *stream);
        DrawID  CreateResizedDrawObjectFromFile    (Blex::RandomStream *stream, int outwidth, int outheight);
        int32_t RegisterDrawObject                 (DrawInfo const *drawinfo);

        //bitmap operations
        int32_t RotateDrawObject                     (DrawID id, bool rotate_right);
        int32_t MirrorDrawObject                     (DrawID id);
        int32_t ResizeDrawObject                   (DrawID id, uint32_t newwidth, uint32_t newheight);

        //set options
        void SetAlphaMode              (DrawID id, uint32_t mode);
        void SetBinaryMode             (DrawID id, uint32_t mode);

        void SetOutlineColor       (DrawID id, DrawLib::Pixel32 color);
        void SetOutlineWidth       (DrawID id, double width);

        void SetFillColor      (DrawID id, DrawLib::Pixel32 color);
        void SetFillTexture    (DrawID id, DrawID texture, double offsetx, double offsety);
        void SetFillMode       (DrawID id, DrawLib::DrawObject::FillMode mode);

        //get options
        uint32_t  GetWidth (DrawID id);
        uint32_t  GetHeight(DrawID id);
        uint32_t  GetAlphaMode(DrawID id);
        uint32_t  GetBinaryMode(DrawID id);
        DrawLib::IRect GetPaintedRectangle(DrawID id);

        //draw options
        void DrawDrawObject    (DrawID id, DrawID fid, double offsetx, double offsety);
        void DrawEllipse       (DrawID id, double centerx, double centery, double radiusx, double radiusy, bool outline);
        void DrawPixel         (DrawID id, double x, double y,  DrawLib::Pixel32 color);
        void DrawRectangle     (DrawID id, double sx, double sy, double ex, double ey);
        void StrokeFillPath          (DrawID id, DrawLib::Path const &path, bool stroke, bool fill);

        ///Comparing bitmaps for testing purposes
        double CompareCanvases(DrawID id1, DrawID id2);

        ///Destroy an object... for powerusers only :)
        void DestroyDrawObject (DrawID id);

        // Bitmap filters...
        void BlurCanvas        (DrawID id, int xsize, int ysize);
        void GrayscaleCanvas   (DrawID id);
        void MultiplyCanvas    (DrawID id1, DrawID id2);

        int32_t ValidateDrawId(DrawID id) const;

        void CalculateKMeansQuantizedPalette(DrawID id, uint32_t clustercount, uint8_t minimum_alpha, int32_t max_iters, float initialpoint, std::vector< Pixel32 > *result);

        int32_t RegisterDrawInfo(std::unique_ptr<DrawLib::Bitmap32> &to_adopt);
        DrawInfo const& GetDrawInfoForRead(DrawID id) const;
        DrawInfo& GetDrawInfoForWrite(DrawID id);

        ///1-based drawinfo list
        std::vector<DrawInfo const *> drawinfos;
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

int32_t   DrawlibInterfaceState::ResizeDrawObject(DrawID id, uint32_t newwidth, uint32_t newheight)
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

double  DrawlibInterfaceState::CompareCanvases(DrawID id1, DrawID id2)
{
        DrawInfo const& src1 = GetDrawInfoForRead(id1);
        DrawInfo const& src2 = GetDrawInfoForRead(id2);

        return DrawLib::MeanSquareError(src1.GetBitmap(), src2.GetBitmap(), false, false);
}

/**********************************************************************************************
OUTLINE SET FUNCTIONS
*********************************************************************************************/
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

void DrawlibInterfaceState::DrawPixel(DrawID id, double x, double y,  DrawLib::Pixel32 pixel)
{
        GetDrawInfoForWrite(id).GetDrawObject().DrawPixel(DrawLib::FPPoint(x,y),pixel);
}

DrawLib::IRect DrawlibInterfaceState::GetPaintedRectangle(DrawID id)
{
        DrawInfo const&drawinfo = GetDrawInfoForRead(id);
        return drawinfo.GetCanvas().GetPaintedRectangle();
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

void DrawlibInterfaceState::DrawRectangle (DrawID id, double sx, double sy, double ex, double ey)
{
        DrawLib::FPPoint upper_left (sx, sy);
        DrawLib::FPPoint lower_right(ex, ey);
        GetDrawInfoForWrite(id).GetDrawObject().DrawRectangle(upper_left,lower_right);
}

void DrawlibInterfaceState::DestroyDrawObject(DrawID id)
{
        GetDrawInfoForRead(id).DelRef();
        drawinfos[id-1] = NULL;
        DEBUGPRINT("DestroyDrawObject called");
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
void    DrawlibInterfaceState::MultiplyCanvas(DrawID cid1, DrawID cid2)
{
        DrawInfo& dptr1 = GetDrawInfoForWrite(cid1);
        DrawInfo& dptr2 = GetDrawInfoForWrite(cid2);
        DrawLib::MultiplyBitmap(&dptr1.GetBitmap(), dptr2.GetBitmap());
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

void  DLv2_MultiplyCanvas(HSVM *vm)
{
        OPEN_WRAPPER
        context->MultiplyCanvas(HSVM_IntegerGet(vm, HSVM_Arg(0)), HSVM_IntegerGet(vm, HSVM_Arg(1)));
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

void DLv2_GetPaintedRectangle(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id = HSVM_IntegerGet(vm,HSVM_Arg(0));
        IRect rect = context->GetPaintedRectangle(id);

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "X")), rect.upper_left.x);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "Y")), rect.upper_left.y);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "WIDTH")), rect.lower_right.x - rect.upper_left.x);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm, "HEIGHT")), rect.lower_right.y - rect.upper_left.y);

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
        context->DrawRectangle(id , sx, sy, ex, ey);

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
        context->DrawEllipse(id , cx, cy, rx, ry, true); //true = outline

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

void  DLv2_ResizeCanvas(HSVM *vm, HSVM_VariableId id_set)
{
        OPEN_WRAPPER
        DrawID id  = HSVM_IntegerGet(vm,HSVM_Arg(0));
        int32_t newwidth = HSVM_IntegerGet(vm,HSVM_Arg(1));
        int32_t newheight= HSVM_IntegerGet(vm,HSVM_Arg(2));
        int32_t result = context->ResizeDrawObject(id, newwidth, newheight);
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
*  REGISTRATION OF DRAWLIB
*
*******************************************************************************/

extern "C" {

static void* CreateContext(void *)
{
        return new DrawlibInterfaceState;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<DrawlibInterfaceState*>(context_ptr);
}

} //end extern "C"

extern "C" BLEXLIB_PUBLIC int HSVM_ModuleEntryPoint(HSVM_RegData *regdata, void*)
{
        HSVM_RegisterContext (regdata, DrawlibContextId, NULL, &CreateContext, &DestroyContext);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_VALIDATEDRAWID:WHMOD_GRAPHICS:I:I",DLv2_ValidateDrawId);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_MAKECANVAS:WHMOD_GRAPHICS:I:III",DLv2_MakeCanvas);

        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWRECTANGLE:WHMOD_GRAPHICS::IIIII",DLv2_DrawRectangle);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWELLIPSE:WHMOD_GRAPHICS::IIIII",DLv2_DrawEllipse);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWELLIPSEBORDER:WHMOD_GRAPHICS::IIIII",DLv2_DrawEllipseOutline);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWPIXEL:WHMOD_GRAPHICS::IIII", DLv2_DrawPixel);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETPAINTEDRECTANGLE:WHMOD_GRAPHICS:R:I", DLv2_GetPaintedRectangle);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWPATH:WHMOD_GRAPHICS::IRABBFA",DLv2_DrawPath);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DRAWCANVAS:WHMOD_GRAPHICS::IIII", DLv2_DrawCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_CREATECANVASFROMFILE:WHMOD_GRAPHICS:I:X", DLv2_CreateCanvasFromFile);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_CREATERESIZEDCANVASFROMFILE:WHMOD_GRAPHICS:I:XII", DLv2_CreateResizedCanvasFromFile);

        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETCANVASWIDTH:WHMOD_GRAPHICS:I:I", DLv2_GetCanvasWidth);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETCANVASHEIGHT:WHMOD_GRAPHICS:I:I", DLv2_GetCanvasHeight);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETFILLCOLOR:WHMOD_GRAPHICS::II", DLv2_SetFillColor);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETFILLMODE:WHMOD_GRAPHICS::II", DLv2_SetFillMode);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETFILLTEXTURE:WHMOD_GRAPHICS::IIII", DLv2_SetFillTexture);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETOUTLINECOLOR:WHMOD_GRAPHICS::II", DLv2_SetOutlineColor);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETOUTLINEWIDTH:WHMOD_GRAPHICS::II", DLv2_SetOutlineWidth);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_RESIZECANVAS:WHMOD_GRAPHICS:I:III", DLv2_ResizeCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_ROTATECANVAS:WHMOD_GRAPHICS:I:IB", DLv2_RotateCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_MIRRORCANVAS:WHMOD_GRAPHICS:I:I", DLv2_MirrorCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_DUPLICATECANVAS:WHMOD_GRAPHICS:I:I", DLv2_DuplicateCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_MAKECANVASFROMCANVAS:WHMOD_GRAPHICS:I:IIIII", DLv2_MakeCanvasFromCanvas);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_DESTROYCANVAS:WHMOD_GRAPHICS::I", DLv2_DestroyCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_CREATEPNGBLOBFROMCANVAS:WHMOD_GRAPHICS:X:IBB", DLv2_CreatePNGBlobFromCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_CREATEJPGBLOBFROMCANVAS:WHMOD_GRAPHICS:X:II", DLv2_CreateJPGBlobFromCanvas);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_CREATEGIFBLOBFROMCANVAS:WHMOD_GRAPHICS:X:I", DLv2_CreateGIFBlobFromCanvas);


        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETALPHAMODE:WHMOD_GRAPHICS::II", DLv2_SetAlphaMode);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_SETPIXELMODE:WHMOD_GRAPHICS::II", DLv2_SetBinaryMode);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETALPHAMODE:WHMOD_GRAPHICS:I:I", DLv2_GetAlphaMode);
        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETPIXELMODE:WHMOD_GRAPHICS:I:I", DLv2_GetBinaryMode);

        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_BLURCANVAS:WHMOD_GRAPHICS::III", DLv2_BlurCanvas);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_GRAYSCALECANVAS:WHMOD_GRAPHICS::I", DLv2_GrayscaleCanvas);
        HSVM_RegisterMacro(regdata, "__DRAWLIB_V2_MULTIPLYCANVAS:WHMOD_GRAPHICS::II", DLv2_MultiplyCanvas);


        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_COMPARECANVASES:WHMOD_GRAPHICS:F:II", DLv2_CompareCanvases);


        HSVM_RegisterFunction(regdata, "__DRAWLIB_V2_GETKMEANSQUANTIZEDPALETTE:WHMOD_GRAPHICS:RA:IIIIF", DLv2_GetKMeansQuantizedPalette);

        return 1;
}

} //namespace end
