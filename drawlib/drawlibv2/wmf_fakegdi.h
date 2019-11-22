#ifndef drawlib_wmflib_fakegdi
#define drawlib_wmflib_fakegdi

#include "wmf_gditypes.h"

// #include "regionmanager.h"
#include <drawlib/drawlibv2/drawobject.h>
#include <drawlib/drawlibv2/region.h>

namespace WmfLib
{

#define DWORD uint32_t

/* constants for the biCompression field */
#define BI_RGB        0L
#define BI_RLE8       1L
#define BI_RLE4       2L
#define BI_BITFIELDS  3L
#define BI_JPEG       4L
#define BI_PNG        5L

/* Mapping Modes */
#define MM_TEXT             1
#define MM_LOMETRIC         2
#define MM_HIMETRIC         3
#define MM_LOENGLISH        4
#define MM_HIENGLISH        5
#define MM_TWIPS            6
#define MM_ISOTROPIC        7
#define MM_ANISOTROPIC      8

/* Stock Logical Objects */
#define WHITE_BRUSH         0
#define LTGRAY_BRUSH        1
#define GRAY_BRUSH          2
#define DKGRAY_BRUSH        3
#define BLACK_BRUSH         4
#define NULL_BRUSH          5
#define HOLLOW_BRUSH        NULL_BRUSH
#define WHITE_PEN           6
#define BLACK_PEN           7
#define NULL_PEN            8
#define OEM_FIXED_FONT      10
#define ANSI_FIXED_FONT     11
#define ANSI_VAR_FONT       12
#define SYSTEM_FONT         13
#define DEVICE_DEFAULT_FONT 14
#define DEFAULT_PALETTE     15
#define SYSTEM_FIXED_FONT   16

/* Brush Styles */
#define BS_SOLID            0
#define BS_NULL             1
#define BS_HOLLOW           BS_NULL
#define BS_HATCHED          2
#define BS_PATTERN          3
#define BS_INDEXED          4
#define BS_DIBPATTERN       5
#define BS_DIBPATTERNPT     6
#define BS_PATTERN8X8       7
#define BS_DIBPATTERN8X8    8
#define BS_MONOPATTERN      9

/* Hatch Styles */
#define HS_HORIZONTAL       0       /* ----- */
#define HS_VERTICAL         1       /* ||||| */
#define HS_FDIAGONAL        2       /* \\\\\ */
#define HS_BDIAGONAL        3       /* ///// */
#define HS_CROSS            4       /* +++++ */
#define HS_DIAGCROSS        5       /* xxxxx */

/* Pen Styles */
#define PS_SOLID            0
#define PS_DASH             1       /* -------  */
#define PS_DOT              2       /* .......  */
#define PS_DASHDOT          3       /* _._._._  */
#define PS_DASHDOTDOT       4       /* _.._.._  */
#define PS_NULL             5
#define PS_INSIDEFRAME      6
#define PS_USERSTYLE        7
#define PS_ALTERNATE        8
#define PS_STYLE_MASK       0x0000000F

#define PS_ENDCAP_ROUND     0x00000000
#define PS_ENDCAP_SQUARE    0x00000100
#define PS_ENDCAP_FLAT      0x00000200
#define PS_ENDCAP_MASK      0x00000F00

#define PS_JOIN_ROUND       0x00000000
#define PS_JOIN_BEVEL       0x00001000
#define PS_JOIN_MITER       0x00002000
#define PS_JOIN_MASK        0x0000F000

#define PS_COSMETIC         0x00000000
#define PS_GEOMETRIC        0x00010000
#define PS_TYPE_MASK        0x000F0000

#define AD_COUNTERCLOCKWISE 1
#define AD_CLOCKWISE        2

/* binary raster operations */
#define R2_BLACK            1   /*  0       */
#define R2_NOTMERGEPEN      2   /* DPon     */
#define R2_MASKNOTPEN       3   /* DPna     */
#define R2_NOTCOPYPEN       4   /* PN       */
#define R2_MASKPENNOT       5   /* PDna     */
#define R2_NOT              6   /* Dn       */
#define R2_XORPEN           7   /* DPx      */
#define R2_NOTMASKPEN       8   /* DPan     */
#define R2_MASKPEN          9   /* DPa      */
#define R2_NOTXORPEN        10  /* DPxn     */
#define R2_NOP              11  /* D        */
#define R2_MERGENOTPEN      12  /* DPno     */
#define R2_COPYPEN          13  /* P        */
#define R2_MERGEPENNOT      14  /* PDno     */
#define R2_MERGEPEN         15  /* DPo      */
#define R2_WHITE            16  /*  1       */
#define R2_LAST             16

/* Ternary raster operations */
#define SRCCOPY             (DWORD)0x00CC0020 /* dest = source                   */
#define SRCPAINT            (DWORD)0x00EE0086 /* dest = source OR dest           */
#define SRCAND              (DWORD)0x008800C6 /* dest = source AND dest          */
#define SRCINVERT           (DWORD)0x00660046 /* dest = source XOR dest          */
#define SRCERASE            (DWORD)0x00440328 /* dest = source AND (NOT dest )   */
#define NOTSRCCOPY          (DWORD)0x00330008 /* dest = (NOT source)             */
#define NOTSRCERASE         (DWORD)0x001100A6 /* dest = (NOT src) AND (NOT dest) */
#define MERGECOPY           (DWORD)0x00C000CA /* dest = (source AND pattern)     */
#define MERGEPAINT          (DWORD)0x00BB0226 /* dest = (NOT source) OR dest     */
#define PATCOPY             (DWORD)0x00F00021 /* dest = pattern                  */
#define PATPAINT            (DWORD)0x00FB0A09 /* dest = DPSnoo                   */
#define PATINVERT           (DWORD)0x005A0049 /* dest = pattern XOR dest         */
#define DSTINVERT           (DWORD)0x00550009 /* dest = (NOT dest)               */
#define BLACKNESS           (DWORD)0x00000042 /* dest = BLACK                    */
#define WHITENESS           (DWORD)0x00FF0062 /* dest = WHITE                    */

/* DIB color table identifiers */
#define DIB_RGB_COLORS      0 /* color table in RGBs */
#define DIB_PAL_COLORS      1 /* color table in palette indices */

#define TRANSPARENT         1
#define OPAQUE              2
#define BKMODE_LAST         2

/* Text Alignment Options */
#define TA_NOUPDATECP                0
#define TA_UPDATECP                  1

#define TA_LEFT                      0
#define TA_RIGHT                     2
#define TA_CENTER                    6

#define TA_TOP                       0
#define TA_BOTTOM                    8
#define TA_BASELINE                  24
#define TA_RTLREADING                256
#define TA_MASK       (TA_BASELINE+TA_CENTER+TA_UPDATECP+TA_RTLREADING)

#define ETO_OPAQUE                   0x0002
#define ETO_CLIPPED                  0x0004

#define OUT_DEFAULT_PRECIS          0
#define OUT_STRING_PRECIS           1
#define OUT_CHARACTER_PRECIS        2
#define OUT_STROKE_PRECIS           3
#define OUT_TT_PRECIS               4
#define OUT_DEVICE_PRECIS           5
#define OUT_RASTER_PRECIS           6
#define OUT_TT_ONLY_PRECIS          7
#define OUT_OUTLINE_PRECIS          8
#define OUT_SCREEN_OUTLINE_PRECIS   9
#define OUT_PS_ONLY_PRECIS          10

#define CLIP_DEFAULT_PRECIS     0
#define CLIP_CHARACTER_PRECIS   1
#define CLIP_STROKE_PRECIS      2
#define CLIP_MASK               0xf
#define CLIP_LH_ANGLES          (1<<4)
#define CLIP_TT_ALWAYS          (2<<4)
#define CLIP_EMBEDDED           (8<<4)

#define DEFAULT_QUALITY         0
#define DRAFT_QUALITY           1
#define PROOF_QUALITY           2
#define NONANTIALIASED_QUALITY  3
#define ANTIALIASED_QUALITY     4

#define DEFAULT_PITCH           0
#define FIXED_PITCH             1
#define VARIABLE_PITCH          2
#define MONO_FONT               8

#define ANSI_CHARSET            0
#define DEFAULT_CHARSET         1
#define SYMBOL_CHARSET          2
#define SHIFTJIS_CHARSET        128
#define HANGEUL_CHARSET         129
#define HANGUL_CHARSET          129
#define GB2312_CHARSET          134
#define CHINESEBIG5_CHARSET     136
#define OEM_CHARSET             255
#define JOHAB_CHARSET           130
#define HEBREW_CHARSET          177
#define ARABIC_CHARSET          178
#define GREEK_CHARSET           161
#define TURKISH_CHARSET         162
#define VIETNAMESE_CHARSET      163
#define THAI_CHARSET            222
#define EASTEUROPE_CHARSET      238
#define RUSSIAN_CHARSET         204

#define MAC_CHARSET             77
#define BALTIC_CHARSET          186

#define FS_LATIN1               0x00000001L
#define FS_LATIN2               0x00000002L
#define FS_CYRILLIC             0x00000004L
#define FS_GREEK                0x00000008L
#define FS_TURKISH              0x00000010L
#define FS_HEBREW               0x00000020L
#define FS_ARABIC               0x00000040L
#define FS_BALTIC               0x00000080L
#define FS_VIETNAMESE           0x00000100L
#define FS_THAI                 0x00010000L
#define FS_JISJAPAN             0x00020000L
#define FS_CHINESESIMP          0x00040000L
#define FS_WANSUNG              0x00080000L
#define FS_CHINESETRAD          0x00100000L
#define FS_JOHAB                0x00200000L
#define FS_SYMBOL               0x80000000L

/* Font Families */
#define FF_DONTCARE         (0<<4)  /* Don't care or don't know. */
#define FF_ROMAN            (1<<4)  /* Variable stroke width, serifed. */
                                    /* Times Roman, Century Schoolbook, etc. */
#define FF_SWISS            (2<<4)  /* Variable stroke width, sans-serifed. */
                                    /* Helvetica, Swiss, etc. */
#define FF_MODERN           (3<<4)  /* Constant stroke width, serifed or sans-serifed. */
                                    /* Pica, Elite, Courier, etc. */
#define FF_SCRIPT           (4<<4)  /* Cursive, etc. */
#define FF_DECORATIVE       (5<<4)  /* Old English, etc. */

/* Font Weights */
#define FW_DONTCARE         0
#define FW_THIN             100
#define FW_EXTRALIGHT       200
#define FW_LIGHT            300
#define FW_NORMAL           400
#define FW_MEDIUM           500
#define FW_SEMIBOLD         600
#define FW_BOLD             700
#define FW_EXTRABOLD        800
#define FW_HEAVY            900

typedef void * fHGDIOBJ;

typedef struct tagfBITMAPINFOHEADER
{
        uint32_t     biSize;
        int32_t     biWidth;
        int32_t     biHeight;
        uint16_t     biPlanes;
        uint16_t     biBitCount;
        uint32_t     biCompression;
        uint32_t     biSizeImage;
        int32_t     biXPelsPerMeter;
        int32_t     biYPelsPerMeter;
        uint32_t     biClrUsed;
        uint32_t     biClrImportant;
} fBITMAPINFOHEADER;

typedef struct tagfBITMAPINFO
{
        fBITMAPINFOHEADER bmiHeader;
        //fRGBQUAD          bmiColors[1];
} fBITMAPINFO;

/*******************************************************************************
/ FAKEBITMAP
*******************************************************************************/

class FakeBitmap
{
public:
        // call when bitmap pointer is known
        // as in EMF
        FakeBitmap(const fBITMAPINFO *lpBitsInfo, const void *lpbitmap);
        // call when bitmap data is directly behind lpBitsInfo
        // as in WMF
        FakeBitmap(const fBITMAPINFO *lpBitsInfo);
        // call in case of a pattern bitmap where the BITMAPINFOHEADER
        // is bogus (used in DIBCreatePatternBrush)
        FakeBitmap(const fBITMAPINFO *lpBitsInfo, uint16_t ColorSpec);

