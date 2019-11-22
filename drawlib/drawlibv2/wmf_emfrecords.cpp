#include <drawlib/drawlibv2/allincludes.h>


#include "wmf_emfrecords.h"

using Blex::getu32lsb;
using Blex::gets32lsb;
using Blex::getu16lsb;
using Blex::gets16lsb;
using Blex::getu8;
using Blex::gets8;

using namespace WmfLib;

void EMFHeader::ReadEMF(uint8_t const *data)
{
        //parse an ENHMETAHEADER structure
        bounds.ReadEMF(data+8);
        frame.ReadEMF(data+24);

        dSignature    = getu32lsb(data+40);
        nVersion      = getu32lsb(data+44);
        nBytes        = getu32lsb(data+48);
        nRecords      = getu32lsb(data+52);
        nHandles      = getu16lsb(data+56);
        //58: sReserved
        //60: nDescription
        //64: offDescription
        nPalEntries   = getu32lsb(data+68);
        device_width  = gets32lsb(data+72);
        device_height = gets32lsb(data+76);
        mms_width     = gets32lsb(data+80);
        mms_height    = gets32lsb(data+84);
        // following MAY follow the
        //88: cbPixelFormat
        //92: offPixelFormat
        //96: bOpenGL

#ifdef DEBUG //look for surprises
        if (dSignature != EMFSignature)
            DEBUGPRINT("\aWarning! EMF signature mismatch: " << std::hex << dSignature << std::dec);
        if (getu16lsb(data+38) != 0)
            DEBUGPRINT("\aWarning! EMF header 'reserved' field should be 0 but is " << getu16lsb(data+38));
#endif
}
