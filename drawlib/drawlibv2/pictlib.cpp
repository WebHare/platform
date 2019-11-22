#include <drawlib/drawlibv2/allincludes.h>


#include "pictlib.h"
#include "bitmapmanip.h"

/* SPECIFICATION AT:
  http://developer.apple.com/documentation/mac/QuickDraw/QuickDraw-461.html#HEADING461-0
*/

using namespace PictLib;
using namespace Blex;

PictConvert::PictConvert()
{
}

std::vector<uint8_t> PictConvert::ExpandPackedBits(const uint32_t rowbytes, uint32_t offset, uint32_t *bytes_read)
{
        std::vector<uint8_t> bits;
        bool count_is_word = false;
        if (rowbytes > 250)
                count_is_word = true;

        uint32_t total_bytes_read = 0;
        uint16_t compressed_bytes_read = 0;
        uint16_t compressed_bytes = 0;


        uint8_t *data_ptr = databuffer + offset;
        if (count_is_word)
        {
                compressed_bytes = getu16msb(data_ptr);
                data_ptr+=2;
                total_bytes_read+= 2;
        }
        else
        {
                compressed_bytes = getu8(data_ptr);
                data_ptr++;
                total_bytes_read++;
        }

        if (compressed_bytes==0)
        {
                bytes_read=0;
                return bits;       // error!
        }

        //DEBUGPRINT("  compressed bytes = " <<compressed_bytes);

        while(compressed_bytes_read < compressed_bytes)
        {
                int8_t repcount = gets8(data_ptr);

                total_bytes_read++;
                compressed_bytes_read++;
                data_ptr++;

                //DEBUGPRINT("    repeat = " <<repcount);

                if (repcount < 0)
                {
                        uint32_t repeatc = static_cast<uint32_t>(-repcount + 1);
                        for(unsigned int i=0; i<repeatc; i++)
                        {
                                uint8_t data = getu8(data_ptr);
                                bits.push_back(data);
                        }
                        total_bytes_read++;
                        data_ptr++;
                        compressed_bytes_read++;
                }
                else
                {
                        uint32_t repeatc = static_cast<uint32_t>(repcount + 1);
                        for(unsigned int i=0; i<repeatc; i++)
                        {
                                uint8_t data = getu8(data_ptr);
                                bits.push_back(data);
                                total_bytes_read++;
                                data_ptr++;
                                compressed_bytes_read++;
                        }
                }
        }
        *bytes_read = total_bytes_read;
        return bits;
}



static const int opcode_sizes[256] =
//special values: -1: unknown length, -2: 2+data length, -3: 4+ data length
// 0   1   2   3   4   5   6   7   8   9   A   B   C   D   E   F
{  0, -1,  8,  2,  1,  2,  4,  4,  2,  8,  8,  4,  4,  2,  4,  4   // 0
,  8,  1, -1, -1, -1,  2,  2, -1, -1, -1,  6,  6,  0,  6,  0,  6   // 1
,  8,  4,  6,  2, -2, -2, -2, -2, -1, -1, -1, -1, -1, 10, -2, -2   // 2
,  8,  8,  8,  8,  8,  8,  8,  8,  0,  0,  0,  0,  0,  0,  0,  0   // 3
,  8,  8,  8,  8,  8,  8,  8,  8,  0,  0,  0,  0,  0,  0,  0,  0   // 4
,  8,  8,  8,  8,  8,  8,  8,  8,  0,  0,  0,  0,  0,  0,  0,  0   // 5
, 12, 12, 12, 12, 12, 12, 12, 12,  4,  4,  4,  4,  4,  4,  4,  4   // 6
, -2, -2, -2, -2, -2, -2, -2, -2,  0,  0,  0,  0,  0,  0,  0,  0   // 7
, -1, -1, -1, -1, -1, -1, -1, -1,  0,  0,  0,  0,  0,  0,  0,  0   // 8
, -1, -1, -2, -2, -2, -2, -2, -2, -1, -1, -1, -1, -1, -1, -1, -1   // 9
,  2, -1, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2   // A
,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0   // B
,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0   // C
, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3   // D
, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3   // E
, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3,  2   // F
};

unsigned PictConvert::GetRealOpcodeSize(unsigned opcode, unsigned reported_size, unsigned offset_into_buffer)
{
        if ((opcode >= 0x0100) && (opcode <= 0x7FFF))
            return (opcode >> 8) * 2;

        if ((opcode >= 0x8000) && (opcode <= 0x80FF))
            return 0;

        if ((opcode >= 0x8100) && (opcode <= 0xFFFF))
            return ReadU32(offset_into_buffer+2)+4;

        int realsize = opcode_sizes[opcode];
        if (realsize==-1)
            return reported_size;
        if(realsize>=0)
           return unsigned(realsize);
        if(realsize==-2)
            return ReadU16(offset_into_buffer+2)+2;
        if(realsize==-3)
            return ReadU32(offset_into_buffer+2)+4;

        throw std::runtime_error("Unknown size encountered in PICT opcode table");
}


