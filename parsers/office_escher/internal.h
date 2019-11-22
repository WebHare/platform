#ifndef blex_parsers_office_escher_internal
#define blex_parsers_office_escher_internal

#include <blex/blexlib.h>
#include <blex/unicode.h>
#include <blex/stream.h>
#include <drawlib/drawlibv2/bitmapio.h>
#include <drawlib/drawlibv2/drawobject.h>

#include "properties.h"
#include "util.h"
#include "escher.h"

namespace Parsers {
namespace Office {
namespace Escher {

class EscherShape;

// Defined in this headerfile below:
class EscherDocument;
class BlipStore;
class DrawingGroupContainer;
class DrawingContainer;
class BlipStoreEntry;
class msoBlip;
class Drawable;
class ShapeContainer;

/** Escher group-in-group current transformation state */
struct TransformationState
{
        ///The matrix required to move from local coordinates to pixels-as-stored state (after this transformation, our coordinates are compatible with font sizes and line widths)
        DrawLib::XForm2D stored_transformation;
        ///Is text rendered vertical in this shape?
        bool text_is_vertical;

        private:
        ///The total scaling and translation from the outer canvas to this picture. Some sort of Window/ViewPort mechanism is probably used by Escher
        DrawLib::XForm2D scaling;
        ///Rotational and flipping matrix. We combine flipping here, and not inscaling, because flipping also affects rotation angles of subgroups
        DrawLib::XForm2D rotational_matrix;

        //FIXME: friend
        friend class ShapeContainer;
};

/**
 * A structure, containing all common parameters for the functions
 * of all shape implementing classes, which draws them on a canvas.
 * FIXME: Inheritance is an ugly solution for the composition problem
 */
struct ShapeDrawParameters : public TransformationState
{
        ShapeDrawParameters(DrawLib::BitmapInterface *bitmap, DrawLib::XForm2D const &final_transformation, TextCallback const &_text_callback, SchemeColors const *_scheme_colors);

        DrawLib::BitmapInterface *bitmap;
        DrawLib::XForm2D final_transformation;

        TextCallback text_callback;
        Escher::SchemeColors const *scheme_colors;
};

/**
 * Represents an Escher container object which can get drawn. This can be a
 * group of shapes ('msofbtSpgrContainer') (possibly with subgroups) or
 * a single shape ('msofbtSpContainer').
 */
class Drawable
{
protected:
        /**
         * The identifier of the group or shape. In case this is a group
         * of shapes, it originalte from a 'group' ShapeContainer.
         */
        int32_t shape_id;

        /** Wether this is a 'ShapeContainer' (and not a group) AND is a groupshape. */
        bool is_group_shape;

        /** Groups must be able to directly access the data of their children. */
        friend class ShapeGroupContainer;

public:

        //Cache the outer bounding box, so we can properly deal with multiple GetBoundingBox invocations
        //FIXME: shouldn't be needed when everything is proper const
        std::unique_ptr<DrawLib::FPBoundingBox> cache_outer_bounding_box;

        /** Simple constructor. */
        Drawable()
        : shape_id(0)
        , is_group_shape(false)
        {
        }

        /** Simple destructor. */
        virtual ~Drawable()
        {
        }

        virtual Properties const &GetProperties() const = 0;

        /**
         * Tries to get the ShapeContainer with the given identifier. It can be
         * this drawable if this is a ShapeContainer or one ot its
         * (grand (grand (...))) children if this is a ShapeGroupContainer.
         *
         * @param shape_id The identifier.
         * @return The found ShapeContainer or NULL if not found.
         */
        virtual ShapeContainer const * GetShapeContainerWithId(int32_t shape_id) const = 0;

        /**
         * Tries to get the Drawable with the given identifier. It can be
         * this drawable or one ot its (grand (grand (...))) children
         * if this is a ShapeGroupContainer.
         *
         * @param _shape_id The identifier.
         * @return The found Drawable or NULL if not found.
         */
        virtual Drawable * GetDrawableWithId(int32_t _shape_id)
        {
                if(shape_id == _shape_id) return this;
                return NULL;
        }

        /**
         * Returns this drawable's shape_id
         */
        int32_t GetShapeId() const
        {
                return shape_id;
        }

        /** Get child anchor for this shape */
        virtual DrawLib::FPBoundingBox* GetChildAnchor() const = 0;