        FakeBitmap(const fBITMAPINFO *lpBitsInfo, const DrawLib::Pixel32 &foreground,
        const DrawLib::Pixel32 &background);

        ~FakeBitmap();

        int32_t GetXsize() const;
        int32_t GetYsize() const;

        void ConvertTo24BPP();
private:
        DrawLib::Bitmap32 *mybitmap;
};


/*******************************************************************************
/ GDIObject list stuff
*******************************************************************************/

class GDIObjectListItem
{
public:
        GDIObjectListItem() {}
        std::unique_ptr<GDIObject> object;
};

typedef std::shared_ptr<GDIObjectListItem>   GDIObjectListItemPtr;

class GDIObjectList
{
public:
        GDIObjectList();
        ~GDIObjectList();

        GDIObject *     GetFakeGDIObject(uint32_t index);
        void            AddObject(std::unique_ptr<GDIObject> &obj);
        void            AddObject(std::unique_ptr<GDIObject> &obj, uint32_t index);
        int32_t             DeleteObject(uint32_t index);

        //BCB BUG??: borland hack for AddObject
        template<class DerivedType> void AddObject(std::unique_ptr<DerivedType> &obj)
        { std::unique_ptr<GDIObject> newobj(obj.release());
          AddObject(newobj);
        }
        template<class DerivedType> void AddObject(std::unique_ptr<DerivedType> &obj, uint32_t index)
        { std::unique_ptr<GDIObject> newobj(obj.release());
          AddObject(newobj, index);
        }

private:
        std::vector<GDIObjectListItemPtr> objectlist;
};

/*******************************************************************************
/ GDI devicecontext stack
*******************************************************************************/

class GDI_DCStack
{
public:
        GDI_DCStack();
        ~GDI_DCStack();