//FIXME: Support outputbox!
void PictConvert::Go(uint8_t const *pictdata, uint32_t length, DrawLib::Bitmap32 &thebitmap, DrawLib::FPBoundingBox const &/*outputbox*/)
{
        datalength = length;
        databuffer = const_cast<uint8_t*>(pictdata);//FIXME!
        DEBUGPRINT("Pict length = "<<length);

        mybitmap = &thebitmap;
        mycanvas.reset(new DrawLib::Canvas32(&thebitmap));
        drobj.reset(new DrawLib::DrawObject(mycanvas.get()));

        //drobj->Clear(DrawLib::Pixel32(0,0,0,255));

        /* Setup a currentfont! */
        CurrentFont.reset(DrawLib::GetGlobalFontManager().CreateFontFromFile("Arial", "Regular"));

        /* init background and foreground colors*/
        CurrentPenPos = DrawLib::FPPoint(0,0);
        foreground = DrawLib::Pixel32(0,0,0,255);
        background = DrawLib::Pixel32(0,0,0,255);

        //Read the header
        int32_t ClipLeft  = ReadS16(4);
        int32_t ClipUpper = ReadS16(2);
        int32_t ClipRight = ReadS16(8);
        int32_t ClipBottom = ReadS16(6);

        ClipSize = DrawLib::FPSize(ClipRight - ClipLeft, ClipBottom - ClipUpper);
        ClipUpperLeft = DrawLib::FPPoint(ClipLeft, ClipUpper);
        DEBUGPRINT("Bounding rectangle, upperleft = " << ClipUpperLeft << ", size = " << ClipSize);

        if ((ClipSize.width == 0) || (ClipSize.height==0))
                throw(std::runtime_error("PICT has invalid clippig size"));

        // there should be a VersionOp opcode now...
        // if not.. the format is incorrect!
        if (ReadU16(10)!=0x0011)
                throw(std::runtime_error("Incorrect PICT format!"));

        // read the version opcode's data!
        switch(ReadU16(12))
        {
        case 0x02FF:
                DEBUGPRINT("Version 2");
                break;
        default:
                DEBUGPRINT("Version 1 or other.. (code= " << getu16msb(pictdata+12));
                throw(std::runtime_error("Unsupported version 1 PICT"));
        }

        //uint8_t *op_ptr = pictdata+40;
        uint32_t offset_into_buffer = 14;
        {
                uint16_t opcode = ReadU16(offset_into_buffer);
                while((opcode!=0x00FF) && (offset_into_buffer < length))
                {
                        DEBUGPRINT("Opcode " << opcode);
                        uint32_t reported_size= ExecuteOpcode(offset_into_buffer);
                        uint32_t realsize = GetRealOpcodeSize(opcode, reported_size, offset_into_buffer) + 2;

                        // opcodes are word aligned.
                        // so adjust if necessary.
                        if ((realsize& 0x01) == 1)
                                realsize++;
                        offset_into_buffer += realsize;

                        // read new opcode..
                        opcode = ReadU16(offset_into_buffer);
                }
        }
}