        /**
         * Get the ClientAnchor data from this Shape
         *
         * Returns the ClientAnchor data
         */
        virtual std::vector<uint8_t> const& GetClientAnchor() const = 0;

        /**
         * Get the ClientData data from this Shape
         *
         * Returns the ClientData data
         */
        virtual std::vector<uint8_t> const& GetClientData() const = 0;

        /**
         * Get the ClientTextbox data from this Shape
         *
         * Returns the ClientTextbox data
         */
        virtual std::vector<uint8_t> const& GetClientTextbox() const = 0;

        /**
         * Get the TextId from this Shape (defined in properties)
         *
         * Returns the TextId
         */
        virtual uint32_t GetTextId() const = 0;

public:
        /**
         * Translates and scales this shape or group of shapes to fit
         * in the rectangle (0, 0, width, height) (the canvas) and let the shape
         * specific implementation initialize itselve by calculating
         * (and store) the shape-specific data like corner points of a rectangle and
         * let them determine the outer bounding box (using this shape-specific data).
         *
         * Note that the function 'Draw' may only get called (once or more) after a
         * call to this function.
         *
         * @param canvas_width The width of the canvas.
         * @param canvas_height The height of the canvas.
         * @param canvas_outer_bounding_box The outer bounding box, in pixel units,
         * to get determined here. May not be NULL.
         */
        virtual DrawLib::FPBoundingBox InitializeAndGetBoundingBox(TransformationState const &pars, DrawLib::FPBoundingBox const &your_own_boundingbox) =0;

        /**
         * Draws this shape or group of shapes, using the data calculated and stored in
         * the last call to 'TranslateAndScaleToCanvas'.
         * This function may only be called (once or more) after a call to
         * 'TranslateAndScaleToCanvas'.
         *
         * @param drawinfo The draw context.
         * @param translate_point The point indicating the amount to translate all drawing.
         * @param scale_point The point indicating the scaling on the x and y axis
         * of all drawing.
         * @param textcallback The host defined callback function to retrieve shape
         * texts from given a host defined identifier stored in the escher tree.
         */
        virtual void Draw(ShapeDrawParameters const &drawparameters, DrawLib::FPBoundingBox const &your_own_boundingbox) const = 0;
};


/**
 * Implements a Drawable which is a single escher shape container
 * ('msofbtSpContainer' / 0xF004).
 * Such a ShapeContainer gan be a group shape container
 * (Drawable::is_group_shape == true) in which case it contains
 * data of the shape group this shape is direct child of.
 *
 * Otherwise this can own / owns a subclass of 'EscherSchape' (in
 * 'escher_shape') which is the shape-type-specific implementation for
 * this class.
 */
class ShapeContainer : public Drawable
{
        /**
         * The root node of the escher tree this shape is
         * (grand) child of, used to retrieve BLIPs from..
         */
        EscherDocument const &document;

        /**
         * The position and size of this shape, if defined, of this
         * shape within the group it is in, expressed in the
         * coordinate space of that group.
         * When this is a group shapecontainer, it defines the
         * position and size of that group, at the same manner.
         * It is read from a 'msofbtChildAnchor' record.
         */
        std::unique_ptr<DrawLib::FPBoundingBox> bounding_box;

        /**
         * When this shapecontainer is a group shape container this is the
         * bounding box around all children of the group, containing the
         * coordinate-space of this group. It is read from a GroupShapeRecord.
         */
        std::unique_ptr<DrawLib::FPBoundingBox> group_bounding_box;

        /** Shape groups must be able to manage the bounding boxes of their shapes. */
        friend class ShapeGroupContainer;

        // From here fields expected to find in a 'msofbtSp' child record:

        unsigned shape_type;            /**< The shape type (originating from the record 'instance'). */
        bool     is_child;              /**< Whether part of a shape group. */
        bool     is_patriarch;          /**< Whether this is the 'patriarch' shape group. */
        bool     is_deleted;            /**< Whether this is a deleted shape (not used). */
        bool     is_ole_object;         /**< Whether this is a ole object reference (not used). */
        bool     is_flipped_horizontal; /**< Whether flipped horizontally or not. */
        bool     is_flipped_vertical;   /**< Whether flipped vertically or not. */
        bool     is_connector;          /**< Whether this is a shape connecting other shapes geographically or not (not used). */
        bool     has_an_anchor;         /**< Whether containing an 'ChildAnchor' or not. */
        bool     is_background_shape;   /**< Whether this is the background shape or not. */

