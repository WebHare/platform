#include <ap/libwebhare/allincludes.h>

#include <blex/utils.h>
#include <drawlib/drawlibv2/bitmapio.h>
#include <drawlib/drawlibv2/drawobject.h>
#include <drawlib/drawlibv2/graphicsrw_gif.h>
#include <drawlib/drawlibv2/wmfrenderer.h>
#include "drawingml.h"

namespace Parsers {
namespace Office {
namespace DrawingML {

Blex::XML::Namespace xmlns_drawing_wp("wp","http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing");
Blex::XML::Namespace xmlns_drawing_main("a","http://schemas.openxmlformats.org/drawingml/2006/main");

int64_t GetS64Attr(Blex::XML::Node node, const char *attrname)
{
        std::string after = node.GetAttr(NULL, attrname);
        return Blex::DecodeSignedNumber<int64_t>(after.begin(), after.end(), 10).first;
}
float ParsePercentage(std::string const &indata)
{
        if(!indata.empty() && indata[indata.size()-1]=='%') //ends with a '%'
        {
                //Then it follows the actual OOXML spec...
                return std::atof(indata.c_str())/100;
        }
        else
        {
                //Then it's just a percentage multiplied by 1000, apparently
                signed basepercentage = Blex::DecodeSignedNumber<unsigned>(indata.begin(),indata.end()).first;
                return basepercentage / 100000.0;
        }
}
float TwipsToPixels(int32_t twips_in)
{
        return ((twips_in / 20) / 4) * 3; //not really verified yet..
}
float EmuToPixels(int64_t emu_in)
{
        return emu_in / 9525.0;
}
int EmuToPoints(int64_t emu_in)
{
        return emu_in / 12700;
}
int EmuToTwips(int64_t emu_in)
{
        return emu_in / 635;
}

class DrawingMLRenderer
{
        void RenderImage(DrawLib::BitmapInterface *bitmap, int32_t startx, int32_t starty, int32_t lenx, int32_t leny, std::string const &src);

        Blex::XML::Node node;
        Parsers::Office::OOXML::OOXMLPackageRef packageref;

        public:
        DrawingMLRenderer(Blex::XML::Node node, Parsers::Office::OOXML::OOXMLPackageRef const &packageref);

        void PaintPicture(DrawLib::BitmapInterface *bitmap, int32_t startx, int32_t starty, int32_t lenx, int32_t leny);

