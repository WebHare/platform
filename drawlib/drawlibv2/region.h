#ifndef region_h
#define region_h

#include <blex/blexlib.h>
#include "drawlib_v2_types.h"
#include <blex/bitmanip.h>

namespace DrawLib
{

/** Region - a container protection bits */

class BLEXLIB_PUBLIC Region
{
        private:
        const unsigned width;
        const unsigned height;

        /// Size of a protection row, in BitmapTypes
        const unsigned rowsize;
        /// Protection bitmap. Any pixel corresponding with a bit marked as true is writable
        std::unique_ptr<Blex::BitmapType[]> protection;

        /* returns a safe area. Upperleft is real upperleft, loweR_right is real lower_right etc. */
        IRect GetSafeArea(IRect area);

        /// Get a protection row
        inline Blex::Bitmap GetRow(unsigned y) { return &protection[rowsize*y]; }
        inline Blex::ConstBitmap GetRow(unsigned y) const { return &protection[rowsize*y]; }

        public:
        /**     Create an empty region of size width*height
                @param width    The width
                @param height   The height
                @param initial_unprotected If true, all pixels are initially writable
        */
        Region(unsigned width, unsigned height, bool initial_unprotected);

        ///region destructor
        ~Region();
        ///assignment operator
        Region& operator= (Region const &src);
        ///copy constructor
        Region(Region const&src);

        /**     Protect or unprotect an ares
                @param IRect    The Area that were dealing with
                @param bool     True - Set Area to Protected
                                False - Set Area to Unprotected
        */
        void SetProtectedArea(IRect area, bool give_protection);

        void AndProtectedArea   (IRect area);
        void InvertProtectedArea(IRect area);

        /** The intersection with the given area will be unprotected, the rest will be protected
                @param IRect    The Area to intersect with.
        */
        void IntersectPermissionArea(IRect area);

        /** Not implemented yet.
        */
        void ExcludePermissionArea(IRect area);

        /** Set a single pixel to permitted (true) or protected (false)
                @param permission - permitted (true) or protected (false)
        */
        void SetPermitted(uint32_t x, uint32_t y, bool permission);

        /** Get the width of the bitmap in pixels */
        uint32_t     GetWidth() const {return width;};

        /** Get the height of the bitmap in pixels */
        uint32_t     GetHeight() const {return height;};

        /** Check if pixel is protected
        @param x        The x coordinate in the region
        @param y        The y coordinate in the region
        @returns        True, if (x,y) is protected, false otherwise
        */
        bool IsProtected (uint32_t x, uint32_t y) const;

        /** Check if unprotected = permitted to write
        @param x        The x coordinate in the region
        @param y        The y coordinate in the region
        @returns        True, if (x,y) is permitted to write to, false otherwise
        */
        bool IsPermitted (uint32_t x, uint32_t y) const;

        friend class ProtectedBitmap32; //FIXME?
};

} //end of namespace
#endif