        Properties properties;

        /** Store the client data */
        std::vector<uint8_t> client_anchor;
        std::vector<uint8_t> client_data;
        std::vector<uint8_t> client_textbox;
        std::vector<uint8_t> positioningdata;

public:
        /**
         * Simple constructor.
         * @param escher_document The root node of the escher tree this
         * shape is (grand) child of, used to retrieve BLIPs from.
         */
        ShapeContainer(EscherDocument const &escher_document);

        //Parse records for this container
        void ContainerReader(RecordData &record);

        virtual ShapeContainer const * GetShapeContainerWithId(int32_t _shape_id) const
        {
                if(!is_group_shape && shape_id == _shape_id)
                        return this;

                return NULL;
        }

        /** Just returns the shape-type. */
        unsigned GetType() const
        {
                return shape_type;
        }

        /** Return the client_anchor */
        virtual std::vector<uint8_t> const &GetClientAnchor() const
        {
                return client_anchor;
        }

        /** Return the client_data */
        virtual std::vector<uint8_t> const &GetClientData() const
        {
                return client_data;
        }

        /** Return the client_textbox */
        virtual std::vector<uint8_t> const &GetClientTextbox() const
        {
                return client_textbox;
        }

        /** Return the positioning data */
        virtual std::vector<uint8_t> const &GetPositioningData() const
        {
                return positioningdata;
        }

        virtual DrawLib::FPBoundingBox* GetChildAnchor() const
        {
                return bounding_box.get();
        }

        /** Return the textid */
        virtual uint32_t GetTextId() const;

        /**
         * Returns the (owned) shape properties object.
         */
        Properties const & GetProperties() const;

        /**
         * Retrieves a BLIP pointed to by the property (from 'properties')
         * with the given identifier. It is used by the shape-type-specific
         * implementation classes, subclass of 'EscherShape'.
         *
         * @param PID The identifier of the property.
         * @return The BLIP or NULL of none found.
         */
        msoBlip const * GetPropertyAsBlip(int PID) const;

        /** Update the transformation state's flipping, rotation and
            stored_transformation */
        void UpdateTransformationState(TransformationState *state, DrawLib::FPBoundingBox const &bbox, DrawLib::FPBoundingBox const &coordinate_system) const;

        DrawLib::FPBoundingBox InitializeAndGetBoundingBox(TransformationState const &pars, DrawLib::FPBoundingBox const &your_own_boundingbox);
        void Draw(ShapeDrawParameters const &drawparameters, DrawLib::FPBoundingBox const &your_own_boundingbox) const;

        /** This function creates the shape-type specific
         * implementation object (subclass of EscherShape) and let it read
         * the properties object.
         */
        void CompleteContainer();

        /// The shape implementating class using the properties from 'properties it needs.
        std::unique_ptr<EscherShape> escher_shape;

        bool GetIsFlippedHorizontally() const
        {       return is_flipped_horizontal;     }

        bool GetIsFlippedVertically() const
        {       return is_flipped_vertical;     }

        /// Is this shape deleted?
        bool IsDeleted() const
        {
                return is_deleted;
        }

};


/**
 * Implements a Drawable which is a group of escher shapes
 * ('msofbtSpgrContainer' / 0xF003).
 *
 * It owns an array of subclass of 'EscherSchape' (in 'drawables') which
 * are the members/children of this group (being shapes or
 * groups of shapes themselves).
 */
class ShapeGroupContainer : public Drawable
{
        /**
         * The group shape container. It is not guaranteed to be defined.
         */
        std::unique_ptr<ShapeContainer> group_shape_container;

        /**
         * The children/members of this group (being shapes or
         * groups of shapes themselves) which are NOT a
         * group shape container.
         */
        std::vector<std::shared_ptr<Drawable> > drawables;

public:
        /** A simple constructor. */
        ShapeGroupContainer();
        /** A simple destructor. */
        ~ShapeGroupContainer();

        //Parse records for this container
        void ContainerReader(RecordData &record, EscherDocument *parentdoc);

        void Process(unsigned level, uint8_t *buffer, unsigned length, Blex::RandomStream *delay,
                     EscherDocument *escher_document, SchemeColors const *scheme_colors);

