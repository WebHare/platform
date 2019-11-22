#include <drawlib/drawlibv2/allincludes.h>


#define DUMPDIR "z:\\data\\dump\\"

#ifdef DUMPWMFFILES
#include <cstdio>
#endif


#include <blex/blexlib.h>

#include <stdexcept>
//#include "../drawlib/drawlib.h"

#include "wmf_wmfconvert.h"
#include "wmf_emfrecords.h"

using namespace WmfLib;

/** round up to nearest multiple of 2 */
inline unsigned int RoundUp2(unsigned int x)
{
        return (x+1) & 0xFFFFFFFEU;
}

WmfDataBuffer::WmfDataBuffer()
{
        buffer_start_ptr = NULL;
        max_offset = 0;
        cur_offset = 0;
        isEmf = false;
}

WmfDataBuffer::~WmfDataBuffer()
{
}

void WmfDataBuffer::Init(const uint8_t* data, uint32_t datalength)
{
        buffer_start_ptr = data;
        cur_offset = 0;
        max_offset = datalength;
        if (CheckFormat() == false)
                throw std::runtime_error("Wmflib: not a wmf/emf");
}

bool WmfDataBuffer::Validate(uint32_t offset, uint32_t length)
{
        if ((cur_offset+offset+length)>max_offset)
                throw std::runtime_error("WmfDataBuffer reports corruption!");
        if (buffer_start_ptr==NULL)
                throw std::runtime_error("WmfDataBuffer reports uninitialized buffer pointer!");
        return true;
}

// hmmm.. smells like a template...

/* Arnold: that's not that hard, since all the GetLsb functions exist in template form as well

   template <typename ReadType> ReadType WmfDataBuffer::Read(uint32_t offset)
   {
        Validate (offset, sizeof ReadType);
        ReadType = Blex::GetLsb<ReadType>(buffer_start_ptr + cur_offset+offset);
        return ReadType;
   }

   and add specialisations to transparently deal with fPoint16 structures et al
*/

uint8_t WmfDataBuffer::ReadU8(uint32_t offset)
{
        Validate(offset, 1);
        uint8_t data = Blex::getu8(buffer_start_ptr + cur_offset+offset);
        return data;
}

int8_t WmfDataBuffer::ReadS8(uint32_t offset)
{
        Validate(offset, 1);
        int8_t data = Blex::gets8(buffer_start_ptr + cur_offset+offset);
        return data;
}

uint16_t WmfDataBuffer::ReadU16(uint32_t offset)
{
        Validate(offset, 2);
        uint16_t data = Blex::getu16lsb(buffer_start_ptr + cur_offset+offset);
        return data;
}

int16_t WmfDataBuffer::ReadS16(uint32_t offset)
{
        Validate(offset, 2);
        int16_t data = Blex::gets16lsb(buffer_start_ptr + cur_offset+offset);
        return data;
}

uint32_t WmfDataBuffer::ReadU32(uint32_t offset)
{
        Validate(offset, 4);
        uint32_t data = Blex::getu32lsb(buffer_start_ptr + cur_offset+offset);
        return data;
}

int32_t WmfDataBuffer::ReadS32(uint32_t offset)
{
        Validate(offset, 4);
        int32_t data = Blex::gets32lsb(buffer_start_ptr + cur_offset+offset);
        return data;
}
fPOINT WmfDataBuffer::ReadPoint16(uint32_t offset)
{
        fPOINT data;
        Validate(offset,4);
        data.x = Blex::gets16lsb(buffer_start_ptr + cur_offset+offset);
        data.y = Blex::gets16lsb(buffer_start_ptr + cur_offset+offset+2);
        return data;
}
fPOINT WmfDataBuffer::ReadPoint32(uint32_t offset)
{
        fPOINT data;
        Validate(offset,8);
        data.x = Blex::gets32lsb(buffer_start_ptr + cur_offset+offset);
        data.y = Blex::gets32lsb(buffer_start_ptr + cur_offset+offset+4);
        return data;
}
fRECT WmfDataBuffer::ReadRectangle16(uint32_t offset)
{
        fRECT rect;
        rect.left   = ReadU16(offset);
        rect.top    = ReadU16(offset+2);
        rect.right  = ReadU16(offset+4);
        rect.bottom = ReadU16(offset+6);
        return rect;
}
fRECT WmfDataBuffer::ReadRectangle32(uint32_t offset)
{
        fRECT rect;
        rect.left   = ReadU32(offset);
        rect.top    = ReadU32(offset+4);
        rect.right  = ReadU32(offset+8);
        rect.bottom = ReadU32(offset+12);
        return rect;
}

//FIXME: does this work on bigendian machines, dunno if IEEE doubles are endian neutral???
double WmfDataBuffer::ReadFloat(uint32_t offset)
{
        float *myfloat;
        Validate(offset,4);
        myfloat = (float*)(buffer_start_ptr + cur_offset+offset);
        return static_cast<double>(*myfloat);
}

/** Read a NUL-terminated byte string */
Blex::UnicodeString WmfDataBuffer::ReadString8(uint32_t offset, unsigned maxlength)
{
        Blex::UnicodeString retval;

        //Read an ASCIIZ terminated string
        for(unsigned i=0; i<maxlength; ++i)
        {
                uint8_t newchar = ReadU8(offset+i);
                if (newchar==0) //termination
                    break;

                //ADDME: Remap Codepage 1252 to Unicode ??
                retval.push_back( newchar );
        }

        return retval;
}

/** Read a NUL-terminated Unicode16 string */
Blex::UnicodeString WmfDataBuffer::ReadString16(uint32_t offset, unsigned maxlength)
{
        Blex::UnicodeString retval;

        //Read an ASCIIZ terminated string
        for(unsigned i=0; i<maxlength; ++i)
        {
                uint16_t newchar = ReadU16(offset+i*2);
                if (newchar==0) //termination
                    break;

                //ADDME: Remap Codepage 1252 to Unicode ??
                retval.push_back( newchar );
        }

        return retval;
}

void WmfDataBuffer::ReadLogFontA(uint32_t offset, fLOGFONT32 *lf)
{
        lf->lfHeight            = ReadS16(offset);
        lf->lfWidth             = ReadS16(offset+2);
        lf->lfEscapement        = ReadS16(offset+4);
        lf->lfOrientation       = ReadS16(offset+6);
        lf->lfWeight            = ReadS16(offset+8);
        lf->lfItalic            = ReadU8(offset+10);
        lf->lfUnderline         = ReadU8(offset+11);
        lf->lfStrikeOut         = ReadU8(offset+12);
        lf->lfCharSet           = ReadU8(offset+13);
        lf->lfOutPrecision      = ReadU8(offset+14);
        lf->lfClipPrecision     = ReadU8(offset+15);
        lf->lfQuality           = ReadU8(offset+16);
        lf->lfPitchAndFamily    = ReadU8(offset+17);
        lf->lfFaceName          = ReadString8(offset+18, LF_FACESIZE);
}

void WmfDataBuffer::ReadLogFontW(uint32_t offset, fLOGFONT32 *lf)
{
        lf->lfHeight            = ReadS32(offset);
        lf->lfWidth             = ReadS32(offset+4);
        lf->lfEscapement        = ReadS32(offset+8);
        lf->lfOrientation       = ReadS32(offset+12);
        lf->lfWeight            = ReadS32(offset+16);
        lf->lfItalic            = ReadU8(offset+20);
        lf->lfUnderline         = ReadU8(offset+21);
        lf->lfStrikeOut         = ReadU8(offset+22);
        lf->lfCharSet           = ReadU8(offset+23);
        lf->lfOutPrecision      = ReadU8(offset+24);
        lf->lfClipPrecision     = ReadU8(offset+25);
        lf->lfQuality           = ReadU8(offset+26);
        lf->lfPitchAndFamily    = ReadU8(offset+27);
        lf->lfFaceName          = ReadString16(offset+28, LF_FACESIZE);
}

bool WmfDataBuffer::CheckFormat()
{
        uint32_t dwSignature;
        uint32_t emfrecordtype;
        uint16_t wSignature;

        // check the EMF record type
        emfrecordtype = ReadU32(0);
        // check the dSignature of EMF file == 0x464D4520 (intel format)
        dwSignature = ReadU32(EMF_SIGNATURE_OFFSET);
        if ((emfrecordtype==EMR_HEADER) && (dwSignature==EMF_Signature))
        {
          isEmf = true;
          return true;
        }

        // If we end up here the file is not an EMF file..
        // maybe its a placeable wmf file..
        dwSignature = ReadU32(0);
        // if placeable, skip the aldus header..

        if (dwSignature == 0x9AC6CDD7l)
        {
                #ifdef DEBUG
                DEBUGPRINT("Placeable .WMF");
                #endif
                AdvancePointer(22);
        }

        // get the WMF header type.. 1 == memory , 2 == disk
        wSignature = ReadU32(0);
        if ((wSignature==1) || (wSignature==2))
        {
                // could be a .wmf file...
                isEmf = false;
                // advance pointer to the first record
                AdvancePointer(18);
                return true;
        }
        return false;
}

void WmfDataBuffer::AdvanceToNextRecord()
{
        AdvancePointer(GetRecordSize());
}

uint32_t WmfDataBuffer::GetRecordSize()
{
        if (isEmf==true)
        {
                return ReadU32(4);
        } else return (ReadU32(0)<<1);
}

void WmfDataBuffer::AdvancePointer(uint32_t offset)
{
        cur_offset += offset;
}

uint32_t WmfDataBuffer::GetRecordID()
{
        uint32_t dID;
        if (isEmf==false)
                dID=ReadU16(4);
        else
                dID=ReadU32(0);
        return dID;
}

bool WmfDataBuffer::isLastRecord()
{
        uint32_t dID;
        // check for end of buffer..
        if (max_offset==cur_offset) return true;
        if (isEmf==false)
        {
                dID = GetRecordID();
                if (dID == 0) return true;
                else return false;
        }
        else
        {
                dID = GetRecordID();
                if (dID == EMR_EOF) return true;
                else return false;
        }
}

const uint8_t *WmfDataBuffer::GetVerifiedBuffer(uint32_t offset, uint32_t length)
{
        if (cur_offset+offset+length>max_offset)
                throw std::runtime_error("WmfDataBuffer: GetVerifiedBuffer failed - out of bounds!");
        return (buffer_start_ptr + cur_offset + offset);
}

WmfConvert::WmfConvert()
{
        display_records = true;
}

WmfConvert::~WmfConvert()
{
}