uint32_t PictConvert::ExecuteOpcode(uint32_t offset_into_buffer)
{
        uint16_t opcode = ReadU16(offset_into_buffer);
        switch(opcode)
        {
        case 0x12:
        case 0x13:
        case 0x14:
        case 0x17:
        case 0x18:
        case 0x19:
        case 0x80: case 0x81: case 0x82: case 0x83: case 0x84: case 0x85: case 0x86: case 0x87:
        case 0x90: case 0x91: case 0x99: case 0x9B: case 0x9C: case 0x9D: case 0x9E: case 0x9F:
                throw(std::runtime_error("Unknown and unskippable opcode encountered in PICT!"));


        case 0x000:
                DEBUGPRINT("NOT IMPLEMENTED: NOP");
                return 0;

        case 0x001:
                {
                        uint32_t size = ReadU16(offset_into_buffer+2);
                        DEBUGPRINT("Clip region datasize = " << size);

                        if(size==10)
                        {
                                DrawLib::FPPoint p1(ReadS16(offset_into_buffer+6), ReadS16(offset_into_buffer+4));
                                DrawLib::FPPoint p2(ReadS16(offset_into_buffer+10), ReadS16(offset_into_buffer+8));
                                DEBUGPRINT("Region " << p1 << " to " << p2);
                        }
                        return size;
                }
        case 0x003:
                DEBUGPRINT("TxFont Font number = " << ReadS16(offset_into_buffer+2));
                return 2;
        case 0x004:
                {
                DEBUGPRINT("TxFace");
#ifdef DEBUG
                uint8_t style = ReadU8(offset_into_buffer+2);
                DEBUGPRINT("  Face style  = " << style);
                if ((style & 1)>0)
                        DEBUGPRINT("Bold");
                if ((style & 2)>0)
                        DEBUGPRINT("Italic");
                if ((style & 4)>0)
                        DEBUGPRINT("Underlined");
                if ((style & 8)>0)
                        DEBUGPRINT("Outlined");
                if ((style & 16)>0)
                        DEBUGPRINT("Shadowed");
                if ((style & 32)>0)
                        DEBUGPRINT("Condensed");
                if ((style & 64)>0)
                        DEBUGPRINT("Extended");
#endif
                }
                return 1;
        case 0x005:
                DEBUGPRINT("TxMode [*]");
                return 2;
        case 0x006:
                DEBUGPRINT("Extra Space [*]");
                return 4;
        case 0x007:
                DEBUGPRINT("PenSize [*] size = ["<<ReadS16(offset_into_buffer+4)<<","<<ReadS16(offset_into_buffer+2)<<"]");
                return 4;
        case 0x008:
                DEBUGPRINT("PenMode [*] mode = "<< ReadS16(offset_into_buffer+2));
                /*
                        Known PenModes:
                        8  - patCopy -  where pen pattern is black, apply foreground.
                                        where pen pattern is white, apply background.
                        9  - patOr   -  where pen pattern is black, invert destination pixel.
                                        where pen pattern is white, leave unaltered.
                        .. more docco to come ..
                */
                /*
                switch(ReadS16(op_ptr+2))
                {
                case 8:
                        drobj->SetOutlineColor(foreground);
                        drobj->SetFillColor(foreground);
                        drobj->GetCanvasNonConstPtr()->SetBinaryMode(DrawLib::Canvas32::DEFAULT);
                        DEBUGPRINT("  BinaryMode = DEFAULT");
                        break;
                case 9:
                        drobj->SetOutlineColor(DrawLib::Pixel32(0,0,0));
                        drobj->SetFillColor(DrawLib::Pixel32(0,0,0));
                        drobj->GetCanvasNonConstPtr()->SetBinaryMode(DrawLib::Canvas32::OR);
                        DEBUGPRINT("  BinaryMode = OR");
                        break;
                default:
                        drobj->SetOutlineColor(foreground);
                        drobj->SetFillColor(foreground);
                        drobj->GetCanvasNonConstPtr()->SetBinaryMode(DrawLib::Canvas32::DEFAULT);
                        DEBUGPRINT("  BinaryMode = DEFAULT");
                        break;
                } */
                return 2;
        case 0x009:
                DEBUGPRINT("Pen pattern - NOT IMPLEMENTED!");
                return 8;
        case 0x00A:
                DEBUGPRINT("Fill pattern - NOT IMPLEMENTED!");
                return 8;
        case 0x00D:
                {
                DrawLib::FPSize textsize(ReadS16(offset_into_buffer+2),ReadS16(offset_into_buffer+2));
                DEBUGPRINT("TxSize size = " << textsize);
                textsize = LogicalSize2LocalSize(textsize);
		if (CurrentFont.get())
	                CurrentFont->SetSize(textsize);
                }
                return 2;
        case 0x010:
                DEBUGPRINT("TxRatio [*]");
                return 8;
        case 0x01e:
                DEBUGPRINT("DefHilite [*]");
                return 0;
        case 0x01a:
                foreground.SetRGBA(
                        ReadU8(offset_into_buffer+2),        // two times uint8_t (duplicate)
                        ReadU8(offset_into_buffer+4),
                        ReadU8(offset_into_buffer+6),
                        0);

                DEBUGPRINT("RBGFgCol " << foreground);
                drobj->SetOutlineColor(foreground);
                drobj->SetFillColor(foreground);
                return 6;
        case 0x01b:
                background.SetRGBA(
                        ReadU8(offset_into_buffer+2),        // two times uint8_t (duplicate)
                        ReadU8(offset_into_buffer+4),
                        ReadU8(offset_into_buffer+6),
                        0);
                DEBUGPRINT("RBGBkCol " << background);
                //drobj->SetOutlineColor(foreground);
                //drobj->SetFillColor(foreground);
                return 6;
        case 0x01f:
                DEBUGPRINT("OpColor " << DrawLib::Pixel32(ReadU8(offset_into_buffer+2), ReadU8(offset_into_buffer+4), ReadU8(offset_into_buffer+6)));
                return 6;
        case 0x020:
                {
                DEBUGPRINT("Line");
                DrawLib::FPPoint startpoint(ReadS16(offset_into_buffer+4), ReadS16(offset_into_buffer+2));
                DrawLib::FPPoint endpoint(ReadS16(offset_into_buffer+8), ReadS16(offset_into_buffer+6));
                CurrentPenPos = endpoint;

                startpoint = Logical2Local(startpoint);
                endpoint   = Logical2Local(endpoint);

                DEBUGPRINT(" From  = " << startpoint << ", to   = " << endpoint);
                drobj->DrawLine(startpoint, endpoint);
                }
                return 10;
        case 0x021:
                {
                DEBUGPRINT("LineFrom");
                /* look like this is actually LineTo... huh?? stupid, no docco..*/
                DrawLib::FPPoint startpoint(CurrentPenPos);
                DrawLib::FPPoint endpoint(ReadS16(offset_into_buffer+4), ReadS16(offset_into_buffer+2));
                startpoint = Logical2Local(startpoint);
                endpoint = Logical2Local(endpoint);
                DEBUGPRINT("  CurPenPos " << startpoint << " end " << endpoint);
                drobj->DrawLine(startpoint, endpoint);
                /*DrawLib::Path path;
                path.MoveTo(startpoint);
                path.LineTo(endpoint);
                DrawLib::StrokePath(path);*/
                return 6;
                }
        case 0x022:
                {
                DEBUGPRINT("ShortLine");
                DrawLib::FPPoint startpoint(ReadS16(offset_into_buffer+4), ReadS16(offset_into_buffer+2));
                DrawLib::FPPoint endpoint(startpoint);
                endpoint.x += ReadS8(offset_into_buffer+6);
                endpoint.y += ReadS8(offset_into_buffer+7);
                CurrentPenPos = endpoint;

                startpoint = Logical2Local(startpoint);
                endpoint   = Logical2Local(endpoint);
                DEBUGPRINT("  From " << startpoint << " to " << endpoint);
                drobj->DrawLine(startpoint, endpoint);
                }
                return 8;
        case 0x023:
                DEBUGPRINT("ShortLineFrom");
                {
                DrawLib::FPPoint startpoint(CurrentPenPos);
                DrawLib::FPPoint endpoint(CurrentPenPos);
                endpoint.x += ReadS8(offset_into_buffer+2);
                endpoint.y += ReadS8(offset_into_buffer+3);

                CurrentPenPos = endpoint;

                startpoint = Logical2Local(startpoint);
                endpoint   = Logical2Local(endpoint);
                DEBUGPRINT("  From " << startpoint << " to " << endpoint);
                drobj->DrawLine(startpoint, endpoint);
                }
                return 4;
        case 0x028:
                {
                DEBUGPRINT("LongText");
                DrawLib::FPPoint textpos(ReadS16(offset_into_buffer+4),ReadS16(offset_into_buffer+2));
                CurrentPenPos = textpos;       // is this correct????
                textpos = Logical2Local(textpos);
                uint32_t textlen = ReadU8(offset_into_buffer+6);

                Blex::UnicodeString textstring;
                for(unsigned int i=0; i<textlen; i++)
                {
                        textstring.push_back(ReadU8(offset_into_buffer+7+i));
                }
                std::vector<double> deltas;      // dummy!
		if(CurrentFont.get())
                drobj->DrawTextExtended(textpos, textstring, *CurrentFont, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);
                return 5+textlen;
                }
        case 0x029:
                {
                DEBUGPRINT("DHText");
                uint32_t textlen = ReadU8(offset_into_buffer+3);

                DrawLib::FPPoint textpos(CurrentPenPos);
                textpos.x += ReadS8(offset_into_buffer+2);
                CurrentPenPos = textpos;
                textpos = Logical2Local(textpos);

                DEBUGPRINT("  position " << textpos);

                Blex::UnicodeString textstring;
                for(unsigned int i=0; i<textlen; i++)
                {
                        textstring.push_back(ReadU8(offset_into_buffer+4+i));
                }
                std::vector<double> deltas;      // dummy!
		if(CurrentFont.get())
                drobj->DrawTextExtended(textpos, textstring, *CurrentFont, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);

                return 2+textlen;
                }
        case 0x02a:
                {
                DEBUGPRINT("DVText");
                uint32_t textlen = ReadU8(offset_into_buffer+3);

                DrawLib::FPPoint textpos(CurrentPenPos);
                textpos.y += ReadS8(offset_into_buffer+2);
                CurrentPenPos = textpos;
                textpos = Logical2Local(textpos);

                DEBUGPRINT("  position " << textpos);

                Blex::UnicodeString textstring;
                for(unsigned int i=0; i<textlen; i++)
                {
                        textstring.push_back(ReadU8(offset_into_buffer+4+i));
                }
                std::vector<double> deltas;      // dummy!
		if(CurrentFont.get())
                drobj->DrawTextExtended(textpos, textstring, *CurrentFont, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);

                return 2+textlen;
                }

        case 0x02b:
                {
                DEBUGPRINT("DHDVText");
                uint32_t textlen = ReadU8(offset_into_buffer+4);

                DrawLib::FPPoint textpos(CurrentPenPos);
                textpos.x += ReadS8(offset_into_buffer+2);
                textpos.y += ReadS8(offset_into_buffer+3);
                CurrentPenPos = textpos;
                textpos = Logical2Local(textpos);

                DEBUGPRINT("  position " << textpos);

                Blex::UnicodeString textstring;
                for(unsigned int i=0; i<textlen; i++)
                {
                        textstring.push_back(ReadU8(offset_into_buffer+5+i));
                }
                std::vector<double> deltas;      // dummy!
		if(CurrentFont.get())
                drobj->DrawTextExtended(textpos, textstring, *CurrentFont, deltas, false, DrawLib::TextRenderer::LEFT, DrawLib::TextRenderer::BASELINE, 0.0, 0.0, 0.0);
                return 3+textlen;
                }
        case 0x02c:
                {
                        DEBUGPRINT("Font name [*]");
                        DEBUGPRINT("size = " << ReadU16(offset_into_buffer+2));
                        DEBUGPRINT("old_font_id = " << ReadU16(offset_into_buffer+4));
                        uint32_t namelen = ReadU8(offset_into_buffer+6);

                        std::string name;
                        for(unsigned int i=0; i<namelen; i++)
                            name.push_back(ReadU8(offset_into_buffer+7+i));

                        DEBUGPRINT("  name=" << name);
                        return namelen+5;
                }
        case 0x02e:
                {
                //The Apple documentation on this call seems to be wrong: it takes 6 bytes, not 8
                uint32_t size = ReadU16(offset_into_buffer+2);
                DEBUGPRINT("glyphState [*] datasize = " << size);
                return 4+size;
                }
        case 0x030:
                {
                DEBUGPRINT("frameRect");
                DrawLib::FPPoint p1(ReadS16(offset_into_buffer+4), ReadS16(offset_into_buffer+2));
                DrawLib::FPPoint p2(ReadS16(offset_into_buffer+8), ReadS16(offset_into_buffer+6));
                p1 = Logical2Local(p1);
                p2 = Logical2Local(p2);
                drobj->DrawRectangleOutline(p1, p2);
                LastRect1 = p1;
                LastRect2 = p2;
                return 10;
                }
        case 0x031:
                {
                DEBUGPRINT("paintRect");
                DrawLib::FPPoint p1(ReadS16(offset_into_buffer+4), ReadS16(offset_into_buffer+2));
                DrawLib::FPPoint p2(ReadS16(offset_into_buffer+8), ReadS16(offset_into_buffer+6));
                p1 = Logical2Local(p1);
                p2 = Logical2Local(p2);
                drobj->DrawRectangle(p1, p2);
                LastRect1 = p1;
                LastRect2 = p2;
                return 10;
                }
        case 0x038:
                DEBUGPRINT("frameSameRect");
                drobj->DrawRectangleOutline(LastRect1,LastRect2);
                return 2;
        case 0x05c:
                DEBUGPRINT("fillSameOval [*]");
                return 2;
        case 0x061:
                DEBUGPRINT("paintArc [*]");
                return 14;
        case 0x068:
                DEBUGPRINT("frameSameArc [*]");
                return 6;
        case 0x069:
                DEBUGPRINT("paintSameArc [*]");
                return 6;
        case 0x070:
                {
                uint32_t size = ReadU16(offset_into_buffer+2);
                DEBUGPRINT("FramePoly");
                DEBUGPRINT("  size = " << size << " rect = " << ReadS16(offset_into_buffer+6) << " , " << ReadS16(offset_into_buffer+4) << " , " << ReadS16(offset_into_buffer+10) << " , " << ReadS16(offset_into_buffer+8));

                uint32_t points = (size - 10) / 4;
                DrawLib::PolyLine mypolyline;
                mypolyline.points.resize(points);
                for(unsigned int i=0; i<points; i++)
                {
                        double x = ReadS16(offset_into_buffer+12+i*4+2);
                        double y = ReadS16(offset_into_buffer+12+i*4);
                        DrawLib::FPPoint mypoint(x,y);
                        mypolyline.points[i] = Logical2Local(mypoint);
                        DEBUGPRINT("  " << mypolyline.points[i]);
                }
                drobj->DrawPolyLine(mypolyline, 1);
                return size;
                }
        case 0x071:
                {
                uint32_t size = ReadU16(offset_into_buffer+2);
                DEBUGPRINT("PaintPoly");
                DEBUGPRINT("  size = " << size << " rect = " << ReadS16(offset_into_buffer+6) << " , " << ReadS16(offset_into_buffer+4) << " , " << ReadS16(offset_into_buffer+10) << " , " << ReadS16(offset_into_buffer+8));

                uint32_t points = (size - 10) / 4;
                DrawLib::Polygon mypolygon;
                mypolygon.points.resize(points);
                for(unsigned int i=0; i<points; i++)
                {
                        double x = ReadS16(offset_into_buffer+12+i*4+2);
                        double y = ReadS16(offset_into_buffer+12+i*4);
                        DrawLib::FPPoint mypoint(x,y);
                        mypolygon.points[i] = Logical2Local(mypoint);
                        DEBUGPRINT("  " << mypolygon.points[i]);
                }
                drobj->DrawPolygon(mypolygon);
                return size;
                }

        case 0x0A1:
                {
                        DEBUGPRINT("Long comment");

                        DEBUGPRINT("  kind = " << ReadU16(offset_into_buffer+2));
                        uint32_t size = ReadU16(offset_into_buffer+4);
                        DEBUGPRINT("  size = " << size);

                        uint32_t length = 4 + size;

                        return length;
                }

        case 0x098:
                {
                DEBUGPRINT("PackBitsRect");
                /* Record layout (looks like PixMap):
                Offset  Field           Size(bytes)
                2       RowBytes        2
                4       Bound           Rectangle (4*2) = 8
                12      packtype        2
                14      version         2 (uuhh.. doccu suggests packtype comes after version!)
                16      packsize        4
                20      hres            4
                24      vres            4
                28      pixeltype       2
                30      pixelsize       2
                32      cmpCount        2
                34      cmpSize         2
                36      planeBytes      4
                40      pmTable         4
                44      pmReserved      4
                48
                */
                uint16_t rowbytes = ReadU16(offset_into_buffer+2);

                DrawLib::IPoint bound_ul(ReadS16(offset_into_buffer+6), ReadS16(offset_into_buffer+4));
                DrawLib::IPoint bound_lr(ReadS16(offset_into_buffer+10), ReadS16(offset_into_buffer+8));

                DrawLib::ISize bitmapsize(bound_lr.x - bound_ul.x,bound_lr.y - bound_ul.y);

                /* if highest bit of rowbytes == 1 then bitmap has more than 1 bit/pixel*/
                bool multicolor = (rowbytes & 0x08000) > 0;

                DrawLib::Bitmap32 mybitmap(bitmapsize.width, bitmapsize.height);

                DEBUGPRINT("  Bitmap size = " << bitmapsize);
                DEBUGPRINT("  RowBytes = " << (rowbytes & 0x3FFF));
                if (multicolor)
                    DEBUGPRINT("  PixMap is multicolored");
                else
                    DEBUGPRINT("  PixMap is black-white");
                DEBUGPRINT("  packtype    = " << ReadU16(offset_into_buffer+12));
                DEBUGPRINT("  version     = " << ReadU16(offset_into_buffer+14));
                DEBUGPRINT("  packsize    = " << ReadU32(offset_into_buffer+16));
                DEBUGPRINT("  hres        = " << static_cast<double>(ReadU32(offset_into_buffer+20)) / 65536.0 << " DPI");
                DEBUGPRINT("  vres        = " << static_cast<double>(ReadU32(offset_into_buffer+24)) / 65536.0 << " DPI");
                DEBUGPRINT("  pixeltype   = " << ReadU16(offset_into_buffer+28));
                DEBUGPRINT("  pixelsize   = " << ReadU16(offset_into_buffer+30));
                DEBUGPRINT("  cmpCount    = " << ReadU16(offset_into_buffer+32));
                DEBUGPRINT("  cmpSize     = " << ReadU16(offset_into_buffer+34));
                DEBUGPRINT("  planeBytes  = " << ReadU32(offset_into_buffer+36));
                DEBUGPRINT("  pmTable     = " << ReadU32(offset_into_buffer+40));
                DEBUGPRINT("  pmReserved  = " << ReadU32(offset_into_buffer+44));
                DEBUGPRINT("--------------------------");

                if (ReadU16(offset_into_buffer+12)!=0)
                        throw(std::runtime_error("PackBitsRect unsupported packing!"));

                /* color table layout ..

                offset  field           Size(bytes)
                48      ctSeed          4
                52      ctFlags         2
                54      ctSize          2
                56      .. color table entries (8 bytes per entry)
                        0000 - RRRR - GGGG - BBBB
                ..
                */

                uint32_t tablesize = ReadU16(offset_into_buffer+54);

                DEBUGPRINT("  Color table size = " <<tablesize+1);

                std::vector<DrawLib::Pixel32> ColorTable;
                ColorTable.reserve(tablesize+1);
                for(uint32_t i=0; i<(tablesize+1); i++)
                {
                        uint8_t r = ReadU8(offset_into_buffer+58+(i*8));
                        uint8_t g = ReadU8(offset_into_buffer+60+(i*8));
                        uint8_t b = ReadU8(offset_into_buffer+62+(i*8));
                        DrawLib::Pixel32 mycolor(r,g,b);
                        ColorTable.push_back(mycolor);
                }

                uint32_t offset = 56 + (tablesize+1) * 8;
                /* now we have:

                Offset          Field           Size
                ------------------------------------
                offset          srcRect         8
                offset+8        destRect        8
                offset+16        Blitmode        2
                */

                DEBUGPRINT("  blitmode = " << ReadU16(offset_into_buffer+offset+16));

                DrawLib::FPPoint srcRectUL(ReadS16(offset_into_buffer+offset+2),
                        ReadS16(offset_into_buffer+offset));
                DrawLib::FPPoint srcRectLR(ReadS16(offset_into_buffer+offset+6),
                        ReadS16(offset_into_buffer+offset+4));

                DrawLib::FPPoint dstRectUL(ReadS16(offset_into_buffer+offset+10),
                        ReadS16(offset_into_buffer+offset+8));
                DrawLib::FPPoint dstRectLR(ReadS16(offset_into_buffer+offset+14),
                        ReadS16(offset_into_buffer+offset+12));

                dstRectUL = Logical2Local(dstRectUL);
                dstRectLR = Logical2Local(dstRectLR);

                DEBUGPRINT("  dstRect = " << dstRectUL << " - " << dstRectLR);
                DEBUGPRINT("  srcRect = " << srcRectUL << " - " << srcRectLR);

                offset+=18;
                uint32_t result = 0;
                DrawLib::Scanline32 myscanline(bitmapsize.width, true);
                for(int l=0; l<bitmapsize.height; l++)
                {
                        std::vector<uint8_t> rowdata;
                        rowdata = ExpandPackedBits(rowbytes & 0x3FFF, offset_into_buffer+offset, &result);
                        offset+=result;
                        // translate through the color table!
                        for(int x=0; x<bitmapsize.width; x++)
                        {
                                uint8_t color_index = rowdata[x];
                                DrawLib::Pixel32 color = ColorTable[color_index];
                                myscanline.Pixel(x) = color;
                                                        }
                        mybitmap.SetScanline32(l, myscanline);
                }

                // stretch it to the right size!
                std::unique_ptr<DrawLib::Bitmap32 > stretched_bitmap;
                DrawLib::ISize newsize(
                        abs((int)dstRectLR.x - (int)dstRectUL.x),
                        abs((int)dstRectLR.y - (int)dstRectUL.y));
                DEBUGPRINT("  resizing bitmap to " << newsize);
                stretched_bitmap.reset(DrawLib::CreateResizedBitmap(mybitmap, newsize));

                //set the DrawObject texture to the resized bitmap!
                DrawLib::IPoint texture_offset(dstRectUL.x, dstRectUL.y);
                drobj->SetFillTexture(stretched_bitmap.get(), texture_offset);
                drobj->SetFillMode(DrawLib::DrawObject::TEXTURED);
                drobj->DrawRectangle(dstRectUL, dstRectLR);
                drobj->SetFillMode(DrawLib::DrawObject::SOLID);
                return offset-2;
                }
        case 0x09a:
                {
                DEBUGPRINT("DirectBitsRect");
                /* Record layout (looks like PixMap):
                Offset  Field           Size(bytes)
                2       BaseAddess      4       (should read 000000FF)
                6       RowBytes        2
                8       Bound           Rectangle (4*2) = 8
                16      packtype        2
                18      version         2 (uuhh.. doccu suggests packtype comes after version!)
                20      packsize        4
                24      hres            4
                28      vres            4
                32      pixeltype       2
                34      pixelsize       2
                36      cmpCount        2
                38      cmpSize         2
                40      planeBytes      4
                44      pmTable         4
                48      pmReserved      4
                52
                */

                uint16_t rowbytes = ReadU16(offset_into_buffer+6);

                DrawLib::IPoint bound_ul(ReadS16(offset_into_buffer+10), ReadS16(offset_into_buffer+8));
                DrawLib::IPoint bound_lr(ReadS16(offset_into_buffer+14), ReadS16(offset_into_buffer+12));

                DrawLib::ISize bitmapsize(bound_lr.x - bound_ul.x,bound_lr.y - bound_ul.y);

                /* if highest bit of rowbytes == 1 then bitmap has more than 1 bit/pixel*/
                bool multicolor = (rowbytes & 0x08000) > 0;

                DrawLib::Bitmap32 mybitmap(bitmapsize.width, bitmapsize.height);

                DEBUGPRINT("  Bitmap size = " << bitmapsize);
                DEBUGPRINT("  RowBytes = " << (rowbytes & 0x3FFF));
                if (multicolor)
                        DEBUGPRINT("  PixMap is multicolored");
                else
                        DEBUGPRINT("  PixMap is black-white");
                DEBUGPRINT("  packtype    = " << ReadU16(offset_into_buffer+16));
                DEBUGPRINT("  version     = " << ReadU16(offset_into_buffer+18));
                DEBUGPRINT("  packsize    = " << ReadU32(offset_into_buffer+20));
                DEBUGPRINT("  hres        = " << static_cast<double>(ReadU32(offset_into_buffer+24)) / 65536.0 << " DPI");
                DEBUGPRINT("  vres        = " << static_cast<double>(ReadU32(offset_into_buffer+28)) / 65536.0 << " DPI");
                DEBUGPRINT("  pixeltype   = " << ReadU16(offset_into_buffer+32));
                DEBUGPRINT("  pixelsize   = " << ReadU16(offset_into_buffer+34));
                DEBUGPRINT("  cmpCount    = " << ReadU16(offset_into_buffer+36));
                DEBUGPRINT("  cmpSize     = " << ReadU16(offset_into_buffer+38));
                DEBUGPRINT("  planeBytes  = " << ReadU32(offset_into_buffer+40));
                DEBUGPRINT("  pmTable     = " << ReadU32(offset_into_buffer+44));
                DEBUGPRINT("  pmReserved  = " << ReadU32(offset_into_buffer+48));
                DEBUGPRINT("--------------------------");

                DrawLib::FPPoint srcRectUL(ReadS16(offset_into_buffer+54),
                        ReadS16(offset_into_buffer+52));
                DrawLib::FPPoint srcRectLR(ReadS16(offset_into_buffer+58),
                        ReadS16(offset_into_buffer+56));

                DrawLib::FPPoint dstRectUL(ReadS16(offset_into_buffer+62),
                        ReadS16(offset_into_buffer+60));
                DrawLib::FPPoint dstRectLR(ReadS16(offset_into_buffer+66),
                        ReadS16(offset_into_buffer+64));

                DEBUGPRINT("  sourcerect = [" << srcRectUL << " , " << srcRectLR << "]");
                DEBUGPRINT("  destrect = [" << dstRectUL << " , " << dstRectLR << "]");

                dstRectUL = Logical2Local(dstRectUL);
                dstRectLR = Logical2Local(dstRectLR);

                DEBUGPRINT("  sourcerect = [" << srcRectUL << " , " << srcRectLR << "]");
                DEBUGPRINT("  destrect = [" << dstRectUL << " , " << dstRectLR << "]");

                DEBUGPRINT("  blitmode = " << ReadU16(offset_into_buffer+68));
                // pixdata at offset_into_buffer+70 ..

                uint32_t pixel_offset = offset_into_buffer + 70;

                std::vector<uint8_t> rowdata;
                DrawLib::Scanline32 my_scanline(bitmapsize.width,true);
                for(int y=0; y<bitmapsize.height; y++)
                {
                        uint32_t result;
                        rowdata = ExpandPackedBits(rowbytes & 0x3FFF, pixel_offset, &result);
                        pixel_offset+=result;

                        if ((int)rowdata.size() == bitmapsize.width*3)
                        {
                                // format is RRRRRR | GGGGG | BBBBB (planes separate!!!)
                                for(int x=0; x<bitmapsize.width; x++)
                                {
                                        my_scanline.Pixel(x).SetRGBA(
                                                rowdata[x],
                                                rowdata[x+bitmapsize.width],
                                                rowdata[x+bitmapsize.width*2],
                                                255);
                                }
                        }
                        else if ((int)rowdata.size() == bitmapsize.width*4)
                        {
                                // My guess: RGBA ?
                                for(int x=0; x<bitmapsize.width; x++)
                                {
                                        my_scanline.Pixel(x).SetRGBA(
                                                rowdata[x+bitmapsize.width*1],
                                                rowdata[x+bitmapsize.width*2],
                                                rowdata[x+bitmapsize.width*3],
                                                rowdata[x]);
                                }
                        }
                        else
                        {
                                throw(std::runtime_error("PictConvert::DirectBitsRect - unsupported type!"));
                        }
                        mybitmap.SetScanline32(y, my_scanline);
                }
                // stretch it to the right size!
                std::unique_ptr<DrawLib::Bitmap32 > stretched_bitmap;
                DrawLib::ISize newsize(
                        abs((int)dstRectLR.x - (int)dstRectUL.x),
                        abs((int)dstRectLR.y - (int)dstRectUL.y));
                DEBUGPRINT("   resizing bitmap to " << newsize);

                stretched_bitmap.reset(DrawLib::CreateResizedBitmap(mybitmap, newsize));

                if (stretched_bitmap)
                {
                        //set the DrawObject texture to the resized bitmap!

                        DrawLib::IPoint texture_offset(dstRectUL.x, dstRectUL.y);
                        drobj->SetFillTexture(stretched_bitmap.get(), texture_offset);
                        drobj->SetFillMode(DrawLib::DrawObject::TEXTURED);
                        drobj->DrawRectangle(dstRectUL, dstRectLR);
                        drobj->SetFillMode(DrawLib::DrawObject::SOLID);
                }

                return pixel_offset - offset_into_buffer - 2;
                }

        case 0xC00: //header: version (Integer), reserved (Integer), hRes, vRes (Fixed), srcRect, reserved (Long);
                extendedv2 = ReadS16(offset_into_buffer+2)==-2;
                DEBUGPRINT("Extended PICT = " << extendedv2);

                DEBUGPRINT("hres = " << ReadFixed(offset_into_buffer+6));
                DEBUGPRINT("vres = " << ReadFixed(offset_into_buffer+10));
                DEBUGPRINT("srcrect = " << ReadIRect(offset_into_buffer+14));
                original_srcbox = ReadIRect(offset_into_buffer+14);

                return 0;

        default:
                DEBUGPRINT("UNIMPLEMENTED OPCODE " << opcode);
        }
        return 0;
}

