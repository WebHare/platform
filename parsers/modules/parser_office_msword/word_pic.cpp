#include <ap/libwebhare/allincludes.h>



#include <blex/stream.h>
#include <blex/docfile.h>
#include <drawlib/drawlibv2/wmfrenderer.h>
#include "biff.h"
#include "word_pic.h"

namespace Parsers {
namespace Office {
namespace Word {

void EstimateCanvasSizeForBox(Parsers::ImageInfo *toset, DrawLib::FPBoundingBox source, float render_scale_x, float render_scale_y)
{
        /* Cut of a 1000th pixel on each side. This works around FP rounding
           errors, and shouldn't be a real problem since our BBox maps the
           visible range - only a pixel less than 0.002 in width would disappear
           with this correction. But NEVER snap origin, as origin is always exact
           and it avoids moving stuff around for no reason at all */
        if (source.upper_left != DrawLib::FPPoint(0,0))
        {
                source.upper_left.x += 0.0001;
                source.upper_left.y += 0.0001;
        }
        if (source.lower_right != DrawLib::FPPoint(0,0))
        {
                source.lower_right.x -= 0.0001;
                source.lower_right.y -= 0.0001;
        }

        DEBUGPRINT("EstimateSizes: source " << source << " scale_x " << render_scale_x << " scale_y " << render_scale_y);
        toset->lenx=std::ceil(source.GetWidth() * render_scale_x);
        toset->leny=std::ceil(source.GetHeight() * render_scale_y);
}


/* ADDME: For now, we've disabled intermediate image caching. IOW: Requesting
          the same picture twice (mostly applies to Escher objects in fast-saved
          documents) will cause a duplicate drawing effort. */

///////////////////////////////////////////////////////////////////////////////
//
// Centralised Escher storage (may contain multiple pictures (aka shapes) )
//
EscherDataStore::EscherDataStore(std::shared_ptr<Blex::RandomStream> const &data,
                                          std::shared_ptr<Blex::RandomStream> const &delay)
   : escherdata(new Parsers::Office::Escher::Interface)
   , escherparentstream(data)
   , delaystream(delay)
{
}

EscherDataStore::~EscherDataStore()
{
}

void EscherDataStore::ScanEscherData(Blex::FileOffset start,Blex::FileOffset length)
{
        Blex::LimitedStream escherstream(start,start+length, *escherparentstream);
        escherdata->ReadDocument(escherstream, delaystream.get());
}



///////////////////////////////////////////////////////////////////////////////
//
// OLE2 embedded objects (eg Equation editor, Excel docs)
//
struct MetaFileInfo
{
        Parsers::ImageInfo info;
        unsigned wmflen;
        const void *wmfbytes;
        DrawLib::FPBoundingBox renderbox;