        GDI_DCItem*     Pop(unsigned items);
        GDI_DCItem*     TruncateTo(unsigned items);
        int32_t             Push(GDI_DCItem *item);

private:
        std::vector<GDI_DCItem*> stacklist;
};

namespace Gdi
{
        enum ModificationMode { MwtIdentity=1, MwtLeftMultiply=2, MwtRightMultiply=3 };
}

/*******************************************************************************
/ FAKEGDI
*******************************************************************************/

class FakeGDI
{
public:
        FakeGDI();
        ~FakeGDI();

        //**************************
        // Supported GDI commands
        //**************************

        int32_t CreateBrushIndirect(uint32_t style, const DrawLib::Pixel32 &color, uint32_t hatch);
        int32_t CreateBrushIndirect(uint32_t objectindex, uint32_t style, const DrawLib::Pixel32 &color, uint32_t hatch);
        //int32_t CreateFontIndirectA(fLOGFONT16 *logfont);

        /** The CreateFontIndirect function creates a logical font that has
            the characteristics specified in the specified structure. The font
            can subsequently be selected as the current font for any device context.
            @param objectindex -1 is this is unknown(for WMF), comes from records in EMF.
            @param logfont Source data for logical font to create */

        int32_t CreateFontIndirectW(int32_t objectindex, fLOGFONT32 const *logfont);
        int32_t CreatePenIndirect(uint32_t style, uint32_t width, const DrawLib::Pixel32 &color);
        int32_t CreatePen(uint32_t objectindex, uint32_t style, uint32_t width, const DrawLib::Pixel32 &color);