DrawLib::FPPoint PictConvert::Logical2Local(const DrawLib::FPPoint &point) const
{
        /* ADDME: Ik weet niet helemaal wat we met de ClipBox moeten doen.
           mogelijk is dat het originele output coordinaten systeem? why care?
           wij moeten alleen maar remappen naar de werkelijk nieuwe output gebied*/

        double xfactor = mybitmap->GetWidth() / original_srcbox.GetWidth();
        double yfactor = mybitmap->GetHeight() / original_srcbox.GetHeight();

        double newx = (point.x - original_srcbox.upper_left.x) * xfactor;
        double newy = (point.y - original_srcbox.upper_left.y) * yfactor;

        DrawLib::FPPoint mypoint(newx, newy);
        return mypoint;
}

DrawLib::FPSize PictConvert::LogicalSize2LocalSize(const DrawLib::FPSize &psize) const
{
        double xfactor = mybitmap->GetWidth() / original_srcbox.GetWidth();
        double yfactor = mybitmap->GetHeight() / original_srcbox.GetHeight();

        double newx = psize.width * xfactor;
        double newy = psize.height * yfactor;

        DrawLib::FPSize mysize(newx, newy);
        return mysize;
}

/* buffer readers */

int8_t PictConvert::ReadS8(uint32_t offset)
{
        if (offset >= datalength)
                throw(std::runtime_error("PictConvert::ReadS8 tried to read past end of buffer"));

        return gets8(databuffer + offset);
}

