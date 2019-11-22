#ifndef drawlib_wmflib_wmfconvert
#define drawlib_wmflib_wmfconvert

#include <blex/blexlib.h>
#include <blex/unicode.h>
#include "wmf_fakegdi.h"

namespace WmfLib
{

const uint32_t EMF_Signature = 0x464D4520;

#define EMF_SIGNATURE_OFFSET 40
#define INCLUDE_WMF_DEFINES

#define WMFCONVERT_ERR -1
#define WMFCONVERT_OK  0

// Include the windows WMF/EMF defines if they're needed

//#ifdef  INCLUDE_WMF_DEFINES

#define META_SETBKCOLOR              0x0201
#define META_SETBKMODE               0x0102
#define META_SETMAPMODE              0x0103
#define META_SETROP2                 0x0104
#define META_SETRELABS               0x0105
#define META_SETPOLYFILLMODE         0x0106
#define META_SETSTRETCHBLTMODE       0x0107
#define META_SETTEXTCHAREXTRA        0x0108
#define META_SETTEXTCOLOR            0x0209
#define META_SETTEXTJUSTIFICATION    0x020A
#define META_SETWINDOWORG            0x020B
#define META_SETWINDOWEXT            0x020C
#define META_SETVIEWPORTORG          0x020D
#define META_SETVIEWPORTEXT          0x020E
#define META_OFFSETWINDOWORG         0x020F
#define META_SCALEWINDOWEXT          0x0410
#define META_OFFSETVIEWPORTORG       0x0211
#define META_SCALEVIEWPORTEXT        0x0412
#define META_LINETO                  0x0213
#define META_MOVETO                  0x0214
#define META_EXCLUDECLIPRECT         0x0415
#define META_INTERSECTCLIPRECT       0x0416
#define META_ARC                     0x0817
#define META_ELLIPSE                 0x0418
#define META_FLOODFILL               0x0419
#define META_PIE                     0x081A
#define META_RECTANGLE               0x041B
#define META_ROUNDRECT               0x061C
#define META_PATBLT                  0x061D
#define META_SAVEDC                  0x001E
#define META_SETPIXEL                0x041F
#define META_OFFSETCLIPRGN           0x0220
#define META_TEXTOUT                 0x0521
#define META_BITBLT                  0x0922
#define META_STRETCHBLT              0x0B23
#define META_POLYGON                 0x0324
#define META_POLYLINE                0x0325
#define META_ESCAPE                  0x0626
#define META_RESTOREDC               0x0127
#define META_FILLREGION              0x0228
#define META_FRAMEREGION             0x0429
#define META_INVERTREGION            0x012A
#define META_PAINTREGION             0x012B
#define META_SELECTCLIPREGION        0x012C
#define META_SELECTOBJECT            0x012D
#define META_SETTEXTALIGN            0x012E
#define META_CHORD                   0x0830
#define META_SETMAPPERFLAGS          0x0231
#define META_EXTTEXTOUT              0x0a32
#define META_SETDIBTODEV             0x0d33
#define META_SELECTPALETTE           0x0234
#define META_REALIZEPALETTE          0x0035
#define META_ANIMATEPALETTE          0x0436
#define META_SETPALENTRIES           0x0037
#define META_POLYPOLYGON             0x0538
#define META_RESIZEPALETTE           0x0139
#define META_DIBBITBLT               0x0940
#define META_DIBSTRETCHBLT           0x0b41
#define META_DIBCREATEPATTERNBRUSH   0x0142
#define META_STRETCHDIB              0x0f43
#define META_EXTFLOODFILL            0x0548
#define META_DELETEOBJECT            0x01f0
#define META_CREATEPALETTE           0x00f7
#define META_CREATEPATTERNBRUSH      0x01F9
#define META_CREATEPENINDIRECT       0x02FA
#define META_CREATEFONTINDIRECT      0x02FB
#define META_CREATEBRUSHINDIRECT     0x02FC
#define META_CREATEREGION            0x06FF

#define ENHMETA_STOCK_OBJECT    0x80000000

#define EMR_HEADER                      1
#define EMR_POLYBEZIER                  2
#define EMR_POLYGON                     3
#define EMR_POLYLINE                    4
#define EMR_POLYBEZIERTO                5
#define EMR_POLYLINETO                  6
#define EMR_POLYPOLYLINE                7
#define EMR_POLYPOLYGON                 8
#define EMR_SETWINDOWEXTEX              9
#define EMR_SETWINDOWORGEX              10
#define EMR_SETVIEWPORTEXTEX            11
#define EMR_SETVIEWPORTORGEX            12
#define EMR_SETBRUSHORGEX               13
#define EMR_EOF                         14
#define EMR_SETPIXELV                   15
#define EMR_SETMAPPERFLAGS              16
#define EMR_SETMAPMODE                  17
#define EMR_SETBKMODE                   18
#define EMR_SETPOLYFILLMODE             19
#define EMR_SETROP2                     20
#define EMR_SETSTRETCHBLTMODE           21
#define EMR_SETTEXTALIGN                22
#define EMR_SETCOLORADJUSTMENT          23
#define EMR_SETTEXTCOLOR                24
#define EMR_SETBKCOLOR                  25
#define EMR_OFFSETCLIPRGN               26
#define EMR_MOVETOEX                    27
#define EMR_SETMETARGN                  28
#define EMR_EXCLUDECLIPRECT             29
#define EMR_INTERSECTCLIPRECT           30
#define EMR_SCALEVIEWPORTEXTEX          31
#define EMR_SCALEWINDOWEXTEX            32
#define EMR_SAVEDC                      33
#define EMR_RESTOREDC                   34
#define EMR_SETWORLDTRANSFORM           35
#define EMR_MODIFYWORLDTRANSFORM        36
#define EMR_SELECTOBJECT                37
#define EMR_CREATEPEN                   38
#define EMR_CREATEBRUSHINDIRECT         39
#define EMR_DELETEOBJECT                40
#define EMR_ANGLEARC                    41
#define EMR_ELLIPSE                     42
#define EMR_RECTANGLE                   43
#define EMR_ROUNDRECT                   44
#define EMR_ARC                         45
#define EMR_CHORD                       46
#define EMR_PIE                         47
#define EMR_SELECTPALETTE               48
#define EMR_CREATEPALETTE               49
#define EMR_SETPALETTEENTRIES           50
#define EMR_RESIZEPALETTE               51
#define EMR_REALIZEPALETTE              52
#define EMR_EXTFLOODFILL                53
#define EMR_LINETO                      54
#define EMR_ARCTO                       55
#define EMR_POLYDRAW                    56
#define EMR_SETARCDIRECTION             57
#define EMR_SETMITERLIMIT               58
#define EMR_BEGINPATH                   59
#define EMR_ENDPATH                     60
#define EMR_CLOSEFIGURE                 61
#define EMR_FILLPATH                    62
#define EMR_STROKEANDFILLPATH           63
#define EMR_STROKEPATH                  64
#define EMR_FLATTENPATH                 65
#define EMR_WIDENPATH                   66
#define EMR_SELECTCLIPPATH              67
#define EMR_ABORTPATH                   68

#define EMR_GDICOMMENT                  70
#define EMR_FILLRGN                     71
#define EMR_FRAMERGN                    72
#define EMR_INVERTRGN                   73
#define EMR_PAINTRGN                    74
#define EMR_EXTSELECTCLIPRGN            75
#define EMR_BITBLT                      76
#define EMR_STRETCHBLT                  77
#define EMR_MASKBLT                     78
#define EMR_PLGBLT                      79
#define EMR_SETDIBITSTODEVICE           80
#define EMR_STRETCHDIBITS               81
#define EMR_EXTCREATEFONTINDIRECTW      82
#define EMR_EXTTEXTOUTA                 83
#define EMR_EXTTEXTOUTW                 84
#define EMR_POLYBEZIER16                85
#define EMR_POLYGON16                   86
#define EMR_POLYLINE16                  87
#define EMR_POLYBEZIERTO16              88
#define EMR_POLYLINETO16                89
#define EMR_POLYPOLYLINE16              90
#define EMR_POLYPOLYGON16               91
#define EMR_POLYDRAW16                  92
#define EMR_CREATEMONOBRUSH             93
#define EMR_CREATEDIBPATTERNBRUSHPT     94
#define EMR_EXTCREATEPEN                95
#define EMR_POLYTEXTOUTA                96
#define EMR_POLYTEXTOUTW                97

#define EMR_SETICMMODE                  98
#define EMR_CREATECOLORSPACE            99
#define EMR_SETCOLORSPACE              100
#define EMR_DELETECOLORSPACE           101
#define EMR_GLSRECORD                  102
#define EMR_GLSBOUNDEDRECORD           103
#define EMR_PIXELFORMAT                104

#define META_SETLAYOUT               0x0149
#define EMR_RESERVED_105               105
#define EMR_RESERVED_106               106
#define EMR_RESERVED_107               107
#define EMR_RESERVED_108               108
#define EMR_RESERVED_109               109
#define EMR_RESERVED_110               110
#define EMR_COLORCORRECTPALETTE        111
#define EMR_SETICMPROFILEA             112
#define EMR_SETICMPROFILEW             113
#define EMR_ALPHABLEND                 114
#define EMR_SETLAYOUT                  115
#define EMR_TRANSPARENTBLT             116
#define EMR_GRADIENTFILL               118
#define EMR_RESERVED_119               119
#define EMR_RESERVED_120               120
#define EMR_COLORMATCHTOTARGETW        121
#define EMR_CREATECOLORSPACEW          122

/** WmfDataBuffer holds the WMF/EMF data and ensures there is no out-of-bound reading! */
class WmfDataBuffer
{
public:
        WmfDataBuffer();
        ~WmfDataBuffer();

