#include <ap/libwebhare/allincludes.h>


#include "internal.h"
#include "shapes.h"
#include <blex/utils.h>
#include <blex/zstream.h>
#include <drawlib/drawlibv2/bitmapmanip.h>
#include <drawlib/drawlibv2/wmfrenderer.h>
#include <iostream>

//#define DUMPPNG

namespace Parsers {
namespace Office {
namespace Escher {

using Blex::getu8;
using Blex::getu16lsb;
using Blex::getu32lsb;
using Blex::gets32lsb;

void GammaCorrect(DrawLib::Pixel32 *color, float g); //FIXME: Hack, move definition to header file

void Interface::PaintShape(DrawLib::BitmapInterface *drawinfo, DrawLib::FPSize const &rendered_pixelsize, DrawLib::XForm2D const &final_transform, int32_t shapeid, TextCallback const &textcallback, Escher::SchemeColors const *scheme_colors) const
{
        DEBUGPRINT("Painting shapeid = " << shapeid << " (bitmap: " << (drawinfo ? "yes" : "no") << ")");
        DEBUGPRINT("rendered pixelsize " << rendered_pixelsize << " final transform " << final_transform);

        //Make sure the shape is truly initialized    (ADDME: Should go away when everything is properly const)
        GetBoundingBox(shapeid, rendered_pixelsize);

        //Find the shape or group of shapes itself first:
        Drawable const *drawable = doc->FindDrawable(shapeid);
        if (!drawable)
        {
                DEBUGPRINT("Interface::PaintShape: Didn't find the shape or shapegroup with shapeid = " << shapeid);
                return;
        }

        Properties const &properties = drawable->GetProperties();

        // Image cropping
        float croptop = properties.GetAsFloatFrom16_16(Properties::cropFromTop, 0.0f);
        float cropbottom = properties.GetAsFloatFrom16_16(Properties::cropFromBottom, 0.0f);
        float cropleft = properties.GetAsFloatFrom16_16(Properties::cropFromLeft, 0.0f);
        float cropright = properties.GetAsFloatFrom16_16(Properties::cropFromRight, 0.0f);

        DrawLib::XForm2D crop_transform;

        crop_transform.eM11 = 1.0f / (1.0f - (cropleft + cropright));
        crop_transform.eM22 = 1.0f / (1.0f - (cropbottom + croptop));
        crop_transform.translation.x = -rendered_pixelsize.width * crop_transform.eM11 * cropleft;
        crop_transform.translation.y = -rendered_pixelsize.height * crop_transform.eM22 * croptop;

        crop_transform *= final_transform;

        ShapeDrawParameters drawparams(drawinfo, crop_transform, textcallback, scheme_colors);
        drawable->Draw(drawparams,DrawLib::FPBoundingBox(0,0,rendered_pixelsize.width,rendered_pixelsize.height));

        if (!drawinfo)
            return;

        //ADDME: For speed and better canvas combining, these filters should be implemented by BitmapInterface

        float contrast = properties.GetAsFloatFrom16_16(Properties::pictureContrast, 1.0f); //Contrast is between 0 and max, 50% = 1 = default, 25% = 0.5, 75% = 2
        float brightness = properties.GetAsFloatFrom16_16(Properties::pictureBrightness, 0.0f); //Brightness is between -0.5 and 0.5, 50% = 0, 25% = -0.25, 75% = 0.25
        if (contrast != 1.0 || brightness != 0.0)
        {
                DEBUGPRINT("Must apply brightness & contrast! " << brightness << " :" << contrast);
                brightness *= 512;
                for (unsigned y=0;y<drawinfo->GetHeight();++y)
                {
                        DrawLib::Scanline32 line = drawinfo->GetScanline32(y);
                        for (unsigned x=0;x<drawinfo->GetWidth();++x)
                        {
                                DrawLib::Pixel32 pixel = line.Pixel(x);
                                /* Word best brightness formula so far: dest_channel = src_channel + brightness_property*512,
                                   without gamma correction */
//                                GammaCorrect(&pixel,1/gamma_correction_constant);
                                pixel.SetRGBA(Blex::Bound<int>( 0, 255, 128 + (pixel.GetR()-128) * contrast + brightness)
                                             ,Blex::Bound<int>( 0, 255, 128 + (pixel.GetG()-128) * contrast + brightness)
                                             ,Blex::Bound<int>( 0, 255, 128 + (pixel.GetB()-128) * contrast + brightness)
                                             ,pixel.GetA());
//                                GammaCorrect(&pixel,gamma_correction_constant);
                                line.Pixel(x) = pixel;
                        }
                        drawinfo->SetScanline32(y,line);
                }
        }
}

DrawingContainer const * EscherDocument::GetDrawingContainer(uint32_t drawing_container_id) const
{
        for(std::vector<std::shared_ptr<DrawingContainer> >::const_iterator it = drawing_containers.begin();
                it != drawing_containers.end(); ++it)
        {
                if ((*it)->GetContainerId() == drawing_container_id)
                        return it->get();
        }
        throw std::runtime_error("Drawing container not found");
}

void EscherDocument::ContainerReader(RecordData &record, Blex::RandomStream *delay)
{
        //We get drawinggroup containers and drawing containers here..
        switch(record.type)
        {
        case ESCHER_DGGCONTAINER: //F000
                drawing_group_container.reset(new DrawingGroupContainer);
                ReadContainer(record.data, std::bind(&DrawingGroupContainer::ContainerReader, drawing_group_container.get(), std::placeholders::_1, delay));
                return;

        case ESCHER_DGCONTAINER: //F002
                drawing_containers.push_back(std::shared_ptr<DrawingContainer>(new DrawingContainer));
                ReadContainer(record.data, std::bind(&DrawingContainer::ContainerReader, drawing_containers.back().get(), std::placeholders::_1, this));
                return;

        case ESCHER_SPCONTAINER: //F004
                DEBUGPRINT("EscherDocument: Fast-saved escher structure - storing top-level shape directly");
                global_shape_container.reset(new ShapeContainer(*this));
                ReadContainer(record.data, std::bind(&ShapeContainer::ContainerReader, global_shape_container.get(), std::placeholders::_1));
                global_shape_container->CompleteContainer(); //ADDME: shrug, we didn't have virtual Process functions for nothing - this CompleteContainer should have been implied!
                return;

        case ESCHER_BLIP: //F007
                DEBUGPRINT("EscherDocument: Fast-saved escher structure - storing top-level blip directly");
                global_blip_store_entry.reset(new BlipStoreEntry);
                global_blip_store_entry->ProcessData(record, delay);
                return;

        default:
                DEBUGPRINT("EscherDocument: Unrecognized record " << record);
        }
}

void DrawingGroupContainer::ContainerReader(RecordData &record, Blex::RandomStream *delay)
{
        switch(record.type)
        {
        case ESCHER_BSTORECONTAINER: //F001
                blip_store.reset(new BlipStore);
                ReadContainer(record.data, std::bind(&BlipStore::ContainerReader, blip_store.get(), std::placeholders::_1, delay));
                return;
        default:
                DEBUGPRINT("DrawingGroupContainer: Unrecognized record " << record);
        }
}

void BlipStore::ContainerReader(RecordData &record, Blex::RandomStream *delay)
{
        if (record.type == ESCHER_BLIP) //F007
        {
                blip_store_entries.push_back(std::shared_ptr<BlipStoreEntry>(new BlipStoreEntry));
                blip_store_entries.back()->ProcessData(record, delay);
                return;
        }
        DEBUGPRINT("BlipStore: Unrecognized record " << record);
}

void BlipStoreEntry::ContainerReader(RecordData &record)
{
        if (record.type>=0xF01A && record.type<=0xF01F)
        {
                switch (record.type)
                {
                case 0xF01A:
                        blip.reset(new msoBlipEMF(BlipStoreEntry::blipEMF));
                        break;
                case 0xF01B:
                        blip.reset(new msoBlipWMF(BlipStoreEntry::blipWMF));
                        break;
                case 0xF01C:
                        blip.reset(new msoBlipPICT(BlipStoreEntry::blipPICT));
                        break;
                case 0xF01D:
                        blip.reset(new msoBlipJPEG(BlipStoreEntry::blipJPEG));
                        break;
                case 0xF01E:
                        blip.reset(new msoBlipPNG(BlipStoreEntry::blipPNG));
                        break;
                case 0xF01F:
                        blip.reset(new msoBlipDIB(BlipStoreEntry::blipDIB));
                        break;
                }
                blip->ProcessData(record);
                return;
        }
        DEBUGPRINT("BlipStore: Unrecognized record " << record);
}

void DrawingContainer::ContainerReader(RecordData &record, EscherDocument *parentdoc)
{
        switch(record.type)
        {
        case ESCHER_DG: //F008
                drawing_container_id = record.data.DirectReadLsb<uint32_t>(4);
                break;

        case ESCHER_SPGRCONTAINER: //F003
                {
                // If it is a 'ShapeGroupContainer', then add it as the 'patriarch' group:
                        std::unique_ptr<ShapeGroupContainer> patriarch(new ShapeGroupContainer);
                        ReadContainer(record.data, std::bind(&ShapeGroupContainer::ContainerReader, patriarch.get(), std::placeholders::_1, parentdoc));
                        if (patriarch->IsDeleted())
                            break;

                        if(patriarch_shape_group_container.get())
                            DEBUGPRINT("Escher:\a There are TWO active patriarch shape groups");
                        else
                            patriarch_shape_group_container.reset(patriarch.release());
                }
                break;

        case ESCHER_SPCONTAINER: //F004
                // If it is a 'ShapeContainer', then add it as the background shape:
                background_shape_container.reset(new ShapeContainer(*parentdoc));
                ReadContainer(record.data, std::bind(&ShapeContainer::ContainerReader, background_shape_container.get(), std::placeholders::_1));
                background_shape_container->CompleteContainer(); //ADDME: shrug, we didn't have virtual Process functions for nothing - this CompleteContainer should have been implied!
                break;

        default:
                DEBUGPRINT("DrawingContainer: Unrecognized record " << record);
        }
}

void ShapeGroupContainer::ContainerReader(RecordData &record, EscherDocument *parentdoc)
{
        switch(record.type)
        {
        case ESCHER_SPGRCONTAINER: //F003
                {
                        std::shared_ptr<ShapeGroupContainer> newgroup(new ShapeGroupContainer);
                        ReadContainer(record.data, std::bind(&ShapeGroupContainer::ContainerReader, newgroup.get(), std::placeholders::_1, parentdoc));
                        drawables.push_back(newgroup);
                        break;
                }

        case ESCHER_SPCONTAINER: //F004
                {
                        std::unique_ptr<ShapeContainer> newshape(new ShapeContainer(*parentdoc));
                        ReadContainer(record.data, std::bind(&ShapeContainer::ContainerReader, newshape.get(), std::placeholders::_1));
                        newshape->CompleteContainer(); //ADDME: shrug, we didn't have virtual Process functions for nothing - this CompleteContainer should have been implied!
                        if (newshape->is_group_shape)
                        {
                                group_shape_container.reset(newshape.release());
                                shape_id = group_shape_container->shape_id;
                        }
                        else
                        {
                                drawables.push_back(std::shared_ptr<ShapeContainer>(newshape.release()));
                        }
                        break;
                }

        default:
                DEBUGPRINT("ShapeGroupContainer: Unrecognized record " << record);
        }
}

void ShapeContainer::ContainerReader(RecordData &record)
{
        switch(record.type)
        {
        case ESCHER_SPGR: //F009
                if(record.data.GetFileLength() >= 16)
                {
                        uint8_t data[16];
                        record.data.Read(data,16);

                        DrawLib::FPPoint upperleft(getu32lsb(data +  0),  getu32lsb(data +  4));
                        DrawLib::FPPoint lowerright(getu32lsb(data +  8),  getu32lsb(data +  12));

                        group_bounding_box.reset(new DrawLib::FPBoundingBox(upperleft,lowerright));
                }
                break;

        case ESCHER_SP: //F00A
                if(record.data.GetFileLength() >= 6)
                {
                        uint8_t data[6];
                        record.data.Read(data,6);

                        shape_id              = getu32lsb(data);
                        shape_type            = record.instance;
                        is_group_shape        = data[4]&1;
                        is_child              = data[4]&2;
                        is_patriarch          = data[4]&4;
                        is_deleted            = data[4]&8;
                        is_ole_object         = data[4]&16;
                        is_flipped_horizontal = data[4]&64;
                        is_flipped_vertical   = data[4]&128;
                        is_connector          = data[5]&1;
                        has_an_anchor         = data[5]&2;
                        is_background_shape   = data[5]&4;
                }
                break;

        case ESCHER_OPT: //F00B
                properties.ProcessData(record.data);
                break;

        case ESCHER_CHILDANCHOR: //F00F
                if(record.data.GetFileLength() >= 16)
                {
                        uint8_t data[16];
                        record.data.Read(data,16);

                        DrawLib::FPPoint upperleft(getu32lsb(data +  0),  getu32lsb(data +  4));
                        DrawLib::FPPoint lowerright(getu32lsb(data +  8),  getu32lsb(data +  12));
                        bounding_box.reset(new DrawLib::FPBoundingBox(upperleft,lowerright));
                }
                break;


        case ESCHER_CLIENTANCHOR: //F010
                Blex::ReadStreamIntoVector(record.data, &client_anchor);
                break;

        case ESCHER_CLIENTDATA: //F011
                Blex::ReadStreamIntoVector(record.data, &client_data);
                break;

        case ESCHER_CLIENTTEXTBOX: //F00D
                Blex::ReadStreamIntoVector(record.data, &client_textbox);
                break;

        case ESCHER_POSITIONINGDATA: //F122
                Blex::ReadStreamIntoVector(record.data, &positioningdata);
                break;

        default:
                DEBUGPRINT("ShapeContainer: Unrecognized record " << record);
        }
}

std::vector<int32_t> Interface::GetShapeIds(uint32_t drawing_container_id) const
{
        DrawingContainer const *container = doc->GetDrawingContainer(drawing_container_id);
        if(!container)
        {
                DEBUGPRINT("Interface::GetShapeIds: " <<
                          "Didn't find the shape or shapegroup with shapeid = " << drawing_container_id);
                return std::vector<int32_t>();
        }
        ShapeGroupContainer const *patriarch = container->GetPatriarchShapeGroupContainer();
        if(!patriarch)
        {
                DEBUGPRINT("Interface::GetShapeIds: " <<
                          "Didn't find the patriarch for shape  " << drawing_container_id);
                return std::vector<int32_t>();
        }
        return patriarch->GetDrawableIds();
}

int32_t Interface::GetBackgroundShapeId(uint32_t drawing_container_id) const
{
        DrawingContainer const*container = doc->GetDrawingContainer(drawing_container_id);
        if(!container)
        {
                DEBUGPRINT("Interface::GetBackgroundShapeId: " <<
                          "Didn't find the shape or shapegroup with shapeid = " << drawing_container_id);
                return 0;
        }
        ShapeContainer const*background = container->GetBackgroundShapeContainer();
        if(!background)
        {
                DEBUGPRINT("Interface::GetBackgroundShapeId: " <<
                          "Didn't find the background for shapeid " << drawing_container_id);
                return 0;
        }
        return background->GetShapeId();
}

std::vector<uint8_t> Interface::GetClientAnchor(int32_t shapeid)
{
        Drawable const *drawable = doc->FindDrawable(shapeid);
        if (!drawable)
        {
                DEBUGPRINT("Interface::GetClientAnchor: " <<
                          "Didn't find the shape or shapegroup with shapeid = " << shapeid);
                return std::vector<uint8_t>();
        }

        return drawable->GetClientAnchor();
}

std::vector<uint8_t> Interface::GetClientData(int32_t shapeid)
{
        Drawable const *drawable = doc->FindDrawable(shapeid);
        if (!drawable)
        {
                DEBUGPRINT("Interface::GetClientAnchor: " <<
                          "Didn't find the shape or shapegroup with shapeid = " << shapeid);
                return std::vector<uint8_t>();
        }

        return drawable->GetClientData();
}

std::vector<uint8_t> Interface::GetClientTextbox(int32_t shapeid)
{
        Drawable const *drawable = doc->FindDrawable(shapeid);
        if (!drawable)
        {
                DEBUGPRINT("Interface::GetClientAnchor: " <<
                          "Didn't find the shape or shapegroup with shapeid = " << shapeid);
                return std::vector<uint8_t>();
        }

        return drawable->GetClientTextbox();
}

uint32_t Interface::GetTextId(int32_t shapeid) const
{
        Drawable const *drawable = doc->FindDrawable(shapeid);
        if (!drawable)
        {
                DEBUGPRINT("Interface::GetTextId: " <<
                           "Didn't find the shape or shapegroup with shapeid = " << shapeid);
                return 0;
        }
        return drawable->GetTextId();
}

ShapeContainer const * EscherDocument::FindShape(int32_t shapeid) const
{
        if(shapeid==0) //Apparently the clients expect the document to be 'just' a shape

                return GetGlobalShapeContainer();

        // Iterate all drawing containers:
        for(std::vector<std::shared_ptr<DrawingContainer> >::const_iterator it = drawing_containers.begin();
                it != drawing_containers.end(); ++it)
        {
                // First find the ShapeGroupContainer which is the 'patriarch':
                ShapeGroupContainer *spgr = (*it)->GetPatriarchShapeGroupContainer();
                if(!spgr)
                        continue;

                // Now try to find the shape in the ShapeContainer:
                ShapeContainer const* sc = spgr->GetShapeContainerWithId(shapeid);
                if(sc)
                    return sc;
        }

        return NULL;
}

Drawable * EscherDocument::FindDrawable(int32_t shapeid)
{
        if (shapeid==0) //Apparently the clients expect the document to be 'just' a shape
            return GetGlobalShapeContainer();

        // Iterate all drawing containers:
        for(std::vector<std::shared_ptr<DrawingContainer> >::const_iterator it = drawing_containers.begin();
                it != drawing_containers.end(); ++it)
        {
                // Check the background container
                ShapeContainer *background = (*it)->GetBackgroundShapeContainer();
                Drawable * dr = background ? background->GetDrawableWithId(shapeid) : NULL;
                if(dr)
                    return dr;

                // First find the ShapeGroupContainer which is the 'patriarch':
                ShapeGroupContainer *spgr = (*it)->GetPatriarchShapeGroupContainer();
                if(!spgr)
                        continue;

                // Now try to find the drawable in the ShapeContainer:
                dr = spgr->GetDrawableWithId(shapeid);
                if(dr)
                    return dr;
        }

        return NULL;
}


ShapeContainer::ShapeContainer(EscherDocument const &_document)
: document(_document)
, shape_type(0)
, is_child(false)
, is_patriarch(false)
, is_deleted(false)
, is_ole_object(false)
, is_flipped_horizontal(false)
, is_flipped_vertical(false)
, is_connector(false)
, has_an_anchor(false)
, is_background_shape(false)
, properties(&_document)
{
}

uint32_t ShapeContainer::GetTextId() const
{
        return properties.Get(Properties::lTxid);
}


Properties const & ShapeContainer::GetProperties() const
{
        return properties;
}

void ShapeContainer::CompleteContainer()
{
        // If this is a group shape, no further action needs to be done.
        if(is_group_shape)
                return;

        escher_shape.reset(EscherShape::ShapeFactory(*this));
        // It should have been created now:
        //if(escher_shape.get() == NULL)
        //    throw std::runtime_error("Escher shape type " + Blex::AnyToString(shape_type) + " not initialized");
}

/* The update transformation state code is critical for the correct implementation
   of rotation and flipping in escher! The following test documents are very
   useful for verifying any modifications to this code:
   - Arrow.doc: tests positioning of objects inside groups after flipping&rotating
   - flippingandrotating.doc: the arrows test proper handling of bbox flips (vertical text)
                              the houses test proper handling of flip-in-flip
   - Flipping arrows.doc: tests proper handling of rotations and flipping combos
   With all the mostly-perfect implementations I tried, one of these three docs always failed.
*/

void ShapeContainer::UpdateTransformationState(TransformationState *state, DrawLib::FPBoundingBox const &bbox, DrawLib::FPBoundingBox const &coordinate_system) const
{
        float rotation = properties.GetAsFloatFrom16_16(Properties::rotation, 0.0f);

        // Is the bbox width/height flipped? Happens in the 45-135 and 225-315 rotation space.
        int normalized_rotation = int(rotation);
        while(normalized_rotation<0) normalized_rotation+=360;
        while(normalized_rotation>=360) normalized_rotation-=360;
        state->text_is_vertical = (normalized_rotation%180)>=45 && (normalized_rotation%180)<135;

        // Where is this shape positioned inside its parent? Simply take the
        // current transformation, and calculate how to move our origin to the
        // center of the final location
        DrawLib::FPPoint center_bbox ( (bbox.upper_left.x + bbox.lower_right.x)/2, (bbox.upper_left.y + bbox.lower_right.y)/2 );
        DrawLib::FPPoint final_center = center_bbox * state->stored_transformation;

        //Get local X and Y scaling factors (if text_is_vertical, our bbox has x and y-width flipped
        float scale_x = (state->text_is_vertical ? bbox.GetHeight() : bbox.GetWidth()) / coordinate_system.GetWidth();
        float scale_y = (state->text_is_vertical ? bbox.GetWidth() : bbox.GetHeight()) / coordinate_system.GetHeight();

        //Update total scaling to integrate our local scaling
        if (state->text_is_vertical) //Arnold: I don't understand exactly why this is needed, it can probably be solved more cleanly
            std::swap(state->scaling.eM11,state->scaling.eM22);
        state->scaling = DrawLib::XForm2D(scale_x,0,0,scale_y,DrawLib::FPPoint()) * state->scaling;

        // Calculate flipping and rotation. Rotate first, then flip, ad infinitum for every shape. Note that rotations in a sub-group can be dependent on our flipping.
        DrawLib::XForm2D flipper = DrawLib::XForm2D(is_flipped_horizontal ? -1 : 1,0,0,
                                                    is_flipped_vertical ? -1 : 1,
                                                    DrawLib::FPPoint(0,0));
        DrawLib::XForm2D thisrotation = DrawLib::XForm2D((rotation/360.0)*2*M_PI, DrawLib::FPPoint(1,1), DrawLib::FPPoint(0,0));
        // Integrate our flipping and rotation into the total matrix (we're working outside-in, so we need to left-multiply)
        state->rotational_matrix = thisrotation * flipper * state->rotational_matrix;

        //Calculate final transformation for the current object

        //Step 1: center our rendered image, so that it is center is at the origin (transformations are easier at the origin)
        state->stored_transformation = DrawLib::XForm2D(1,0,0,1,Escher::GetBBoxCenter(coordinate_system)*-1);
        //Step 2: scale our image
        state->stored_transformation *= state->scaling;
        //Step 3: rotate and flip the image
        state->stored_transformation *= state->rotational_matrix;
        //Step 4: move the image from origin to its final location
        state->stored_transformation *= DrawLib::XForm2D(1,0,0,1,final_center);

        //FIXME: Can we update the cropping here?

        DEBUGPRINT("Update transformation for shape " << shape_id << " = " << state->stored_transformation);
        DEBUGPRINT(" Final upper left at " << DrawLib::FPPoint(coordinate_system.upper_left.x,coordinate_system.upper_left.y) * state->stored_transformation << " upper right at " << DrawLib::FPPoint(coordinate_system.lower_right.x,coordinate_system.upper_left.y) * state->stored_transformation);
        DEBUGPRINT(" Final lower left at " << DrawLib::FPPoint(coordinate_system.upper_left.x,coordinate_system.lower_right.y) * state->stored_transformation << " lower right at " << DrawLib::FPPoint(coordinate_system.lower_right.x,coordinate_system.lower_right.y) * state->stored_transformation);
        DEBUGPRINT(" Final bounding box  " << coordinate_system * state->stored_transformation << " dimensions = " << (coordinate_system * state->stored_transformation).GetWidth() << "x" << (coordinate_system * state->stored_transformation).GetHeight());
}

//******************************************************************************
//**                             BlipStoreEntry structure                          **
//******************************************************************************
BlipStoreEntry::BlipStoreEntry()
{
        Win32=MacOS=blipUNKNOWN;
        usage=blipDefault;
        tag=0;
        size=refcount=offset=0;
}

BlipStoreEntry::~BlipStoreEntry()
{
}

void BlipStoreEntry::ProcessData(RecordData &record, Blex::RandomStream *delay)
{
        if (record.data.GetFileLength()<36)
        {
                DEBUGPRINT("Escher record BlipStoreEntry length is too small");
                return;
        }

        Win32=(BlipType)record.data.ReadLsb<uint8_t>();
        MacOS=(BlipType)record.data.ReadLsb<uint8_t>();
        record.data.Read(uid,sizeof(uid));
        tag=record.data.ReadLsb<uint16_t>();
        size=record.data.ReadLsb<uint32_t>();
        refcount=record.data.ReadLsb<uint32_t>();
        offset=record.data.ReadLsb<uint32_t>();
        usage=(BlipUsage)record.data.ReadLsb<uint8_t>();
        unsigned blipnamesize = record.data.ReadLsb<uint8_t>();
        /*unused 2*/ record.data.ReadLsb<uint8_t>();
        /*unused 3*/ record.data.ReadLsb<uint8_t>();

        //if refcount is 0, we're not a real blip. don't try to interpret
        //delay streams or following data, because they are bogus!
        if (refcount==0)
            return;

        blipname.resize( blipnamesize/2 );
        for (unsigned i=0;i< blipname.size() ;++i)
            blipname[i] = record.data.ReadLsb<uint16_t>();

        if (delay) //blip data is in a separate stream
        {
                Blex::LimitedStream picdata(offset,offset+size,*delay);
                ReadContainer(picdata, std::bind(&BlipStoreEntry::ContainerReader, this, std::placeholders::_1));
        }
        else
        {
                //get data from 'behind us'.
                Blex::LimitedStream subdata(record.data.GetOffset(), record.data.GetFileLength(), record.data);
                ReadContainer(subdata, std::bind(&BlipStoreEntry::ContainerReader, this, std::placeholders::_1));
        }
}

BlipStoreEntry const * BlipStore::GetBlipBySeq(unsigned num) const
{
        // Num varies from 1 to n so:
        --num;

        if(num >= blip_store_entries.size())
                return NULL;

        return blip_store_entries.begin()[num].get();
}

//******************************************************************************
//**                              msoBlip structure                           **
//******************************************************************************
msoBlip::msoBlip(BlipStoreEntry::BlipType type) : my_blip_type(type)
{
}

msoBlip::~msoBlip()
{
}

DrawLib::BitmapInterface * msoBlip::GetUnprocessedBitmap() const
{
        //Probably because its a vector image? :)
        throw std::runtime_error("An unprocessed bitmap not available for this image type");
}

BlipStoreEntry::BlipType msoBlip::GetBlipType() const
{
        return my_blip_type;
}

DrawLib::BitmapInterface *msoBlipDIB::GetResizedBitmap(DrawLib::ISize const &finalsize) const
{
        DEBUGPRINT("msoBlipDIB::GetResizedBitmap");
        std::unique_ptr<Blex::RandomStream> picdata;
        picdata.reset(GetPictureData().release());

        std::unique_ptr<DrawLib::DIB_GraphicsReader> reader;
        reader.reset(new DrawLib::DIB_GraphicsReader(picdata.get(),true)); /* ADDME: might also be palette= false? don't know the rules here.. */
        return DrawLib::CreateResizedBitmapFromReader(*reader,finalsize);
}

DrawLib::BitmapInterface *msoBlip::GetResizedBitmap(DrawLib::ISize const &finalsize) const
{
        DEBUGPRINT("msoBlip::GetResizedBitmap");
        std::unique_ptr<Blex::RandomStream> picdata;
        picdata.reset(GetPictureData().release());
        return DrawLib::CreateBitmap32Magic(picdata.get(), finalsize);
}

DrawLib::BitmapInterface *msoBlip::GetCroppedAndResizedBitmap(
        DrawLib::ISize const &bitmapsize,
        BlipRenderProperties const &props) const
{
          // only resize and blit... (FIXME DRAWLIB: Inconsistent, magic wants separate newsizes, resizedbitmap doesnt)

          std::unique_ptr<DrawLib::BitmapInterface > resized_bitmap;
          resized_bitmap.reset(GetResizedBitmap(bitmapsize));
          if (resized_bitmap.get()==NULL)
                  throw(std::runtime_error("msoBlip::CropResizeAndBlitBitmap could not resize the bitmap."));

          if (props.pictureGray == true)
                  DrawLib::MakeBitmapGreyscale(resized_bitmap.get(), 1.0f);

          return resized_bitmap.release();
}

msoBlipVector::msoBlipVector(BlipStoreEntry::BlipType type) : msoBlip(type)
{
        compression=msocompressionNone;
        filter=msofilterNone;
        cachesize=0;
        boundsleft=boundstop=boundsright=boundsbottom=0;
        sizeh=sizev=0;
        savedsize=0;
}

msoBlipEMF::msoBlipEMF(BlipStoreEntry::BlipType type) : msoBlipVector(type) {}
msoBlipWMF::msoBlipWMF(BlipStoreEntry::BlipType type) : msoBlipVector(type) {}
msoBlipPICT::msoBlipPICT(BlipStoreEntry::BlipType type) : msoBlipVector(type) {}
msoBlipJPEG::msoBlipJPEG(BlipStoreEntry::BlipType type) : msoBlip(type) {}
msoBlipDIB::msoBlipDIB(BlipStoreEntry::BlipType type) : msoBlip(type) {}
msoBlipPNG::msoBlipPNG(BlipStoreEntry::BlipType type) : msoBlip(type) {}

unsigned msoBlipEMF::GetSignature()
{
        //These signatures are hard-coded in the Escher spec
        return 0x3DF;
}

unsigned msoBlipWMF::GetSignature()
{
        //These signatures are hard-coded in the Escher spec
        return 0x216;
}

unsigned msoBlipPICT::GetSignature()
{
        //These signatures are hard-coded in the Escher spec
        return 0x542;
}

unsigned msoBlipJPEG::GetSignature()
{
        //These signatures are hard-coded in the Escher spec
        return 0x46A;
}

unsigned msoBlipPNG::GetSignature()
{
        //These signatures are hard-coded in the Escher spec
        return 0x6E0;
}

unsigned msoBlipDIB::GetSignature()
{
        //These signatures are hard-coded in the Escher spec
        return 0x7A8;
}

std::unique_ptr<Blex::RandomStream> msoBlip::GetPictureData() const
{
        std::unique_ptr<Blex::RandomStream> retval;
        retval.reset(new Blex::MemoryReadStream(&temp_datastore[0], temp_datastore.size()));
#if defined(DEBUG) && defined(DUMPPNG)
        DEBUGPRINT("\aDUMPING PNG");
        std::unique_ptr<Blex::FileStream> file;
        file.reset(Blex::FileStream::OpenWrite(Blex::CreateTempName("C:/temp/test-png-") + ".png", true, true, 0));
        file->SetFileLength(0);
        retval->SendAllTo(*file);
        retval->SetOffset(0);
#endif
        return retval;
}

void msoBlip::ProcessData(RecordData &record)
{
        /* We need to perform Fuzzy MS Logic(tm) to figure out the right start position
           (actually, we need to XOR the instance number with the MSOBI, and if that
           turns out to be one, skip the 'primary UID'. Whatever those MS coders are
           smoking, I want it too */
        if ( (record.instance ^ GetSignature()) == 1)
            record.data.SetOffset(record.data.GetOffset()+16);

        ProcessGraphicsData(record.data);

        /* FIXME: This may cause some bugs but... for blipEMF, blipWMF blipPICT
           the actual code was:
           datalength = savedsize - 2;
           though one would expect the general case. Using the general case for
           now, probably wrong, and added a DEBUG to figure out what is going
           on here */
        ReadStreamIntoVector(record.data, &temp_datastore);
}

void msoBlipVector::ProcessGraphicsData(Blex::Stream &str)
{
        uint8_t data[52];
        if (str.Read(data,sizeof data)< sizeof data)
            throw std::runtime_error("msoBlipVector: stored vector data corrupted");

        cachesize=getu32lsb(data+16);
        boundsleft=getu32lsb(data+20);
        boundstop=getu32lsb(data+24);
        boundsright=getu32lsb(data+28);
        boundsbottom=getu32lsb(data+32);
        sizeh=getu32lsb(data+36);
        sizev=getu32lsb(data+40);
        savedsize=getu32lsb(data+44);
        compression=(CompressType)data[48];
        filter=(FilterType)data[49];
}

void msoBlipJPEG::ProcessGraphicsData(Blex::Stream &data)
{
        //Just swallow 17 bytes..
        uint8_t skip[17];
        data.Read(skip,sizeof skip);
}

void msoBlipPNG::ProcessGraphicsData(Blex::Stream &data)
{
        //Just swallow 17 bytes..
        uint8_t skip[17];
        data.Read(skip,sizeof skip);
}

void msoBlipDIB::ProcessGraphicsData(Blex::Stream &data)
{
        //Just swallow 17 bytes..
        uint8_t skip[17];
        data.Read(skip,sizeof skip);
}

void msoBlipVector::PaintYourself(ShapeDrawParameters const &pars, const BlipRenderProperties &props) const
{
        std::unique_ptr<Blex::RandomStream> inpicture;
        inpicture.reset(GetPictureData().release());

        //if the data is compressed, decompress it!
        if (compression == msocompressionDeflate)
        {
                DEBUGPRINT("Deflated graphic, gotta decompress it");
                //Get 0x7FFFFFFF bytes, there's no safe way to determine how many bytes were really compressed
                std::unique_ptr<Blex::Stream> in_stream( Blex::ZlibDecompressStream::OpenRaw(*inpicture, 0x7FFFFFFF) );
                PaintSelfUncompressed(pars,props, *in_stream);
        }
        else if (compression == msocompressionNone)
        {
                PaintSelfUncompressed(pars,props, *inpicture);
        }
        else
        {
                DEBUGPRINT("Unknown compression algorithm used on graphics file");
        }
}

void msoBlipEMF::PaintSelfUncompressed(ShapeDrawParameters const &pars, const BlipRenderProperties &/*props*/, Blex::Stream &picture) const
{
        if (!pars.bitmap)
            return;

        std::unique_ptr<uint8_t[]> wmfdata(new uint8_t[cachesize]);
        // fill temp buffer..
        picture.Read(wmfdata.get(), cachesize);

        /* FIXME: Don't translate to bounding box, render the true picture */
        DrawLib::FPBoundingBox bbox(-1,-1,1,1);
        bbox *= pars.stored_transformation;
        //bbox *= pars.final_transformation;

        DEBUGPRINT("EMF PaintSelfUncompressed. bbox " << bbox << " stored xform " << pars.stored_transformation << " final xform " << pars.final_transformation);

        DrawLib::RenderWmfEmf(*pars.bitmap, bbox, wmfdata.get(), cachesize, pars.final_transformation);
}

void msoBlipWMF::PaintSelfUncompressed(ShapeDrawParameters const &pars, const BlipRenderProperties &/*props*/, Blex::Stream &picture) const
{
        if (!pars.bitmap)
            return;

        std::unique_ptr<uint8_t[]> wmfdata(new uint8_t[cachesize]);
        // fill temp buffer..
        picture.Read(wmfdata.get(), cachesize);

        /* FIXME: Don't translate to bounding box, render the true picture */
        DrawLib::FPBoundingBox bbox(-1,-1,1,1);
        bbox *= pars.stored_transformation;
        //bbox *= pars.final_transformation;

        DEBUGPRINT("WMF PaintSelfUncompressed. bbox " << bbox << " stored xform " << pars.stored_transformation << " final xform " << pars.final_transformation);

        DrawLib::RenderWmfEmf(*pars.bitmap, bbox, wmfdata.get(), cachesize, pars.final_transformation);
}

void msoBlipPICT::PaintSelfUncompressed(ShapeDrawParameters const &pars, const BlipRenderProperties &/*props*/, Blex::Stream &picture) const
{
        if (!pars.bitmap)
            return;

        std::unique_ptr<uint8_t[]> pictdata(new uint8_t[cachesize]);
        // fill temp buffer..
        picture.Read(pictdata.get(), cachesize);

        /* FIXME: Don't translate to bounding box, render the true picture */
        DrawLib::FPBoundingBox bbox(-1,-1,1,1);
        bbox *= pars.stored_transformation;
        bbox *= pars.final_transformation;

        DrawLib::RenderPict(*pars.bitmap, bbox, pictdata.get(), cachesize);
}

void msoBlip::PaintYourself(ShapeDrawParameters const &pars, const BlipRenderProperties &props) const
{
        if (!pars.bitmap)
            return;

        /* Get the image resolution first */
        DrawLib::FPPoint upper_left(-1,-1);
        DrawLib::FPPoint upper_right(1,-1);
        DrawLib::FPPoint lower_left(-1, 1);
        DrawLib::FPPoint lower_right(1, 1);
        DrawLib::FPPoint center(0,0);

        DrawLib::XForm2D realtransform = pars.stored_transformation * pars.final_transformation;

        upper_left *= realtransform;
        upper_right *= realtransform;
        lower_left *= realtransform;
        lower_right *= realtransform;
        center *= realtransform;

        float width = (upper_right-upper_left).Norm();
        float height = (upper_left-lower_left).Norm();

        std::unique_ptr<DrawLib::BitmapInterface > cropped_resized_bitmap;
        DrawLib::ISize newsize(width + 0.5, height + 0.5); //ADDME: Maybe float to integer rounding should be done in Drawlib

        /* If the bitmap _almost_ covers the entire drawing area, stretch it to
           completely cover it (avoid small white lines around simple embedded bitmaps)
           See also BBB#412 */
        if(newsize.width >= 2
           && newsize.height >= 2
           && (newsize.width == (signed)pars.bitmap->GetWidth() || newsize.width+1 == (signed)pars.bitmap->GetWidth())
           && (newsize.height == (signed)pars.bitmap->GetHeight() || newsize.height+1 == (signed)pars.bitmap->GetHeight())
           )
        {
                newsize.width = pars.bitmap->GetWidth();
                newsize.height = pars.bitmap->GetHeight();
        }

        cropped_resized_bitmap.reset(GetCroppedAndResizedBitmap(newsize, props));

        DrawLib::Canvas32 blitcanvas(pars.bitmap);

        blitcanvas.SetAlphaMode(DrawLib::Canvas32::BLEND255);

        /* Create a translation that moves bitmap coordinates (0..width, 0..height) into the -1,-1,1,1 space
        DrawLib::XForm2D bitmap_to_store(2.0/width,0,0,2.0/height,DrawLib::FPPoint(-1,-1));

        DrawLib::DrawObject(&blitcanvas).DrawBitmap(*cropped_resized_bitmap, bitmap_to_store * realtransform.GetRotation());
        */
        DrawLib::XForm2D bitmap_to_store(realtransform.GetRotation()
                                        , DrawLib::FPPoint(upper_left.x > lower_right.x ? -1 : 1, upper_left.y > lower_right.y ? -1 : 1)
                                        , upper_left);
        DrawLib::DrawObject(&blitcanvas).DrawBitmap(*cropped_resized_bitmap, bitmap_to_store);
}

DrawLib::BitmapInterface *msoBlipJPEG::GetUnprocessedBitmap() const
{
        std::unique_ptr<Blex::RandomStream> str;
        str.reset(GetPictureData().release());
        return DrawLib::CreateBitmap32FromJPG(str.get(), 1);
}
DrawLib::BitmapInterface *msoBlipPNG::GetUnprocessedBitmap() const
{
        std::unique_ptr<Blex::RandomStream> str;
        str.reset(GetPictureData().release());
        return DrawLib::CreateBitmap32FromPNG(str.get());
}
DrawLib::BitmapInterface *msoBlipDIB::GetUnprocessedBitmap() const
{
        std::unique_ptr<Blex::RandomStream> str;
        str.reset(GetPictureData().release());
        return DrawLib::CreateBitmap32FromBMP(str.get(), false, false);
}

ShapeContainer const * ShapeGroupContainer::GetShapeContainerWithId  (int32_t shape_id) const
{
        // Just iterate all members and see wether they can deliver the shape container:
        for(std::vector<std::shared_ptr<Drawable> >::const_iterator it = drawables.begin();
                it != drawables.end(); ++it)
        {
                ShapeContainer const *sc = (*it)->GetShapeContainerWithId(shape_id);
                if(sc)
                     return sc;
        }

        return NULL;
}

Drawable * ShapeGroupContainer::GetDrawableWithId(int32_t _shape_id)
{
        if(shape_id == _shape_id)
                return this;

        for(std::vector<std::shared_ptr<Drawable> >::const_iterator it = drawables.begin();
                it != drawables.end(); ++it)
        {
                Drawable *dr = (*it)->GetDrawableWithId(_shape_id);
                if(dr) return dr;
        }

        return NULL;
}

std::vector<int32_t> ShapeGroupContainer::GetDrawableIds() const
{
        std::vector<int32_t> id_list;
        for(std::vector<std::shared_ptr<Drawable> >::const_iterator it = drawables.begin();
                it != drawables.end(); ++it)
            id_list.push_back((*it)->GetShapeId());

        return id_list;
}

DrawLib::FPBoundingBox ShapeContainer::InitializeAndGetBoundingBox(TransformationState const&pars, DrawLib::FPBoundingBox const &your_own_boundingbox)
{
        // The group shape is no real shapeand does not need any scaling and translating:
        // Not shape just containing data for a super-record ?:
        if(is_patriarch || is_group_shape) //ADDME: Shouldn't ever get here?!
            throw std::runtime_error("Escher: requesting size of a groupshape's shape cotainer");

        TransformationState localpars(pars);
        UpdateTransformationState(&localpars, your_own_boundingbox, DrawLib::FPBoundingBox(-1, -1, 1, 1));

        if(!escher_shape.get())
                return DrawLib::FPBoundingBox(0, 0, 0, 0);

        return escher_shape->ApplyToCanvas(localpars);
}

void ShapeContainer::Draw(ShapeDrawParameters const &drawparameters, DrawLib::FPBoundingBox const &your_own_boundingbox) const
{
        // Did this shape not form itself for any reason ?:
        if(!escher_shape.get())
        {
                if(!is_patriarch && !is_group_shape )
                        DEBUGPRINT("A shape with type " << shape_type << " was not initialized");
                return;
        }

        ShapeDrawParameters localpars(drawparameters);
        UpdateTransformationState(&localpars, your_own_boundingbox, DrawLib::FPBoundingBox(-1, -1, 1, 1));

        if(!escher_shape.get())
                return;

        escher_shape->Draw(localpars);
}

DrawLib::FPBoundingBox ShapeGroupContainer::InitializeAndGetBoundingBox(TransformationState const &pars, DrawLib::FPBoundingBox const &your_own_boundingbox)
{
        if (!group_shape_container.get() || !group_shape_container->group_bounding_box.get())
            throw std::runtime_error("Escher: missing a group bounding box"); //ADDME: If this actually happens, we could make a bounding box out of all our child bounding boxes?

        //FIXME: Deal with volume-less groups?!
        DrawLib::FPBoundingBox group_coordinate_system = *group_shape_container->group_bounding_box;
        if ( (group_coordinate_system.GetWidth() * group_coordinate_system.GetHeight()) == 0)
            throw std::runtime_error("Escher: group without volume");

        TransformationState localpars(pars);
        group_shape_container->UpdateTransformationState(&localpars,your_own_boundingbox,group_coordinate_system);

        //Let the initial bounding box simply contain our center.
        DrawLib::FPPoint center = Escher::GetBBoxCenter(group_coordinate_system) * localpars.stored_transformation;
        DrawLib::FPBoundingBox fullboundingbox(center,center);

        DEBUGPRINT("Group bbox calculation! group coord system " << group_coordinate_system);
        DEBUGPRINT("Initial transformation " << pars.stored_transformation << ", group inner transform " << localpars.stored_transformation);

        // Iterate all children and do the same with them:
        for(std::vector<std::shared_ptr<Drawable> >::const_iterator it = drawables.begin();
                it != drawables.end(); ++it)
        {
                DrawLib::FPBoundingBox *child_anchor = (*it)->GetChildAnchor();
                if (!child_anchor)
                    throw std::runtime_error("Escher: missing a group shape's bounding box");

                DrawLib::FPBoundingBox sub_bounding_box = (*it)->InitializeAndGetBoundingBox(localpars, *child_anchor);
                DEBUGPRINT("Subshape bounding. Local bounding box " << sub_bounding_box);
                fullboundingbox.ExtendTo(sub_bounding_box);
                DEBUGPRINT("Final box is now " << fullboundingbox);
        }
        return fullboundingbox;
}

void ShapeGroupContainer::Draw(ShapeDrawParameters const &drawparameters, DrawLib::FPBoundingBox const &your_own_boundingbox) const
{
        DrawLib::FPBoundingBox group_coordinate_system = *group_shape_container->group_bounding_box;
        if ( (group_coordinate_system.GetWidth() * group_coordinate_system.GetHeight()) == 0)
            throw std::runtime_error("Escher: group without volume");

        ShapeDrawParameters localpars(drawparameters);
        group_shape_container->UpdateTransformationState(&localpars,your_own_boundingbox,group_coordinate_system);

        // Iterate all children and draw them:
        //FIXME: what about cropping/color settings for the children?
        for(std::vector<std::shared_ptr<Drawable> >::const_iterator it = drawables.begin();
                it != drawables.end(); ++it)
        {
              (*it)->Draw(localpars, *(*it)->GetChildAnchor());
        }
}
DrawLib::FPBoundingBox Interface::GetBoundingBox(int32_t shapeid,DrawLib::FPSize const &rendered_pixelsize) const
{
        //FIXME: We should be properly const!

        //Find the shape or group of shapes itself first:
        Drawable *drawable = const_cast<Interface*>(this)->doc->FindDrawable(shapeid);
        if (!drawable)
        {
                DEBUGPRINT("Interface::UpdateBoundingBox: " <<
                           "Didn't find the shape or shapegroup with shapeid = " << shapeid);
                return DrawLib::FPBoundingBox(0,0,1,1);
        }

        if (!drawable->cache_outer_bounding_box.get())
        {
                drawable->cache_outer_bounding_box.reset(new DrawLib::FPBoundingBox);

                DrawLib::FPBoundingBox renderbox(0,0,rendered_pixelsize.width,rendered_pixelsize.height);

                TransformationState initialpars;
                DrawLib::FPBoundingBox fullbox = drawable->InitializeAndGetBoundingBox(initialpars, renderbox);
                DEBUGPRINT("Picture " << shapeid << " maps from " << renderbox << " to " << fullbox);

                *drawable->cache_outer_bounding_box=fullbox;
        }
        return *drawable->cache_outer_bounding_box;
}

void Interface::ReadDocument(Blex::RandomStream &escherdata, Blex::RandomStream *delaydata)
{
        #ifdef DEBUG
        Blex::FileOffset start = escherdata.GetOffset();
        ReadContainer(escherdata, std::bind(&DebugContainerReader,
                std::placeholders::_1, delaydata, &std::clog, 0));
        escherdata.SetOffset(start);
        #endif


        ReadContainer(escherdata, std::bind(&EscherDocument::ContainerReader, doc, std::placeholders::_1, delaydata));
}

//Needed by powerpoint, which has the escher tree in broken parts
void Interface::ReadDggContainer(Blex::RandomStream &dggContainer, Blex::RandomStream *delaydata)
{
        ReadContainer(dggContainer, std::bind(&EscherDocument::ContainerReader, doc, std::placeholders::_1, delaydata));
}

//Needed by powerpoint, which has the escher tree in broken parts
uint32_t Interface::ReadDgContainer(Blex::RandomStream &dgContainer, Blex::RandomStream *delaydata)
{
        ReadContainer(dgContainer, std::bind(&EscherDocument::ContainerReader, doc, std::placeholders::_1, delaydata));
        return doc->GetLastDrawingContainer()->GetContainerId();
}

//FIXME: Proper UTF16 decoder
std::string UTF16_to_UTF8(const void *data, unsigned datalen)
{
        const uint8_t *dataptr = static_cast<const uint8_t*>(data);
        std::string retval;

        Blex::UTF8Encoder<std::back_insert_iterator<std::string> > encoder(std::back_inserter(retval));
        for (unsigned i=0;i<datalen;++i)
        {
                uint16_t thisbyte = Blex::getu16lsb(dataptr);
                if (thisbyte == 0)
                    break;
                dataptr+=2;
                encoder(thisbyte);
        }

        return retval;
}

void Interface::GetShapeImageInfo(int32_t shapeid, Parsers::ImageInfo *imageinfo) const
{
        assert(imageinfo);
        ShapeContainer const *shape = doc->FindShape(shapeid);
        if (!shape)
            return;

        Properties const &properties = shape->GetProperties();

        // Read the ALT tag. This complex property is UCS-2/UTF-16 encoded
        std::vector<uint8_t> const text = properties.GetComplex(Properties::wzDescription); //Alt tag!
        imageinfo->alttag = UTF16_to_UTF8(&text[0], text.size()/2);
        // Remove CRs
        while(true)
        {
                std::string::iterator cr = std::find(imageinfo->alttag.begin(), imageinfo->alttag.end(), '\r');
                if(cr==imageinfo->alttag.end())
                    break;
                imageinfo->alttag.erase(cr);
        }

        // Get the animated gif data, if any
        GetShapeGifData(shapeid, &imageinfo->animated_gif);

        // Get alignment data

        /* The F122 property stores alignment data as some sort of opcode structure.
           Each opcode is 6 bytes. The blocks seem to terminate with <BF,3,0,80,80,FF>, no
           clue what that code would indicate

          <bf,1,0,0,60,0> Inline with text

          No 8f: Horziontal Absolute
          <911,1> Horizontal Left
          <911,2> Horizontal Center
          <911,3> Horizontal Right
          <911,4> Horizontal Inside
          <911,5> Horizontal Outside

          No 90: ... of column
          <90,3,0,0,0,0> Horizontal ... of Margin
          <90,3,1,0,0,0> Horizontal ... of Page
          <90,3,3,0,0,0> Horizontal ... of Character

          No 91: Vertical Absolute
          <91,3,1,0,0,0> Vertical top relative
          <91,3,3,0,0,0> Vertical bottom relative
          <91,3,2,0,0,0> Vertical centered relative

          No 92: .... of paragraph
          <92,3,0,0,0,0> Vertical ... of margin
          <92,3,1,0,0,0> Vertical ... of page
          <92,3,3,0,0,0> Vertical ... of line
        */

        std::vector<uint8_t> const &shapeprops = shape->GetPositioningData(); //ADDME this is the msofbtTertiaryOPT or so, odd. Block #3 properties, eg 2000+ stuff
        unsigned pos = 0;
        while(pos + 6 < shapeprops.size())
        {
                uint16_t pidstruct = Blex::getu16lsb(&shapeprops[pos]);
                unsigned pid = pidstruct & 0x3FFF;
                //ADDME support fbid and fcomplex
                unsigned op = Blex::getu32lsb(&shapeprops[pos+2]);
                pos+=6;

                DEBUGPRINT("pid " << pid << " op " << op);
                if(pid==911 && op==3)
                    imageinfo->align=2; //right
                if(pid==911 && op==1)
                    imageinfo->align=1; //left
        }
/*                if(posdata[0]==0x8F && posdata[2]==1)
                    imageinfo->align=1; //left
*/


        // Get wrapping information
        imageinfo->wrapping.top    = static_cast<int>(properties.GetAsPixelsFromEMUs(Properties::dyWrapDistTop,    0)*15 + 0.5);
        imageinfo->wrapping.left   = static_cast<int>(properties.GetAsPixelsFromEMUs(Properties::dxWrapDistLeft,  12)*15 + 0.5);
        imageinfo->wrapping.bottom = static_cast<int>(properties.GetAsPixelsFromEMUs(Properties::dyWrapDistBottom, 0)*15 + 0.5);
        imageinfo->wrapping.right  = static_cast<int>(properties.GetAsPixelsFromEMUs(Properties::dxWrapDistRight, 12)*15 + 0.5);
}

Parsers::Hyperlink Interface::GetShapeHyperlink(int32_t shapeid) const
{
        //ADDME: Share code with word_fields - eg the CreateHyperlink autocorrect of encodings in hyperlinks

        static const uint8_t stdhlink_clsid[16]={0xD0,0xC9,0xEA,0x79,0xF9,0xBA,0xCE,0x11,
                                            0x8C,0x82,0x00,0xAA,0x00,0x4B,0xA9,0x0B};
        static const uint8_t urlmonik_clsid[16]={0xE0,0xC9,0xEA,0x79,0xF9,0xBA,0xCE,0x11,
                                            0x8C,0x82,0x00,0xAA,0x00,0x4B,0xA9,0x0B};
        static const uint8_t filemonik_clsid[16]={0x03,0x03,0x00,0x00,0x00,0x00,0x00,0x00,
                                             0xC0,0x00,0x00,0x00,0x00,0x00,0x00,0x46};

        ShapeContainer const *shape = doc->FindShape(shapeid);
        if (!shape)
            return Parsers::Hyperlink();

        Properties const &properties = shape->GetProperties();
        std::vector<uint8_t> const hyperlink = properties.GetComplex(Properties::pihlShape);

        /* This is a scary embedded format. This is what I already found out.
           - The object itself is probably a streamed COM object. CLSID
             is 79EAC9D0-BAF9-11CE-8C82-00AA004BA90B (StdHlink)
           - Offset 16 and 20 contain a DWord

           - Object may contain a URL Moniker. That CLSID is
                79EAC9E0-BAF9-11CE-8C82-00AA004BA90B (URL Moniker)

           - Other moniker?
                00000303-0000-0000-C000-000000000046

           Example packets I found. There will probably be more. The second
           DWORD in StdHLink is a bitmask indicating what might follow. A
           <STR-BYTELEN> is a <DWORD> followed by a nul-terminated <UCS2> part,
           where the DWORD is the length of the following part in bytes
           <STR-WORDLEN> is a <DWORD> followed by a nul-terminated ,UCS2> part
           where the DWORD is the length of teh following part in 16bit words

           OPEN IN NEW WINDOW:
           <CLSID StdHLink> <DWORD:2> <DWORD:0x83> <STR-WORDLEN:_blank\0> <CSLID URLMoniker> <STR-BYTELEN:http...\0>

           OPEN NORMAL, ANCHOR test:
           <CLSID StdHLink> <DWORD:2> <DWORD:0x0B> <CSLID URLMoniker> <DWORD:40> <UCS2:http(40bytes)\0> <DWORD:5> <UCS2:test\0>

           OPEN ENTIRE PAGE, ANCHOR test:
           <CLSID StdHLink> <DWORD:2> <DWORD:0x8B> <DWORD:5> <UCS2:_top\0> <CSLID URLMoniker> <DWORD:40> <UCS2:http(40bytes)\0> <DWORD:5> <UCS2:test\0>

           OPEN ENTIRE PAGE, to bookmark in document, screentip, :
           <CLSID StdHLink> <DWORD:2> <DWORD:0x88> <STR-WORDLEN:_top\0> <STR-WORDLEN:bookmark\0> ...

           LINK TO LOCAL FILE:
           <CLSID StdHLink> <DWORD:2> <DWORD:1> <CLSID Filemoniker> <WORD:0> <STR-WORLD:filename\0> <DWORD:DEADFFFF> <24:0>

           <CLSID StdHLink> <DWORD:2> <DWORD:1> <CLSID Filemoniker> <WORD:0> <STR-WORLD:short name\0> <DWORD:DEADFFFF> <20:0> <DWORD:106> <DWORD:100> <DWORD:3> <100 bytes of UCS2 data>

           Het derde D-Word
           bit 7: Hyperlink target volgt
           bit 3: Anchor volgt (kan dus interne bookmark zijn, of anchor van een link)
           bit 1 of 0: URL Moniker volgt

           Scan http://xml.openoffice.org/source/browse/xml/oox/source/dump/biffdumper.cxx?view=markup for more info
        */
        Parsers::Hyperlink hlink;
        if (hyperlink.size() < 24 || !std::equal(&hyperlink[0],&hyperlink[16],stdhlink_clsid))
            return hlink; //Odd object or no hyperlink at all?

        unsigned flags = Blex::getu32lsb(&hyperlink[20]);
        unsigned offset = 24;
        if (flags & 0x80 && offset+4 <= hyperlink.size()) //got a Target Frame
        {
                unsigned targetlen = Blex::getu32lsb(&hyperlink[offset]);
                offset+=4;
                if (targetlen*2 + offset > hyperlink.size())
                    return hlink;

                hlink.target = UTF16_to_UTF8(&hyperlink[offset], targetlen);
                offset+=targetlen*2;
        }
        if (flags & 0x3 && offset+20 <= hyperlink.size()) //got a Moniker
        {
                if (std::equal(&hyperlink[offset], &hyperlink[offset+16], urlmonik_clsid))
                {
                        //It's a url moniker object..
                        offset+=16; //skip CLSID
                        unsigned hlink_len = Blex::getu32lsb(&hyperlink[offset]); //this one is in bytes..
                        offset+=4; //skip len
                        if (hlink_len + offset > hyperlink.size())
                            return hlink;

                        hlink.data = UTF16_to_UTF8(&hyperlink[offset], hlink_len/2);
                        offset+=hlink_len;
                }
                else if (std::equal(&hyperlink[offset], &hyperlink[offset+16], filemonik_clsid))
                {
                        //It's a file moniker object..
                        offset+=18; //skip CLSID and first word
                        unsigned filename_len = Blex::getu32lsb(&hyperlink[offset]); //this one is in bytes..
                        if (filename_len==0 || filename_len + offset > hyperlink.size())
                            return hlink;

                        //ADDME: CP1252 to UTF8 conversion?
                        offset+=4; //skip len
                        hlink.data.assign(&hyperlink[offset], &hyperlink[offset+filename_len-1]);
                        if (offset + 4+16+4 > hyperlink.size())
                            return hlink;
                        offset+=filename_len;

                        //should have DEADBEEF and 20x0 here - skip
                        offset+=24;
                        if(offset + 10 > hyperlink.size())
                            return hlink;

                        unsigned type = Blex::getu16lsb(&hyperlink[offset+8]);
                        if(type == 3)
                        {
                                //now a length byte
                                unsigned embedlen = Blex::getu32lsb(&hyperlink[offset]); //this one is in bytes..
                                if (embedlen < 6 || offset + embedlen > hyperlink.size())
                                    return hlink;

                                hlink.data = UTF16_to_UTF8(&hyperlink[offset+10], (embedlen-6)/2);
                                offset+=embedlen;
                        }
                        else //a different characterset? we've seen type 4 so far in brokenimagelink.doc
                        {
                                DEBUGPRINT("Unrecognized type " << type);
                                return hlink;
                        }
                }
        }
        if (flags & 0x8 && offset+4 <= hyperlink.size()) //got an Anchor
        {
                std::string anchor;
                unsigned anchorlen = Blex::getu32lsb(&hyperlink[offset]);
                offset+=4;
                if (anchorlen*2 + offset <= hyperlink.size())
                    anchor = UTF16_to_UTF8(&hyperlink[offset], anchorlen);
                offset+=anchorlen*2;

                //Allow the use of anchors to indicate target (the Word2000 hyperlink hack)
                if (Blex::StrCaseCompare(anchor,"_blank")==0
                    || Blex::StrCaseCompare(anchor,"_self")==0
                    || Blex::StrCaseCompare(anchor,"_parent")==0
                    || Blex::StrCaseCompare(anchor,"_top")==0)
                {
                        DEBUGPRINT("Converting anchor to target, to implement the Word hyperlink hack");
                        hlink.target = anchor;
                }
                else
                {
                        if (hlink.data.empty())
                        {
                                DEBUGPRINT("FIXME: Implement internal document links (this is a bookmark link)");
                        }
                        else
                        {
                                hlink.data+="#";
                                hlink.data+=anchor;
                        }
                }
        }
        DEBUGPRINT("Escher hyperlink " <<hlink);
        return hlink;
}

/* Helper function for GetShapeGifData */
void EscherPngChunkCallback(const char *chunkname, const void *data, unsigned octets, std::vector<uint8_t> *gifdata)
{
        if ((chunkname!=NULL) && (data!=NULL) && (octets!=0))
        {
                DEBUGPRINT("  Got PNG chuck callback: " << chunkname);
                // Check if it is an animated GIF chunk..
                if (strcmp(chunkname,"msOG")==0 && octets>11)
                {
                        gifdata->assign(static_cast<uint8_t const *>(data) + 11,
                                static_cast<uint8_t const *>(data) + octets);
                }
        }
}

//ADDME: Move out of the interface class, into the Escher classes! Pass a property or something instead of a shape id
void Interface::GetShapeGifData(int32_t shapeid, std::vector<uint8_t> *gifdata) const
{
        gifdata->clear();
        ShapeContainer const *myShapeContainer = doc->FindShape(shapeid);
        if (!myShapeContainer)
            return;

        // check for shapetype = 75 (pictureframe)
        if(myShapeContainer->GetType() != 75)
            return;

        // search for BLIP..
        msoBlip const *BlipPtr = myShapeContainer->GetProperties().GetPropertyAsBlip(260);
        if (BlipPtr!=NULL)
        {
                // Is the BLIP a PNG blip?
                msoBlipPNG const *PNGBlipPtr = dynamic_cast<msoBlipPNG const*>(BlipPtr);
                if ((PNGBlipPtr!=NULL) && (BlipPtr->GetBlipType() == BlipStoreEntry::blipPNG))
                {
                        /* Setup a unknown png chunck callback and process animated
                           gif chunk.. */

                        DEBUGPRINT("Found PNG Blip -- checking for animated GIF");

                        // Setup chunk callback
                        DrawLib::PNG_GraphicsReader::ChunkCallback unknown_chunk_callback;
                        unknown_chunk_callback =
                                std::bind(&EscherPngChunkCallback, std::placeholders::_1, std::placeholders::_2, std::placeholders::_3, gifdata);

                        // Make a PNG reader to process the PNG data..
                        std::unique_ptr<Blex::RandomStream> pngdata;
                        pngdata.reset(PNGBlipPtr->GetPictureData().release());

                        try
                        {
                                DrawLib::PNG_GraphicsReader pngreader(pngdata.get(), unknown_chunk_callback);

                                /* SkipImageData skips the png image data and calls the unknown
                                   chunk callback when it encountes a non-std PNG chunk. */
                                pngreader.SkipImageData();
                        }
                        catch(std::exception &e)
                        {
                                DEBUGPRINT("Exception looking for GIF data, ignoring gif data: " << e.what());
                        }
                }
        }
}

Interface::Interface()
: doc(new EscherDocument)
{
}

Interface::~Interface()
{
        delete doc;
}

ShapeGroupContainer::ShapeGroupContainer()
{
}