int32_t WmfConvert::Go(uint8_t const *pcData, uint32_t dDatasize, DrawLib::Bitmap32 &bitmap, DrawLib::FPBoundingBox const &bbox)
{
        #ifdef DEBUG
        DEBUGPRINT("Converting EMF/WMF... ");
        #endif
        /* Init the wmf buffer. This will also check the type of WMF
           Will throw an exception if filetype not correct! */
        recno = 0;
        wmfbuffer.Init(pcData, dDatasize);

        #ifdef DUMPWMFFILES
        std::string pre = DUMPDIR;
        std::string numberstr = Blex::AnyToString(dDatasize);
        pre.append(numberstr);
        pre.append(".wmf");
        DEBUGPRINT("Writing .WMF to [" << pre << "]");
        FILE *fout = fopen(pre.c_str(), "wb");
        if (fout!=NULL)
        {
                fwrite(pcData, 1, dDatasize, fout);
                fclose(fout);
        }
        #endif

        /* keep sizes for future reference */
        //dRGBbufferX = bitmap.GetWidth();
        //dRGBbufferY = bitmap.GetHeight();
        //OutputBuffer = bitmap.GetPointer(0);
        //Xextent = Xext;
        //Yextent = Yext;
        output_bbox = bbox;
        DEBUGPRINT("   context: to be rendered into " << output_bbox);
        GDI.SetOutputParams(&bitmap);

        if(!wmfbuffer.isEMF())
        {
                GDI.SetMapMode(MM_Text);

                //Calculate the bounding box for the WMF to allow scaling
                DrawLib::FPBoundingBox initialbbox = GetWMFBoundingBox();

                recno = 0;
                wmfbuffer.Init(pcData, dDatasize);

                DEBUGPRINT("Determined the bounding box to be " << initialbbox);

                /* How do we get from the frame to the output_bbox? (the original bounding box)
                   move the contents to topleft, rescale, move them back to the starting position of their output bbox */
                DrawLib::XForm2D frame_to_topleft = DrawLib::XForm2D(1,0,0,1, DrawLib::FPPoint(initialbbox.upper_left*-1));
                DrawLib::XForm2D frame_to_bbox = DrawLib::XForm2D(output_bbox.GetWidth() / initialbbox.GetWidth()
                                                                 ,0
                                                                 ,0
                                                                 ,output_bbox.GetHeight() / initialbbox.GetHeight()
                                                                 ,DrawLib::FPPoint(0,0)
                                                                 );
                DrawLib::XForm2D bbox_to_final = DrawLib::XForm2D(1,0,0,1, output_bbox.upper_left);
                DrawLib::XForm2D frame_to_outputbbox = frame_to_topleft * frame_to_bbox * bbox_to_final;

                DEBUGPRINT(" calculate: " << frame_to_topleft << " * " << frame_to_bbox << " * " << bbox_to_final);
                DEBUGPRINT("    result: frame_to_outputbbox: " << frame_to_outputbbox);

                DEBUGPRINT("   context: ultimate_translation to apply " << ultimate_translation);
                DrawLib::XForm2D frame_to_finalcanvas = frame_to_outputbbox * ultimate_translation;
                DEBUGPRINT("    result: frame_to_finalcanvas " << frame_to_finalcanvas);

                GDI.SetDefaultTransform(frame_to_finalcanvas);

                GDI.SetViewportExt(initialbbox.GetWidth(), initialbbox.GetHeight());
                GDI.SetWindowExt(initialbbox.GetWidth(), initialbbox.GetHeight());
        }
        else
        {
                //GDI.SetMapMode(MM_Anisotropic);
                GDI.SetMapMode(MM_Text);
        }

        display_records = true;
        /*
        if (wmfbuffer.isEMF()==true)
            canvas.Clear(DrawLib_v1::Color(0xff,0xff,0xff));
        */

        while(wmfbuffer.isLastRecord()==false)
        {
                // execute current record
                if (wmfbuffer.isEMF()==false)
                    ExecuteWMFRecord();
                else
                    ExecuteEMFRecord();

                wmfbuffer.AdvanceToNextRecord();
                ++recno;
        }
        // All was OK! return 0

        return WMFCONVERT_OK;
}


DrawLib::FPBoundingBox WmfConvert::GetWMFBoundingBox()
{
        DrawLib::FPPoint windoworg(0,0);
        discovered_any_points = false;
        discovered_bbox = DrawLib::FPBoundingBox(windoworg,windoworg);

        while(wmfbuffer.isLastRecord()==false)
        {
                ApplyWMFRecordToBoundingBox(&windoworg);
                wmfbuffer.AdvanceToNextRecord();
                ++recno;
        }
        return discovered_bbox;
}

void WmfConvert::ExtendBBoxIfNeeded(DrawLib::FPPoint point)
{
        if(!discovered_any_points)
        {
                discovered_any_points=true;
                discovered_bbox = DrawLib::FPBoundingBox(point,point);
                DEBUGPRINT("Box initialized to " << discovered_bbox << " by first point " << point);
        }
        else if(discovered_bbox.ExtendTo(point))
        {
                DEBUGPRINT("Box extended to " << discovered_bbox << " by point " << point);
        }
}

void WmfConvert::ApplyWMFRecordToBoundingBox(DrawLib::FPPoint *windoworg) //Fast, ugly hack
{
        using DrawLib::FPPoint;

        uint32_t dID = wmfbuffer.GetRecordID();
        DrawLib::Pixel32 color;

#ifdef DEBUG
        if (display_records)
            DEBUGPRINT("SCAN " << std::dec << recno << ':' << GetIdName(dID) << " RecSize = " << wmfbuffer.GetRecordSize() << " bytes");
#endif

        switch(dID)
        {
        case META_TEXTOUT:
                {
                        int16_t strlen = wmfbuffer.ReadU16(6);              // get string length
                        int32_t coordptr = (strlen+1) & 0x0FFFE;            // strip the LSB.
                        //ADDME bounding box and properly scan these...
                        ExtendBBoxIfNeeded(-*windoworg+FPPoint(windoworg->x+wmfbuffer.ReadS16(10+coordptr),windoworg->y+wmfbuffer.ReadS16(8+coordptr)));
                        break;
                }
        case META_EXTTEXTOUT:
                //ADDME bounding box and properly scan these...
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(8),wmfbuffer.ReadS16(6)));
                break;
                //
/*      ADDME: should we handle these? they don't really paint...
        case META_EXCLUDECLIPRECT:
        case META_INTERSECTCLIPRECT:
        case META_MOVETO:
        */

        case META_ELLIPSE:
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(12),wmfbuffer.ReadS16(10)));
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(8),wmfbuffer.ReadS16(6)));
                break;
        case META_LINETO:
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(8),wmfbuffer.ReadS16(6)));
                break;
        case META_PATBLT:
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(16),wmfbuffer.ReadS16(14)));
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(16)+wmfbuffer.ReadS16(12),wmfbuffer.ReadS16(14)+wmfbuffer.ReadS16(10)));
                break;
        case META_PIE:
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(20),wmfbuffer.ReadS16(18)));
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(16),wmfbuffer.ReadS16(14)));
                break;
        case META_POLYLINE:
                {
                uint32_t points = wmfbuffer.ReadU16(6);
                for(uint32_t i=0; i<points; i++)
                {
                        fPOINT p = wmfbuffer.ReadPoint16(8+(i<<2));
                        ExtendBBoxIfNeeded(-*windoworg+FPPoint(p.x,p.y));
                }
                }
                break;
        case META_POLYGON:
                {
                uint32_t points   = wmfbuffer.ReadU16(6);
                for(uint32_t i=0; i<points; i++)
                {
                        fPOINT p = wmfbuffer.ReadPoint16(8+(i<<2));
                        ExtendBBoxIfNeeded(-*windoworg+FPPoint(p.x,p.y));
                }
                }
                break;
        case META_POLYPOLYGON:
                {
                uint32_t Npolygons;
                Npolygons = wmfbuffer.ReadU16(6);
                #ifdef DEBUG
                        DEBUGPRINT("  Polygons " << Npolygons);
                #endif
                // Check the number of polygons...
                // Don't trust more than 8000 polygons...
                // Completely abitrary
                if (Npolygons>8000)
                {
                        #ifdef DEBUG
                        DEBUGPRINT("Warning! PolyPolygon bailed because of extraneous amount of polygons");
                        #endif
                        break;
                }
                // Allocate space for polygon info
                std::vector<uint32_t> Npoints;
                for(uint32_t i=0; i<Npolygons; i++)
                {
                        uint16_t points_in_poly = wmfbuffer.ReadU16(8+(i<<1));
                        Npoints.push_back(points_in_poly);
                        #ifdef DEBUG
                        DEBUGPRINT("  Points[" << i << "] " << Npoints[i]);
                        #endif
                }
                uint32_t offset = 8 + (Npolygons<<1);
                // Draw all the polygons
                std::vector<DrawLib::FPPoint> Plist;
                for(uint32_t i=0; i<Npolygons; i++)
                {
                        #ifdef DEBUG
                                DEBUGPRINT("  Data for polygon [" << i << "]");
                        #endif
                        // build point array for call to GDI.Polygon
                        //int start_index = Plist.size();                 // keep the starting point!
                        for(uint32_t j=0; j<Npoints[i]; j++)
                        {
                                fPOINT p=wmfbuffer.ReadPoint16(offset);
                                ExtendBBoxIfNeeded(-*windoworg+FPPoint(p.x,p.y));
                                offset+=4;      // 2*uint16_t !!
                        }
                }
                }
                break;
        case META_RECTANGLE:
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(12),wmfbuffer.ReadS16(10)));
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(8),wmfbuffer.ReadS16(6)));
                break;
        case META_ROUNDRECT:
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(16),wmfbuffer.ReadS16(14)));
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(12),wmfbuffer.ReadS16(10)));
                break;

        case META_SCALEVIEWPORTEXT:
                DEBUGPRINT("\aUnimplemented ScaleViewportExtex");
                break;
        case META_SCALEWINDOWEXT:
                DEBUGPRINT("\aUnimplemented ScaleWindowExtEx");
                break;
        case META_OFFSETWINDOWORG:
                DEBUGPRINT("\aUnimplemented OffsetWindowOrgEx");
                break;
        case META_OFFSETVIEWPORTORG:
                DEBUGPRINT("\aUnimplemented OffsetViewportOrgEx");
                break;
        case META_SETMAPMODE:
                DEBUGPRINT("Ignoring... mapping mode selected!" << wmfbuffer.ReadU16(6));
                break;
        case META_SETWINDOWEXT:
                /* - ADDME react to drawing instead of extents?
                   - later (earthquackes.doc): probably. at least don't respond 'too early', it totally miscalibrated the boxes, as the window origin may change later,
                                               making current extents meaningless

                */
                //ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(8),wmfbuffer.ReadS16(6)));
                break;
        case META_SETWINDOWORG:
                -*windoworg = DrawLib::FPPoint(wmfbuffer.ReadS16(8),wmfbuffer.ReadS16(6));
                DEBUGPRINT("Window origin updated to " << *windoworg);
                break;
        case META_SETVIEWPORTORG:
                DEBUGPRINT("Ignoring... setviewportorg " << wmfbuffer.ReadS16(8) << "," << wmfbuffer.ReadS16(6));
                break;
        case META_SETVIEWPORTEXT:
                DEBUGPRINT("Ignoring... setviewportext " << wmfbuffer.ReadS16(8) << "," << wmfbuffer.ReadS16(6));
                break;
        case META_STRETCHDIB:
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(26), wmfbuffer.ReadS16(24)));
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(26)+wmfbuffer.ReadS16(22), wmfbuffer.ReadS16(24)+wmfbuffer.ReadS16(20)));
               break;
        case META_DIBSTRETCHBLT:
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(24), wmfbuffer.ReadS16(22)));
                ExtendBBoxIfNeeded(-*windoworg+FPPoint(wmfbuffer.ReadS16(24)+wmfbuffer.ReadS16(20), wmfbuffer.ReadS16(22)+wmfbuffer.ReadS16(18)));
                break;
        }
}