        /** Init - Tell the buffer which part of memory contains the data! */
        void Init(const uint8_t *dataptr, const uint32_t datalength);
        /** AdvanceToNextRecord - move the current read pointer to the next record */
        void AdvanceToNextRecord();
        /** AdvancePointer - move the current read pointer by 'offset' bytes */
        void AdvancePointer(uint32_t offset);

        bool isEMF() {return isEmf;};
        bool isLastRecord();
        uint32_t  GetRecordID();
        /** GetRecordSize - returns record size in bytes */
        uint32_t  GetRecordSize();

        uint8_t   ReadU8(uint32_t offset);
        int8_t   ReadS8(uint32_t offset);
        uint16_t  ReadU16(uint32_t offset);
        int16_t  ReadS16(uint32_t offset);
        uint32_t  ReadU32(uint32_t offset);
        int32_t  ReadS32(uint32_t offset);
        double ReadFloat(uint32_t offset);
        /** Read a WMF RECT structure */
        fRECT ReadRectangle16(uint32_t offset);
        /** Read a EMF RECT structure */
        fRECT ReadRectangle32(uint32_t offset);

        /** Read a NUL-terminated byte string
            @param offset Position to start reading
            @param maxlength Maximum length to read, in characters (bytes)
            @return The data string, converted to Unicode32 */
        Blex::UnicodeString ReadString8(uint32_t offset, unsigned maxlength);
        /** Read a NUL-terminated Unicode16 string
            @param offset Position to start reading
            @param maxlength Maximum length to read, in characters (not bytes!)
            @return The data string, converted to Unicode32 */
        Blex::UnicodeString ReadString16(uint32_t offset, unsigned maxlength);

//        fPOINT ReadPoint(uint32_t offset);
        fPOINT ReadPoint16(uint32_t offset);
        fPOINT ReadPoint32(uint32_t offset);
        const uint8_t*  GetVerifiedBuffer(uint32_t offset, uint32_t length);