int16_t PictConvert::ReadS16(uint32_t offset)
{
        if ((offset+1) >= datalength)
                throw(std::runtime_error("PictConvert::ReadS16 tried to read past end of buffer"));

        return gets16msb(databuffer + offset);
}

DrawLib::IPoint PictConvert::ReadIPoint(uint32_t offset)
{
        DrawLib::IPoint p;
        p.x=ReadS16(offset+2);
        p.y=ReadS16(offset);
        return p;
}

DrawLib::IRect PictConvert::ReadIRect(uint32_t offset)
{
        DrawLib::IRect rect;
        rect.upper_left = ReadIPoint(offset);
        rect.lower_right = ReadIPoint(offset+4);
        return rect;
}

F64 PictConvert::ReadFixed(uint32_t offset)
{
        //FIXME:  Never been able to verify whether we interpret this format correctly
        return ReadS32(offset) / 65536.0;
}

int32_t PictConvert::ReadS32(uint32_t offset)
{
        if ((offset+3) >= datalength)
                throw(std::runtime_error("PictConvert::ReadS32 tried to read past end of buffer"));

        return gets32msb(databuffer + offset);
}

uint8_t PictConvert::ReadU8(uint32_t offset)
{
        if (offset >= datalength)
                throw(std::runtime_error("PictConvert::ReadU8 tried to read past end of buffer"));

        return getu8(databuffer + offset);
}

uint16_t PictConvert::ReadU16(uint32_t offset)
{
        if ((offset+1) >= datalength)
                throw(std::runtime_error("PictConvert::ReadS16 tried to read past end of buffer"));

        return getu16msb(databuffer + offset);
}

uint32_t PictConvert::ReadU32(uint32_t offset)
{
        if ((offset+3) >= datalength)
                throw(std::runtime_error("PictConvert::ReadS32 tried to read past end of buffer"));

        return getu32msb(databuffer + offset);
}