        /** This function creates a dummy region GDIObject on the object stack (WMF)
        */
        int32_t CreateRegion();

        /** This function creates a dummy palette GDIObject on the object stack (WMF)
        */
        int32_t CreatePalette();

        /** This function creates a dummy region GDIObject on the object stack (WMF)
            @param[in] objectindex - where to put the object on the stack (or list actually)
        */
        int32_t CreateRegion(int32_t objectindex);

        /** This function creates a dummy region GDIObject on the object stack (WMF)
            @param[in] objectindex - where to put the object on the stack (or list actually)
        */
        int32_t CreatePalette(int32_t objectindex);

        /** The StretchBlt function performs a bit-block transfer of the color data
            corresponding to a rectangle of pixels, optionally resizing it
            @param nXDest x-coordinate of destination rectangle's upper-left corner
            @param nYDest y-coordinate of destination rectangle's upper-left corner
            @param nWidth width of destination rectangle
            @param nHeight height of destination rectangle
            @param dwRop raster operation code (one of the Ternary raster operations)
            @return true on success, false on failure */
//        bool StretchBlt(DrawLib::FPPoint const &originstart, DrawLib::FPSize const &originsize,
//                        DrawLib::FPPoint const &deststart, DrawLib::FPSize const &destsize, uint32_t dwRop);