        Properties const &GetProperties() const;

        /**
         * Returns a (sub) member with the given identifier if found.
         * @param shape_id The identifier of the shape to find.
         * @return The member with the given identifier or NULL if not found.
         */
        virtual ShapeContainer const * GetShapeContainerWithId(int32_t shape_id) const;
        /**
         * Returns this group or a (sub) member if it has the given identifier.
         * @param shape_id The identifier of the shape to find.
         * @return This group or a member which has the given identifier or
         * NULL if not found.
         */
        virtual Drawable * GetDrawableWithId(int32_t shape_id);
        /**
         * Returns all shape id's in this group
         * @return Vector with shape id's in this group
         */
        std::vector<int32_t> GetDrawableIds() const;

        /** Return the client_anchor */
        virtual std::vector<uint8_t> const& GetClientAnchor() const
        {
                // In a Shape Group, return the ClientAnchor from the first Shape in the container
                return group_shape_container->GetClientAnchor();
        }

        /** Return the client_data */
        virtual std::vector<uint8_t> const& GetClientData() const
        {
                // In a Shape Group, return the ClientData from the first Shape in the container
                return group_shape_container->GetClientData();
        }

        /** Return the client_textbox */
        virtual std::vector<uint8_t> const& GetClientTextbox() const
        {
                // In a Shape Group, return the ClientTextbox from the first Shape in the container
                return group_shape_container->GetClientTextbox();
        }

        virtual DrawLib::FPBoundingBox* GetChildAnchor() const
        {
                return group_shape_container.get() ? group_shape_container->GetChildAnchor() : NULL;
        }

        /** Return the textid */
        virtual uint32_t GetTextId() const
        {
                // In a Shape Group, return the TextId from the first Shape in the container
                return group_shape_container->GetTextId();
        }

        virtual DrawLib::FPBoundingBox InitializeAndGetBoundingBox(TransformationState const &pars, DrawLib::FPBoundingBox const &your_own_boundingbox);
        virtual void Draw(ShapeDrawParameters const &drawparameters, DrawLib::FPBoundingBox const &your_own_boundingbox) const;

        // Is this group deleted?
        bool IsDeleted() const
        {
                return group_shape_container.get() ? group_shape_container->IsDeleted() : false;
        }
};

class BlipStore
{
        std::vector<std::shared_ptr<BlipStoreEntry> > blip_store_entries;

public:
        //Parse records for this container
        void ContainerReader(RecordData &record, Blex::RandomStream *delay);

        /** Get the 'num'-th blip in this store */
        BlipStoreEntry const * GetBlipBySeq(unsigned num) const;
};

///msofbtDggContainer
class DrawingGroupContainer
{
        std::unique_ptr<BlipStore> blip_store;

public:
        //Parse records for this container
        void ContainerReader(RecordData &record, Blex::RandomStream *delay);
        BlipStore * GetBlipStore() const
        {
                return blip_store.get();
        }
};

/**
 * Represents a drawing container in an escher tree ('msofbtDgContainer' / 0xF002).
 * It should contain a shape group which is called the patriarch.
 */
class DrawingContainer
{
        /**
         * The patriarch group shape container this container contains.
         * It is NULL if not defined.
         */
        std::unique_ptr<ShapeGroupContainer> patriarch_shape_group_container;

        std::unique_ptr<ShapeContainer> background_shape_container;

        uint32_t drawing_container_id; // Contains the id of the last shape in this container
                                  // (can be used to refer to this container)

public:
        //Parse records for this container
        void ContainerReader(RecordData &record, EscherDocument *parentdoc);

        /**
         * @return The patriarch group shape container.
         */
        ShapeGroupContainer * GetPatriarchShapeGroupContainer()
        {
                return patriarch_shape_group_container.get();
        }
        ShapeGroupContainer const * GetPatriarchShapeGroupContainer() const
        {
                return patriarch_shape_group_container.get();
        }

        /**
         * @return The background group shape container.
         */
        ShapeContainer * GetBackgroundShapeContainer() const
        {
                return background_shape_container.get();
        }

        /**
         * @return The container id
         */
        uint32_t GetContainerId() const
        {
                return drawing_container_id;
        }

};

class BLEXLIB_PUBLIC BlipStoreEntry
{
        std::unique_ptr<msoBlip> blip;

public:
        BlipStoreEntry();
        ~BlipStoreEntry();