        MetaFileInfo(float lenx, float leny, unsigned wmflen, const void *wmfbytes, float render_scale_x, float render_scale_y);
        void RenderMetafile(DrawLib::BitmapInterface *bitmap, int32_t startx, int32_t starty, int32_t lenx, int32_t leny);
};

MetaFileInfo::MetaFileInfo(float lenx, float leny, unsigned wmflen, const void *wmfbytes, float render_scale_x, float render_scale_y)
: wmflen(wmflen)
, wmfbytes(wmfbytes)
, renderbox(0,0,lenx,leny)
{
        info.painter = std::bind(&MetaFileInfo::RenderMetafile, this, std::placeholders::_2, std::placeholders::_3, std::placeholders::_4, std::placeholders::_5, std::placeholders::_6);
        EstimateCanvasSizeForBox(&info, renderbox, render_scale_x, render_scale_y);
        DEBUGPRINT("MetaFileInfo: lenx " << lenx << " leny " << leny << " estimated box: " << renderbox);
}

void MetaFileInfo::RenderMetafile(DrawLib::BitmapInterface *bitmap, int32_t startx, int32_t starty, int32_t lenx, int32_t leny)
{
        float scale_x = (lenx-startx+1) * 1.0 / info.lenx;
        float scale_y = (leny-starty+1) * 1.0 / info.leny;

        renderbox.lower_right.x *= scale_x;
        renderbox.lower_right.y *= scale_y;

        DEBUGPRINT("Note: direct RenderMetaFile"); //FIXME scale based on startx/starty/lenx/leny
        DrawLib::RenderWmfEmf(*bitmap, renderbox, wmfbytes, wmflen, DrawLib::XForm2D()); //DrawLib::XForm2D(scale_x,0,0,scale_y,DrawLib::FPPoint(0,0))
}

void BiffDoc::Pic_OLE2(uint32_t objtag, Parsers::FormattedOutput &output) const
{
        //Find the object pool inside the current document root
        Blex::Docfile::Directory const *pool_root = docfile->FindDirectory(docfileroot, "ObjectPool");
        if (!pool_root)
            return;

        //Look for a directory named with the object's id, prefixed with an underscore
        const Blex::Docfile::Directory *obj_root = docfile->FindDirectory(pool_root,"_" + Blex::AnyToString(objtag));
        if (!obj_root)
            return;

        Blex::Docfile::File const *clipmeta_file = docfile->FindFile(obj_root,"\3META");
        if (!clipmeta_file)
            return;

        //Okay, we found the object metafile. Try to render this
        std::vector<uint8_t> wmfdata;
        std::unique_ptr<Blex::RandomStream> clipmeta(docfile->OpenOleFile(clipmeta_file));
        if (!clipmeta.get() || clipmeta->GetFileLength() < 8 || ReadStreamIntoVector(*clipmeta, &wmfdata) != clipmeta->GetFileLength())
            return;

        //unsigned mappingmode = Blex::getu16lsb(&wmfdata[0]);
        float flenx = Blex::getu16lsb(&wmfdata[2]) / 26.6;
        float fleny = Blex::getu16lsb(&wmfdata[4]) / 26.6;

        MetaFileInfo mfi(flenx, fleny, wmfdata.size()-8, &wmfdata[8], 1, 1);
        mfi.info.uniqueid = "msword-" + Blex::AnyToString(GetUniqueVMId()) + "-ole-" + Blex::AnyToString(objtag);
        output.InsertImage(mfi.info);
}

///////////////////////////////////////////////////////////////////////////////
//
// Escher objects (anything that can float)
//
struct EscherObject
{
        Parsers::ImageInfo imginfo;
        EscherObject(Escher::Interface &iface, int32_t spid, float origlenx, float origleny, BiffDoc const &doc, std::string const &id, float render_scale_x, float render_scale_y);