// *************************************
// Execute WMF Record
// *************************************

void WmfConvert::ExecuteWMFRecord()
{
        uint32_t dID = wmfbuffer.GetRecordID();
        uint32_t count = 0;
        uint32_t recordsize = wmfbuffer.GetRecordSize();     // bytes
        uint16_t flag  = 0;
        DrawLib::Pixel32 color;

#ifdef DEBUG
        if (display_records)
            DEBUGPRINT(std::dec << recno << ':' << GetIdName(dID) << " RecSize = " << recordsize << " bytes");
#endif
        //if(recno>=10) return;

        switch(dID)
        {
        case META_CREATEPENINDIRECT:
                color = DrawLib::Pixel32(wmfbuffer.ReadU8(12), wmfbuffer.ReadU8(13),
                        wmfbuffer.ReadU8(14));
                GDI.CreatePenIndirect(wmfbuffer.ReadU16(6), wmfbuffer.ReadU16(8), color);
                break;
        case META_CREATEREGION:
                GDI.CreateRegion();
                break;
        case META_CREATEBRUSHINDIRECT:
                color = DrawLib::Pixel32(wmfbuffer.ReadU8(8), wmfbuffer.ReadU8(9),
                        wmfbuffer.ReadU8(10));
                GDI.CreateBrushIndirect(wmfbuffer.ReadU16(6),color,wmfbuffer.ReadU16(12));
                break;
        case META_DIBCREATEPATTERNBRUSH:
                {
                        //uint16_t brushstyle = getu16lsb(pcWmfData+6);
                        // brushstyle should be BS_PATTERN or BS_DIBPATTERN
                        // The BITMAPINFOHEADER starts at pcWmfData+10
                        // There is a palette specifier at pcWmfData+8
                        // should either be == DIB_PAL_COLORS
                        //               or == DIB_RGB_COLORS
                        // it seems that when == DIB_RGB_COLORS
                        // the BITMAPINFOHEADER only contains valid
                        // size info. The rest is just bogus info
                        #ifdef DEBUG
                        uint16_t dibcolors  = wmfbuffer.ReadU16(8);
                        if (dibcolors==DIB_PAL_COLORS) DEBUGPRINT("  Paletted bitmap");
                        if (dibcolors==DIB_RGB_COLORS) DEBUGPRINT("  RGB color bitmap");
                        DEBUGPRINT("  size      " << wmfbuffer.ReadU32(10));
                        DEBUGPRINT("  width     " << wmfbuffer.ReadS32(14));
                        DEBUGPRINT("  height    " << wmfbuffer.ReadS32(18));
                        DEBUGPRINT("  planes    " << wmfbuffer.ReadU16(22));
                        DEBUGPRINT("  bits/pix  " << wmfbuffer.ReadU16(24));
                        DEBUGPRINT("  colors    " << wmfbuffer.ReadU32(40));
                        DEBUGPRINT("  important " << wmfbuffer.ReadU32(44));
                        #endif
                        //fBITMAPINFO *bi = (fBITMAPINFO*)wmfbuffer.GetVerifiedBuffer(10, wmfbuffer.GetRecordSize()-10);
                        GDI.DIBCreatePatternBrush(wmfbuffer.GetVerifiedBuffer(10, wmfbuffer.GetRecordSize()-10), wmfbuffer.GetRecordSize()-10);
                }
                break;
        case META_CREATEPALETTE:
                GDI.CreatePalette();
                break;
        case META_CREATEFONTINDIRECT:
                {
                fLOGFONT32 lf;
                wmfbuffer.ReadLogFontA(6, &lf);                  // fill a LOGFONT structure!
                GDI.CreateFontIndirectW(-1, &lf);
                }
                break;
        case META_DELETEOBJECT:
                GDI.DeleteObject(wmfbuffer.ReadU16(6));         // get object number
                break;
        case META_ESCAPE:
                // ignore escape commands...
                // They are not interesting
                // They deal with printer settings etc.
                // Totally bullshit for this app.
                // They're not (well) documented anyway..
                break;
        case META_TEXTOUT:
                {
                int16_t strlen = wmfbuffer.ReadU16(6);              // get string length
                int32_t coordptr = (strlen+1) & 0x0FFFE;            // strip the LSB.
                GDI.ExtTextOutA(wmfbuffer.ReadS16(10+coordptr),
                               wmfbuffer.ReadS16(8+coordptr),
                               0,
                               NULL,
                               wmfbuffer.GetVerifiedBuffer(8,strlen),
                               strlen,
                               NULL);
                #ifdef DEBUG
                //DEBUGPRINT("String = %s", pcWmfData+8);
                #endif
                }
                break;
        case META_EXTTEXTOUT:
                flag = wmfbuffer.ReadU16(12);                   // get flag data
                DEBUGPRINT("flags : "  << flag);
                if ((flag & ETO_OPAQUE) || (flag & ETO_CLIPPED))
                {
                        bool WidthDataPresent = false;
                        fRECT rectangle = wmfbuffer.ReadRectangle16(14);
                        count = wmfbuffer.ReadU16(10);
                        if (recordsize > RoundUp2(22+count))
                        {
                                DEBUGPRINT("  LpDX data found (" << RoundUp2(22+count) << ")!...");
                                WidthDataPresent = true;
                        }
                        const uint16_t *lpDx = WidthDataPresent ? reinterpret_cast<const uint16_t*>(wmfbuffer.GetVerifiedBuffer(RoundUp2(22+count), count<<1)) : NULL;
                        GDI.ExtTextOutA(wmfbuffer.ReadS16(8),                            // x pos
                                        wmfbuffer.ReadS16(6),                            // y pos
                                        flag,                                            // flags
                                        &rectangle,                                      // cliprect
                                        wmfbuffer.GetVerifiedBuffer(22, count),
                                        count,                                           // char count
                                        lpDx);  // width info
                #ifdef DEBUG
                //DEBUGPRINT("String = %s", pcWmfData+22);
                #endif
                }
                else
                {
                        bool WidthDataPresent = false;
                        count = wmfbuffer.ReadU16(10);
                        if (recordsize > RoundUp2(14+count))
                        {
                                DEBUGPRINT("  LpDX data found (" << RoundUp2(14+count) << ")!...");
                                WidthDataPresent = true;
                        }
                        const uint16_t *lpDx = WidthDataPresent ? reinterpret_cast<const uint16_t*>(wmfbuffer.GetVerifiedBuffer(RoundUp2(14+count), count<<1)) : NULL;
                        GDI.ExtTextOutA(wmfbuffer.ReadS16(8),                           // x pos
                                       wmfbuffer.ReadS16(6),                            // y pos
                                       flag,                                            // flags
                                       NULL,                                            // cliprect
                                       wmfbuffer.GetVerifiedBuffer(14, count),
                                       count,                                           // char count
                                       lpDx);                                           // width info
                #ifdef DEBUG
                //DEBUGPRINT("String = %s", pcWmfData+14);
                #endif

                }
                break;
        case META_EXCLUDECLIPRECT:
                GDI.ExcludeClipRect(wmfbuffer.ReadS16(12),
                                wmfbuffer.ReadS16(10),
                                wmfbuffer.ReadS16(8),
                                wmfbuffer.ReadS16(6));
                break;
        case META_INTERSECTCLIPRECT:
                GDI.IntersectClipRect(wmfbuffer.ReadS16(12),
                                wmfbuffer.ReadS16(10),
                                wmfbuffer.ReadS16(8),
                                wmfbuffer.ReadS16(6));
                break;
        case META_ELLIPSE:
                GDI.Ellipse(wmfbuffer.ReadS16(12),
                            wmfbuffer.ReadS16(10),
                            wmfbuffer.ReadS16(8),
                            wmfbuffer.ReadS16(6));
                break;
        case META_LINETO:
                GDI.LineTo(wmfbuffer.ReadS16(8), wmfbuffer.ReadS16(6));
                break;
        case META_MOVETO:
                GDI.MoveTo(wmfbuffer.ReadS16(8), wmfbuffer.ReadS16(6));
                break;
        case META_PATBLT:
                GDI.PatBlt( wmfbuffer.ReadS16(16),
                            wmfbuffer.ReadS16(14),
                            wmfbuffer.ReadS16(12),
                            wmfbuffer.ReadS16(10),
                            wmfbuffer.ReadU32(6));
                break;
        case META_PIE:
                GDI.Pie(wmfbuffer.ReadS16(20),
                        wmfbuffer.ReadS16(18),
                        wmfbuffer.ReadS16(16),
                        wmfbuffer.ReadS16(14),
                        wmfbuffer.ReadS16(12),
                        wmfbuffer.ReadS16(10),
                        wmfbuffer.ReadS16(8),
                        wmfbuffer.ReadS16(6));
                break;
        case META_POLYLINE:
                {
                uint32_t points = wmfbuffer.ReadU16(6);
                std::vector<DrawLib::FPPoint> pnts;
                for(uint32_t i=0; i<points; i++)
                {
                        fPOINT p = wmfbuffer.ReadPoint16(8+(i<<2));
                        pnts.push_back(DrawLib::FPPoint(p.x,p.y));
                }
                GDI.PolyLine(pnts);
                }
                break;
        case META_POLYGON:
                {
                uint32_t points   = wmfbuffer.ReadU16(6);
                std::vector<DrawLib::FPPoint> Plist;
                Plist.resize(points);
                for(uint32_t i=0; i<points; i++)
                {
                        fPOINT p = wmfbuffer.ReadPoint16(8+(i<<2));
                        Plist[i] = DrawLib::FPPoint(p.x,p.y);
                }
                GDI.Polygon(Plist);
                }
                break;
        case META_POLYPOLYGON:
                {
                uint32_t Npolygons;
                Npolygons = wmfbuffer.ReadU16(6);
                #ifdef DEBUG
                        DEBUGPRINT("  Polygons " << Npolygons);
                #endif
                // Check the number of polygons...
                // Don't trust more than 8000 polygons...
                // Completely abitrary
                if (Npolygons>8000)
                {
                        #ifdef DEBUG
                        DEBUGPRINT("Warning! PolyPolygon bailed because of extraneous amount of polygons");
                        #endif
                        break;
                }
                // Allocate space for polygon info
                std::vector<uint32_t> Npoints;
                for(uint32_t i=0; i<Npolygons; i++)
                {
                        uint16_t points_in_poly = wmfbuffer.ReadU16(8+(i<<1));
                        Npoints.push_back(points_in_poly);
                        #ifdef DEBUG
                        DEBUGPRINT("  Points[" << i << "] " << Npoints[i]);
                        #endif
                }
                uint32_t offset = 8 + (Npolygons<<1);
                // Draw all the polygons
                std::vector<DrawLib::FPPoint> Plist;
                for(uint32_t i=0; i<Npolygons; i++)
                {
                        #ifdef DEBUG
                                DEBUGPRINT("  Data for polygon [" << i << "]");
                        #endif
                        // build point array for call to GDI.Polygon
                        //int start_index = Plist.size();                 // keep the starting point!
                        for(uint32_t j=0; j<Npoints[i]; j++)
                        {
                                fPOINT p=wmfbuffer.ReadPoint16(offset);
                                DEBUGPRINT("  Point ["<<j<<"] = " << DrawLib::FPPoint(p.x, p.y));
                                Plist.push_back(DrawLib::FPPoint(p.x, p.y));
                                offset+=4;      // 2*uint16_t !!
                        }
                }
                GDI.PolyPolygon(Npolygons, Npoints, Plist);
                }
                break;
        case META_RECTANGLE:
                {
                uint32_t top,bottom,left,right;
                bottom     = wmfbuffer.ReadS16(6);
                right      = wmfbuffer.ReadS16(8);
                top        = wmfbuffer.ReadS16(10);
                left       = wmfbuffer.ReadS16(12);
                fRECT rect;
                rect.left = left;
                rect.top  = top;
                rect.right = right;
                rect.bottom = bottom;
                GDI.Rectangle(rect);
                }
                break;
        case META_ROUNDRECT:
                {
                int32_t top,bottom,left,right, width, height;
                // AU: JA! bij WMF staan de argumenten omgekeerd in het geheugen!!!!!
                // daarom klopten de height en width niet!!!
                // opletten dus!
                height     = wmfbuffer.ReadS16(6);
                width      = wmfbuffer.ReadS16(8);
                bottom     = wmfbuffer.ReadS16(10);
                right      = wmfbuffer.ReadS16(12);
                top        = wmfbuffer.ReadS16(14);
                left       = wmfbuffer.ReadS16(16);
                GDI.RoundRectangle(left,top,right, bottom,width, height);
                }
                break;
        case META_SAVEDC:
                GDI.SaveDC();
                break;
        case META_RESTOREDC:
                GDI.RestoreDC(wmfbuffer.ReadS16(6));
                break;
        case META_SCALEVIEWPORTEXT:
                //DEBUGPRINT("\aUnimplemented ScaleViewportExtex");
                GDI.ScaleViewportExtent(wmfbuffer.ReadS16(12),
                        wmfbuffer.ReadS16(10),
                        wmfbuffer.ReadS16(8),
                        wmfbuffer.ReadS16(6));
                break;
        case META_SCALEWINDOWEXT:
                DEBUGPRINT("\aUnimplemented ScaleWindowExtEx");
                break;
        case META_OFFSETWINDOWORG:
                DEBUGPRINT("\aUnimplemented OffsetWindowOrgEx");
                break;
        case META_OFFSETVIEWPORTORG:
                DEBUGPRINT("\aUnimplemented OffsetViewportOrgEx");
                break;
        case META_SETROP2:
                GDI.SetROP(wmfbuffer.ReadU32(6));
                break;
        case META_SETTEXTCOLOR:
                color = DrawLib::Pixel32(wmfbuffer.ReadU8(6), wmfbuffer.ReadU8(7),
                        wmfbuffer.ReadU8(8));
                GDI.SetTextColor(color);
                break;
        case META_SETTEXTALIGN:
                GDI.SetTextAlign(wmfbuffer.ReadU16(6));
                break;
        case META_SETBKCOLOR:
                color = DrawLib::Pixel32(wmfbuffer.ReadU8(6), wmfbuffer.ReadU8(7),
                        wmfbuffer.ReadU8(8));
                GDI.SetBKColor(color);
                break;
        case META_SETBKMODE:
                GDI.SetBKMode(wmfbuffer.ReadU16(6));
                break;
        case META_SETSTRETCHBLTMODE:
                GDI.SetStretchBltMode(wmfbuffer.ReadU16(6));
                break;
        case META_SELECTOBJECT:
                GDI.SelectObject(wmfbuffer.ReadU16(6));       // get object number
                break;
        case META_SETMAPMODE:
                GDI.SetMapMode((MappingModes)wmfbuffer.ReadU16(6));          // get map mode
                break;
        case META_SETWINDOWEXT:
                GDI.SetWindowExt(wmfbuffer.ReadS16(8),wmfbuffer.ReadS16(6));
                break;
        case META_SETWINDOWORG:
                GDI.SetWindowOrg(wmfbuffer.ReadS16(8),wmfbuffer.ReadS16(6));
                break;
        case META_SETVIEWPORTORG:
                GDI.SetViewportOrg(wmfbuffer.ReadS16(8),wmfbuffer.ReadS16(6));
                break;
        case META_SETVIEWPORTEXT:
                GDI.SetViewportExt(wmfbuffer.ReadS16(8),wmfbuffer.ReadS16(6));
                break;
        case META_STRETCHDIB:
                {
                GDI.StretchDIBits(DrawLib::FPPoint(wmfbuffer.ReadS16(26), wmfbuffer.ReadS16(24))  //XDest, YDest
                                 ,DrawLib::FPSize (wmfbuffer.ReadS16(22), wmfbuffer.ReadS16(20))  //nDestWidth, nDestHeight
                                 ,DrawLib::FPPoint(wmfbuffer.ReadS16(18), wmfbuffer.ReadS16(16))  //XSrc, YSrc
                                 ,DrawLib::FPSize (wmfbuffer.ReadS16(14), wmfbuffer.ReadS16(12))  //nSrcWidth, nSrcHeight
                                 ,wmfbuffer.GetVerifiedBuffer(28, wmfbuffer.GetRecordSize()-28)   // bitmap buffer ptr
                                 ,wmfbuffer.GetRecordSize()-28                                    // bitmap buffer length!
                                 ,wmfbuffer.ReadU16(10)        // usage
                                 ,wmfbuffer.ReadU32(6));       // ROP
                }
               break;
        case META_DIBSTRETCHBLT:
                {
                GDI.StretchDIBits(DrawLib::FPPoint(wmfbuffer.ReadS16(24), wmfbuffer.ReadS16(22))  //XDest, YDest
                                 ,DrawLib::FPSize (wmfbuffer.ReadS16(20), wmfbuffer.ReadS16(18))  //nDestWidth, nDestHeight
                                 ,DrawLib::FPPoint(wmfbuffer.ReadS16(16), wmfbuffer.ReadS16(14))  //XSrc, YSrc
                                 ,DrawLib::FPSize (wmfbuffer.ReadS16(12), wmfbuffer.ReadS16(10))  //nSrcWidth, nSrcHeight
                                 ,wmfbuffer.GetVerifiedBuffer(26, wmfbuffer.GetRecordSize()-26),  // bitmap buffer ptr
                                  wmfbuffer.GetRecordSize()-26,                                   // bitmap buffer length!
                                  0,                           // usage
                                  wmfbuffer.ReadU32(6));       // ROP
                }
                break;

        case META_SETTEXTJUSTIFICATION:
                #ifdef DEBUG
                DEBUGPRINT("[Unimplemented]");
                #endif
                break;

        case META_SETPOLYFILLMODE:
                {
                uint32_t fm = wmfbuffer.ReadU16(6);
                GDI.SetPolyFillMode(fm);
                #ifdef DEBUG
                DEBUGPRINT("[Partially Unimplemented]");
                switch(fm)
                {
                case 1: DEBUGPRINT("  Fillmode = Alternate");
                        break;
                case 2: DEBUGPRINT("  Fillmode = Winding");
                        break;
                default:
                        DEBUGPRINT("  Fillmode = unknown!");
                }
                #endif
                }
                break;

        default:
                DEBUGPRINT("*** Unsupported metafile command: " << GetIdName(dID));
        }
}


