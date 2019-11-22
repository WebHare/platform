#include <drawlib/drawlibv2/allincludes.h>


//#include <cstdio>
#include <algorithm>
#include "wmf_gditypes.h"
#include "wmf_fakegdi.h"
#include <drawlib/drawlibv2/bitmapio.h>
#include <drawlib/drawlibv2/bitmapmanip.h>
#include <drawlib/drawlibv2/textrenderer.h>

using std::cos;
using std::sin;
using std::atan2;

namespace WmfLib
{

uint8_t HB_Forwarddiag[64] =
        {1,0,0,0,0,0,0,0,
         0,1,0,0,0,0,0,0,
         0,0,1,0,0,0,0,0,
         0,0,0,1,0,0,0,0,
         0,0,0,0,1,0,0,0,
         0,0,0,0,0,1,0,0,
         0,0,0,0,0,0,1,0,
         0,0,0,0,0,0,0,1};

uint8_t HB_Backwarddiag[64] =
        {0,0,0,0,0,0,0,1,
         0,0,0,0,0,0,1,0,
         0,0,0,0,0,1,0,0,
         0,0,0,0,1,0,0,0,
         0,0,0,1,0,0,0,0,
         0,0,1,0,0,0,0,0,
         0,1,0,0,0,0,0,0,
         1,0,0,0,0,0,0,0};

uint8_t HB_Cross[64] =
        {0,0,0,0,1,0,0,0,
         0,0,0,0,1,0,0,0,
         0,0,0,0,1,0,0,0,
         1,1,1,1,1,1,1,1,
         0,0,0,0,1,0,0,0,
         0,0,0,0,1,0,0,0,
         0,0,0,0,1,0,0,0,
         0,0,0,0,1,0,0,0};

uint8_t HB_Crossdiag[64] =
        {1,0,0,0,0,0,0,1,
         0,1,0,0,0,0,1,0,
         0,0,1,0,0,1,0,0,
         0,0,0,1,1,0,0,0,
         0,0,0,1,1,0,0,0,
         0,0,1,0,0,1,0,0,
         0,1,0,0,0,0,1,0,
         1,0,0,0,0,0,0,1};

uint8_t HB_Horizontal[64] =
        {0,0,0,0,0,0,0,0,
         0,0,0,0,0,0,0,0,
         0,0,0,0,0,0,0,0,
         1,1,1,1,1,1,1,1,
         0,0,0,0,0,0,0,0,
         0,0,0,0,0,0,0,0,
         0,0,0,0,0,0,0,0,
         0,0,0,0,0,0,0,0};

uint8_t HB_Vertical[64] =
        {0,0,0,0,1,0,0,0,
         0,0,0,0,1,0,0,0,
         0,0,0,0,1,0,0,0,
         0,0,0,0,1,0,0,0,
         0,0,0,0,1,0,0,0,
         0,0,0,0,1,0,0,0,
         0,0,0,0,1,0,0,0,
         0,0,0,0,1,0,0,0};


DrawLib::Bitmap32 *CreateStandardPattern(const uint8_t *pattern, const DrawLib::Pixel32 &fore,
        const DrawLib::Pixel32 &back)
{
        DrawLib::Bitmap32 *newpattern = new DrawLib::Bitmap32(8,8);
        DrawLib::Scanline32 myscanline(8, true);

        for(unsigned int y=0; y<8; y++)
        {
                const uint8_t *src = pattern+(y*8);
                for(unsigned int x=0; x<8; x++)
                {
                        if (src[x]==1)
                                myscanline.Pixel(x) = fore;
                        else
                                myscanline.Pixel(x) = back;
                }
                newpattern->SetScanline32(y, myscanline);
        }
        return newpattern;
}


//*******************************************************************************
// GDIOBJECTLIST stuff
//*******************************************************************************/

GDIObject::~GDIObject()
{
}

GDIObjectList::GDIObjectList()
{
}

GDIObjectList::~GDIObjectList()
{
        //nothing needs to be done. Everything is destroyed automatically :)
}

GDIObject * GDIObjectList::GetFakeGDIObject(uint32_t index)
{
        if (index>=objectlist.size())
                throw(std::runtime_error("GDIObjectList::GetFakeGDIObject out-of-range"));

        return objectlist[index]->object.get();
}

void GDIObjectList::AddObject(std::unique_ptr<GDIObject> &obj)
{
        // find the first empty slot!
        int maxitems = objectlist.size();
        // check if the list contains no items
        if (maxitems==0)
        {
                AddObject(obj, 0);      // add first object!
        }
        else
        {
                //find first empty slot!
                int index = 0;
                while(index<maxitems)
                {
                        if (objectlist[index].get()==NULL)
                        {
                                // found an empty slot -> add!
                                AddObject(obj, index);
                                return;         //exit!
                        }
                        index++;
                }
                // if we end up here.. there is no empty slot..
                // so add the object at the end of the list!
                AddObject(obj, index);
        }
}

void GDIObjectList::AddObject(std::unique_ptr<GDIObject> &obj, uint32_t index)
{
        GDIObjectListItemPtr  newitem (new GDIObjectListItem);
        newitem->object.reset(obj.release());  //obj ownership set to newitem!
        // check if the index is out-of-range!
        if (index>objectlist.size())
        {
                // expand the objectlist to include the index
                objectlist.resize(index+1);
        }

        // check if the index is at the end of the list..
        if (index==objectlist.size())
        {
                // add to the end of the list!
                DEBUGPRINT("Adding GDI object ID=[" << index << "]");
                objectlist.push_back(newitem);
                return;
        }
        // check if we need to delete the object first!
        if (objectlist[index].get()!=NULL)
        {
                DEBUGPRINT("Deleting GDI object ID=[" << index << "]");
                DeleteObject(index);
        }
        // add the new object to the index
        objectlist[index] = newitem;

        DEBUGPRINT("Replacing GDI object ID=[" << index << "]");
}


int32_t GDIObjectList::DeleteObject(uint32_t index)
{
        if (index>=objectlist.size())
                throw(std::runtime_error("GDIObjectList::DeleteObject out-of-range!"));

        // delete object from memory!
        objectlist[index].reset();
        return 0;
}

//*****************************************************************************
// GDI_STACK stuff
//*****************************************************************************/

GDI_DCStack::GDI_DCStack()
{
}

GDI_DCStack::~GDI_DCStack()
{
        for(unsigned int i=0; i<stacklist.size(); i++)
        {
                delete stacklist[i];
        }
}
GDI_DCItem *GDI_DCStack::TruncateTo(unsigned items)
{
        if (items>stacklist.size())
                throw(std::runtime_error("GDI_DCStack::TruncateTo stack underflow"));

        while (stacklist.size()>items+1)
        {
                delete stacklist.back();
                stacklist.pop_back();
        }
        if (stacklist.empty())
                return NULL;

        GDI_DCItem *result = stacklist.back();
        stacklist.pop_back();
        return result;
}

GDI_DCItem *GDI_DCStack::Pop(unsigned items)
{
        if (items>stacklist.size())
                throw(std::runtime_error("GDI_DCStack::Pop stack underflow"));

        // delete and pop unwanted items!
        if(items>1)
        {
                for(unsigned i=0; i<(items-1); ++i)
                {
                        delete stacklist.back();
                        stacklist.pop_back();
                }
        }

        // check if we have a stack left!!
        if (stacklist.empty())
                return NULL;

        //return the last item on the stack and pop it!
        GDI_DCItem *result = stacklist.back();
        stacklist.pop_back();

        return result;
}

int32_t GDI_DCStack::Push(GDI_DCItem *item)
{
        stacklist.push_back(item);
        return 0;
}

/*******************************************************************************
/ FAKEGDI
*******************************************************************************/

FakeGDI::FakeGDI()
: outputbitmap(NULL)
{
        // setup standard GDI system
        devicecontext.reset(new GDI_DCItem());
        devicecontext->mapmode = MM_Text;  //FIXME: Dezze likt dubbel op? de default init van een DC is ook al MM_Text..

        currentpoint.x = 0;
        currentpoint.y = 0;

        // build a new GDIObjectList
        ObjectList = new GDIObjectList();
        dcstack    = new GDI_DCStack();

        // allocate standard brush/pen/region4

        startbrush = new GO_Brush();
        startpen   = new GO_Pen();

        devicecontext->brushptr = startbrush;
        devicecontext->penptr   = startpen;
        devicecontext->fontptr  = NULL;

        devicecontext->valign = GDI_DCItem::TOP;
        devicecontext->halign = GDI_DCItem::LEFT;

        devicecontext->textcolor = DrawLib::Pixel32(0,0,0,255);
        devicecontext->bkmode = OPAQUE;
        devicecontext->bkcolor = DrawLib::Pixel32(255,255,255,255);

        dwROP2code = R2_COPYPEN;

        // setup StockObjects

        StockObjects[0] = new GO_Brush();       // white brush
        StockObjects[1] = new GO_Brush();       // LtGrayBrush
        StockObjects[2] = new GO_Brush();       // GrayBrush
        StockObjects[3] = new GO_Brush();       // DkGrayBrush
        StockObjects[4] = new GO_Brush();       // BlackBrush
        StockObjects[5] = new GO_Brush();       // NullBrush
        StockObjects[6] = new GO_Pen();         // WhitePen
        StockObjects[7] = new GO_Pen();         // BlackPen
        StockObjects[8] = new GO_Pen();         // NullPen

        SetBrush(*((GO_Brush*)StockObjects[0]), BS_SOLID, DrawLib::Pixel32(0xFF,0xFF,0xFF,0xFF),0);
        SetBrush(*((GO_Brush*)StockObjects[1]), BS_SOLID, DrawLib::Pixel32(192,192,192,0xFF), 0);
        SetBrush(*((GO_Brush*)StockObjects[2]), BS_SOLID, DrawLib::Pixel32(128,128,128,0xFF), 0);
        SetBrush(*((GO_Brush*)StockObjects[3]), BS_SOLID, DrawLib::Pixel32(0,0,0,0xFF), 0);      // fixme: hatch!
        SetBrush(*((GO_Brush*)StockObjects[4]), BS_SOLID, DrawLib::Pixel32(0,0,0,0xFF), 0);
        SetBrush(*((GO_Brush*)StockObjects[5]), BS_NULL,  DrawLib::Pixel32(0,0,0,0x00), 0);

        SetPen(*((GO_Pen*)StockObjects[6]), PS_SOLID, 0, DrawLib::Pixel32(255,255,255,255));
        SetPen(*((GO_Pen*)StockObjects[7]), PS_SOLID, 0, DrawLib::Pixel32(255,255,255,255));
        SetPen(*((GO_Pen*)StockObjects[8]), PS_NULL, 0, DrawLib::Pixel32(0,0,0,255));

        dwPolyFillMode = 1;     // alternate mode!
        use_path = false;
}

FakeGDI::~FakeGDI()
{
        delete dcstack;
        delete startpen;
        delete startbrush;
        delete ObjectList;

        for(int i=0; i<=8; i++)
            delete StockObjects[i];
}
void FakeGDI::SetupDrawLibAccordingToDeviceContext()
{

        const GO_Pen   * pen     = devicecontext->penptr;
        const GO_Brush * brush   = devicecontext->brushptr;

        drobj->SetFillColor(    brush->color);
        drobj->SetOutlineColor( pen->color);
        drobj->SetOutlineWidth( CalcLineWidth(pen->width));

        switch(brush->style)
        {
        case    BS_PATTERN:
                DEBUGPRINT("Brush: PATTERN");
                if (brush->patternbrushbitmap.get()!=NULL)
                {
                        drobj->SetFillMode(DrawLib::DrawObject::TEXTURED);
                        drobj->SetFillTexture(brush->patternbrushbitmap.get(), DrawLib::IPoint(0,0));
                }
                else
                {
                        drobj->SetFillMode(DrawLib::DrawObject::SOLID);
                        DEBUGPRINT("  WARNING: PatternBrushBitmap == NULL!");
                }
                break;

        case    BS_HATCHED:
                DEBUGPRINT("Brush: HATCHED");
                if (brush->patternbrushbitmap.get()!=NULL)
                {
                        drobj->SetFillMode(DrawLib::DrawObject::TEXTURED);
                        drobj->SetFillTexture(brush->patternbrushbitmap.get(), DrawLib::IPoint(0,0));
                }
                else
                {
                        drobj->SetFillMode(DrawLib::DrawObject::SOLID);
                        DEBUGPRINT("  WARNING: PatternBrushBitmap == NULL!");
                }
                break;
        default:
                DEBUGPRINT("Brush: SOLID");
                drobj->SetFillMode(DrawLib::DrawObject::SOLID);
        }
}

void    FakeGDI::SetBrush(GO_Brush &brush, uint32_t style, DrawLib::Pixel32 const &color, uint32_t hatch)
{
        brush.style = style;
        brush.color = color;
        brush.hatch = hatch;
        brush.ObjectType = isBrush;
}

void    FakeGDI::SetPen(GO_Pen &pen, uint32_t style, uint32_t width, DrawLib::Pixel32 const &color)
{
        pen.style = style;
        pen.width = width;
        pen.color = color;
        pen.ObjectType = isPen;
}

void FakeGDI::SetExtent(int32_t /*x*/, int32_t /*y*/)
{
//        ViewportExtent.x = x;
//        ViewportExtent.y = y;
//        WindowExtent.x = x;
//        WindowExtent.y = y;
}

void FakeGDI::SetOutputParams(DrawLib::Bitmap32 *bitmap)
{
        outputbitmap = bitmap;
        protected_bitmap.reset(new DrawLib::ProtectedBitmap32(*outputbitmap));
        mycanvas.reset(new DrawLib::Canvas32(protected_bitmap.get()));
        drobj.reset(new DrawLib::DrawObject(mycanvas.get()));

        devicecontext->region.reset(new DrawLib::Region(outputbitmap->GetWidth(),outputbitmap->GetHeight(), true));
        RegionToPermission();
}

// *****************************************************************************

void FakeGDI::SetupHatchBrush(GO_Brush *obj, uint32_t hatch, const DrawLib::Pixel32 &color,
        const DrawLib::Pixel32 &bkcolor)
{
        uint8_t* pattern = NULL;

        switch(hatch)
        {
        case HS_HORIZONTAL:
                DEBUGPRINT("  HATCH PATTERN = HS_HORIZONTAL");
                pattern = HB_Horizontal;
                break;
        case HS_VERTICAL:
                DEBUGPRINT("  HATCH PATTERN = HS_VERTICAL");
                pattern = HB_Vertical;
                break;
        case HS_CROSS:
                DEBUGPRINT("  HATCH PATTERN = HS_CROSS");
                pattern = HB_Cross;
                break;
        case HS_DIAGCROSS:
                DEBUGPRINT("  HATCH PATTERN = HS_DIAGCROSS");
                pattern = HB_Crossdiag;
                break;
        case HS_FDIAGONAL:
                DEBUGPRINT("  HATCH PATTERN = HS_FDIAGONAL");
                pattern = HB_Forwarddiag;
                break;
        case HS_BDIAGONAL:
                DEBUGPRINT("  HATCH PATTERN = HS_BDIAGONAL");
                pattern = HB_Backwarddiag;
                break;
        default:
                DEBUGPRINT("  HATCH PATTERN = ????");
                return;
        }

        obj->patternbrushbitmap.reset(CreateStandardPattern(pattern,
                color, bkcolor));
}

int32_t FakeGDI::CreateBrushIndirect(uint32_t style, const DrawLib::Pixel32 &color, uint32_t hatch)
{
        std::unique_ptr<GO_Brush> obj (new GO_Brush());
        obj->ObjectType = isBrush;
        obj->color = color;
          DEBUGPRINT("  Red     " << static_cast<int>(color.GetR()));
          DEBUGPRINT("  Green   " << static_cast<int>(color.GetG()));
          DEBUGPRINT("  Blue    " << static_cast<int>(color.GetB()));
          DEBUGPRINT("  Style   " << style);
          DEBUGPRINT("  Hatch   " << hatch);
        //obj->bitmap = NULL;
        switch(style)
        {
        case BS_NULL:
                break;
        case BS_SOLID:
                break;
        case BS_PATTERN:
                break;
        case BS_HATCHED:
                {
                        DrawLib::Pixel32 bkcolor;
                        if (devicecontext->bkmode == OPAQUE)
                                bkcolor = devicecontext->bkcolor;
                        else
                                bkcolor = DrawLib::Pixel32(0,0,0,0);

                        SetupHatchBrush(obj.get(), hatch, color, bkcolor);
                }
                break;
        default:
                DEBUGPRINT("**************************");
                DEBUGPRINT(" Unsupported BRUSH Loaded");
                DEBUGPRINT("**************************");
                break;
        }
        obj->hatch = hatch;
        obj->style = style;
        ObjectList->AddObject(obj);
        return 0;
}

int32_t FakeGDI::CreateBrushIndirect(uint32_t objectindex, uint32_t style, const DrawLib::Pixel32 &color, uint32_t hatch)
{
        std::unique_ptr<GO_Brush> obj (new GO_Brush());
        obj->ObjectType = isBrush;
        obj->color = color;
          DEBUGPRINT("  Red     " << static_cast<int>(color.GetR()));
          DEBUGPRINT("  Green   " << static_cast<int>(color.GetG()));
          DEBUGPRINT("  Blue    " << static_cast<int>(color.GetB()));
          DEBUGPRINT("  Style   " << style);
          DEBUGPRINT("  Hatch   " << hatch);
          DEBUGPRINT("  WOOOOHHAAAAA!!! This function should be obsolete! ");
/*
        obj->bitmap = NULL;
        switch(style)
        {
        case BS_NULL:
                break;
        case BS_SOLID:
                break;
        case BS_PATTERN:
                break;
        case BS_HATCHED:
                {
                switch(hatch)
                {
                case HS_HORIZONTAL:
                        //obj->bitmap = (void*)new FakeBitmap(BI_horizontal);
                        //PatternBitmapResourceList->Add((FakeBitmap*)obj->bitmap);
                        break;
                case HS_VERTICAL:
                        //obj->bitmap = (void*)new FakeBitmap(BI_vertical);
                        //PatternBitmapResourceList->Add((FakeBitmap*)obj->bitmap);
                        break;
                case HS_CROSS:
                        //obj->bitmap = (void*)new FakeBitmap(BI_cross);
                        //PatternBitmapResourceList->Add((FakeBitmap*)obj->bitmap);
                        break;
                case HS_DIAGCROSS:
                        //obj->bitmap = (void*)new FakeBitmap(BI_diagonal);
                        //PatternBitmapResourceList->Add((FakeBitmap*)obj->bitmap);
                        break;
                case HS_FDIAGONAL:
                        //obj->bitmap = (void*)new FakeBitmap(BI_forward);
                        //PatternBitmapResourceList->Add((FakeBitmap*)obj->bitmap);
                        break;
                case HS_BDIAGONAL:
                        //obj->bitmap = (void*)new FakeBitmap(BI_backward);
                        //PatternBitmapResourceList->Add((FakeBitmap*)obj->bitmap);
                        break;
                default:
                        // backward is the default is everything else fails...
                        //obj->bitmap = (void*)new FakeBitmap(BI_backward);
                        //PatternBitmapResourceList->Add((FakeBitmap*)obj->bitmap);
                        break;
                }
                }
                break;
        default:
                DEBUGPRINT("**************************"));
                DEBUGPRINT(" Unsupported BRUSH Loaded"));
                DEBUGPRINT("**************************"));
                break;
        } */
        obj->hatch = hatch;
        obj->style = style;
        ObjectList->AddObject(obj, objectindex);
        return 0;
}

// if index < 0, the value is taken to be unknown!
int32_t FakeGDI::CreateFontIndirectW(int32_t index, fLOGFONT32 const *logfont)
{
        std::string stylename;
        const char *stBold    = "Bold";
        const char *stNormal  = "Regular";

        std::string buffer;

        std::unique_ptr<GO_Font> obj (new GO_Font());

        obj->ObjectType = isFont;

        switch(logfont->lfWeight)
        {
        case FW_DONTCARE:
                                DEBUGPRINT("  weight = Don't care");
                                stylename = stNormal;
                                obj->is_bold=false;
                                break;
        case FW_THIN:
                                DEBUGPRINT("  weight = Thin");
                                stylename = stNormal;
                                obj->is_bold=false;
                                break;
        case FW_EXTRALIGHT:
                                DEBUGPRINT("  weight = Extra Light");
                                obj->is_bold=false;
                                stylename = stNormal;
                                break;
        case FW_LIGHT:
                                DEBUGPRINT("  weight = Light");
                                stylename = stNormal;
                                obj->is_bold=false;
                                break;
        case FW_NORMAL:
                                DEBUGPRINT("  weight = Normal");
                                stylename = stNormal;
                                obj->is_bold=false;
                                break;
        case FW_MEDIUM:
                                DEBUGPRINT("  weight = Medium");
                                stylename = stNormal;
                                obj->is_bold=false;
                                break;
        case FW_SEMIBOLD:
                                DEBUGPRINT("  weight = Semi Bold");
                                stylename = stBold;
                                obj->is_bold=true;
                                break;
        case FW_BOLD:
                                DEBUGPRINT("  weight = Bold");
                                stylename = stBold;
                                obj->is_bold=true;
                                break;
        case FW_EXTRABOLD:
                                DEBUGPRINT("  weight = Extra Bold");
                                stylename = stBold;
                                obj->is_bold=true;
                                break;
        case FW_HEAVY:
                                DEBUGPRINT("  weight = Heavy");
                                stylename = stBold;
                                obj->is_bold=true;
                                break;
        default:
                                DEBUGPRINT("  weight = unknown");
                                stylename = stNormal;
                                obj->is_bold=false;
        }

        if (logfont->lfItalic!=0)
        {
                DEBUGPRINT("  italic = true");
                // if Italic == true and weight == normal
                // the font name is only "Italic"
                // if Italic == true and weight == bold
                // the font name is "Bold Italic"
                if (logfont->lfWeight==FW_NORMAL)
                {
                        stylename = "Italic";
                }
                else
                {
                        stylename = stylename + " Italic";
                }
        }
        else
        {
                DEBUGPRINT("  italic = false");
        }

        switch((logfont->lfPitchAndFamily & 0xF0))
        {
        case FF_DONTCARE:
                                DEBUGPRINT("  family = Don't know");
                                break;
        case FF_ROMAN:
                                DEBUGPRINT("  family = Variable stroke width, serifed");
                                break;
        case FF_SWISS:
                                DEBUGPRINT("  family = Variable stroke width, sans-serifed");
                                break;
        case FF_MODERN:
                                DEBUGPRINT("  family = Constant stroke width, serifed or sans-serifed");
                                break;
        case FF_SCRIPT:
                                DEBUGPRINT("  family = Cursive");
                                break;
        case FF_DECORATIVE:
                                DEBUGPRINT("  family = Decorative");
                                break;
        default:
                                DEBUGPRINT("  family = Unknown");
                                ;
        }

        obj->encoding = logfont->lfCharSet;
        switch(logfont->lfCharSet)
        {
        case ANSI_CHARSET:
                DEBUGPRINT("  charset = ANSI");

                break;
        case DEFAULT_CHARSET:
                DEBUGPRINT("  charset = DEFAULT");
                break;
        case SYMBOL_CHARSET:
                DEBUGPRINT("  charset = SYMBOL");
                break;
        case OEM_CHARSET:
                DEBUGPRINT("  charset = OEM");
                break;
        case SHIFTJIS_CHARSET:
                DEBUGPRINT("  charset = SHIFTJIS");
                break;
        case CHINESEBIG5_CHARSET:
                DEBUGPRINT("  charset = CHINESEBIG5 - CP950");
                break;
        case JOHAB_CHARSET:
                DEBUGPRINT("  charset = JOHAB");
                break;
/*
#define HANGEUL_CHARSET         129
#define HANGUL_CHARSET          129
#define GB2312_CHARSET          134
#define HEBREW_CHARSET          177
#define ARABIC_CHARSET          178
#define GREEK_CHARSET           161
#define TURKISH_CHARSET         162
#define VIETNAMESE_CHARSET      163
#define THAI_CHARSET            222
#define EASTEUROPE_CHARSET      238
#define RUSSIAN_CHARSET         204
*/
        default:
                DEBUGPRINT("  charset = unknown [code = " << logfont->lfCharSet << "]");
                break;
        }

        std::string fontname;
        Blex::UTF8Encode(logfont->lfFaceName.begin(), logfont->lfFaceName.end(), std::back_inserter(fontname));

        //FIXME: This print crashes.
        //DEBUGPRINT("  fontmapper searching for: " << fontname << " " << stylename);

        DEBUGPRINT("  width  " <<logfont->lfWidth);
        DEBUGPRINT("  height " <<logfont->lfHeight);

        DEBUGPRINT("  orientation " <<logfont->lfOrientation);
        DEBUGPRINT("  escapement  " <<logfont->lfEscapement);

        // This is a quick fix..
        // The escapement overrules the orientation in Win95!
        // if Orientation is zero
        if ((logfont->lfOrientation==0) || (logfont->lfEscapement!=0))
                obj->orientation = logfont->lfEscapement; //flip image if escapement?
        else
                obj->orientation = logfont->lfOrientation;


        // set font family and style..
        obj->familyname = fontname;
        obj->stylename  = stylename;

        obj->pointsizeY = logfont->lfHeight;
        obj->pointsizeX = logfont->lfWidth;

        //FIXME:: make a reference.
        devicecontext->fontptr = obj.get();

        if (index<0)
            ObjectList->AddObject(obj);
        else
            ObjectList->AddObject(obj, index);

        return 0;
}

int32_t FakeGDI::CreatePen(uint32_t objectindex, uint32_t style, uint32_t width, const DrawLib::Pixel32 &color)
{
        std::unique_ptr<GO_Pen> obj (new GO_Pen());
        obj->ObjectType = isPen;
        obj->color = color;
        #ifdef DEBUG
          DEBUGPRINT("  Red   " << static_cast<int>(color.GetR()));
          DEBUGPRINT("  Green " << static_cast<int>(color.GetG()));
          DEBUGPRINT("  Blue  " << static_cast<int>(color.GetB()));
          DEBUGPRINT("  Style " << style);
          DEBUGPRINT("  Width " << width);
        #endif
        obj->style = style;
        obj->width = width;
        ObjectList->AddObject(obj, objectindex);
        return 0;
}

int32_t FakeGDI::CreatePenIndirect(uint32_t style, uint32_t width, const DrawLib::Pixel32 &color)
{
        std::unique_ptr<GO_Pen> obj (new GO_Pen());
        obj->ObjectType = isPen;
        obj->color = color;
        #ifdef DEBUG
          DEBUGPRINT("  Red   " << static_cast<int>(color.GetR()));
          DEBUGPRINT("  Green " << static_cast<int>(color.GetG()));
          DEBUGPRINT("  Blue  " << static_cast<int>(color.GetB()));
          DEBUGPRINT("  Style " << style);
          DEBUGPRINT("  Width " << width);
        #endif
        obj->style = style;
        obj->width = width;
        ObjectList->AddObject(obj); //obj loses ownership...:)
        return 0;
}

int32_t FakeGDI::CreateRegion()
{
        std::unique_ptr<GDIObject> obj (new GDIObject());
        obj->ObjectType = isRegion;
        ObjectList->AddObject(obj);
        return 0;
}

int32_t FakeGDI::CreatePalette()
{
        std::unique_ptr<GDIObject> obj (new GDIObject());
        obj->ObjectType = isPalette;
        ObjectList->AddObject(obj);
        return 0;
}

int32_t FakeGDI::CreateRegion(int32_t objectindex)
{
        std::unique_ptr<GDIObject> obj (new GDIObject());
        obj->ObjectType = isRegion;
        ObjectList->AddObject(obj, objectindex);
        return 0;
}

int32_t FakeGDI::CreatePalette(int32_t objectindex)
{
        std::unique_ptr<GDIObject> obj (new GDIObject());
        obj->ObjectType = isPalette;
        ObjectList->AddObject(obj, objectindex);
        return 0;
}


int32_t FakeGDI::DIBCreatePatternBrush(const uint8_t *DIBdata, long datalength)
{
        std::unique_ptr<GO_Brush> obj (new GO_Brush());
        obj->ObjectType = isBrush;
        obj->style = BS_PATTERN;
        obj->color = DrawLib::Pixel32(0,0,0,255);

        Blex::MemoryReadStream DIBstream(DIBdata, datalength);

        DrawLib::Bitmap32 *patternbitmap = DrawLib::CreateBitmap32FromBMP(&DIBstream, false, false);
        if (patternbitmap==NULL)
        {
                throw(std::runtime_error("DIBCreatePatternBrush loaded a NULL bitmap"));
        }
        obj->patternbrushbitmap.reset(patternbitmap);
        obj->style  = BS_PATTERN;

        // load it into the current device context
        devicecontext->brushptr = obj.get();

        ObjectList->AddObject(obj);
        return 0;
}

int32_t FakeGDI::DIBCreatePatternBrush(uint32_t index, const uint8_t *DIBdata, long datalength)
{
        std::unique_ptr<GO_Brush> obj (new GO_Brush());
        obj->ObjectType = isBrush;
        obj->style = BS_PATTERN;
        obj->color = DrawLib::Pixel32(0,0,0,255);

        Blex::MemoryReadStream DIBstream(DIBdata, datalength);

        DrawLib::Bitmap32 *patternbitmap = DrawLib::CreateBitmap32FromBMP(&DIBstream, false, false);
        if (patternbitmap==NULL)
        {
                throw(std::runtime_error("DIBCreatePatternBrush loaded a NULL bitmap"));
        }
        obj->patternbrushbitmap.reset(patternbitmap);
        obj->style  = BS_PATTERN;

        // load it into the current device context
        devicecontext->brushptr = obj.get();
        ObjectList->AddObject(obj, index);
        return 0;
}

int32_t FakeGDI::DeleteObject(uint32_t dwObjectNo)
{
        #ifdef DEBUG
        DEBUGPRINT("  Object number " <<dwObjectNo);
        #endif
        if (ObjectList->DeleteObject(dwObjectNo) !=0)
        {
                #ifdef DEBUG
                DEBUGPRINT("  ERROR - failed to delete object [obj not found]");
                #endif
        }
        return 0;
}

int32_t FakeGDI::ExcludeClipRect(int32_t left, int32_t top, int32_t right,
                int32_t bottom)
{
        DrawLib::FPPoint p1, p2;
        p1.x = left;
        p1.y = top;
        p2.x = right;
        p2.y = bottom;
        p1 = LPtoDP(p1);
        p2 = LPtoDP(p2);

        //excluding: A with B excluded  = A and (not B) => protect the given rectangle :)
        //'+1' because the last line is excluded too (see Win32 dox)
        devicecontext->region->SetProtectedArea( DrawLib::IRect(
                static_cast<int32_t>(p1.x),
                static_cast<int32_t>(p1.y),
                static_cast<int32_t>(p2.x+1),
                static_cast<int32_t>(p2.y+1)), true);

        // copy t deviceconthe permission bitmap to drawlib component
        RegionToPermission();

        DEBUGPRINT("  Cliprect = " << p1 << " - " << p2);
        return 0;
}

int32_t FakeGDI::ExtTextOutW(int32_t x, int32_t y, uint32_t flags, fRECT *lpRect, const uint16_t *string, uint32_t count, const uint16_t *lpDx)
{
        //the text should fit in the boundig box ?
        if (lpRect)
            DEBUGPRINT("  Cliprect = " << *lpRect);

        std::vector<double> deltas;      // inter character spacing delta's (in pixels)
        if (lpDx !=NULL)
        {
                //dump the lpDx data..
                DEBUGPRINT("  lpDx data follows.. ");

                for(unsigned index=0; index<(count-1); index++)
                {
                        DrawLib::FPSize delta(static_cast<double>(lpDx[index]), 0.0);
                        DEBUGPRINT("  lpDx[" << index << "] = " << lpDx[index] << " width=" << LPtoDP(delta).width);
                        deltas.push_back(LPtoDP(delta).width);
                }
        }

        DrawLib::FPPoint p1(x,y);
        if (devicecontext->update)
                p1 = LPtoDP(currentpoint);
        else
                p1 = LPtoDP(p1);

        // build a font ..
        // for safety!!
        if (devicecontext->fontptr==NULL)
        {
                DEBUGPRINT("ExtTextOutW: warning - devicecontext->font == NULL (skipping command)");
                return -1;
        }

        //Get the font mananger

        DrawLib::Font *font = devicecontext->fontptr->GetFont();
        if (!font)
        {
                DEBUGPRINT("Cannot open requested font or the fallback font");
                return -1;
        }

        //FIXME: This print crashes.
        //DEBUGPRINT("Opening: " << devicecontext->fontptr->familyname << " & " << devicecontext->fontptr->stylename);


        // set the correct encoding.

        switch(devicecontext->fontptr->encoding)
        {
        case ANSI_CHARSET:
                DEBUGPRINT("ANSI charset (using UNICODE) [ FIXME ]");
                font->SelectCharacterMap(DrawLib::Font::UNICODEMAP);
                break;
        case DEFAULT_CHARSET:
                DEBUGPRINT("Unicode charset");
                font->SelectCharacterMap(DrawLib::Font::UNICODEMAP);
                break;
        case SYMBOL_CHARSET:
                DEBUGPRINT("Symbol charset");
                font->SelectCharacterMap(DrawLib::Font::SYMBOLMAP);
                break;
        default:
                DEBUGPRINT("Unknown charset (defaulting to UNICODE)");
                font->SelectCharacterMap(DrawLib::Font::UNICODEMAP);
        }

        //FIXME: Windows help (LOGFONT) definieert ook het geval pointsizeY==0 -  wat gebeurt daarmee?
        //FIXME: De onderstaande implementatie van pointsizeY lijkt niet op wat er in de Windows API docs bedoeld wordt??
        DrawLib::FPSize size(devicecontext->fontptr->pointsizeX == 0 ? devicecontext->fontptr->pointsizeY : devicecontext->fontptr->pointsizeX
                            ,devicecontext->fontptr->pointsizeY);

        //Scale width with _Y_ factor if Window only gave us the Y direction to begin with.. Win32 transforms don't seem to transform both!
        size.width = std::fabs(size.width*logical_to_local.eM11);
        size.height = std::fabs(size.height*logical_to_local.eM22);

        font->SetSize(size);
        font->SetColor(devicecontext->textcolor);

        if (flags & ETO_OPAQUE) // check if text rectangle should be filled with the background color..
        {
                // if we end up here.. we should fill the background
                // of the text with the background color.
        }

        Blex::UnicodeString ustring;
        for(unsigned int i=0; i<count; i++)
        {
                /* ADDME: In which charsets is this re-coding valid? */

                uint16_t ch = string[i];
                //Unicode control codes are used by MS to extend ISO-8859-1, so re-map them
                if (ch>=128 && ch<160 && devicecontext->fontptr->encoding != SYMBOL_CHARSET)
                    ch = Blex::GetCharsetConversiontable(Blex::Charsets::CP1252)[ch];
                ustring.push_back(ch);
        }

        using DrawLib::TextRenderer;
        TextRenderer::VerticalAlignment va_code = TextRenderer::ASCENDER;
        switch(devicecontext->valign)
        {
        case GDI_DCItem::BASELINE:
                va_code = TextRenderer::BASELINE;
                break;
        case GDI_DCItem::TOP:
                va_code = TextRenderer::ASCENDER;
                break;
        case GDI_DCItem::BOTTOM:
                va_code = TextRenderer::DESCENDER;
                break;
        }

        TextRenderer::HorizontalAlignment ha_code = TextRenderer::LEFT;
        switch(devicecontext->halign)
        {
        case GDI_DCItem::LEFT:
                ha_code = TextRenderer::LEFT;
                break;
        case GDI_DCItem::CENTER:
                ha_code = TextRenderer::CENTER;
                break;
        case GDI_DCItem::RIGHT:
                ha_code = TextRenderer::RIGHT;
                break;
        }

        bool anti_aliassing = false;
        if (size.width >= 18 || size.height >= 18)
            anti_aliassing = true;
        if (devicecontext->fontptr->is_bold)
            anti_aliassing = true;

        double rotation = devicecontext->fontptr->orientation/10.0;

        //Figure out whether the angle is too far from 0,90,180,270
        if (std::fabs( (rotation / 90) - std::floor(rotation / 90) ) >= 2.0/90.0 ) //more than 2 degrees of rotation
            anti_aliassing=true; //better rendering quality after rotation

        //If the text fall only just outside the clipping rect we render it a bit smaller
        double textwidth = (double)(drobj->GetTextWidth(ustring, *font, deltas, anti_aliassing, 0.0));

        if (lpRect)
        {
                double clipwidth = (double)(lpRect->right - lpRect->left) * logical_to_local.eM11;
                if (textwidth > (clipwidth + 1) && (textwidth / clipwidth) <= 1.05)
                {
                    size.width *= 0.95;
                    size.height *= 0.95;
                    font->SetSize(size);
                }
        }

#ifdef DEBUG
        std::string printversion;
        Blex::UTF8Encode(ustring.begin(), std::min(ustring.begin()+60,ustring.end()), std::back_inserter(printversion));
        DEBUGPRINT("  ExtTextOutW at " << p1 << " original logical point should be " << (p1*logical_to_local.Invert()));
        DEBUGPRINT("  ExtTextOutW text: [" << printversion << "]");
#endif

        DrawLib::Canvas32::AlphaOperationMode oldmode = mycanvas->GetAlphaMode();
        mycanvas->SetAlphaMode(DrawLib::Canvas32::BLEND255);
        drobj->DrawTextExtended(p1, ustring, *font, deltas, anti_aliassing, ha_code ,va_code,rotation, rotation, 0.0);
        mycanvas->SetAlphaMode(oldmode);


        if (devicecontext->update)
        {
                //update the current point!
                uint32_t width_pixels = drobj->GetTextWidth(ustring, *font, deltas, false, 0.0);
                DEBUGPRINT("  text width in pixels " << width_pixels);
                p1.x += width_pixels;
                currentpoint = p1*logical_to_local.Invert();
                DEBUGPRINT("  current point is now " << currentpoint);
        }
        return 0;
}

int32_t FakeGDI::ExtTextOutA(int32_t x, int32_t y, uint32_t flags, fRECT *lpRect, const uint8_t *string,
                uint32_t count, const uint16_t *lpDx)
{
        // convert uint8_t string to uint16_t string..
        std::vector<uint16_t>        u16string;
        u16string.resize(count);
        // FIXME: codepage translation??
        for(unsigned int i=0; i<count; i++)
        {
                u16string[i] = static_cast<uint16_t>(string[i]);
        }
        return ExtTextOutW(x,y,flags,lpRect, &(u16string[0]), count, lpDx);
}

/*

  ft_encoding_none    = 0,
    ft_encoding_symbol  = FT_MAKE_TAG( 's', 'y', 'm', 'b' ),
    ft_encoding_unicode = FT_MAKE_TAG( 'u', 'n', 'i', 'c' ),
    ft_encoding_latin_2 = FT_MAKE_TAG( 'l', 'a', 't', '2' ),
    ft_encoding_sjis    = FT_MAKE_TAG( 's', 'j', 'i', 's' ),
    ft_encoding_gb2312  = FT_MAKE_TAG( 'g', 'b', ' ', ' ' ),
    ft_encoding_big5    = FT_MAKE_TAG( 'b', 'i', 'g', '5' ),
    ft_encoding_wansung = FT_MAKE_TAG( 'w', 'a', 'n', 's' ),
    ft_encoding_johab   = FT_MAKE_TAG( 'j', 'o', 'h', 'a' ),

    ft_encoding_adobe_standard = FT_MAKE_TAG( 'A', 'D', 'O', 'B' ),
    ft_encoding_adobe_expert   = FT_MAKE_TAG( 'A', 'D', 'B', 'E' ),
    ft_encoding_adobe_custom   = FT_MAKE_TAG( 'A', 'D', 'B', 'C' ),

    ft_encoding_apple_roman    = FT_MAKE_TAG( 'a', 'r', 'm', 'n' )

*/

fHGDIOBJ *FakeGDI::SelectObject(uint32_t dwObjectNo)
{
        GDIObject  * obj;

        DEBUGPRINT("  Object number = " << dwObjectNo);

        // Check if this is a stockobject!
        if (dwObjectNo>=0x80000000L)
        {
                // this is a stockobject!s
                uint32_t index = dwObjectNo - 0x80000000L;

                //FIXME: add more stock objects !!!!!
                //and change the limits!
                if (index>8)
                        return NULL;

                obj = (StockObjects[index]);
        }
        else
        {
                // when it isn't a stockobject, get it from the object stack.
                obj = ObjectList->GetFakeGDIObject(dwObjectNo);
        }

        // search object list for object number

        DEBUGONLY(if (obj==NULL) DEBUGPRINT("  ERROR - object not found!"));

        // bail on error!
        if (obj==NULL)
            return NULL;

        // TODO: check the object type and assign to current object variables
        switch(obj->ObjectType)
        {
        case isBrush:
                        devicecontext->brushptr  = (GO_Brush*)obj;
                        DEBUGPRINT("  Brush selected - color = " << ((GO_Brush*)obj)->color << " style " << ((GO_Brush*)obj)->style);
                        switch(((GO_Brush*)obj)->style)
                        {
                        case BS_SOLID:
                                DEBUGPRINT("  BS_SOLID");
                                break;
                        case BS_NULL:
                                DEBUGPRINT("  BS_NULL");
                                break;
                        case BS_PATTERN:
                                DEBUGPRINT("  BS_PATTERN");
                                break;
                        case BS_HATCHED:
                                DEBUGPRINT("  BS_HATCHED");
                                break;
                        default:
                                DEBUGPRINT("****************************");
                                DEBUGPRINT("  Unsupported Brush Style!  ");
                                DEBUGPRINT("****************************");
                        }
                        break;
        case isPen:
                        devicecontext->penptr = ((GO_Pen*)obj);
                        DEBUGPRINT("  Pen selected - color = " << ((GO_Pen*)obj)->color << " style " << ((GO_Pen*)obj)->style);
                        DEBUGPRINT("  width " <<((GO_Pen*)obj)->width);
                        switch(((GO_Pen*)obj)->style)
                        {
                        case PS_SOLID:
                                DEBUGPRINT("  PS_SOLID");
                                break;
                        case PS_NULL:
                                DEBUGPRINT("  PS_NULL");
                                break;
                        default:
                                DEBUGPRINT("**************************");
                                DEBUGPRINT("  Unsupported Pen Style!  ");
                                DEBUGPRINT("**************************");
                        }
                        break;
        case isPalette:
                        DEBUGPRINT("  Palette selected");
                        break;
        case isFont:
                        devicecontext->fontptr = ((GO_Font*)obj);
                        DEBUGPRINT("  Font selected");

//                        drawsurface->OpenFont(devicecontext->font->filename.c_str());
//                        drawsurface->SetFontSize(devicecontext->font->pointsizeX, devicecontext->font->pointsizeY);
//                        drawsurface->SetFontAngle((double)(devicecontext->font->orientation)*pi2/3600.0);
                        break;
        case isRegion:
                        {
                        //uint32_t *bitmap = drawsurface->GetPermissionBitmap().GetPermissionBitmap();
                        //devicecontext->region = std::shared_ptr<RegionBitmap> ( static_cast<RegionBitmap*>(obj) );
                        //devicecontext->region->CopyRegionBitmap(bitmap, drawsurface->GetPermissionBitmap().GetBitmapWidth());
                        DEBUGPRINT("  Region selected");
                        }
                        break;
        default: ;
                DEBUGPRINT("  ERROR - object type not specified!");
        }
        return NULL;
}

// ****************************************************************
// Ellipse
// ****************************************************************

int32_t FakeGDI::Ellipse(int32_t left, int32_t top, int32_t right, int32_t bottom)
{
        DrawLib::FPPoint p1(left, top);
        DrawLib::FPPoint p2(right, bottom);

        DEBUGPRINT("ELLIPSE: Left " << left << " top " << top << " right " << right << " bottom " << bottom);
        // transform bouding box to local space

        p1 = LPtoDP(p1);
        p2 = LPtoDP(p2);
        // compute center & axis lengths
        DrawLib::FPSize axis((p2.x - p1.x) / 2.0, (p2.y - p1.y) / 2.0);
        DrawLib::FPPoint center(p1 + axis);

        // setup DrawLib ...
        SetupDrawLibAccordingToDeviceContext();

        if (devicecontext->brushptr->style != BS_NULL)
        {
                drobj->DrawEllipse(center, axis);
        }
        if (devicecontext->penptr->style != PS_NULL)
        {
                drobj->DrawEllipseOutline(center,axis);
        }
        return 0;
}

int32_t FakeGDI::IntersectClipRect(int32_t fleft, int32_t ftop, int32_t fright, int32_t fbottom)
{
        DEBUGPRINT("  Intersect cliprect: logical " << fleft << "," << ftop << "-" << fright << "," << fbottom);

        //everything that is INSIDE the clipping region can be painted to.
        DrawLib::FPPoint p1 = LPtoDP(DrawLib::FPPoint(fleft,ftop));
        DrawLib::FPPoint p2 = LPtoDP(DrawLib::FPPoint(fright,fbottom));

        /*Rounding errors mess up the drawings, try to round the clipping region outwards..
        int clipped_left = static_cast<int>(std::min(p1.x,p2.x));
        int clipped_right= static_cast<int>(std::max(p1.x,p2.x)+1);
        int clipped_top = static_cast<int>(std::min(p1.y,p2.y));
        int clipped_bottom = static_cast<int>(std::max(p1.y,p2.y)+1);
        */
        int clipped_left = DrawLib::RoundFloat(std::min(p1.x,p2.x));
        int clipped_right= DrawLib::RoundFloat(std::max(p1.x,p2.x));
        int clipped_top = DrawLib::RoundFloat(std::min(p1.y,p2.y));
        int clipped_bottom = DrawLib::RoundFloat(std::max(p1.y,p2.y));

        //Build an unflipped rectangle
        DrawLib::IRect toclip(clipped_left,clipped_top,clipped_right,clipped_bottom);

        DEBUGPRINT("  Translates to local " << toclip);
        devicecontext->region->IntersectPermissionArea(toclip);
        RegionToPermission();
        return 0;
}


int32_t FakeGDI::LineTo(int32_t x, int32_t y)
{
        DrawLib::FPPoint p1(x,y);
        DEBUGPRINT("  Line to logical " << p1);
        currentpath.LineTo(p1);
        currentpoint = p1;
        FinishPathOperation();
        return 0;
}

int32_t FakeGDI::MoveTo(int32_t x, int32_t y)
{
        DrawLib::FPPoint p1(x,y);
        DEBUGPRINT("  Move to logical " << p1);
        currentpath.MoveTo(p1);
        currentpoint=p1;
        return 0;
}

DrawLib::FPPoint FakeGDI::GetCurrentPoint()
{
        return currentpoint;
}

int32_t FakeGDI::PatBlt(int32_t left, int32_t top, int32_t width, int32_t height, uint32_t rop)
{
        DrawLib::FPPoint p1, p2;

        fRECT r;
        r.left = left;
        r.top = top;
        r.right = left+width;
        r.bottom = top+height;

        DEBUGPRINT("  destination rect " << r << " rop code " << rop);
        switch(rop)
        {
                case PATCOPY:   DEBUGPRINT("  PATTERN COPY");   break;
                case PATINVERT: DEBUGPRINT("  PATTERN INVERT"); break;
                case DSTINVERT: DEBUGPRINT("  INVERT DESTINATION RECTANGLE"); break;
                case BLACKNESS: DEBUGPRINT("  FILL USING PALETTE[0]"); break;
                case WHITENESS: DEBUGPRINT("  FILL USING PALETTE[1]"); break;
                default:        DEBUGPRINT("  Nonstandard ROP code"); break;
        }


        p1.x = left;
        p1.y = top;
        p2.x = left+width;
        p2.y = top+height;

        p1 = LPtoDP(p1);
        p2 = LPtoDP(p2);

        //pPatternBlit(p1.x, p1.y, p2.x, p2.y);
        Rectangle(r);
        return 0;
}


int32_t FakeGDI::RoundRectangle(int32_t left, int32_t top, int32_t right, int32_t bottom, int32_t width, int32_t height)
{
        double eHeight=height/2;
        double eWidth =width/2;
        //(width!=0) ? (width/2) : (height/2);

        double rLeft   = (left<right) ? left  : right;
        double rRight  = (left<right) ? right : left;
        double rTop    = (top<bottom) ? top   : bottom;
        double rBottom = (top<bottom) ? bottom: top;

        if ( (eWidth *2)  > (rRight-rLeft))        eWidth   = (rRight -rLeft)/2;
        if ( (eHeight*2)  > (rBottom-rTop))        eHeight =  (rBottom-rTop )/2;

        int linesPerCorner=33;

        std::vector<DrawLib::FPPoint> roundRectanglePoints;
        roundRectanglePoints.resize(1+linesPerCorner*4);   //33 points per corner
        DEBUGPRINT("  ewidth, eheight " << eWidth << " , " << eHeight);

        double factor = (0.5*M_PI) / (double)linesPerCorner;  //(2Pi / totalLines => 1/2 Pi * per corner)
        for (int i=0;i<linesPerCorner;i++)
        {
                //upperleft corner
                roundRectanglePoints[i].x =    (int32_t) ((rLeft+eWidth )  - eWidth * cos( (double)i * factor));
                roundRectanglePoints[i].y =    (int32_t) ((rTop +eHeight)  - eHeight* sin( (double)i * factor));

                //upperright corner
                roundRectanglePoints[i+linesPerCorner].x = (int32_t) ((rRight - eWidth)   - eWidth * cos(factor*(i+linesPerCorner)) );
                roundRectanglePoints[i+linesPerCorner].y = (int32_t) ((rTop   + eHeight)  - eHeight  * sin(factor*(i+linesPerCorner)) );

                //lowerright corner
                roundRectanglePoints[i+2*linesPerCorner].x = (int32_t) ((rRight-eWidth)      - eWidth * cos(factor*(i+linesPerCorner*2)) );
                roundRectanglePoints[i+2*linesPerCorner].y = (int32_t) ((rBottom - eHeight)  - eHeight* sin(factor*(i+linesPerCorner*2)) );

                //lowerleft corner
                roundRectanglePoints[i+3*linesPerCorner].x = (int32_t) ((rLeft+eWidth)       - eWidth   * cos(factor*(i+linesPerCorner*3)) );
                roundRectanglePoints[i+3*linesPerCorner].y = (int32_t) ((rBottom - eHeight)  - eHeight  * sin(factor*(i+linesPerCorner*3)) );
        }

        // close the polygon
        roundRectanglePoints[linesPerCorner*4]=roundRectanglePoints[0];

        // draw the polygon
        Polygon(roundRectanglePoints);

        return 0;
}

void FakeGDI::InnerPolyBezier(const std::vector<DrawLib::FPPoint> &pointlist, bool first_point_is_moveto)
{
        unsigned pointoffset = first_point_is_moveto ? 1 : 0;
        if (pointlist.size() < 3+pointoffset)
        {
                DEBUGPRINT("  Too few points for bezier");
                return;
        }

        if (first_point_is_moveto)
            currentpath.MoveTo(pointlist[0]);

        unsigned numbeziers = (pointlist.size()-pointoffset) / 3;
        for (unsigned bezier=0;bezier<numbeziers;++bezier)
            currentpath.BezierTo(pointlist[bezier*3+pointoffset+0],
                                 pointlist[bezier*3+pointoffset+1],
                                 pointlist[bezier*3+pointoffset+2]);

        currentpoint=pointlist.back();
        FinishPathOperation();
}

void FakeGDI::PolyBezier(const std::vector<DrawLib::FPPoint> &Plist)
{
        InnerPolyBezier(Plist, true);
}

void FakeGDI::PolyBezierTo(const std::vector<DrawLib::FPPoint> &Plist)
{
        InnerPolyBezier(Plist, false);
}

int32_t FakeGDI::Rectangle(const fRECT &rect)
{
        DEBUGPRINT("Rectangle logical " << rect << " local " << (DrawLib::FPPoint(rect.left,rect.top) * logical_to_local) << " to " << (DrawLib::FPPoint(rect.right,rect.bottom) * logical_to_local));

        currentpath.MoveTo(DrawLib::FPPoint(rect.left, rect.top));

        currentpath.LineTo(DrawLib::FPPoint(rect.right, rect.top));
        currentpath.LineTo(DrawLib::FPPoint(rect.right, rect.bottom));
        currentpath.LineTo(DrawLib::FPPoint(rect.left, rect.bottom));
        currentpath.ClosePath();

        //Move pen back to old position
        currentpath.MoveTo(currentpoint);

        FinishPathOperation();

        return 0;
}

int32_t FakeGDI::Pie(int32_t left, int32_t top, int32_t right, int32_t bottom,
                int32_t startx, int32_t starty, int32_t endx, int32_t endy)
{
        DrawLib::FPSize  radius((right-left)/2,(bottom-top)/2);
        DrawLib::FPPoint center(left + radius.width, top + radius.height);

        center = LPtoDP(center);
        radius = LPtoDP(radius);

        DrawLib::FPPoint startpoint(startx, starty);
        DrawLib::FPPoint endpoint(endx, endy);

        startpoint = LPtoDP(startpoint);
        endpoint   = LPtoDP(endpoint);

        SetupDrawLibAccordingToDeviceContext();

        if (devicecontext->brushptr->style!=BS_NULL)
        {
                drobj->DrawPie(center, radius, startpoint, endpoint);
        }
        if (devicecontext->penptr->style!=PS_NULL)
        {
                drobj->DrawPieOutline(center, radius, startpoint, endpoint);
        }
        return 0;
}

DrawLib::Path FakeGDI::PolyLineToPath(const std::vector<DrawLib::FPPoint> &Plist)
{
        if (Plist.size() <= 1)
                return DrawLib::Path();

        DrawLib::Path path;

        path.MoveTo(LPtoDP(Plist[0]));

        for(uint32_t i=1; i<Plist.size(); i++)
        {
                path.LineTo(LPtoDP(Plist[i]));
                DEBUGPRINT("Point : " << Plist[i]);
        }

        return path;
}

int32_t FakeGDI::PolyLine(const std::vector<DrawLib::FPPoint> &Plist)
{
        if (Plist.size() <= 1)
                return -1;

        drobj->SetOutlineWidth(CalcLineWidth(devicecontext->penptr->width));

        DrawLib::Path path = PolyLineToPath(Plist);

        // setup DrawLib ...
        SetupDrawLibAccordingToDeviceContext();

        // translate points to local space.. & build pointlist..
        if (devicecontext->penptr->style!=PS_NULL)
        {
                drobj->StrokePath(path);
        }
        return 0;
}

int32_t FakeGDI::Polygon(const std::vector<DrawLib::FPPoint> &Plist)
{
        if (Plist.size() <= 1)
                return -1;

        DrawLib::Path path = PolyLineToPath(Plist);
        path.ClosePath();

        // setup DrawLib ...
        drobj->SetOutlineWidth(CalcLineWidth(devicecontext->penptr->width));
        SetupDrawLibAccordingToDeviceContext();


        // draw filled polygon
        if (devicecontext->brushptr->style != BS_NULL)
        {
                drobj->FillPath(path);
        }
        else
        {
                DEBUGPRINT("Skipping filling..");
        }

        // draw polygon outline
        if (devicecontext->penptr->style != PS_NULL)
        {
                drobj->StrokePath(path);
        }
        return 0;
}

int32_t FakeGDI::PolyPolygon(uint32_t Npolys, const std::vector<uint32_t> &Nlist, const std::vector<DrawLib::FPPoint> &Plist)
{
        // setup DrawLib ...
        drobj->SetOutlineWidth(CalcLineWidth(devicecontext->penptr->width));
        SetupDrawLibAccordingToDeviceContext();

        DrawLib::Path path;

        unsigned index = 0;
        for(unsigned i=0; i<Npolys; i++)
        {
                for(unsigned j=0; j<Nlist[i]; j++)
                {
                        DrawLib::FPPoint point = LPtoDP(Plist[index++]);
                        if (j==0)
                            path.MoveTo(point);
                        else
                            path.LineTo(point);
                }
                path.ClosePath();
        }

        if (devicecontext->brushptr->style != BS_NULL)
            drobj->FillPath(path);

        if (devicecontext->penptr->style != PS_NULL)
            drobj->StrokePath(path);

        return 0;
}

int32_t FakeGDI::SaveDC()
{
        // make new device context object
        GDI_DCItem* newdc = new GDI_DCItem(*devicecontext);
        // push it on the stack.
        dcstack->Push(newdc);
        return 0;
}

int32_t FakeGDI::RestoreDC(int32_t items)
{
//        GDI_DCItem *newdc;
        DEBUGPRINT("  item " <<items);

        /* Items will be negative to signify popping a relative amount of
           items.. A positive amount must pop until item number 'items' is
           reached. */
        if (items<0)
            devicecontext.reset(dcstack->Pop(-items));
        else
            devicecontext.reset(dcstack->TruncateTo(items));

        UpdateTransforms();
        return 0;
}

int32_t FakeGDI::SetROP(uint32_t ropmode)
{
        // Raster operation codes unimplemented.

        DEBUGPRINT("  ROP = " << (ropmode & 0xFF));
        dwROP2code = ropmode & 0xFF;
        switch(ropmode)
        {
        case R2_XORPEN:
                DEBUGPRINT("  XORPEN");
                mycanvas->SetBinaryMode(DrawLib::Canvas32::XOR);
                break;
        case R2_NOP:
                DEBUGPRINT("  NULL");
                mycanvas->SetBinaryMode(DrawLib::Canvas32::NOP);
                break;
        case R2_COPYPEN:
                DEBUGPRINT("  COPYPEN");
                mycanvas->SetBinaryMode(DrawLib::Canvas32::DEFAULT);
                break;
        case R2_MASKPEN:
                DEBUGPRINT("  MASKPEN");
                mycanvas->SetBinaryMode(DrawLib::Canvas32::AND);
                break;
        default:
                DEBUGPRINT("  UNIMPLEMENTED ROP CODE!");
                mycanvas->SetBinaryMode(DrawLib::Canvas32::DEFAULT);
                break;
        }
        return 0;
}

int32_t FakeGDI::SetPolyFillMode(uint32_t fillmode)
{
        // alternate == 1
        // winding == 2
        dwPolyFillMode = fillmode;
        switch(fillmode)
        {
        case 1: //alternate
                DEBUGPRINT("Alternate");
                drobj->SetPolyEdgeMode(true);
                break;
        case 2: // winding
                DEBUGPRINT("Winding");
                drobj->SetPolyEdgeMode(false);
                break;
        default:
                DEBUGPRINT("HUH?? -- weird mode!");
                ;
        }
        return 0;
}

int32_t FakeGDI::SetTextAlign(uint32_t alignflag)
{
        //devicecontext->alignflag = alignflag;
        int lr = TA_LEFT | TA_RIGHT | TA_CENTER;
        int tb = TA_BOTTOM | TA_TOP | TA_BASELINE;
        int upd = TA_NOUPDATECP | TA_UPDATECP;

        GDI_DCItem::Valign va = GDI_DCItem::BOTTOM;

        #ifdef DEBUG

        // test left/right/center
        if ((lr & alignflag) == TA_LEFT) DEBUGPRINT("  align == LEFT");
        if ((lr & alignflag) == TA_RIGHT) DEBUGPRINT("  align == RIGHT");
        if ((lr & alignflag) == TA_CENTER) DEBUGPRINT("  align == CENTER");

        // test top/bottom
        if ((tb & alignflag) == TA_BOTTOM) DEBUGPRINT("  align == BOTTOM (drawlib: DESCENDER)");
        if ((tb & alignflag) == TA_TOP) DEBUGPRINT("  align == TOP (drawlib: ASCENDER)");
        if ((tb & alignflag) == TA_BASELINE) DEBUGPRINT("  align == BASELINE");

        // test update
        if ((upd & alignflag) == TA_NOUPDATECP) DEBUGPRINT("  align == NO UPDATE");
        if ((upd & alignflag) == TA_UPDATECP) DEBUGPRINT("  align == UPDATE");

        #endif

        if ((tb & alignflag) == TA_TOP) va = GDI_DCItem::TOP;
        else if ((tb & alignflag) == TA_BASELINE) va = GDI_DCItem::BASELINE;

        GDI_DCItem::Halign ha = GDI_DCItem::LEFT;

        if ((lr & alignflag) == TA_LEFT) ha = GDI_DCItem::LEFT;
        else if ((lr & alignflag) == TA_RIGHT) ha = GDI_DCItem::RIGHT;
        else if ((lr & alignflag) == TA_CENTER) ha = GDI_DCItem::CENTER;

        if ((upd & alignflag) == TA_UPDATECP)
                devicecontext->update = true;
        else
                devicecontext->update = false;

        devicecontext->valign = va;
        devicecontext->halign = ha;

        return 0;
}

int32_t FakeGDI::SetTextColor(const DrawLib::Pixel32 &color)
{
        DEBUGPRINT("  color = " <<color);
        devicecontext->textcolor = color;
        return 0;
}

int32_t FakeGDI::SetBKColor(const DrawLib::Pixel32 &color)
{
        DEBUGPRINT("  bkcolor = " <<color);
        devicecontext->bkcolor = color;
        return 0;
}

int32_t FakeGDI::SetBKMode(uint32_t bkmode)
{
        #ifdef DEBUG
        switch(bkmode)
        {
        case TRANSPARENT:       DEBUGPRINT("  BKmode = transparent");
                                break;
        case OPAQUE:            DEBUGPRINT("  BKmode = opaque");
                                break;
        default:                DEBUGPRINT("  BKmode unknown!  [mode = " << bkmode << "]");
        }
        #endif
        // update device context
        devicecontext->bkmode = bkmode;

        // handle hatchbrushes here..
        // make background color transparent if necessary..

        GO_Brush *brush   = devicecontext->brushptr;

        if (brush->style == BS_HATCHED)
        {
                // renew the brush!
                DrawLib::Pixel32 bkcolor(0,0,0,0);
                if (devicecontext->bkmode == OPAQUE)
                        bkcolor = devicecontext->bkcolor;

                SetupHatchBrush(brush, brush->hatch, brush->color, bkcolor);
        }
        return 0;
}

int32_t FakeGDI::SetStretchBltMode(uint32_t bltmode)
{
        devicecontext->stretch_mode=(GDI_DCItem::StretchBltMode)bltmode;
        DEBUGPRINT("  New stretch mode = " << devicecontext->stretch_mode);
        return 0;
}

int32_t FakeGDI::SetMapMode(MappingModes new_mapping_mode)
{
        switch(new_mapping_mode)
        {
        case MM_Text:
                devicecontext->window_origin = devicecontext->viewport_origin = DrawLib::FPPoint(0,0);
                devicecontext->window_extents = devicecontext->viewport_extents = DrawLib::FPSize(1,1);
                DEBUGPRINT("  Text [1U = 1 pixel]");
                break;
        case MM_Lometric:
                DEBUGPRINT("  Low metric [1U = 0.1 mm]");
                break;
        case MM_Himetric:
                DEBUGPRINT("  High metric [1U = 0.01 mm]");
                break;
        case MM_Loenglish:
                DEBUGPRINT("  Low English [1U = 0.01 inch]");
                break;
        case MM_Hienglish:
                DEBUGPRINT("  High English [1U = 0.001 inch]");
                break;
        case MM_Twips:
                DEBUGPRINT("  Twips [1U = 1/1440 inch]");
                break;
        case MM_Isotropic:
                DEBUGPRINT("  Isotropic");
                break;
        case MM_Anisotropic:
                DEBUGPRINT("  Anisotropic");
                break;
        }
        devicecontext->mapmode = new_mapping_mode;
        UpdateTransforms();
        return 0;
}

int32_t FakeGDI::ScaleViewportExtent(int32_t xNum, int32_t xDenom, int32_t yNum, int32_t yDenom)
{
        DEBUGPRINT("Before: viewport = " << devicecontext->viewport_extents);

        /* WINE CODE:

            if ((dc->MapMode != MM_ISOTROPIC) && (dc->MapMode != MM_ANISOTROPIC))
                goto done;
            if (!xNum || !xDenom || !xNum || !yDenom)
            {
                ret = FALSE;
                goto done;
            }
            dc->vportExtX = (dc->vportExtX * xNum) / xDenom;
            dc->vportExtY = (dc->vportExtY * yNum) / yDenom;
            if (dc->vportExtX == 0) dc->vportExtX = 1;
            if (dc->vportExtY == 0) dc->vportExtY = 1;
            if (dc->MapMode == MM_ISOTROPIC) MAPPING_FixIsotropic( dc );
            DC_UpdateXforms( dc );
        */

        // this function doesn't work with anything other than
        // isotropic and anisotropic mapping modes!

        if ((devicecontext->mapmode!=MM_Isotropic) && (devicecontext->mapmode!= MM_Anisotropic))
        {
                DEBUGPRINT("Ignoring: device mapping mode is not MM_Isotropic or MM_Anisotropic");
                return 0;
        }
        if (xDenom==0 || yDenom==0)
            throw std::runtime_error("ScaleViewportExtent division by zero");

        devicecontext->viewport_extents.width *= xNum*1.0/xDenom;
        devicecontext->viewport_extents.height *= yNum*1.0/yDenom;

        if (devicecontext->mapmode==MM_Isotropic)
        {
                // FIXME: enforce ISOTROPIC rules here!
        }
        UpdateTransforms();

        DEBUGPRINT("After : viewport = " << devicecontext->viewport_extents);
        return 0;
}

int32_t FakeGDI::SetWindowOrg(int32_t x, int32_t y)
{
        DEBUGPRINT("SetWindowOrg: current origin: " << devicecontext->window_origin << ", new origin: " << DrawLib::FPPoint(x,y));
        devicecontext->window_origin = DrawLib::FPPoint(x,y);
        UpdateTransforms();
        return 0;
}

int32_t FakeGDI::SetWindowExt(int32_t x, int32_t y)
{
        DEBUGPRINT("  WExtent = " << x << "," << y);

        // according to WINE we must bail on faulty arguments!
        if (x==0 || y == 0)
        {
                DEBUGPRINT("Ignoring setwindowext call with invalid arguments " << x << "," << y);
                return 0;
        }

        DEBUGPRINT("SetWindowExt: current extents: " << devicecontext->window_origin << ", new extents: " << DrawLib::FPPoint(x,y));
        devicecontext->window_extents = DrawLib::FPSize(x,y);
        UpdateTransforms();
        return 0;
}

int32_t FakeGDI::SetViewportOrg(int32_t x, int32_t y)
{
        devicecontext->viewport_origin.x=x;
        devicecontext->viewport_origin.y=y;
        UpdateTransforms();

        DEBUGPRINT("  VOrigin = " << devicecontext->viewport_origin);
        return 0;
}

int32_t FakeGDI::SetViewportExt(int32_t x, int32_t y)
{
        DEBUGPRINT("  VExtent = " << x << "," << y);


        // according to WINE, we bail on faulty arguments...
        if (x==0)
            return 0;
        if (y==0)
            return 0;

        devicecontext->viewport_extents = DrawLib::FPSize(x,y);
        UpdateTransforms();

        return 0;
}


// *****************************************************************************
// Private methods
// *****************************************************************************
DrawLib::FPSize FakeGDI::LPtoDP(const DrawLib::FPSize &p)
{
        return p * logical_to_local;
}


DrawLib::FPPoint FakeGDI::LPtoDP(const DrawLib::FPPoint &p)
{
        return p * logical_to_local;
}

double FakeGDI::CalculateRadial (int32_t cx, int32_t cy, int32_t xs, int32_t ys, DrawLib::FPPoint r)
{
        if (cx==r.x)
        {
                if (r.y>cy)
                        return (1.5 * M_PI);  //270 degrees
                else
                        return (0.5 * M_PI);
        }
        else
        {
                if (r.x>cx)
                        return M_PI+atan2( double((r.y-cy))/double(ys) , double((r.x-cx))/double(xs) );
                else
                        return M_PI+(M_PI-atan2( double((r.y-cy))/double(ys) , double((r.x-cx))/double(xs) ));
        }
}


int32_t FakeGDI::CalcLineWidth(int32_t LogicalWidth)
{
        if ((LogicalWidth==0) || (LogicalWidth==1))
            return 1;

        DrawLib::FPSize newlinewidth = LPtoDP(
                DrawLib::FPSize(static_cast<double>(LogicalWidth), static_cast<double>(LogicalWidth)));

        int32_t retval = newlinewidth.width;

        if (retval<1) retval = 1;
        return retval;
}

void FakeGDI::RegionToPermission()
{
        uint32_t countprotection = 0;

        uint32_t width = drobj->GetCanvas()->GetWidth();
        uint32_t height = drobj->GetCanvas()->GetHeight();
        for (uint32_t y = 0; y<height; y++)
                for (uint32_t x = 0; x<width; x++)
                        if (devicecontext->region->IsProtected(x,y))
                                countprotection++;

        DEBUGPRINT("Number of protected pixels = " << countprotection);
        protected_bitmap->SetAreaProtection(*devicecontext->region);
}

// *****************************************************************************
// Drawing routines
// *****************************************************************************

void FakeGDI::ModifyWorldTransform(DrawLib::XForm2D const &make_xform, Gdi::ModificationMode const &mode)
{
        switch (mode)
        {
        /* Resets the current world transformation by using the identity matrix.
           If this mode is specified, the XFORM structure pointed to by lpXform is ignored. */
        case Gdi::MwtIdentity:
                DEBUGPRINT("Setting identity transform");
                devicecontext->current_transform = DrawLib::XForm2D();
                break;
        /* Multiplies the current transformation by the data in the XFORM
           structure. (The data in the XFORM structure becomes the left
           multiplicand, and the data for the current transformation becomes
           the right multiplicand.) */
        case Gdi::MwtLeftMultiply:
                DEBUGPRINT("Setting transform leftmultiply " << make_xform << " current " << devicecontext->current_transform << " result " << (make_xform * devicecontext->current_transform));
                devicecontext->current_transform = make_xform * devicecontext->current_transform;
                break;

        case Gdi::MwtRightMultiply:
                DEBUGPRINT("Setting transform current " << devicecontext->current_transform << " rightmultiply " << make_xform << " result " << (devicecontext->current_transform * make_xform));
                devicecontext->current_transform = devicecontext->current_transform * make_xform;
                break;

        default:
                DEBUGPRINT("Incorrect world transformation mode #" << (int)mode << " in ModifyWorldTransform call (current " << devicecontext->current_transform << " parameter " << make_xform << ")");
                return; // bail!
        }
        UpdateTransforms();
}

void FakeGDI::SetWorldTransform(DrawLib::XForm2D const &wt)
{
        DEBUGPRINT("Updating current transform: was " << devicecontext->current_transform << " will be " << wt);
        devicecontext->current_transform = wt;
        UpdateTransforms();
}

void FakeGDI::SetDefaultTransform(DrawLib::XForm2D const & myxform)
{
        DEBUGPRINT("Updating default transform: was " << default_transform << " will be " << myxform);
        default_transform = myxform;
        UpdateTransforms();
}

/********************************************************************************
        Path functions
********************************************************************************/

void FakeGDI::BeginPath()
{
        use_path = true;
        currentpath.Reset();
}

void FakeGDI::EndPath()
{
        use_path = false;
}

void FakeGDI::ClosePath()
{
        currentpath.ClosePath();
}

// Finish the current path operation, if any. (keeps the action if a path is open, immediately performs the action if no path is open)
void FakeGDI::FinishPathOperation()
{
        if (use_path)
            return; //skip this

        StrokeFillPath(true,true); //stroke
        currentpath.Reset();
        currentpath.MoveTo(currentpoint);
}

void FakeGDI::StrokeFillPath(bool stroke, bool fill)
{
        if (devicecontext->penptr->style != PS_NULL
            || devicecontext->brushptr->style != BS_NULL)
        {
                SetupDrawLibAccordingToDeviceContext();
                currentpath.SetTransform(logical_to_local);

                drobj->StrokeFillPath(currentpath,
                                      stroke && (devicecontext->penptr->style != BS_NULL),
                                      fill && (devicecontext->brushptr->style != BS_NULL));
        }
}

void FakeGDI::UpdateTransforms()
{
        if (devicecontext->mapmode ==MM_Anisotropic || devicecontext->mapmode == MM_Isotropic)
        {
                if (devicecontext->window_extents.width==0 || devicecontext->window_extents.height==0 || devicecontext->viewport_extents.width==0 || devicecontext->viewport_extents.height==0)
                    throw std::runtime_error("Collapsed viewport/window passed for transformation");

                //The following formula shows the math involved in converting a point from page space to device space.
                //Dx = ((Lx - WOx) * VEx / WEx) + VOx   (D=device, L=logical)

                logical_to_local = DrawLib::XForm2D(1,0,0,1,devicecontext->window_origin * -1)
                                   * DrawLib::XForm2D((devicecontext->viewport_extents.width)/devicecontext->window_extents.width,
                                                      0,
                                                      0,
                                                      (devicecontext->viewport_extents.height)/devicecontext->window_extents.height,
                                                      devicecontext->viewport_origin);

                DEBUGPRINT("UpdateTransforms l2l based on window/viewport: " << logical_to_local);

                DEBUGPRINT("UpdateTransforms l2l applying current transform: " << devicecontext->current_transform);
                logical_to_local *= devicecontext->current_transform;
                DEBUGPRINT("UpdateTransforms l2l after applying current transform: " << logical_to_local);

                DEBUGPRINT("UpdateTransforms l2l applying default transform: " << default_transform);
                logical_to_local *= default_transform; //ADDME: Better name (this is the 'from internal DC' to 'render canvas' transformation)
                DEBUGPRINT("UpdateTransforms l2l after applying default transform: " << logical_to_local);
        }
        else
        {
                logical_to_local = devicecontext->current_transform;
                DEBUGPRINT("UpdateTransforms no mapping mode, world transform is : " << logical_to_local);
                logical_to_local *= default_transform; //ADDME: Better name (this is the 'from internal DC' to 'render canvas' transformation)
                DEBUGPRINT("UpdateTransforms no mapping mode, after apply default transform: " << logical_to_local);
        }
}


void FakeGDI::ExtSelectClipRgn(uint32_t regionbytes, int32_t mode)
{
/*#define RGN_AND             1
#define RGN_OR              2
#define RGN_XOR             3
#define RGN_DIFF            4
#define RGN_COPY            5*/
        if (regionbytes!=0)
        {
                DEBUGPRINT("  Don't know how to handle region data (" << regionbytes << " bytes)");
        }
        else if (mode!=5)
        {
                DEBUGPRINT("  Don't know how to handle region mode #" << mode);
        }
        else
        {
                //Copy NULL means: reset clipping region
                DEBUGPRINT("  Resetting clipping region (code RGN_COPY region NULL)");
                devicecontext->region->SetProtectedArea( DrawLib::IRect(0,0,devicecontext->region->GetWidth(),devicecontext->region->GetHeight()), false);
                RegionToPermission();
        }
}

} //end of namespace