        private:
        DrawLib::FPBoundingBox fullpicturebox;
        Escher::Interface &iface;
        Escher::TextCallback textfunc;
        int32_t spid;
        DrawLib::FPSize origsize;
        void Render(DrawLib::BitmapInterface *bitmap, int32_t startx, int32_t starty, int32_t lenx, int32_t leny);
};

EscherObject::EscherObject(Escher::Interface &iface, int32_t spid, float origlenx, float origleny, BiffDoc const &doc, std::string const &id, float render_scale_x, float render_scale_y)
: iface(iface)
, spid (spid)
, origsize(origlenx,origleny)
{
        //ADDME: Cache known bounding boxes
        fullpicturebox = iface.GetBoundingBox(spid, origsize);
        DEBUGPRINT("EscherObject: lenx " << origlenx << " leny " << origleny << " estimated box: " << fullpicturebox);

        textfunc = std::bind(&BiffDoc::RenderTextboxText, std::ref(doc), std::placeholders::_2, &iface, std::placeholders::_1);

        EstimateCanvasSizeForBox(&imginfo, fullpicturebox, render_scale_x, render_scale_y);
        iface.GetShapeImageInfo(spid, &imginfo);
        imginfo.painter=std::bind(&EscherObject::Render, this, std::placeholders::_2, std::placeholders::_3, std::placeholders::_4, std::placeholders::_5, std::placeholders::_6);
        imginfo.uniqueid=id;
}

void EscherObject::Render(DrawLib::BitmapInterface *bitmap, int32_t startx, int32_t starty, int32_t lenx, int32_t leny)
{
        /*We always want to render the full image data, even parts that would
          be clipped outside the original box. Calculate a transformation that
          renders all escher data inside the canvas*/

        DEBUGPRINT("PaintShape. fpbox " << fullpicturebox << " start (" << startx << "," << starty << ") len (" << lenx << "," << leny << ")");


        //move the image back to orgiin
        DrawLib::XForm2D final_transformation(1,0,0,1,fullpicturebox.upper_left*-1 + DrawLib::FPPoint(startx,starty));
        //scale inside standard escher box (round size of picture box up, because we already used that to calculate the required canvas, and we don't want to introduce false scale factor
        final_transformation *= DrawLib::XForm2D(lenx*1.0f / fullpicturebox.GetWidth(),
                                                 0,
                                                 0,
                                                 leny*1.0f / fullpicturebox.GetHeight(),DrawLib::FPPoint(0,0));
        DEBUGPRINT("PaintShape. origsize " << origsize << " final transform " << final_transformation);
        iface.PaintShape(bitmap, origsize, final_transformation, spid, textfunc, NULL);
}

void BiffDoc::Pic_Escher(FileShape const &fs, Parsers::FormattedOutput &output, bool ignore_float) const
{
        if (!GetEscherData().get())
        {
                DEBUGPRINT("Attempting to process an escher object, but no escher data available!");
                return;
        }
        Sections::const_iterator sec = FindSection(fs.cp);
        if (sec == sections.end())
        {
                DEBUGPRINT("Cannot find containing section for image");
                return;
        }

        DEBUGPRINT("ESPP " << fs);

        std::string id = "msword-" + Blex::AnyToString(GetUniqueVMId());
        if (fs.spid != 0)
            id += "-spid-" + Blex::AnyToString(fs.spid);
        else
            id += "-cp-" + Blex::AnyToString(fs.cp);

        float lenx = (fs.xa_right-fs.xa_left)/15.0;
        float leny = (fs.ya_bottom-fs.ya_top)/15.0;
        EscherObject obj(*GetEscherData()->escherdata, fs.spid, lenx, leny, *this, id, 1, 1);

        //Try to determine alignment (FIXME: set align only on 'floating' images?)
        if (!ignore_float && obj.imginfo.align==0)
        {
                unsigned pagecenter = sec->sep.pod.xaPage / 2;
                unsigned imagecenter = fs.xa_left + (fs.xa_right-fs.xa_left)/2;
                //relative to margin? (ADDME: column != margin) (ADDME: how to do paragraph)
                if(fs.relative_x != 1) // add margin
                    imagecenter += sec->sep.pod.dxaLeft;

                obj.imginfo.align = imagecenter < pagecenter ? 1 : 2;
        }

        if ( (obj.imginfo.lenx * obj.imginfo.leny) == 0) //empty image!
        {
                DEBUGPRINT("Image size is 0, skipping");
                return;
        }

        //Does the escher image contain a hyperlink? If so, open it!
        Parsers::Hyperlink link;
        if(output.AreHyperlinksAccepted())
            link = GetEscherData()->escherdata->GetShapeHyperlink(fs.spid);

        if (!link.data.empty())
            output.StartHyperlink(link);

        output.InsertImage(obj.imginfo);

        //Close any hyperlink we locally opened (ADDME: Restore original hyperlink?)
        if (!link.data.empty())
            output.EndHyperlink();
}

///////////////////////////////////////////////////////////////////////////////
//
// PIC objects (apparently old style Word objects)
//
void BiffDoc::Pic_Pic(uint32_t startoffset, Parsers::FormattedOutput &output) const
{
        Blex::RandomStream *source = datafile.get() ? datafile.get() : wordfile.get();

        unsigned total_length = source->DirectReadLsb<uint32_t>(startoffset);
        unsigned header_length = source->DirectReadLsb<uint16_t>(startoffset+4);
        if (total_length == 0 || header_length == 0) //deleted picture?
        {
                DEBUGPRINT("Skipping picture without a header");
                return;
        }

        if (total_length < header_length || header_length < 44)
            throw std::runtime_error("Corrupted document: DataStream picture has truncated header");

        std::vector<uint8_t> header(header_length);
        if (source->DirectRead(startoffset,&header[0],header.size()) != header.size())
            throw std::runtime_error("Corrupted document: I/O error reading datastream picture");

        unsigned mappingmode = Blex::getu8(&header[6]);
        float scale_x = Blex::getu16lsb(&header[32])/1000.0;
        float scale_y = Blex::getu16lsb(&header[34])/1000.0;
        int storedwidth = Blex::getu16lsb(&header[28]) ;
        int storedheight = Blex::getu16lsb(&header[30]) ;

        DEBUGPRINT("BiffDoc::Pic_pic original dimensions: scale_x " << scale_x << " scale_y " << scale_y << " width " << storedwidth << " height " << storedheight);

        //FIXME: Configurable scaling correction factor?
        if (scale_x >= 0.95 && scale_x <= 1.05 && scale_y >= 0.95 && scale_y < 1.05)
           scale_x = scale_y = 1.0;

        //float flenx = storedwidth * scale_x / 15.0;
        //float fleny = storedheight * scale_y / 15.0;
        float flenx = storedwidth / 15.0;
        float fleny = storedheight / 15.0;

        Blex::LimitedStream picturedata(startoffset+header_length,startoffset+total_length,*source);

        //The original lengths are in xExt and yExt
        //The new lengths can be found my multiplying these with mx/1000 and my/1000

        //NOTE: The word documentation's PIC structure is shiftes 8 bytes
        //      eg, dxaCropLeft (word &PIC[36]) is at &fundata[28]

        //Conversion to pixels seems to be done by dividing these through 15
        // 15 = TWIPS / DPI = 1440 / 96 !

        std::string uniqueid = "msword-" + Blex::AnyToString(GetUniqueVMId()) + "-pic-" + Blex::AnyToString(startoffset);
        if (mappingmode == 8) //metafile
        {
                std::vector<uint8_t> meta;
                Blex::ReadStreamIntoVector(picturedata,&meta);

                MetaFileInfo mfi(flenx,fleny,meta.size(),&meta[0], scale_x, scale_y);
                mfi.info.uniqueid = uniqueid;
                output.InsertImage(mfi.info);
        }
        else if (mappingmode==98)//TIFF filename
        {
                DEBUGPRINT("This version does not support TIFF files");
        }
        else if (mappingmode==99)//Bitmap
        {
                DEBUGPRINT("This version does not support DIB files");
        }
        else if (mappingmode == 100)
        {
                Escher::Interface localinterface;
                localinterface.ReadDocument(picturedata, NULL);

                EscherObject obj(localinterface, 0, flenx, fleny, *this, uniqueid, scale_x, scale_y);
                if ( (obj.imginfo.lenx * obj.imginfo.leny) == 0) //empty image!
                {
                        DEBUGPRINT("Image size is 0, skipping");
                        return;
                }
                obj.imginfo.wrapping = Parsers::Distance(); //it seems this image type never supports wrapping?
                obj.imginfo.align = 0; //or floating.....
                output.InsertImage(obj.imginfo);
        }
        else if (mappingmode == 102) //Escher, with a hyperlink or something like that prepended to the data
        {
                //uint8_t lenhyperlink = picturedata.DirectReadLsb<uint8_t>(0);
                //The hyperlink is a LINK to the original image.
                //(ADDME: Support)
                DEBUGPRINT("\aSkipping image link!");
                /*
                //Well, this is what OpenOffice tried, but it doesn't appear that there is much useful in
                //the escher data at all - it probably only holds some picture option information.
                Escher::Interface localinterface;

                Blex::LimitedStream eschersubdata(lenhyperlink+1, picturedata-.GetFileLength(), picturedata);
                escherdoc->ReadDocument(eschersubdata, NULL);
                */
        }
        else
        {
                DEBUGPRINT("Unknown picture format used (odd mappingmode " << mappingmode << ")");
        }
}

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