// *************************************
// Execute EMF Record
// *************************************
void WmfConvert::DoEMFHeader()
{
        //Standard checks that could be moved out if we have a lookup table..
        if (wmfbuffer.GetRecordSize()<EMFHeader::RecSizeEMF)
            throw std::runtime_error("EMF header too short");

        EMFHeader hdr;
        hdr.ReadEMF(wmfbuffer.GetVerifiedBuffer(0, EMFHeader::RecSizeEMF));

        DEBUGPRINT("EMF header: original device WxH: " << hdr.device_width << " x " << hdr.device_height << " in pixels, or " << hdr.mms_width << "mm x " << hdr.mms_height << "mm");

        //The frameheight units to pixels conversion step
        double xSrcPixSize = (double(hdr.device_width) / double(hdr.mms_width));
        double ySrcPixSize = (double(hdr.device_height) / double(hdr.mms_height));

        DEBUGPRINT("EMF header: original device pixel size: x: " << xSrcPixSize << " mm/pixel, y: " << ySrcPixSize << " mm/pixel");

        DrawLib::FPBoundingBox frame_in_pixels( hdr.frame.left * xSrcPixSize/100
                                              , hdr.frame.top * ySrcPixSize/100
                                              , hdr.frame.right * xSrcPixSize/100
                                              , hdr.frame.bottom * ySrcPixSize/100
                                              );

        DEBUGPRINT("EMF header: frame in 0.01mm units: " << hdr.frame << ", in pixels: " << frame_in_pixels);

        //try to interpret the frame as the initial window extents, not as an extra conversion. see emf_initial_window_extents_1/2
/*        GDI.SetWindowOrg(0,0);
        GDI.SetWindowExt(std::ceil(frame_in_pixels.GetWidth()), std::ceil(frame_in_pixels.GetHeight()));
        GDI.SetViewportOrg(0,0);
        GDI.SetViewportExt(std::ceil(frame_in_pixels.GetWidth()), std::ceil(frame_in_pixels.GetHeight()));
*/

        /* How do we get from the frame to the output_bbox? (the original bounding box)
           move the contents to topleft, rescale, move them back to the starting position of their output bbox */
        DrawLib::XForm2D frame_to_topleft = DrawLib::XForm2D(1,0,0,1, frame_in_pixels.upper_left*-1);
        DrawLib::XForm2D frame_to_bbox = DrawLib::XForm2D(output_bbox.GetWidth() / frame_in_pixels.GetWidth()
                                                         ,0
                                                         ,0
                                                         ,output_bbox.GetHeight() / frame_in_pixels.GetHeight()
                                                         ,DrawLib::FPPoint(0,0)
                                                         );
        DrawLib::XForm2D bbox_to_final = DrawLib::XForm2D(1,0,0,1, output_bbox.upper_left);
        DrawLib::XForm2D frame_to_outputbbox = frame_to_topleft * frame_to_bbox * bbox_to_final;

        DEBUGPRINT(" calculate: " << frame_to_topleft << " * " << frame_to_bbox << " * " << bbox_to_final);
        DEBUGPRINT("    result: frame_to_outputbbox: " << frame_to_outputbbox);

        //This is the source-pixels to destination-pixels translation. other mapping modes probably require the use of xSrcPixSize and ySrcPixSize...

        DEBUGPRINT("   context: ultimate_translation to apply " << ultimate_translation);
        DrawLib::XForm2D frame_to_finalcanvas = frame_to_outputbbox * ultimate_translation;
        DEBUGPRINT("    result: frame_to_finalcanvas " << frame_to_finalcanvas);
        GDI.SetDefaultTransform(frame_to_finalcanvas);

        /*


        //NOte, hdr.bounds used to be hdr.frame, but that fails?
        int32_t framewidth = hdr.frame.right - hdr.frame.left;
        int32_t frameheight = hdr.frame.bottom - hdr.frame.top;

        float framewidthpixels = framewidth * xSrcPixSize;
        float frameheightpixels = frameheight * ySrcPixSize;

        //DrawLib::XForm2D frame_to_origin = DrawLib::XForm2D(1,0,0,1, DrawLib::FPPoint(-hdr.bounds.left,-hdr.bounds.top));
        DrawLib::XForm2D frame_to_origin = DrawLib::XForm2D(1,0,0,1, DrawLib::FPPoint(0,0));

        //ADDME: Too much drawings fall off the edge, now compensating by using -1
        //ADDME: Causes white borders, removing the -1
        //double outbox_width = std::max<double>(output_bbox.GetWidth()/ *-1* /,1);
        //double outbox_height = std::max<double>(output_bbox.GetHeight()/ *-1* /,1);

        //try to interpret the frame as the initial window extents, not as an extra conversion. see emf_initial_window_extents_1/2
        GDI.SetWindowOrg(hdr.frame.left, hdr.frame.top);
        GDI.SetWindowExt(framewidth, frameheight);


        DrawLib::XForm2D frame_scaling = DrawLib::XForm2D(1,0,0,1,DrawLib::FPPoint(0,0)); //DrawLib::XForm2D(outbox_width / (framewidth * xSrcPixSize),0,0,outbox_height / (frameheight * ySrcPixSize), DrawLib::FPPoint(0,0));
        DrawLib::XForm2D scaled_to_final = DrawLib::XForm2D(1,0,0,1,output_bbox.upper_left);

        //WAS: GDI.SetWindowExt(std::ceil(framewidth * xSrcPixSize), std::ceil(frameheight * ySrcPixSize));

        //ADDME: SetGraphicsMode(GM_ADVANCED);
        //GDI.ModifyWorldTransform(newxform, Gdi::MwtRightMultiply);

        // the size of the reference device, in pixels.
        //the reference device, in millimeters.
        DEBUGPRINT("EMF header: mms WxH: " << hdr.mms_width << " x " << hdr.mms_height);
        DEBUGPRINT("(context):  output box:" << output_bbox);
        DEBUGPRINT("EMF header: frame: " << hdr.frame);
        DEBUGPRINT("EMF header: frame_to_origin " << frame_to_origin);
        DEBUGPRINT("EMF header: frame_scaling " << frame_scaling);
        DEBUGPRINT("EMF header: scaled_to_final " << scaled_to_final);
        DEBUGPRINT("EMF header: ultimate_translation " << ultimate_translation);

        DrawLib::XForm2D result = frame_to_origin * frame_scaling * scaled_to_final * ultimate_translation;
        DEBUGPRINT("EMF header, final default transform: " << result);
        GDI.SetDefaultTransform(result);*/
}