        bool StretchDIBits(DrawLib::FPPoint const &destpoint, DrawLib::FPSize const &destheight,
                           DrawLib::FPPoint const &srcpoint, DrawLib::FPSize const &srcheight,
                           const uint8_t *DIBdata, long DIBlength,
                           uint32_t iUsage, uint32_t dwRop);

        /** DIBCreatePatternBrush - Create a Pattern brush using a DIB bitmap buffer and store it on the GDI object stack */
        int32_t DIBCreatePatternBrush(const uint8_t *DIBdata, long datalength);

        /** DIBCreatePatternBrush - Create a Pattern brush using a DIB bitmap buffer and store it in the 'index' position on the GDI object stack - EMF version*/
        int32_t DIBCreatePatternBrush(uint32_t index, const uint8_t *DIBdata, long datalength);

        int32_t DeleteObject(uint32_t dwObjectNo);
        int32_t ExtTextOutA(int32_t x, int32_t y, uint32_t flags, fRECT *lpRect, const uint8_t *string,
                uint32_t count, const uint16_t *lpDx);
        int32_t ExtTextOutW(int32_t x, int32_t y, uint32_t flags, fRECT *lpRect, const uint16_t *string,
                uint32_t count, const uint16_t *lpDx);

        int32_t Ellipse(int32_t left, int32_t top, int32_t right, int32_t bottom);
        int32_t RoundRectangle(int32_t left, int32_t top, int32_t right, int32_t bottom, int32_t width, int32_t height);
        int32_t LineTo(int32_t x, int32_t y);
        int32_t MoveTo(int32_t x, int32_t y);
        int32_t PatBlt(int32_t left, int32_t top, int32_t width, int32_t height, uint32_t rop);
        int32_t Pie(int32_t left, int32_t top, int32_t right, int32_t bottom,
                int32_t startx, int32_t starty, int32_t endx, int32_t endy);

        int32_t PolyLine(const std::vector<DrawLib::FPPoint> &Plist);
        int32_t Polygon(const std::vector<DrawLib::FPPoint> &Plist);
        int32_t PolyPolygon(uint32_t Npolys, const std::vector<uint32_t> &Nlist, const std::vector<DrawLib::FPPoint> &Plist);
        void PolyBezier(const std::vector<DrawLib::FPPoint> &Plist);
        void PolyBezierTo(const std::vector<DrawLib::FPPoint> &Plist);
        void InnerPolyBezier(const std::vector<DrawLib::FPPoint> &Plist, bool first_point_is_moveto);

        int32_t Rectangle(const fRECT &rect);
        int32_t SaveDC();
        int32_t RestoreDC(int32_t items);
        int32_t SetBKColor(const DrawLib::Pixel32 &color);
        int32_t SetBKMode(uint32_t bkmode);
        int32_t SetStretchBltMode(uint32_t bltmode);
        int32_t SetROP(uint32_t ropmode);
        int32_t SetTextAlign(uint32_t alignflags);
        int32_t SetTextColor(const DrawLib::Pixel32 &color);
        int32_t SetPolyFillMode(uint32_t fillmode);

        void ExtSelectClipRgn(uint32_t regionbytes, int32_t mode);

        /* The IntersectClipRect function adjusts the clipping region so that it
           becomes the intersection of the current clipping region and the
           specified rectangle. */
        int32_t IntersectClipRect(int32_t left, int32_t top, int32_t right,
                int32_t bottom);

        /*The ExcludeClipRect function adjusts the clipping region so that it
          consists of the existing clipping region minus the specified rectangle.
          */
        int32_t ExcludeClipRect(int32_t left, int32_t top, int32_t right,
                int32_t bottom);