        void ReadBitmapInfo(uint32_t offset, fBITMAPINFO *bi);
        void ReadLogFontA(uint32_t offset, fLOGFONT32 *lf);
        void ReadLogFontW(uint32_t offset, fLOGFONT32 *lf);

private:
        bool    CheckFormat();
        bool    inline Validate(uint32_t offset, uint32_t length);
        const   uint8_t *buffer_start_ptr;
        uint32_t     max_offset;
        uint32_t     cur_offset;
        bool    isEmf;
};


/**
        WmfConvert is a WMF renderer that renders a buffer containing the WMF
        file data to an 32bit (R,G,B,ALPHA) bitmap of a given size. By setting
        the extents of the bitmap, a mapping is performed irrespective of the
        physical size of the bitmap.

        This class can process the following formats:
        \begin{itemize}
        \item Windows 3.1 16Bits .WMF format
        \item Windows 3.1 16Bits placable .WMF format (extra data is discarded)
        \item WIN32 32Bits .EMf format (only bitmaps)
        \end{itemize}

        Notes:
        \begin{itemize}
        \item This class is supposed to be thread-safe.. (untested)
        \item FakeGDI is used as an interface class to DrawLib
        \end{itemize}
*/

class WmfConvert
{
  public:
        WmfConvert();
        ~WmfConvert();
        /**     Go starts the rendering process.
                Some notes:
                \begin{itemize}
                \item Size of the pixel buffer is 4*dBufferX*dBufferY in bytes.
                \item Go assumes that the canvas32Bits pointer contains a valid address to a pixel buffer
                \end{itemize}

                @param pcData a pointer to the buffer containing the WMF/EMF data
                @param dDatasize length of the WMF/EMF buffer in bytes
                @param dBufferX width of the pixel buffer in pixels
                @param dBufferY height of the pixel buffer in pixels
                @param Xext logical width of the pixel buffer in logical units
                @param Yext logical height of the pixel buffer in logical units
                @param canvas32Bits a pointer to the pixel buffer
                @return returns 0 if OK else !=0
        */

