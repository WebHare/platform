#ifndef drawlib_wmflib_gditypes
#define drawlib_wmflib_gditypes

#include <blex/blexlib.h>
#include <blex/unicode.h>
#include "drawlib_v2_types.h"
#include "bitmap.h"
#include <string>
#include <drawlib/drawlibv2/fontmanager.h>

namespace WmfLib
{

enum MappingModes
{
        MM_Text = 1,
        MM_Lometric = 2,
        MM_Himetric = 3,
        MM_Loenglish = 4,
        MM_Hienglish = 5,
        MM_Twips = 6,
        MM_Isotropic = 7,
        MM_Anisotropic = 8
};

/*******************************************************************************
/ BRUSH / PEN / FONT / REGION / PALETTE
*******************************************************************************/
#define LF_FACESIZE         32

typedef struct tagfPOINT
{
        int32_t         x;
        int32_t         y;
} fPOINT;

struct fRECT
{
        ///Size of this record in a EMF file
        static unsigned const RecSizeEMF = 16;
        ///Size of this record in a WMF file
        static unsigned const RecSizeWMF = 8;
        ///Read this record from a EMF file
        void ReadEMF(uint8_t const *data);
        ///Read this record from a WMF file
        void ReadWMF(uint8_t const *data);

        int32_t         left;
        int32_t         top;
        int32_t         right;
        int32_t         bottom;
};

typedef struct tagfLOGBRUSH
{
        uint32_t         lbStyle;
        uint32_t         lbColor;
        uint32_t         lbHatch;
} fLOGBRUSH;

typedef struct tagfLOGPEN
{
        uint32_t         lopnStyle;
        fPOINT      lopnWidth;
        uint32_t         lopnColor;
} fLOGPEN;

/*******************************************************************************
/ GDIObject
*******************************************************************************/

typedef struct tagfLOGFONTW {
    int32_t      lfHeight;
    int32_t      lfWidth;
    int32_t      lfEscapement;
    int32_t      lfOrientation;
    int32_t      lfWeight;
    uint8_t       lfItalic;
    uint8_t       lfUnderline;
    uint8_t       lfStrikeOut;
    uint8_t       lfCharSet;
    uint8_t       lfOutPrecision;
    uint8_t       lfClipPrecision;
    uint8_t       lfQuality;
    uint8_t       lfPitchAndFamily;
    Blex::UnicodeString lfFaceName;
} fLOGFONT32;

enum GDIObjectType { isBrush, isPen, isPalette, isFont, isRegion};

class GDIObject
{
public:
        virtual ~GDIObject();
        GDIObjectType   ObjectType;
};

class GO_Brush : public GDIObject
{
public:
        GO_Brush() : style(0), hatch(0) {}

        uint32_t                     style;
        DrawLib::Pixel32        color;
        uint32_t                     hatch;

        // for patterned brushes
        std::shared_ptr<DrawLib::Bitmap32 >   patternbrushbitmap;
};

class GO_Pen : public GDIObject
{
public:
        GO_Pen() : style(0), width(0) {};

        uint32_t                     style;
        uint32_t                     width;
        DrawLib::Pixel32        color;
};

class GO_Font : public GDIObject
{
        std::unique_ptr<DrawLib::Font> opened_font;

public:
        ~GO_Font();
        DrawLib::Font *GetFont();

        std::string     familyname;
        std::string     stylename;
        bool            is_bold;
        double           pointsizeX;
        double           pointsizeY;
        uint32_t             encoding;               // font encoding
        uint32_t             orientation;            // == 0 for horizontal
                                                // == 1 for vertical
};

class GDI_DCItem
{
public:
        GDI_DCItem();
        GDI_DCItem(GDI_DCItem const & myitem);

        //rewrite to object id.
        GO_Pen *                penptr;
        GO_Brush *              brushptr;
        GO_Font *               fontptr;
//FIXME::  uint32_t                             regionid; //? very rare??
        std::unique_ptr<DrawLib::Region>  region;
        DrawLib::Pixel32        textcolor;
        DrawLib::Pixel32        bkcolor;
        uint32_t                     bkmode;
        MappingModes            mapmode;

        enum Valign {BASELINE, TOP, BOTTOM};
        enum Halign {LEFT, CENTER, RIGHT};

        Valign                  valign;
        Halign                  halign;
        bool                    update;

        ///Current window origin
        DrawLib::FPPoint window_origin;
        ///Current window extents
        DrawLib::FPSize window_extents;
        ///Current viewport origin
        DrawLib::FPPoint viewport_origin;
        ///Current viewport extents
        DrawLib::FPSize viewport_extents;
        ///Current selected transformation (through SetWorldTransform)
        DrawLib::XForm2D current_transform;

        enum StretchBltMode
        {
                BlackOnWhite = 1,
                WhiteOnBlack = 2,
                ColorOnColor = 3,
                HalfTone = 4
        };

        StretchBltMode stretch_mode;

        ///Current world to windows transformation
        //WorldTransform World_to_window;

        ///Current world to viewport transformation
        //WorldTransform World_to_viewport;

        //WorldTransform Viewport_to_world;

        //WorldTransform default_transform;
private:
        //not implemented to prevent errors.
        GDI_DCItem & operator= (GDI_DCItem const &);
};

/*******************************************************************************
/ new objects?
*******************************************************************************/

std::ostream& operator << (std::ostream &out, fRECT const &);
std::ostream& operator << (std::ostream &out, fPOINT const &);
std::ostream& operator<< (std::ostream &str, GDI_DCItem::StretchBltMode mode);

}
#endif
