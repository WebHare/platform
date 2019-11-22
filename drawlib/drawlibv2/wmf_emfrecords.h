#ifndef drawlib_wmflib_emfrecords
#define drawlib_wmflib_emfrecords

#include "wmf_gditypes.h"

namespace WmfLib
{

const uint32_t EMFSignature = 0x464D4520;

///EMF header record (Win32 keyword ENHMETAHEADER)
struct EMFHeader
{
        ///Minimum ize of this record in a EMF file
        static unsigned const RecSizeEMF = 88;
        ///Read this record from a EMF file. Assumes that data->nSize is validated
        void ReadEMF(uint8_t const *data);

        /** Specifies the dimensions, in device units, of the smallest rectangle
           that can be drawn around the picture stored in the metafile. This
           rectangle is supplied by graphics device interface (GDI). Its
           dimensions include the right and bottom edges. */
        fRECT bounds;

        /** Specifies the dimensions, in .01 millimeter units, of a rectangle
            that surrounds the picture stored in the metafile. This rectangle
            must be supplied by the application that creates the metafile. Its
            dimensions include the right and bottom edges. */
        fRECT frame;

        /** Specifies a doubleword signature. This member must specify the
            value assigned to the ENHMETA_SIGNATURE constant. */
        uint32_t dSignature;

        /// The metafile version
        uint32_t nVersion;

        /** Specifies a doubleword signature. This member must specify the value
            assigned to the ENHMETA_SIGNATURE constant. */
        uint32_t nBytes;

        /** Specifies the number of records in the enhanced metafile. */
        uint32_t nRecords;

        /** Specifies the number of handles in the enhanced-metafile handle
            table. (Index zero in this table is reserved.) */
        uint16_t nHandles;

        /** Specifies the number of entries in the enhanced metafile's palette.*/
        uint32_t nPalEntries;
        /** Specifies the resolution of the reference device, in pixels. */
        int32_t device_width, device_height;
        /** Specifies the resolution of the reference device, in millimeters. */
        int32_t mms_width, mms_height;
};

}
#endif