        //The ultimate translation to do, which is NOT seen by the EMF/WMF rendering code and mappings as device properties
        DrawLib::XForm2D ultimate_translation;

        int32_t Go(uint8_t const *pcData, uint32_t dDatasize, DrawLib::Bitmap32 &bitmap, DrawLib::FPBoundingBox const &outputbox);

        /** Call SetViewportOrg with rescaled parameters to match the
            destination canvas */
        void SetRescaledViewportOrg(int32_t org_x, int32_t org_y);

        /** Call SetViewportExt with rescaled parameters to match the
            destination canvas */
        void SetRescaledViewportExt(int32_t ext_x, int32_t ext_y);

  private:
        bool    display_records;
        WmfDataBuffer   wmfbuffer;

        bool discovered_any_points;
        DrawLib::FPBoundingBox discovered_bbox;

        void ExecuteWMFRecord();// this is where it all happens
        void ApplyWMFRecordToBoundingBox(DrawLib::FPPoint *windoworg);
        void ExtendBBoxIfNeeded(DrawLib::FPPoint point);
        void ExecuteEMFRecord();
        DrawLib::FPBoundingBox GetWMFBoundingBox();

        DrawLib::FPBoundingBox output_bbox;

        FakeGDI GDI;            // fake GDI
        fRECT   renderrect;     //<Rectangle in which to render the metafile
        //uint32_t     dRGBbufferX;    // X-size of buffer in Pixels
        //uint32_t     dRGBbufferY;    // Y-size of buffer in Pixels
        //uint32_t     Xextent;
        //uint32_t     Yextent;
        uint8_t      *OutputBuffer;  // pointer to the output bitmap

        std::string GetIdName(uint32_t dID);       // debug routines
//        void    DumpRecord(char *filename);

        unsigned recno;         //< Current record number

        void DoEMFHeader();

        double xscale, yscale, edx, edy;
};

}
#endif //__WMFCONVERT_H