        void ContainerReader(RecordData &record);

        void ProcessData(RecordData &record, Blex::RandomStream *delay);

        msoBlip const * GetBlip() const
        {
                return blip.get();
        }

        enum BlipType
        {
                blipERROR=0,
                blipUNKNOWN,
                blipEMF,
                blipWMF,
                blipPICT,
                blipJPEG,
                blipPNG,
                blipDIB
        };

        enum BlipUsage
        {
                blipDefault=0,
                blipTexture
        };

        static const char * BlipTypeName (BlipType  b);
        static const char * BlipUsageName(BlipUsage u);

private:
        //Data
        BlipType Win32,MacOS;
        uint8_t uid[16];             //blip ID
        uint16_t tag;
        uint32_t size;               //blip's size
        uint32_t refcount;           //blip reference count
        uint32_t offset;             //blip's file offset in delay stream (?)
        BlipUsage usage;        //how the blip is used
        Blex::UTF16String blipname;   //name of the blip
};

struct BlipRenderProperties
{
        float   cropFromTop;            /**< PropNo. 256 - 16.16 fixedpoint!! See Microsoft ESCHER docs. */
        float   cropFromBottom;         /**< PropNo. 257 */
        float   cropFromLeft;           /**< PropNo. 258 */
        float   cropFromRight;          /**< PropNo. 259 */
        int32_t     pictureConstrast;       /**< PropNo. 264 - constrast (16.16 ??) - currently not used. */
        int32_t     pictureBrightness;      /**< PropNo. 265 - brightness - currently not used. */
        bool    pictureGray;            /**< PropNo. 319 - bool (if true make picture greyscale) */
};

class msoBlip
{
public:
        msoBlip(BlipStoreEntry::BlipType type);
        virtual ~msoBlip();

        void ProcessData(RecordData &record);

        virtual void PaintYourself(ShapeDrawParameters const &pars, const BlipRenderProperties &props) const;

        BlipStoreEntry::BlipType GetBlipType() const;

        virtual DrawLib::BitmapInterface * GetUnprocessedBitmap() const;

        virtual DrawLib::BitmapInterface *GetResizedBitmap(DrawLib::ISize const &finalsize) const;

        /** Get the raw datafile for this image */
        std::unique_ptr<Blex::RandomStream> GetPictureData() const;

protected:
        BlipStoreEntry::BlipType my_blip_type;

        virtual unsigned GetSignature()=0;
        virtual void ProcessGraphicsData(Blex::Stream &data)=0;

        /**
         * Creates a croppd and resized bitmap. It also does other rendering, like
         * making the bitmap gray.
         * @param bitmap_box The area on the canvas where the bitmap should get drawn.
         * No checking is done on wether the box fits on the canvas.
         * @param props The rendering properties, also containing cropping information.
         * @param original_bitmap The bitmap.
         * @return A pointer to the bitmap.
         */
        DrawLib::BitmapInterface *GetCroppedAndResizedBitmap(
                DrawLib::ISize const &bitmap_size,
                BlipRenderProperties const &props) const;


private:

        std::vector<uint8_t> temp_datastore;
};

/** A generic base-class for all vector-type blips (EMF, WMF, PICT)
    because we store the same additional data for all these types */
class msoBlipVector : public msoBlip //F01A
{
        public:
        enum CompressType
        {
                msocompressionDeflate = 0,
                msocompressionNone = 254
        };

        enum FilterType
        {
                msofilterAdaptive = 0,
                msofilterNone = 254
        };

        msoBlipVector(BlipStoreEntry::BlipType type);

        void ProcessGraphicsData(Blex::Stream &data);

        uint32_t cachesize;          //cache of the metafile size
        uint32_t boundsleft,boundstop,boundsright,boundsbottom;      //boundaries
        uint32_t sizeh,sizev;        //size in EMUs
        uint32_t savedsize;          //cache of the saved size

        CompressType compression;
        FilterType filter;

        virtual void PaintYourself(ShapeDrawParameters const &pars, const BlipRenderProperties &props) const;
        virtual void PaintSelfUncompressed(ShapeDrawParameters const &pars, const BlipRenderProperties &props, Blex::Stream &picture) const=0;