void WmfConvert::SetRescaledViewportOrg(int32_t org_x, int32_t org_y)
{
        GDI.SetViewportOrg( (org_x - edx) * xscale, (org_y - edy)*yscale);
}

void WmfConvert::SetRescaledViewportExt(int32_t ext_x, int32_t ext_y)
{
        GDI.SetViewportExt( (ext_x - edx) * xscale, (ext_y - edy)*yscale);
}

void WmfConvert::ExecuteEMFRecord()
{
        uint32_t dID  = wmfbuffer.GetRecordID();
        DrawLib::Pixel32 color;

        if (display_records)
            DEBUGPRINT("" << std::dec << recno << ':' << GetIdName(dID));

        //Make sure record.nSize is valid
        if (wmfbuffer.GetRecordSize() < 8)
            throw std::runtime_error("Invalid EMF record");
        wmfbuffer.GetVerifiedBuffer(0,wmfbuffer.GetRecordSize());

        switch(dID)
        {
        case EMR_HEADER: //a ENHMETAHEADER structure
                if (recno != 0)
                {
                        DEBUGPRINT("Skipping duplicate EMF header\n");
                        break;
                }

                DoEMFHeader();
                break;

        case EMR_SETROP2:
                GDI.SetROP(wmfbuffer.ReadU32(8));
                break;

        case EMR_MOVETOEX:
                {
                        int32_t x,y;
                        x = wmfbuffer.ReadS32(8);
                        y = wmfbuffer.ReadS32(12);
                        GDI.MoveTo(x, y);
                }
                break;
        case EMR_LINETO:
                {
                        int32_t x,y;
                        x = wmfbuffer.ReadS32(8);
                        y = wmfbuffer.ReadS32(12);
                        GDI.LineTo(x, y);
                }
                break;
        case EMR_SETTEXTALIGN:
                GDI.SetTextAlign(wmfbuffer.ReadU32(8));
                break;

        case EMR_SETTEXTCOLOR:
                {
                        color = DrawLib::Pixel32(wmfbuffer.ReadU8(8), wmfbuffer.ReadU8(9),
                                wmfbuffer.ReadU8(10));

                        DEBUGPRINT(     "  Setting color to: " << color);

                        GDI.SetTextColor(color);
                }
                break;
       case EMR_POLYLINE16:
                {
                        uint32_t points   = wmfbuffer.ReadU32(24);
                        std::vector<DrawLib::FPPoint> Plist;
                        for(uint32_t i=0; i<points; i++)
                        {
                                fPOINT p  = wmfbuffer.ReadPoint16(28+(i<<2));
                                Plist.push_back(DrawLib::FPPoint(p.x, p.y));
                                DEBUGPRINT("Read Point " << i << " of " << points << ": " << Plist[i]);
                        }
                        GDI.PolyLine(Plist);
                }
                break;
       case EMR_POLYLINETO16:
                {
                        uint32_t points   = wmfbuffer.ReadU32(24);
                        std::vector<DrawLib::FPPoint> Plist;
                        // add the current point to the list!
                        Plist.push_back(GDI.GetCurrentPoint());
                        for(uint32_t i=0; i<points; i++)
                        {
                                fPOINT p  = wmfbuffer.ReadPoint16(28+(i<<2));
                                Plist.push_back(DrawLib::FPPoint(p.x,p.y));
                                DEBUGPRINT("Read Point " << i << " of " << points << ": " << Plist[i]);
                        }
                        GDI.PolyLine(Plist);
                        GDI.MoveTo(Plist[Plist.size()-1].x,Plist[Plist.size()-1].y);
                }
                break;
        case EMR_SETBKCOLOR:
                {
                        color = DrawLib::Pixel32(wmfbuffer.ReadU8(8), wmfbuffer.ReadU8(9),
                                wmfbuffer.ReadU8(10));

                        DEBUGPRINT(     "  Setting bkcolor to: " << color);

                        GDI.SetBKColor(color);
                }
                break;
        case EMR_SETBKMODE:
                GDI.SetBKMode(wmfbuffer.ReadU32(8));
                break;

        case EMR_SAVEDC:
                GDI.SaveDC();
                break;
        case EMR_RESTOREDC:
                GDI.RestoreDC(wmfbuffer.ReadS32(8));
                break;
        case EMR_ROUNDRECT:
                {
                        int32_t top,bottom,left,right, width, height;

                        left     = wmfbuffer.ReadS32(8);
                        top      = wmfbuffer.ReadS32(12);
                        right    = wmfbuffer.ReadS32(16);
                        bottom   = wmfbuffer.ReadS32(20);

                        width   = wmfbuffer.ReadS32(24);
                        height  = wmfbuffer.ReadS32(28);
                        GDI.RoundRectangle(left,top,right,bottom,width,height);
                }
                break;
        case EMR_RECTANGLE:
                {
                        int32_t top,bottom,left,right;
                        left     = wmfbuffer.ReadS32(8);
                        top      = wmfbuffer.ReadS32(12);
                        right    = wmfbuffer.ReadS32(16);
                        bottom   = wmfbuffer.ReadS32(20);
                        fRECT rect;
                        rect.left = left;
                        rect.top  = top;
                        rect.right = right;
                        rect.bottom = bottom;
                        GDI.Rectangle(rect);
                }
                break;

        case EMR_STRETCHDIBITS:
                {
/*typedef struct tagEMRSTRETCHDIBITS
{
    EMR   emr;         0
    RECTL rclBounds;   8
    LONG  xDest;       24
    LONG  yDest;       28
    LONG  xSrc;        32
    LONG  ySrc;        36
    LONG  cxSrc;       40
    LONG  cySrc;       44
    DWORD offBmiSrc;   48
    DWORD cbBmiSrc;    52
    DWORD offBitsSrc;  56
    DWORD cbBitsSrc;   60
    DWORD iUsageSrc;   64
    DWORD dwRop;       68
    LONG  cxDest;      72
    LONG  cyDest;      76
} EMRSTRETCHDIBITS, *PEMRSTRETCHDIBITS;*/

                        uint32_t bi2offset = wmfbuffer.ReadU32(48);
                        /* FIXME uint32_t bi2size =   wmfbuffer.ReadU32(52);  corrupts ut.doc and lots of other documents*/
                        uint32_t bi2size = wmfbuffer.GetRecordSize()-bi2offset;
                        const uint8_t* bitmapdata = wmfbuffer.GetVerifiedBuffer(bi2offset,wmfbuffer.GetRecordSize()-bi2offset);

                        //Note; we're not handling the rclBounds and xFormsrc members! or other EMRSTRETCHBLT members
                        GDI.StretchDIBits(DrawLib::FPPoint(wmfbuffer.ReadS32(24), wmfbuffer.ReadS32(28))  //XDest, YDest
                                         ,DrawLib::FPSize (wmfbuffer.ReadS32(72), wmfbuffer.ReadS32(76))  //nDestWidth, nDestHeight
                                         ,DrawLib::FPPoint(wmfbuffer.ReadS32(32), wmfbuffer.ReadS32(36))  //XSrc, YSrc
                                         ,DrawLib::FPSize (wmfbuffer.ReadS32(40), wmfbuffer.ReadS32(44))  //nSrcWidth, nSrcHeight
                                         ,bitmapdata, bi2size
                                         ,wmfbuffer.ReadU32(64)                                           // usage
                                         ,wmfbuffer.ReadU32(68));                                         // ROP
                }
                break;

        case EMR_BITBLT:
                {
/*typedef struct tagEMRBITBLT
{
    EMR      emr;             0
    RECTL    rclBounds;       8
    LONG     xDest;           24
    LONG     yDest;           28
    LONG     cxDest;          32
    LONG     cyDest;          36
    DWORD    dwRop;           40
    LONG     xSrc;            44
    LONG     ySrc;            48
    XFORM    xformSrc;        52
    COLORREF crBkColorSrc;    76
    DWORD    iUsageSrc;       80
    DWORD    offBmiSrc;       84
    DWORD    cbBmiSrc;        88
    DWORD    offBitsSrc;      92
    DWORD    cbBitsSrc;       96
} EMRBITBLT, *PEMRBITBLT;*/

                        uint32_t bi2offset = wmfbuffer.ReadU32(84);
                        uint32_t bi2size =   wmfbuffer.ReadU32(88);
                        const uint8_t* bitmapdata = wmfbuffer.GetVerifiedBuffer(bi2offset,wmfbuffer.GetRecordSize()-bi2offset);

                        GDI.StretchDIBits(DrawLib::FPPoint(wmfbuffer.ReadS32(24), wmfbuffer.ReadS32(28))  //XDest, YDest
                                         ,DrawLib::FPSize (wmfbuffer.ReadS32(32), wmfbuffer.ReadS32(36))  //nDestWidth, nDestHeight
                                         ,DrawLib::FPPoint(wmfbuffer.ReadS32(44), wmfbuffer.ReadS32(48))  //XSrc, YSrc
                                         ,DrawLib::FPSize (0, 0)  //nSrcWidth, nSrcHeight
                                         ,bitmapdata, bi2size
                                         ,wmfbuffer.ReadU32(80)                                           // usage
                                         ,wmfbuffer.ReadU32(40));                                         // ROP
                }
                break;

        case EMR_STRETCHBLT:
                {
/*typedef struct tagEMRSTRETCHBLT
{
    EMR      emr;            0
    RECTL    rclBounds;      8
    LONG     xDest;         24
    LONG     yDest;         28
    LONG     cxDest;        32
    LONG     cyDest;        36
    DWORD    dwRop;         40
    LONG     xSrc;          44
    LONG     ySrc;          48
    XFORM    xformSrc;      52
    COLORREF crBkColorSrc;  76
    DWORD    iUsageSrc;     80
    DWORD    offBmiSrc;     84
    DWORD    cbBmiSrc;      88
    DWORD    offBitsSrc;    92
    DWORD    cbBitsSrc;     96
    LONG     cxSrc;        100
    LONG     cySrc;        104
} EMRSTRETCHBLT, *PEMRSTRETCHBLT;
*/

                        uint32_t bi2offset = wmfbuffer.ReadU32(84);
                        uint32_t bi2size =   wmfbuffer.ReadU32(88);
                        const uint8_t* bitmapdata = wmfbuffer.GetVerifiedBuffer(bi2offset,wmfbuffer.GetRecordSize()-bi2offset);

                        GDI.StretchDIBits(DrawLib::FPPoint(wmfbuffer.ReadS32(24), wmfbuffer.ReadS32(28))  //XDest, YDest
                                         ,DrawLib::FPSize (wmfbuffer.ReadS32(32), wmfbuffer.ReadS32(36))  //nDestWidth, nDestHeight
                                         ,DrawLib::FPPoint(wmfbuffer.ReadS32(44), wmfbuffer.ReadS32(48))  //XSrc, YSrc
                                         ,DrawLib::FPSize (wmfbuffer.ReadS32(100), wmfbuffer.ReadS32(104))  //nSrcWidth, nSrcHeight
                                         ,bitmapdata, bi2size
                                         ,wmfbuffer.ReadU32(80)                                           // usage
                                         ,wmfbuffer.ReadU32(40));                                         // ROP
                }
                break;

        case EMR_INTERSECTCLIPRECT:
                {
                        int32_t top,bottom,left,right;
                        left     = wmfbuffer.ReadS32(8);
                        top      = wmfbuffer.ReadS32(12);
                        right    = wmfbuffer.ReadS32(16);
                        bottom   = wmfbuffer.ReadS32(20);
                        GDI.IntersectClipRect(left,top,right,bottom);
                }
                break;
        case EMR_EXCLUDECLIPRECT:
                {
                        int32_t top,bottom,left,right;
                        left     = wmfbuffer.ReadS32(8);
                        top      = wmfbuffer.ReadS32(12);
                        right    = wmfbuffer.ReadS32(16);
                        bottom   = wmfbuffer.ReadS32(20);
                        GDI.ExcludeClipRect(left,top,right,bottom);
                }
                break;

        case EMR_SETWINDOWORGEX:
                GDI.SetWindowOrg(wmfbuffer.ReadS32(8),wmfbuffer.ReadS32(12));
                break;

        case EMR_SETWINDOWEXTEX:
                GDI.SetWindowExt(wmfbuffer.ReadS32(8),wmfbuffer.ReadS32(12));
                break;

        case EMR_SETVIEWPORTORGEX:
                //FIXME: is this correct???
                //SetRescaledViewportOrg(wmfbuffer.ReadS32(8),wmfbuffer.ReadS32(12));
                GDI.SetViewportOrg(wmfbuffer.ReadS32(8),wmfbuffer.ReadS32(12));
                break;

        case EMR_SETVIEWPORTEXTEX:
                //FIXME: is this correct??
                //SetRescaledViewportExt(wmfbuffer.ReadS32(8),wmfbuffer.ReadS32(12));
                GDI.SetViewportExt(wmfbuffer.ReadS32(8),wmfbuffer.ReadS32(12));
                break;

        case EMR_SETSTRETCHBLTMODE:
                GDI.SetStretchBltMode(wmfbuffer.ReadU32(8));
                break;

        case EMR_ELLIPSE:
                GDI.Ellipse(wmfbuffer.ReadS32(8),
                            wmfbuffer.ReadS32(12),
                            wmfbuffer.ReadS32(16),
                            wmfbuffer.ReadS32(20));
                break;
        case EMR_EXTTEXTOUTW: //EMRTEXT  TextOut
                {
                        fRECT rectangle = wmfbuffer.ReadRectangle32(8);
                         //RECTL   rclBounds;
                        fRECT rectangle2; //RECTL   rclBounds;

                        //FIXME: This print crashes.
                        //DEBUGPRINT("TextRectBounds: " << rectangle);

                        //uint32_t iGraphicsMode    = wmfbuffer.ReadU32(24); //dunno (flags?)??
                        //FLOAT xscale (on 32 bits... I assume?)
                        //FLOAT yscale (on 32 bits... I assume?)
                        uint32_t x = wmfbuffer.ReadU32(36);
                        uint32_t y = wmfbuffer.ReadU32(40);
                        DEBUGPRINT("TextPosition: : " << x << "," << y);
                        uint32_t length = wmfbuffer.ReadU32(44);
                        DEBUGPRINT("Text Length: : " << length);
                        uint32_t offset = wmfbuffer.ReadU32(48);
                        DEBUGPRINT("Text Offset: : " << offset);
                        uint32_t flags = wmfbuffer.ReadU32(52);

                        rectangle2 = wmfbuffer.ReadRectangle32(56);
                        DEBUGPRINT("Text FlagBounds: : " << rectangle2);
                        DEBUGPRINT("Text Offset DX " << wmfbuffer.ReadU32(72));
                        GDI.ExtTextOutW(x,
                                        y,
                                        flags,
                                        &rectangle,
                                        (const uint16_t*)wmfbuffer.GetVerifiedBuffer(offset, length),
                                        length,
                                        NULL);

                }
                break;
        case EMR_POLYGON16:
                {
                        //skip RECLT (8, 12, 16, 20) //seems like it is 16 bit though!
                        uint32_t points   = wmfbuffer.ReadU32(24);
                        std::vector<DrawLib::FPPoint> Plist;
                        Plist.resize(points);
                        for(uint32_t i=0; i<points; i++)
                        {
                                fPOINT p = wmfbuffer.ReadPoint16(28+(i<<2));
                                Plist[i]= DrawLib::FPPoint(p.x, p.y);
                        }
                        /*
                        Plist[points] = startpoint;
                        */
                        #ifdef DEBUG
                        DEBUGPRINT("Lekker EMF!");
                        #endif
                        GDI.Polygon(Plist);
                }
                break;
        case EMR_POLYPOLYGON16:
                {
                        //skip RECLT (8, 12, 16, 20) //seems like it is 16 bit though!
                        uint32_t nPolys      = wmfbuffer.ReadU32(24);
                        uint32_t totalPoints = wmfbuffer.ReadU32(28);
                        DEBUGPRINT("PolyPolygon16 nPolys: " << nPolys << "  tPoints " << totalPoints);
                        int offset=32;
                        std::vector<uint32_t> pointsPerPoly;
                        for(uint32_t i=0; i<nPolys; i++)
                        {
                                uint32_t p  = wmfbuffer.ReadU32(offset);
                                pointsPerPoly.push_back(p);
                                DEBUGPRINT("There are " << p << " points in polygon " << i);
                                offset += 4;
                        }
                        std::vector<DrawLib::FPPoint> pointsArray;
                        for(uint32_t i=0; i<totalPoints; i++)
                        {
                                fPOINT p =wmfbuffer.ReadPoint16(offset);
                                pointsArray.push_back(DrawLib::FPPoint(p.x, p.y));
                                offset += 4; //2x 16 bit
                        }
                        GDI.PolyPolygon(nPolys, pointsPerPoly, pointsArray);
                }
                break;
        case EMR_POLYBEZIER16:
                {
                        //0 EMR    emr;
                        //8 RECTL  rclBounds;
                        //24  DWORD  cpts;
                        //28  POINTL apts[1];
                        std::vector<DrawLib::FPPoint> Plist;
                        uint32_t offset = 28;
                        uint32_t cpts = wmfbuffer.ReadU32(24);

                        DEBUGPRINT("  Control points = "  << cpts);

                        for(uint32_t i=0; i<cpts; i++)
                        {
                                fPOINT p = wmfbuffer.ReadPoint16(offset);
                                Plist.push_back(DrawLib::FPPoint(p.x, p.y));
                                DEBUGPRINT("  points = "  << Plist[i]);
                                offset+=4;
                        }
                        GDI.PolyBezier(Plist);
                }
                break;
        case EMR_POLYBEZIERTO16:
                {
                        //0 EMR    emr;
                        //8 RECTL  rclBounds;
                        //24  DWORD  cpts;
                        //28  POINTL apts[1];
                        std::vector<DrawLib::FPPoint> Plist;
                        uint32_t offset = 28;
                        uint32_t cpts = wmfbuffer.ReadU32(24);

                        DEBUGPRINT("  Control points = "  << cpts);
                        for(uint32_t i=0; i<cpts; i++)
                        {
                                fPOINT p = wmfbuffer.ReadPoint16(offset);
                                Plist.push_back(DrawLib::FPPoint(p.x, p.y));
                                DEBUGPRINT("  points = "  << Plist[i]);
                                offset+=4;
                        }
                        GDI.PolyBezierTo(Plist);
                        }
                break;
        case EMR_CREATEBRUSHINDIRECT:
                {
                        uint32_t index = wmfbuffer.ReadU32( 8);
                        uint32_t style = wmfbuffer.ReadU32(12);
                        color = DrawLib::Pixel32(wmfbuffer.ReadU8(16), wmfbuffer.ReadU8(17),
                                wmfbuffer.ReadU8(18));
                        uint32_t hatch = wmfbuffer.ReadU32(20);     //or 19 ??

                        GDI.CreateBrushIndirect(index, style, color, hatch);
                }
                break;
                // FIXME: implement this record correctly!!
        case EMR_CREATEMONOBRUSH:
        case EMR_CREATEDIBPATTERNBRUSHPT:
                {
                        uint32_t index  = wmfbuffer.ReadU32( 8);
                        uint32_t header_offset = wmfbuffer.ReadU32(16);

                        DEBUGPRINT("  bitmap header offset " << header_offset);
                        DEBUGPRINT("  bitmap header size   " << wmfbuffer.ReadU32(20));
                        DEBUGPRINT("  bitmap pixels offset " << wmfbuffer.ReadU32(24));
                        DEBUGPRINT("  bitmap pixels size   " << wmfbuffer.ReadU32(28));
                        DEBUGPRINT("  bitmap usage         " << wmfbuffer.ReadU32(12));

                        GDI.DIBCreatePatternBrush(index,wmfbuffer.GetVerifiedBuffer(header_offset, wmfbuffer.GetRecordSize()-header_offset), wmfbuffer.GetRecordSize()-header_offset);
                }
                break;
        case EMR_CREATEPEN:
                {
                        uint32_t index = wmfbuffer.ReadU32( 8);
                        uint32_t style = wmfbuffer.ReadU32(12);
                        uint32_t width = wmfbuffer.ReadU32(16);
                        color = DrawLib::Pixel32(wmfbuffer.ReadU8(24), wmfbuffer.ReadU8(25),
                                wmfbuffer.ReadU8(26));

                        GDI.CreatePen(index, style, width, color);
                        //GDI.CreatePenIndirect(style, width, color);
                }
                break;
        case EMR_EXTCREATEPEN:
                {
                        /* Win32 call format:

                         8  DWORD     ihPen;
                         12 DWORD     offBmi;
                         16 DWORD     cbBmi;
                         20 DWORD     offBits;
                         24 DWORD     cbBits;
                         28 EXTLOGPEN elp;

                            EXTLOGPEN =
                         28 UINT     elpPenStyle;
                         32 UINT     elpWidth;
                         36 UINT     elpBrushStyle;
                         40 COLORREF elpColor;
                         44 LONG     elpHatch;
                         48 DWORD    elpNumEntries;
                         52 DWORD    elpStyleEntry[1];
                        */
                        uint32_t index = wmfbuffer.ReadU32(8);
                        uint32_t style = wmfbuffer.ReadU32(28);
                        uint32_t width = wmfbuffer.ReadU32(32);
                        color = DrawLib::Pixel32(wmfbuffer.ReadU8(40), wmfbuffer.ReadU8(41),
                                wmfbuffer.ReadU8(42));
                        // PS_STYLE_MASK = 0x0000000F
                        GDI.CreatePen(index, style & 0x0000000F, width, color);
                }
                break;
        case EMR_EXTCREATEFONTINDIRECTW:
                {
                        //fixme: fix this hack
                        /* win32 dox:
                           8  LONG      lfHeight;
                          12  LONG      lfWidth;
                          16  LONG      lfEscapement;
                          20  LONG      lfOrientation;
                          24  LONG      lfWeight;
                          28  BYTE      lfItalic;
                          29  BYTE      lfUnderline;
                          30  BYTE      lfStrikeOut;
                          31  BYTE      lfCharSet;
                          32  BYTE      lfOutPrecision;
                          33  BYTE      lfClipPrecision;
                          34  BYTE      lfQuality;
                          35  BYTE      lfPitchAndFamily;
                          36..  WCHAR     lfFaceName[LF_FACESIZE];
                        */
                        fLOGFONT32 lf;
                        uint32_t index = wmfbuffer.ReadU32(8);
                        wmfbuffer.ReadLogFontW(12,&lf);
                        GDI.CreateFontIndirectW(index, &lf);
                }
                break;
        case EMR_SELECTOBJECT:
                {
                        GDI.SelectObject(wmfbuffer.ReadU32(8));       // get object number
                }
                break;
        case EMR_DELETEOBJECT:
                {
                        GDI.DeleteObject(wmfbuffer.ReadU32(8));       // get object number
                }
                break;
        case EMR_CREATEPALETTE:
                {
                        uint32_t ihPal = wmfbuffer.ReadU32(8);
                        DEBUGPRINT("  Palette handle " << ihPal);
                        DEBUGPRINT("  WARNING: This function creates dummy palettes!");
                        GDI.CreatePalette(ihPal);
                }
                break;
        case EMR_SELECTPALETTE:
                {
                        uint32_t ihPal = wmfbuffer.ReadU32(8);
                        DEBUGPRINT("  Palette handle " << ihPal);
                        DEBUGPRINT("  WARNING: This function does nothing!");
                        GDI.SelectObject(ihPal);
                }
                break;
        case EMR_GDICOMMENT:
                {
                }
                break;
        case EMR_SETMAPMODE:
                {
                        #ifdef DEBUG
                        DEBUGPRINT("Mapmode " <<  wmfbuffer.ReadU32(8));
                        #endif
                        GDI.SetMapMode((MappingModes)wmfbuffer.ReadU32(8));          // get map mode
                }
                break;
        case EMR_BEGINPATH:
                GDI.BeginPath();
                break;
        case EMR_ENDPATH:
                GDI.EndPath();
                break;
        case EMR_CLOSEFIGURE:
                GDI.ClosePath();
                break;
        case EMR_FILLPATH:
                GDI.StrokeFillPath(false, true);
                break;
        case EMR_STROKEANDFILLPATH:
                GDI.StrokeFillPath(true, true);
                break;
        case EMR_STROKEPATH:
                GDI.StrokeFillPath(true, false);
                break;
        case EMR_SETWORLDTRANSFORM:
                {
                        DrawLib::XForm2D wt;
                        wt.eM11 = wmfbuffer.ReadFloat(8);
                        wt.eM12 = wmfbuffer.ReadFloat(12);
                        wt.eM21 = wmfbuffer.ReadFloat(16);
                        wt.eM22 = wmfbuffer.ReadFloat(20);
                        wt.translation.x = wmfbuffer.ReadFloat(24);
                        wt.translation.y = wmfbuffer.ReadFloat(28);
                        GDI.SetWorldTransform(wt);
                }
                break;
        case EMR_MODIFYWORLDTRANSFORM:
                {
                        DrawLib::XForm2D wt;
                        wt.eM11 = wmfbuffer.ReadFloat(8);
                        wt.eM12 = wmfbuffer.ReadFloat(12);
                        wt.eM21 = wmfbuffer.ReadFloat(16);
                        wt.eM22 = wmfbuffer.ReadFloat(20);
                        wt.translation.x = wmfbuffer.ReadFloat(24);
                        wt.translation.y = wmfbuffer.ReadFloat(28);
                        unsigned int imode = wmfbuffer.ReadU32(32);
                        GDI.ModifyWorldTransform(wt, (Gdi::ModificationMode)imode);
                }
                break;
        case EMR_SETPOLYFILLMODE:
                {
                uint32_t fm = wmfbuffer.ReadU32(8);
                GDI.SetPolyFillMode(fm);
                #ifdef DEBUG
                DEBUGPRINT("[Partially Unimplemented]");
                switch(fm)
                {
                case 1: DEBUGPRINT("  Fillmode = Alternate");
                        break;
                case 2: DEBUGPRINT("  Fillmode = Winding");
                        break;
                default:
                        DEBUGPRINT("  Fillmode = unknown!");
                }
                #endif
                }
                break;
        case EMR_EXTSELECTCLIPRGN:
                {
                        //ADDME: Clip region data follows
                        DEBUGPRINT("  Not parsing " << wmfbuffer.ReadU32(8) << " bytes of clipping data (ADDME!)");
                        GDI.ExtSelectClipRgn(wmfbuffer.ReadU32(8), wmfbuffer.ReadS32(12));
                }
                break;

        default:
                DEBUGPRINT("*** Unsupported EMF command: " << GetIdName(dID));
        }
}