        std::string relid;
        float croptop, cropleft, cropbottom, cropright;
        float brightness, contrast;
};

DrawingMLRenderer::DrawingMLRenderer(Blex::XML::Node node, Parsers::Office::OOXML::OOXMLPackageRef const &packageref)
: node(node)
, packageref(packageref)
, croptop(0)
, cropleft(0)
, cropbottom(0)
, cropright(0)
, brightness(0)
, contrast(0)
{
}

void DrawingMLRenderer::PaintPicture(DrawLib::BitmapInterface *bitmap, int32_t startx, int32_t starty, int32_t lenx, int32_t leny)
{
        DEBUGPRINT("Entering DrawingMLRenderer::PaintPicture bitmap:" << (void*)bitmap << " at " << startx << "," << starty << " " << lenx << "," << leny);
        //ADDME Could roll startx etc into a transformation matrix..?
        if(relid.empty())
            return;

        std::unique_ptr<Blex::Stream> imgstream;
        imgstream.reset(packageref.OpenFileByRelation(relid));
        if(!imgstream.get())
        {
                DEBUGPRINT("Cannot open img " << relid);
                return;
        }

        //ADDME Get mimetype or something... Avoid extracting if not needed
        Blex::MemoryRWStream image_in_memory;
        imgstream->SendAllTo(image_in_memory);

        /*
        image_in_memory.SetOffset(0);
        std::string temppath = Blex::MergePath(Blex::GetSystemTempDir(), Blex::CreateTempName("paintpicture"));
        std::unique_ptr<Blex::FileStream> str(Blex::FileStream::OpenWrite(temppath, true, true, Blex::FilePermissions::PublicRead));
        if(str.get())
        {
                image_in_memory.SendAllTo(*str);
                Blex::ErrStream() << "Generated image " << temppath;
        }
        //*/

        image_in_memory.SetOffset(0);
        std::unique_ptr<DrawLib::BitmapInterface> inbitmap;
        //inbitmap.reset(DrawLib::CreateBitmap32Magic(&image_in_memory, DrawLib::ISize(lenx,leny)));
        inbitmap.reset(DrawLib::CreateBitmap32Magic(&image_in_memory));

        if(!inbitmap.get())
        {
                //Is it a WMF ?  FIXME just get the mimetype from the relation info, instead of probing?
                uint8_t header[4];
                image_in_memory.SetOffset(0);
                if(image_in_memory.Read(&header,4)==4)
                {
                        DEBUGPRINT("DrawingMLRender WMF: startx " << startx << ", starty=" << starty << " crop=[" << lenx  << "," << croptop << "-" << cropright << "," << cropbottom << "]");
                        inbitmap.reset(new DrawLib::Bitmap32(lenx, leny));

                        std::vector<uint8_t> bitmapdata;
                        image_in_memory.SetOffset(0);
                        ReadStreamIntoVector(image_in_memory, &bitmapdata);
                        //bbox *= pars.stored_transformation;
                        //bbox *= pars.final_transformation;
                        DrawLib::RenderWmfEmf(static_cast<DrawLib::Bitmap32&> (*inbitmap), DrawLib::FPBoundingBox(0,0,lenx,leny), &bitmapdata[0], bitmapdata.size(), DrawLib::XForm2D());
                }

        }

        if(inbitmap.get())
        {
                //ADDME: remerge/ Copied from void msoBlip::PaintYourself(ShapeDrawParameters const &pars, const BlipRenderProperties &props) const
                DrawLib::Canvas32 blitcanvas(bitmap);

                blitcanvas.SetAlphaMode(DrawLib::Canvas32::BLEND255);

                /* Create a translation that moves bitmap coordinates (0..width, 0..height) into the -1,-1,1,1 space
                DrawLib::XForm2D bitmap_to_store(2.0/width,0,0,2.0/height,DrawLib::FPPoint(-1,-1));

                DrawLib::DrawObject(&blitcanvas).DrawBitmap(*cropped_resized_bitmap, bitmap_to_store * realtransform.GetRotation());
                */

                //FIXME dupliacting escher.cpp PaintShape here, for both crop and brightness
                DEBUGPRINT("startx " << startx << ", starty=" << starty << " crop=[" << cropleft << "," << croptop << "-" << cropright << "," << cropbottom << "]");
                DrawLib::XForm2D store_to_input(0, DrawLib::FPPoint( (lenx*1.0) / inbitmap->GetWidth(), (leny*1.0) / inbitmap->GetHeight()), DrawLib::FPPoint(0,0));
                DrawLib::XForm2D bitmap_to_store(0, DrawLib::FPPoint(1,1), DrawLib::FPPoint(startx,starty));
                DrawLib::XForm2D crop_transform;

                crop_transform.eM11 = 1.0f / (1.0f - (cropleft + cropright));
                crop_transform.eM22 = 1.0f / (1.0f - (cropbottom + croptop));
                crop_transform.translation.x = -lenx * crop_transform.eM11 * cropleft;
                crop_transform.translation.y = -leny * crop_transform.eM22 * croptop;

                DEBUGPRINT("bitmap_to_store " << bitmap_to_store);
                DEBUGPRINT("crop_transform " << crop_transform);

                DrawLib::XForm2D final_transform = store_to_input * bitmap_to_store * crop_transform;
                DEBUGPRINT("final " << final_transform);

                if (brightness != 0.0)
                {
                        DEBUGPRINT("Must apply brightness & contrast! " << brightness << " :" << contrast << " (contrast not implemented yet)");
                        float applycontrast = 1; //ADDME not implementing contrast until we've seen a reference picture requiring it

                        float applybrightness = brightness * 256; //100% must match 256, -100% must match 256... so

                        for (unsigned y=0;y<inbitmap->GetHeight();++y)
                        {
                                DrawLib::Scanline32 line = inbitmap->GetScanline32(y);
                                for (unsigned x=0;x<inbitmap->GetWidth();++x)
                                {
                                        DrawLib::Pixel32 pixel = line.Pixel(x);
                                        /* Word best brightness formula so far: dest_channel = src_channel + brightness_property*512,
                                           without gamma correction

                                           DocX tells us:
                                           This element specifies a luminance effect. Brightness linearly shifts all colors closer to white or black.
                                           Contrast scales all colors to be either closer or further apart.
                                           */
        //                                GammaCorrect(&pixel,1/gamma_correction_constant);
                                        pixel.SetRGBA(Blex::Bound<int>( 0, 255, 128 + (pixel.GetR()-128) * applycontrast + applybrightness)
                                                     ,Blex::Bound<int>( 0, 255, 128 + (pixel.GetG()-128) * applycontrast + applybrightness)
                                                     ,Blex::Bound<int>( 0, 255, 128 + (pixel.GetB()-128) * applycontrast + applybrightness)
                                                     ,pixel.GetA());
        //                                GammaCorrect(&pixel,gamma_correction_constant);
                                        line.Pixel(x) = pixel;
                                }
                                inbitmap->SetScanline32(y,line);
                        }
                }

                DrawLib::DrawObject(&blitcanvas).DrawBitmap(*inbitmap, final_transform);
                DEBUGPRINT("Blitted bitmap!");
        }
        else
        {

                DEBUGPRINT("Failed to open the bitmap len " << image_in_memory.GetFileLength());
        }

}

void RenderDrawingML(Parsers::FormattedOutput &output, Blex::XML::Node node, Parsers::Office::OOXML::OOXMLPackageRef const &packageref, Blex::XML::Document const &maindoc)
{
        if (!output.AreImagesAccepted())
            return;

        node = node.GetFirstChild();
        while(node && !node.LocalNameIs("anchor") && !node.LocalNameIs("inline"))
            node = node.GetNextSibling();
        if(!node)
        {
                DEBUGPRINT("Cannot find an anchor or inline element in drawing element");
                return;
        }

        //ADDME: Detect photos/jpegs
        DrawingMLRenderer renderer(node, packageref);
        bool is_inline = node.LocalNameIs("inline");

        ImageInfo img;
        Parsers::Hyperlink link;

        std::string position_h_relativefrom;
        float position_h_offset=0;
        std::string position_v_relativefrom;
        float position_v_offset=0;

        /* We don't (yet?) really care whether its an anchor or inline
           anchor: ECMA-376 2E1: page 3469
           inline: ECMA-376 2E1: page 3485 */
        for (Blex::XML::NodeIterator cur = node.GetChildNodeIterator(NULL); cur; ++cur)
        {
                if(cur->LocalNameIs("docPr") && cur->IsInNamespace(xmlns_drawing_wp)) //ADDME Maybe we shouldn't grab links from docPr but from graphicData//hlinkClick
                {
                        //docprops ECMA-376 2E1: page 3478
                        for (Blex::XML::NodeIterator props = cur->GetChildNodeIterator(&xmlns_drawing_main); props; ++props)
                        {
                                if(props->LocalNameIs("hlinkClick"))
                                {
                                        if(!output.AreHyperlinksAccepted())
                                            continue;

                                        if(props->HasAttr(0, "tgtFrame"))
                                                link.target = props->GetAttr(0, "tgtFrame");

                                        std::string relid = props->GetAttr(&Parsers::Office::OOXML::xmlns_officedoc_relationships, "id");
                                        Blex::XML::Node linkrel = packageref.GetRelNodeById(relid);
                                        if(linkrel)
                                        {
                                                if(linkrel.GetAttr(NULL, "TargetMode") == "External")
                                                {
                                                        link.data = linkrel.GetAttr(NULL, "Target");
                                                        if(link.data.empty())
                                                        {
                                                                DEBUGPRINT("Cannot get Target for link relation '" << relid << "'");
                                                        }
                                                        else
                                                        {
                                                                DEBUGPRINT("Resolved link relation '" << relid << "' to '" << link.data << "'");
                                                        }
                                                }
                                                else
                                                {
                                                        DEBUGPRINT("Link relation '" << relid << "' had an unrecognized target '" << linkrel.GetAttr(NULL,"TargetMoide") << "'");
                                                }
                                        }
                                        else
                                        {
                                                DEBUGPRINT("Cannot resolve link relation '" << relid << "'");
                                        }
                                }
                                else
                                {
                                        DEBUGPRINT("Unexpected node " << props->GetLocalName() << " in drawing/docPr");
                                }
                        }

                        img.alttag = cur->GetAttr(NULL,"title");
                        std::string descr = cur->GetAttr(NULL,"descr");

                        if(!descr.empty())
                        {
                                if(img.alttag.empty()) //Word 2007 stores alttags in descr for DOCX, and in title for DOC. compensate
                                {
                                      img.alttag = descr;
                                      descr.clear();
                                }
                                else
                                {
                                      img.title = descr;
                                }
                        }
                }
                else if(cur->LocalNameIs("positionH") && cur->IsInNamespace(xmlns_drawing_wp)) //2nded 20.4.2.10 pg 3490
                {
                        position_h_relativefrom = cur->GetAttr(0, "relativeFrom");
                        for (Blex::XML::NodeIterator props = cur->GetChildNodeIterator(&xmlns_drawing_wp); props; ++props)
                          if(props->LocalNameIs("posOffset"))
                        {
                                position_h_offset = EmuToPixels(std::atoi(props->GetAllChildrenContent().c_str()));
                        }
                }
                else if(cur->LocalNameIs("positionV") && cur->IsInNamespace(xmlns_drawing_wp))
                {
                        position_v_relativefrom = cur->GetAttr(0, "relativeFrom");
                        for (Blex::XML::NodeIterator props = cur->GetChildNodeIterator(&xmlns_drawing_wp); props; ++props)
                          if(props->LocalNameIs("posOffset"))
                        {
                                position_v_offset = std::atoi(props->GetAllChildrenContent().c_str());
                        }
                }
                else if(cur->LocalNameIs("extent") && cur->IsInNamespace(xmlns_drawing_wp))
                {
                        float xlen = EmuToPixels(GetS64Attr(*cur, "cx"));
                        float ylen = EmuToPixels(GetS64Attr(*cur, "cy"));

                        img.lenx = std::ceil(xlen);
                        img.leny = std::ceil(ylen);
                }
                else if(cur->LocalNameIs("graphic") && cur->IsInNamespace(xmlns_drawing_main))
                {
                        //Graphic follows.. blindly find a blip if any
                        Blex::XML::PathExpr blipfinder(maindoc);
                        blipfinder.RegisterNamespace(xmlns_drawing_main); //registers 'a'
                        blipfinder.context = *cur;

                        std::unique_ptr<Blex::XML::PathResult> blipfindresults;
                        blipfindresults.reset(blipfinder.Evaluate(".//a:blip"));
                        if(blipfindresults.get())
                          for (unsigned i=0;i<blipfindresults->Size();++i)
                            DEBUGPRINT("Node " << blipfindresults->Item(i).GetLocalName());

                        if(blipfindresults.get() && blipfindresults->Size() == 1)
                        {
                                renderer.relid = blipfindresults->Item(0).GetAttr(&Parsers::Office::OOXML::xmlns_officedoc_relationships, "embed");
                                DEBUGPRINT("Found my blip. relid = " << renderer.relid);

                                //is there a luminance node with cropping info?
                                std::unique_ptr<Blex::XML::PathResult> lumfinder;
                                blipfinder.context = blipfindresults->Item(0);
                                lumfinder.reset(blipfinder.Evaluate("./a:lum"));

                                if(lumfinder.get() && lumfinder->Size()==1)
                                {
                                        renderer.brightness = ParsePercentage(lumfinder->Item(0).GetAttr(0, "bright"));
                                        renderer.contrast = ParsePercentage(lumfinder->Item(0).GetAttr(0, "contrast"));

                                        DEBUGPRINT("Found a lum. brightness = " << (renderer.brightness*100) << "%, contrast = " << (renderer.contrast*100) << "%");
                                }

                                //is there a srcRect node with cropping info?
                                std::unique_ptr<Blex::XML::PathResult> srcrectfinder;
                                blipfinder.context = blipfindresults->Item(0);
                                srcrectfinder.reset(blipfinder.Evaluate("../a:srcRect"));

                                if(srcrectfinder.get() && srcrectfinder->Size()==1)
                                {
                                        renderer.cropleft = ParsePercentage(srcrectfinder->Item(0).GetAttr(0, "l"));
                                        renderer.croptop = ParsePercentage(srcrectfinder->Item(0).GetAttr(0, "t"));
                                        renderer.cropright = ParsePercentage(srcrectfinder->Item(0).GetAttr(0, "r"));
                                        renderer.cropbottom = ParsePercentage(srcrectfinder->Item(0).GetAttr(0, "b"));

                                        DEBUGPRINT("Found a srcRect (cropping rectangle). top = " << (renderer.croptop*100) << "%, right = " << (renderer.cropright*100) << "% bottom = " << (renderer.cropbottom*100) << "% left = " << (renderer.cropleft*100) << "%");
                                }
                        }
                }
                else
                {
                        DEBUGPRINT("Unexpected node " << cur->GetLocalName() << " in drawing");
                }
        }

        //ADDME insideMargin, outsideMargin, rightMargin
        if(!is_inline
           && (position_h_relativefrom == "column"
               || position_h_relativefrom == "leftMargin"
               || position_h_relativefrom == "margin"
               || position_h_relativefrom == "page"))
        {
                //ADDME Discover page size to be able to interpret position_h_offset
                //      assuming 12240 width for now (is in twips)
                int32_t pagecenter = TwipsToPixels(12240) / 2;
                int32_t imagecenter = position_h_offset + img.lenx/2;
                img.align = imagecenter < pagecenter ? 1 : 2;
        }

        ApplyWordLinkHack(&link); //allow #_blank

        // FIXME: not implemented
        (void)position_v_offset;

        if(!is_inline)
        {
                int32_t distt = EmuToTwips(GetS64Attr(node, "distT"));
                int32_t distb = EmuToTwips(GetS64Attr(node, "distB"));
                int32_t distl = EmuToTwips(GetS64Attr(node, "distL"));
                int32_t distr = EmuToTwips(GetS64Attr(node, "distR"));

                img.wrapping.top = distt;
                img.wrapping.bottom = distb;
                img.wrapping.left = distl;
                img.wrapping.right = distr;
        }

        img.painter = std::bind(&DrawingMLRenderer::PaintPicture, &renderer, std::placeholders::_2, std::placeholders::_3, std::placeholders::_4, std::placeholders::_5, std::placeholders::_6);
        //img.alttag = node.GetAttr(NULL, "alt");


        try
        {
                std::unique_ptr<Blex::Stream> imgstream;
                imgstream.reset(packageref.OpenFileByRelation(renderer.relid));
                if(imgstream.get())
                {
                        //Is it a gif file?
                        DrawLib::GifDecompressor decoder(*imgstream);
                        std::unique_ptr<DrawLib::BitmapInterface> firstimage(decoder.ReadImage());
                        std::unique_ptr<DrawLib::BitmapInterface> secondimage(decoder.ReadImage());

                        if(firstimage.get() && secondimage.get())
                        {
                                //It's an animated gif!

                                imgstream.reset(packageref.OpenFileByRelation(renderer.relid));
                                ReadStreamIntoVector(*imgstream, &img.animated_gif);
                        }
                }

        }
        catch(std::exception &e)
        {
                DEBUGPRINT("Exception " << e.what() << " looking for animated gif data, ignoring");
        }


        if(!link.data.empty())
            output.StartHyperlink(link);
        output.InsertImage(img);

        //Close any hyperlink we locally opened (ADDME: Restore original hyperlink? Add push/pop link suppport to output?)
        if(!link.data.empty())
            output.EndHyperlink();
}


} // End of namespace DrawingML
} // End of namespace Office
} // End of namespace Parsers