        fHGDIOBJ *SelectObject(uint32_t dwObjectNo);
        int32_t SetMapMode(MappingModes new_mapping_mode);

        // Look up the following functions in Win32 documentation...
        int32_t SetWindowOrg(int32_t x, int32_t y);
        int32_t SetWindowExt(int32_t x, int32_t y);
        int32_t SetViewportOrg(int32_t x, int32_t y);
        int32_t SetViewportExt(int32_t x, int32_t y);
        void SetExtent(int32_t x, int32_t y);
        int32_t ScaleViewportExtent(int32_t xNum, int32_t xDenom, int32_t yNum, int32_t yDenom);

        // Path functions (lookup in Win32 dox)
        void BeginPath();
        void EndPath();
        void ClosePath();
        void StrokeFillPath(bool stroke, bool fill);

        // Finish the current path operation, if any. (keeps the action if a path is open, immediately performs the action if no path is open)
        void FinishPathOperation();

        DrawLib::FPPoint GetCurrentPoint();

        // *****************************
        // Graphics I/O
        // *****************************

        void SetOutputParams(DrawLib::Bitmap32 *bitmap);

        // *****************************
        // Various
        // *****************************

        // Set fontmapper
        //void            SetFontmapper(FontMapper *fm);

        //////////////////////////////////////////////////////////////////////
        // Coordinate Space and Transformation Functions
        //////////////////////////////////////////////////////////////////////
        void ModifyWorldTransform(DrawLib::XForm2D const &xform, Gdi::ModificationMode const &mode);
        void SetWorldTransform(DrawLib::XForm2D const &wt);
        void SetScaleFactors(double x, double y, double edx, double edy);
        void SetFrameRect(double x, double y, double x2, double y2);
        void SetDefaultTransform(DrawLib::XForm2D const & myxform);

private:
        ///Recalculate to_viewport after updates
        void UpdateTransforms();

        void            SetupDrawLibAccordingToDeviceContext();
        void            SetupHatchBrush(GO_Brush *obj, uint32_t hatch, const DrawLib::Pixel32 &color,
                                const DrawLib::Pixel32 &bkcolor);

        void            RegionToPermission();
        void            SetBrush(GO_Brush &brush, uint32_t style, DrawLib::Pixel32 const &color, uint32_t hatch);
        void            SetPen(GO_Pen &pen, uint32_t style, uint32_t width, DrawLib::Pixel32 const &color);

        DrawLib::FPPoint         LPtoDP(const DrawLib::FPPoint &p);
        DrawLib::FPSize          LPtoDP(const DrawLib::FPSize &p);
        //Add a polyline to currentpath
        DrawLib::Path            PolyLineToPath(const std::vector<DrawLib::FPPoint> &Plist);

        int32_t             CalcLineWidth(int32_t LogicalWidth);
        double           CalculateRadial (int32_t cx, int32_t cy, int32_t xs, int32_t ys, DrawLib::FPPoint r);
        bool            use_path;

        uint32_t            dwROP2code;
        uint32_t            dwPolyFillMode;

        DrawLib::FPPoint          currentpoint;

        // Device context stack
        GDI_DCStack     *dcstack;

        // current device context
        std::unique_ptr <GDI_DCItem> devicecontext;

        ///Default transformation (ADDME: What is this anyway?)
        DrawLib::XForm2D default_transform;
        ///Logical to local transformation (calculated based on current DC properties)
        DrawLib::XForm2D logical_to_local;

        // startup brush + pen
        GO_Brush        *startbrush;
        GO_Pen          *startpen;

        std::shared_ptr<DrawLib::Region> startregion;

        // Object list to keep track of objects that can be selected
        // by SelectObject
        GDIObjectList*  ObjectList;

        DrawLib::Bitmap32 *outputbitmap;
        std::unique_ptr<DrawLib::ProtectedBitmap32> protected_bitmap;
        std::unique_ptr<DrawLib::Canvas32>          mycanvas;
        std::unique_ptr<DrawLib::DrawObject>        drobj;
        DrawLib::Path           currentpath;

        // StockObjects!
        GDIObject *StockObjects[16];
};

}
#endif