#ifdef DEBUG
/*
void WmfConvert::DumpRecord(char *filename)
{
        using namespace std;
        FILE *dumpfile;
        uint32_t  recordsize;

        dumpfile = fopen(filename,"wb");
        if (dumpfile==NULL) return;
        if (isEMF == 0)
          recordsize = getu32lsb(pcWmfData) << 1;
        else
          recordsize = getu32lsb(pcWmfData+4);
        if (isEMF==0) fwrite(pcWmfData+6,sizeof(uint8_t), recordsize,dumpfile);
        else fwrite(pcWmfData+8,sizeof(uint8_t), recordsize, dumpfile);

        fclose(dumpfile);
}
*/
std::string WmfConvert::GetIdName(uint32_t dID)
{
        if (wmfbuffer.isEMF()==0)
        {
                switch(dID)
                {
                case META_SETBKCOLOR:                   return "SETBKCOLOR";
                case META_SETBKMODE:                    return "SETBKMODE";
                case META_SETMAPMODE:                   return "SETMAPMODE";
                case META_SETROP2:                      return "SETROP2";
                case META_SETRELABS:                    return "SETRELABS";
                case META_SETPOLYFILLMODE:              return "SETPOLYFILLMODE";
                case META_SETSTRETCHBLTMODE:            return "SETSTRETCHBLTMODE";
                case META_SETTEXTCHAREXTRA:             return "SETTEXTCHAREXTRA";
                case META_SETTEXTCOLOR:                 return "SETTEXTCOLOR";
                case META_SETTEXTJUSTIFICATION:         return "SETTEXTJUSTIFICATION";
                case META_SETWINDOWORG:                 return "SETWINDOWORG";
                case META_SETWINDOWEXT:                 return "SETWINDOWEXT";
                case META_SETVIEWPORTORG:               return "SETVIEWPORTORG";
                case META_SETVIEWPORTEXT:               return "SETVIEWPORTEXT";
                case META_OFFSETWINDOWORG:              return "OFFSETWINDOWORG";
                case META_SCALEWINDOWEXT:               return "SCALEWINDOWEXT";
                case META_OFFSETVIEWPORTORG:            return "OFFSETVIEWPORTORG";
                case META_SCALEVIEWPORTEXT:             return "SCALEVIEWPORTEXT";
                case META_LINETO:                       return "LINETO";
                case META_MOVETO:                       return "MOVETO";
                case META_EXCLUDECLIPRECT:              return "EXCLUDECLIPRECT";
                case META_INTERSECTCLIPRECT:            return "INTERSECTCLIPRECT";
                case META_ARC:                          return "ARC";
                case META_ELLIPSE:                      return "ELLIPSE";
                case META_FLOODFILL:                    return "FLOODFILL";
                case META_PIE:                          return "PIE";
                case META_RECTANGLE:                    return "RECTANGLE";
                case META_ROUNDRECT:                    return "ROUNDRECT";
                case META_PATBLT:                       return "PATBLT";
                case META_SAVEDC:                       return "SAVEDC";
                case META_SETPIXEL:                     return "SETPIXEL";
                case META_OFFSETCLIPRGN:                return "OFFSETCLIPRGN";
                case META_TEXTOUT:                      return "TEXTOUT";
                case META_BITBLT:                       return "BITBLT";
                case META_STRETCHBLT:                   return "STRETCHBLT";
                case META_POLYGON:                      return "POLYGON";
                case META_POLYLINE:                     return "POLYLINE";
                case META_ESCAPE:                       return "ESCAPE";
                case META_RESTOREDC:                    return "RESTOREDC";
                case META_FILLREGION:                   return "FILLREGION";
                case META_FRAMEREGION:                  return "FRAMEREGION";
                case META_INVERTREGION:                 return "INVERTREGION";
                case META_PAINTREGION:                  return "PAINTREGION";
                case META_SELECTCLIPREGION:             return "SELECTCLIPREGION";
                case META_SELECTOBJECT:                 return "SELECTOBJECT";
                case META_SETTEXTALIGN:                 return "SETTEXTALIGN";
                case META_CHORD:                        return "CHORD";
                case META_SETMAPPERFLAGS:               return "SETMAPPERFLAGS";
                case META_EXTTEXTOUT:                   return "EXTTEXTOUT";
                case META_SETDIBTODEV:                  return "SETDIBTODEV";
                case META_SELECTPALETTE:                return "SELECTPALETTE";
                case META_REALIZEPALETTE:               return "REALIZEPALETTE";
                case META_ANIMATEPALETTE:               return "ANIMATEPALETTE";
                case META_SETPALENTRIES:                return "SETPALENTRIES";
                case META_POLYPOLYGON:                  return "POLYPOLYGON";
                case META_RESIZEPALETTE:                return "RESIZEPALETTE";
                case META_DIBBITBLT:                    return "DIBBITBLT";
                case META_DIBSTRETCHBLT:                return "DIBSTRETCHBLT";
                case META_DIBCREATEPATTERNBRUSH:        return "DIBCREATEPATTERNBRUSH";
                case META_STRETCHDIB:                   return "STRETCHDIB";
                case META_EXTFLOODFILL:                 return "EXTFLOODFILL";
                case META_SETLAYOUT:                    return "SETLAYOUT";
                case META_DELETEOBJECT:                 return "DELETEOBJECT";
                case META_CREATEPALETTE:                return "CREATEPALETTE";
                case META_CREATEPATTERNBRUSH:           return "CREATEPATTERNBRUSH";
                case META_CREATEPENINDIRECT:            return "CREATEPENINDIRECT";
                case META_CREATEFONTINDIRECT:           return "CREATEFONTINDIRECT";
                case META_CREATEBRUSHINDIRECT:          return "CREATEBRUSHINDIRECT";
                case META_CREATEREGION:                 return "CREATEREGION";
                default:                                return "WMF unknown " + Blex::AnyToString(dID);
                }
        }
        else
        {
                switch(dID)
                {
                case EMR_HEADER:                        return "EMF header";
                case EMR_POLYBEZIER:                    return "PolyBezier";
                case EMR_POLYGON:                       return "Polygon";
                case EMR_POLYLINE:                      return "Polyline";
                case EMR_POLYBEZIERTO:                  return "PolyBezieto";
                case EMR_POLYLINETO:                    return "PolyLineto";
                case EMR_POLYPOLYLINE:                  return "PolyPolyline";
                case EMR_POLYPOLYGON:                   return "PolyPolygon";
                case EMR_SETWINDOWEXTEX:                return "SETWINDOWEXTEX";
                case EMR_SETWINDOWORGEX:                return "SETWINDOWORGEX";
                case EMR_SETVIEWPORTEXTEX:              return "SETVIEWPORTEXTEX";
                case EMR_SETVIEWPORTORGEX:              return "SETVIEWPORTORGEX";
                case EMR_SETBRUSHORGEX:                 return "SETBRUSHORGEX";
                case EMR_EOF:                           return "EMF eof";
                case EMR_SETPIXELV:                     return "SETPIXELV";
                case EMR_SETMAPPERFLAGS:                return "SETMAPPERFLAGS";
                case EMR_SETMAPMODE:                    return "SETMAPMODE";
                case EMR_SETBKMODE:                     return "SETBKMODE";
                case EMR_SETPOLYFILLMODE:               return "SETPOLYFILLMODE";
                case EMR_SETROP2:                       return "SETROP2";
                case EMR_SETSTRETCHBLTMODE:             return "SETSTRETCHBLTMODE";
                case EMR_SETTEXTALIGN:                  return "SETTEXTALIGN";
                case EMR_SETCOLORADJUSTMENT:            return "SETCOLORADJUSTMENT";
                case EMR_SETTEXTCOLOR:                  return "SETTEXTCOLOR";
                case EMR_SETBKCOLOR:                    return "SETBKCOLOR";
                case EMR_OFFSETCLIPRGN:                 return "OFFSETCLIPRGN";
                case EMR_MOVETOEX:                      return "MOVETOEX";
                case EMR_SETMETARGN:                    return "SETMETARGN";
                case EMR_EXCLUDECLIPRECT:               return "EXCLUDECLIPRECT";
                case EMR_INTERSECTCLIPRECT:             return "INTERSECTCLIPRECT";
                case EMR_SCALEVIEWPORTEXTEX:            return "SCALEVIEWPORTEXTEX";
                case EMR_SCALEWINDOWEXTEX:              return "SCALEWINDOWEXTEX";
                case EMR_SAVEDC:                        return "SAVEDC";
                case EMR_RESTOREDC:                     return "RESTOREDC";
                case EMR_SETWORLDTRANSFORM:             return "SETWORLDTRANSFORM";
                case EMR_MODIFYWORLDTRANSFORM:          return "MODIFYWORLDTRANSFORM";
                case EMR_SELECTOBJECT:                  return "SELECTOBJECT";
                case EMR_CREATEPEN:                     return "CREATEPEN";
                case EMR_CREATEBRUSHINDIRECT:           return "CREATEBRUSHINDIRECT";
                case EMR_DELETEOBJECT:                  return "DELETEOBJECT";
                case EMR_ANGLEARC:                      return "ANGLEARC";
                case EMR_ELLIPSE:                       return "ELLIPSE";
                case EMR_RECTANGLE:                     return "RECTANGLE";
                case EMR_ROUNDRECT:                     return "ROUNDRECT";
                case EMR_ARC:                           return "ARC";
                case EMR_CHORD:                         return "CHORD";
                case EMR_PIE:                           return "PIE";
                case EMR_SELECTPALETTE:                 return "SELECTPALETTE";
                case EMR_CREATEPALETTE:                 return "CREATEPALETTE";
                case EMR_SETPALETTEENTRIES:             return "SETPALETTEENTRIES";
                case EMR_RESIZEPALETTE:                 return "RESIZEPALETTE";
                case EMR_REALIZEPALETTE:                return "REALIZEPALETTE";
                case EMR_EXTFLOODFILL:                  return "EXTFLOODFILL";
                case EMR_LINETO:                        return "LINETO";
                case EMR_ARCTO:                         return "ARCTO";
                case EMR_POLYDRAW:                      return "POLYDRAW";
                case EMR_SETARCDIRECTION:               return "SETARCDIRECTION";
                case EMR_SETMITERLIMIT:                 return "SETMITERLIMIT";
                case EMR_BEGINPATH:                     return "BEGINPATH";
                case EMR_ENDPATH:                       return "ENDPATH";
                case EMR_CLOSEFIGURE:                   return "CLOSEFIGURE";
                case EMR_FILLPATH:                      return "FILLPATH";
                case EMR_STROKEANDFILLPATH:             return "STROKEANDFILLPATH";
                case EMR_STROKEPATH:                    return "STROKEPATH";
                case EMR_FLATTENPATH:                   return "FLATTENPATH";
                case EMR_WIDENPATH:                     return "WIDENPATH";
                case EMR_SELECTCLIPPATH:                return "SELECTCLIPPATH";
                case EMR_ABORTPATH:                     return "ABORTPATH";
                case EMR_GDICOMMENT:                    return "GDICOMMENT";
                case EMR_FILLRGN:                       return "FILLRGN";
                case EMR_FRAMERGN:                      return "FRAMERGN";
                case EMR_INVERTRGN:                     return "INVERTRGN";
                case EMR_PAINTRGN:                      return "PAINTRGN";
                case EMR_EXTSELECTCLIPRGN:              return "EXTSELECTCLIPRGN";
                case EMR_BITBLT:                        return "BITBLT";
                case EMR_STRETCHBLT:                    return "STRETCHBLT";
                case EMR_MASKBLT:                       return "MASKBLT";
                case EMR_PLGBLT:                        return "PLGBLT";
                case EMR_SETDIBITSTODEVICE:             return "SETDIBITSTODEVICE";
                case EMR_STRETCHDIBITS:                 return "STRETCHDIBITS";
                case EMR_EXTCREATEFONTINDIRECTW:        return "EXTCREATEFONTINDIRECTW";
                case EMR_EXTTEXTOUTA:                   return "EXTTEXTOUTA";
                case EMR_EXTTEXTOUTW:                   return "EXTTEXTOUTW";
                case EMR_POLYBEZIER16:                  return "POLYBEZIER16";
                case EMR_POLYGON16:                     return "POLYGON16";
                case EMR_POLYLINE16:                    return "POLYLINE16";
                case EMR_POLYBEZIERTO16:                return "POLYBEZIERTO16";
                case EMR_POLYLINETO16:                  return "POLYLINETO16";
                case EMR_POLYPOLYLINE16:                return "POLYPOLYLINE16";
                case EMR_POLYPOLYGON16:                 return "POLYPOLYGON16";
                case EMR_POLYDRAW16:                    return "POLYDRAW16";
                case EMR_CREATEMONOBRUSH:               return "CREATEMONOBRUSH";
                case EMR_CREATEDIBPATTERNBRUSHPT:       return "CREATEDIBPATTERNBRUSHPT";
                case EMR_EXTCREATEPEN:                  return "EXTCREATEPEN";
                case EMR_POLYTEXTOUTA:                  return "POLYTEXTOUTA";
                case EMR_POLYTEXTOUTW:                  return "POLYTEXTOUTW";
                case EMR_RESERVED_105:                  return "RESERVED_105";
                case EMR_RESERVED_106:                  return "RESERVED_106";
                case EMR_RESERVED_107:                  return "RESERVED_107";
                case EMR_RESERVED_108:                  return "RESERVED_108";
                case EMR_RESERVED_109:                  return "RESERVED_109";
                case EMR_RESERVED_110:                  return "RESERVED_110";
                case EMR_COLORCORRECTPALETTE:           return "COLORCORRECTPALETTE";
                case EMR_SETICMPROFILEA:                return "SETICMPROFILEA";
                case EMR_SETICMPROFILEW:                return "SETICMPROFILEW";
                case EMR_ALPHABLEND:                    return "ALPHABLEND";
                case EMR_SETLAYOUT:                     return "SetLayout";
                case EMR_TRANSPARENTBLT:                return "TransparentBlt";
                case EMR_GRADIENTFILL:                  return "GradientFill";
                case EMR_RESERVED_119:                  return "RESERVED_119";
                case EMR_RESERVED_120:                  return "RESERVED_120";
                case EMR_COLORMATCHTOTARGETW:           return "ColorMatchToTargetW";
                case EMR_CREATECOLORSPACEW:             return "CreateColorSpaceW";
                case EMR_SETICMMODE:                    return "SetIcmMode";
                case EMR_CREATECOLORSPACE:              return "CreateColorSpace";
                case EMR_SETCOLORSPACE:                 return "SetColorSpace";
                case EMR_DELETECOLORSPACE:              return "DeleteColorSpace";
                case EMR_GLSRECORD:                     return "GLSRecord";
                case EMR_GLSBOUNDEDRECORD:              return "GLSBoundedRecord";
                case EMR_PIXELFORMAT:                   return "PixelFormat";
                default:                                return "EMF unknown " + Blex::AnyToString(dID);
                }
        }
}

#endif // DEBUG