        void DumpVectorData(std::ostream &output, unsigned level) const;
};

class msoBlipEMF : public msoBlipVector //F01A
{
        public:
        msoBlipEMF(BlipStoreEntry::BlipType type);

        unsigned GetSignature();
        void PaintSelfUncompressed(ShapeDrawParameters const &pars, const BlipRenderProperties &props, Blex::Stream &picture) const;
        virtual void Dump(std::ostream &output, unsigned level) const;
};

class msoBlipWMF : public msoBlipVector //F01B
{
        public:
        msoBlipWMF(BlipStoreEntry::BlipType type);

        void PaintSelfUncompressed(ShapeDrawParameters const &pars, const BlipRenderProperties &props, Blex::Stream &picture) const;
        unsigned GetSignature();
        virtual void Dump(std::ostream &output, unsigned level) const;
};

class msoBlipPICT : public msoBlipVector //F01A
{
        public:
        msoBlipPICT(BlipStoreEntry::BlipType type);

        void PaintSelfUncompressed(ShapeDrawParameters const &pars, const BlipRenderProperties &props, Blex::Stream &picture) const;
        unsigned GetSignature();
        virtual void Dump(std::ostream &output, unsigned level) const;
};

class msoBlipJPEG : public msoBlip //F01A
{
        public:
        msoBlipJPEG(BlipStoreEntry::BlipType type);

        void ProcessGraphicsData(Blex::Stream &data);
        virtual DrawLib::BitmapInterface * GetUnprocessedBitmap() const;

        unsigned GetSignature();
        virtual void Dump(std::ostream &output, unsigned level) const;
};

class msoBlipPNG : public msoBlip //F01A
{
        public:
        msoBlipPNG(BlipStoreEntry::BlipType type);

        void ProcessGraphicsData(Blex::Stream &data);
        unsigned GetSignature();
        virtual DrawLib::BitmapInterface * GetUnprocessedBitmap() const;
        virtual void Dump(std::ostream &output, unsigned level) const;
};

class msoBlipDIB : public msoBlip //F01A
{
        public:
        msoBlipDIB(BlipStoreEntry::BlipType type);

        void ProcessGraphicsData(Blex::Stream &data);
        virtual DrawLib::BitmapInterface * GetUnprocessedBitmap() const;
        virtual DrawLib::BitmapInterface *GetResizedBitmap(DrawLib::ISize const &finalsize) const;
        unsigned GetSignature();
        virtual void Dump(std::ostream &output, unsigned level) const;
};

/** This is the 'top level' escher object, our starting point for searches
   through the escher tree. */
class EscherDocument
{
        /** The drawing group container of the escher tree. */
        std::unique_ptr<DrawingGroupContainer> drawing_group_container;
        /** All drawing containers in this drawing group. */
        std::vector<std::shared_ptr<DrawingContainer> > drawing_containers;

        /// The shape in a fast-saved Escher piece
        std::unique_ptr<ShapeContainer> global_shape_container;
        /// The blip in a fast-saved Escher piece
        std::unique_ptr<BlipStoreEntry> global_blip_store_entry;

public:
        //Parse records for this container
        void ContainerReader(
                RecordData &record, Blex::RandomStream *delay);

        /** Find a Drawable object from a shapeID */
        Drawable * FindDrawable(int32_t shapeid);

        DrawingGroupContainer const * GetDrawingGroupContainer() const
        {
                return drawing_group_container.get();
        }

        DrawingContainer const * GetFirstDrawingContainer() const
        {
                return drawing_containers.begin()->get();
        }
        DrawingContainer const * GetLastDrawingContainer() const
        {
                return drawing_containers.back().get();
        }

        DrawingContainer const * GetDrawingContainer(uint32_t drawing_container_id) const;

        ShapeContainer * GetGlobalShapeContainer() const
        {
                return global_shape_container.get();
        }

        BlipStoreEntry const * GetGlobalBlipStoreEntry() const
        {
                return global_blip_store_entry.get();
        }

private:
        /** Find a shape using an ID in the Escher tree */
        ShapeContainer const *FindShape(int32_t shapeid) const;

        ShapeContainer *FindShape(int32_t shapeid)
        { return const_cast<ShapeContainer*>(const_cast<EscherDocument const*>(this)->FindShape(shapeid)); }

        friend class Interface;
        friend class Properties;
};


} //end namespace Escher
} //end namespace Office
} //end namespace Parsers


#endif