 ShapeGroupContainer::~ShapeGroupContainer()
{
}

Properties const &ShapeGroupContainer::GetProperties() const
{
        return group_shape_container->GetProperties();
}

DrawLib::Pixel32 SchemeColors::GetColor(unsigned index) const
{
        if (index >= colors.size())
                return DrawLib::Pixel32(0,0,0);

        return colors[index];
}

ShapeDrawParameters::ShapeDrawParameters(DrawLib::BitmapInterface *_bitmap,
                DrawLib::XForm2D const &final_transformation,
                Escher::TextCallback const &_text_callback,
                Escher::SchemeColors const *_scheme_colors)
: bitmap(_bitmap)
, final_transformation(final_transformation)
, text_callback(_text_callback)
, scheme_colors(_scheme_colors)
{

}

void ReadContainer(Blex::RandomStream &container, RecordCallback const &recordcallback)
{
        // Now start reading the container
        unsigned offset=0;
        unsigned length=(unsigned)container.GetFileLength();
        uint8_t buffer[8];
        while (offset + 8 < length)
        {
                container.DirectRead (offset, buffer, 8);

                uint8_t version = (uint8_t)(buffer[0] & 0xf);
                uint16_t instance = (uint16_t)((Blex::getu16lsb(buffer)>>4)&0xfff);
                uint16_t type = Blex::getu16lsb(buffer+2);
                unsigned reclength  = Blex::getu32lsb(buffer+4);

                RecordData rec(container, offset+8, offset+8+reclength);
                rec.version=version;
                rec.instance=instance;
                rec.type=type;

                // Handle this via the callback function
                recordcallback(rec);

                offset += reclength + 8;

                /* It seems there's a nul-byte after 0xF000 and 0xF002, anyone
                   know why? Can't
                  find a thing in the docs. It probably has to do with 0xF000
                  and 0xF002 being top-level elements in PowerPoint, from which
                  Word escher coding was dervied (PowerPoint splits 0xF000 and
                  0xF002s over separate streams, Words combines them, maybe some
                  daft Microsoft programmer accidentally inserted a nul-byte after
                  these stream initiations) */
                if(rec.type == 0xF000 || rec.type==0xF002)
                    ++offset;
        }
}

std::ostream& operator<<(std::ostream &output, RecordData const &record_header)
{
        output << "Type: " << record_header.type;
        return output;
}

} //end namespace Escher
} //end namespace Office
} //end namespace Parsers
