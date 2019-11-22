#ifndef pictlib_h
#define pictlib_h

#include <blex/blexlib.h>
#include <drawlib/drawlibv2/bitmap.h>
#include <drawlib/drawlibv2/drawobject.h>
#include <drawlib/drawlibv2/fontmanager.h>

namespace PictLib
{

class PictConvert
{
public:
        PictConvert();
        void Go(uint8_t const *pictdata, uint32_t length, DrawLib::Bitmap32 &thebitmap, DrawLib::FPBoundingBox const &outputbox);

private:
        unsigned GetRealOpcodeSize(unsigned opcode, unsigned reported_size, unsigned offset_into_buffer);
        uint32_t     ExecuteOpcode(uint32_t offset);

        std::vector<uint8_t> ExpandPackedBits(const uint32_t rowbytes, uint32_t offset, uint32_t *bytes_read);

        /* Read stuff from the pict data buffer.
           These calls check for out-of-bound access */
        uint8_t      ReadU8(uint32_t offset);
        uint16_t     ReadU16(uint32_t offset);
        uint32_t     ReadU32(uint32_t offset);
        int8_t      ReadS8(uint32_t offset);
        int16_t     ReadS16(uint32_t offset);
        int32_t     ReadS32(uint32_t offset);
        F64     ReadFixed(uint32_t offset);
        DrawLib::IPoint  ReadIPoint(uint32_t offset);
        DrawLib::IRect   ReadIRect(uint32_t offset);

        DrawLib::FPPoint Logical2Local(const DrawLib::FPPoint &point) const;
        DrawLib::FPSize  LogicalSize2LocalSize(const DrawLib::FPSize &psize) const;

        uint32_t datalength;
        uint8_t   *databuffer;
        bool extendedv2;

        // State data..
        DrawLib::Pixel32 foreground;
        DrawLib::Pixel32 background;

        DrawLib::FPSize  ClipSize;
        DrawLib::FPPoint ClipUpperLeft;

        DrawLib::FPPoint CurrentPenPos;

        std::unique_ptr<DrawLib::Font>    CurrentFont;

        // For sameRect commands
        DrawLib::FPPoint LastRect1;
        DrawLib::FPPoint LastRect2;
        DrawLib::FPBoundingBox original_srcbox;

        DrawLib::Bitmap32 *mybitmap;
        std::unique_ptr<DrawLib::DrawObject> drobj;
        std::unique_ptr<DrawLib::Canvas32>   mycanvas;
};

} //end namespace PictLib

#endif
