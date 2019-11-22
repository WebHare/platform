#include <ap/libwebhare/allincludes.h>


#include <blex/zstream.h>
#include <blex/xml.h>
#include "docx.h"
#include "vmlrender.h"
#include "drawingml.h"
#include "docx_parse.h"
#include "word_fields.h"
#include "word_output.h"
#include "word_debug.h"
#include "wordstyles.h"

//ADDME: The XML reading causes a LOT of string copies... should be able to do better

namespace Parsers {
namespace Office {
namespace OOXML {

Blex::XML::Namespace xmlns_package_relationships("PR", "http://schemas.openxmlformats.org/package/2006/relationships");
Blex::XML::Namespace xmlns_officedoc_relationships("OR", "http://schemas.openxmlformats.org/officeDocument/2006/relationships");
Blex::XML::Namespace xmlns_custom_properties("CP", "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties");
Blex::XML::Namespace xmlns_docpropsvtypes("vt", "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes");

//////////////////////////////////////////////////////////////////////////////
//
// ZipFile stuff (sharable with ODF, should move to blexlib and we actually
// need random access to the various files
ZipFile::ZipFile()
{
}
ZipFile::~ZipFile()
{
}

ZipFile* ZipFile::OpenZipFile(Blex::RandomStream &data)
{
        std::unique_ptr<Blex::ZipArchiveReader> zip_reader;
        zip_reader.reset(Blex::ZipArchiveReader::Open(data));
        if (!zip_reader.get())
            return NULL;

        std::unique_ptr<ZipFile> zf(new ZipFile);

        while(true)
        {
                Blex::ZipArchiveReader::Entry entry = zip_reader->NextEntryInfo();
                if (entry.type == Blex::ZipArchiveReader::Entry::Eof)
                    break;
                if (entry.type != Blex::ZipArchiveReader::Entry::File)
                    continue;

                //FIXME: Decompress-as-we-go stream!
                Blex::MemoryRWStream temp;
                if (zip_reader->SendFile(temp))
                {
                        OOFilePtr fptr(new std::vector<uint8_t>());
                        temp.SetOffset(0);
                        ReadStreamIntoVector(temp, fptr.get());
                        zf->files[entry.name] = fptr;
                }
        }
        return zf.release();

}

Blex::Stream* ZipFile::OpenFile(std::string const &path)
{
        if(files.count(path)==0)
            return NULL;

        std::vector<uint8_t> &data = *files[path];
        return new Blex::MemoryReadStream(&data[0], data.size());
}

//////////////////////////////////////////////////////////////////////////////
//
// OOXMLPackage

OOXMLPackage::OOXMLPackage(std::unique_ptr<ZipFile> &_zip)
{
        zip.reset(_zip.release());
}
OOXMLPackage::~OOXMLPackage()
{
}
OOXMLPackage* OOXMLPackage::Open(Blex::RandomStream &data)
{
        std::unique_ptr<ZipFile> zip;
        zip.reset(ZipFile::OpenZipFile(data));
        if(!zip.get())
           return NULL;

        return new OOXMLPackage(zip);
}
Blex::Stream * OOXMLPackage::OpenFile(std::string const &path) const
{
        return zip->OpenFile(path);
}
Blex::XML::Document* OOXMLPackage::GetRelsFor(std::string const &curpath) const
{
        //ADDME - cache the rels file
        std::map<std::string, std::shared_ptr<Blex::XML::Document> >::const_iterator relsitr = relscache.find(curpath);
        if(relsitr != relscache.end())
            return relsitr->second.get();

        //Determine our current .rels file - take our current file, insert ".rels" halfway..
        std::string::const_iterator lastslash=curpath.end();
        while(lastslash != curpath.begin() && lastslash[-1]!='/')
            --lastslash;

        std::string relsfile(curpath.begin(), lastslash);
        relsfile += "_rels/";
        relsfile.append(lastslash, curpath.end());
        relsfile += ".rels";

        std::unique_ptr<Blex::Stream> relsstream;
        relsstream.reset(zip->OpenFile(relsfile));
        if(!relsstream.get())
        {
                DEBUGPRINT("Cannot open rels file [" << relsfile << "]");
                return NULL;
        }

        std::shared_ptr<Blex::XML::Document> xmldoc;
        xmldoc.reset(new Blex::XML::Document);

        if(!xmldoc->ReadFromStream(*relsstream))
        {
                DEBUGPRINT("Cannot parse rels file [" << relsfile << "]");
                return NULL;
        }
        return relscache.insert(std::make_pair(curpath, xmldoc)).first->second.get();
}
Blex::Stream* OOXMLPackage::OpenRelationship(std::string const &curpath, Blex::XML::Node relationship) const
{
        //Determine our current .rels file - take our current file, insert ".rels" halfway..
        std::string::const_iterator lastslash=curpath.end();
        while(lastslash != curpath.begin() && lastslash[-1]!='/')
            --lastslash;

        //ADDME support .. in links
        std::string path = std::string(curpath.begin(), lastslash) + relationship.GetAttr(NULL,"Target");
        return zip->OpenFile(path);
}
Blex::XML::Node OOXMLPackage::GetRelNodeById(std::string const &curpath, std::string const &id) const
{
        Blex::XML::Document *rels = GetRelsFor(curpath);
        if(rels)
          for (Blex::XML::NodeIterator itr = rels->GetRoot().GetChildNodeIterator(&xmlns_package_relationships); itr; ++itr)
            if(itr->GetAttr(NULL, "Id") == id)
              return *itr;
        return Blex::XML::Node();
}
Blex::XML::Node OOXMLPackage::GetRelNodeByType(std::string const &curpath, std::string const &type) const
{
        Blex::XML::Document *rels = GetRelsFor(curpath);
        if(rels)
          for (Blex::XML::NodeIterator itr = rels->GetRoot().GetChildNodeIterator(&xmlns_package_relationships); itr; ++itr)
            if(itr->GetAttr(NULL, "Type") == type)
              return *itr;
        return Blex::XML::Node();
}
Blex::Stream* OOXMLPackage::OpenFileByRelation(std::string const &curpath, std::string const &id) const
{
        Blex::XML::Node node = GetRelNodeById(curpath, id);
        return node ? OpenRelationship(curpath, node) : NULL;
}
Blex::Stream* OOXMLPackage::OpenFileByType(std::string const &curpath, std::string const &type) const
{
        Blex::XML::Node node = GetRelNodeByType(curpath, type);
        return node ? OpenRelationship(curpath, node) : NULL;
}

OOXMLPackageRef::OOXMLPackageRef(OOXMLPackage const &package, std::string const &docpath)
: package(&package)
, docpath(docpath)
{
}
Blex::XML::Node OOXMLPackageRef::GetRelNodeById(std::string const &id) const
{
        return package->GetRelNodeById(docpath,id);
}
Blex::XML::Node OOXMLPackageRef::GetRelNodeByType(std::string const &type) const
{
        return package->GetRelNodeByType(docpath,type);
}
Blex::Stream* OOXMLPackageRef::OpenFileByRelation(std::string const &id) const
{
        Blex::XML::Node node = GetRelNodeById(id);
        return node ? package->OpenRelationship(docpath, node) : NULL;
}
Blex::Stream* OOXMLPackageRef::OpenFileByType(std::string const &type) const
{
        Blex::XML::Node node = GetRelNodeByType(type);
        return node ? package->OpenRelationship(docpath, node) : NULL;
}



} //end namespace OOXML
} // End of namespace Office
} // End of namespace Parsers

namespace Parsers {
namespace Office {
namespace Word {
namespace DocX {

extern Blex::XML::Namespace xmlns_wordml;

///////////////////////////////////////////////////////////
//
// DocXParagraphWalker
//
DocXParagraphWalker::DocXParagraphWalker(DocXDoc const &doc)
: doc(doc)
, curpara(NULL)
, para_pap(doc)
, char_chp(doc)
{
}

void DocXParagraphWalker::SetParagraph(DocXParagraph const &docobj)
{
        eating_pagebreaks = true;
        curpara = &docobj;
        para_pap = docobj.basestyle->cached_stylepap;
        char_chp = docobj.basestyle->cached_stylechp;

        if(docobj.ppr)
        {
                para_pap.ApplyDocXProps(doc, docobj.ppr);
                if(para_pap.listovr)
                {
                        ListLevel const *lvlinfo = para_pap.listovr->GetLevel(para_pap.listlevel);
                        if(lvlinfo)
                        {
//                                lvlinfo->ApplyPap(&para_pap); //pap properties should be applied right away, as list's pap properties should be overriden by our local properties
//                                lvlinfo->ApplyChp(&para_pap, &char_chp);
                        }
                }
        }

        para_pap.Fixup();
        char_chp.Fixup();
}

Chp DocXParagraphWalker::GetListBulletChp() const
{
        Chp listchp(doc);
        if(!curpara)
            return listchp;

        listchp = curpara->basestyle->cached_stylechp;
        if(curpara->paragraphmark_rpr)
            doc.ApplyChpProps(&listchp, curpara->paragraphmark_rpr, true);

        if(para_pap.listovr)
        {
                ListLevel const *lvlinfo = para_pap.listovr->GetLevel(para_pap.listlevel);
                if(lvlinfo)
                {
                        lvlinfo->ApplyChp(NULL, &listchp);
                }
        }

        return listchp;
}

///////////////////////////////////////////////////////////
//
// DocXParagraph
//
DocXParagraph::DocXParagraph(DocPart *parent, DocXDoc const &doc, Blex::XML::Node paranode)
: DocPart(doc, parent, doc.default_paragraph_style)
{
        paranodes.push_back(paranode);
}

void DocXParagraph::ExtendParagraph(Blex::XML::Node nextparanode)
{
        paranodes.push_back(nextparanode);
}

void DocXParagraph::AddPpr(Blex::XML::Node _ppr)
{
        for(Blex::XML::NodeIterator subitr = _ppr.GetChildNodeIterator(&xmlns_wordml); subitr; ++subitr)
        {
                if(subitr->LocalNameIs("pStyle") && !ppr) //ignore styleinfo on followup paragraphs
                {
                        StyleBase const* base = doc.GetStyleByDocXId(subitr->GetAttr(&xmlns_wordml, "val"));
                        if(base && base->type == StyleBase::ParagraphStyle)
                            basestyle = static_cast<ParaCharStyle const*>(base);
                }
                if(subitr->LocalNameIs("rPr")) //paragraph mark properties
                {
                        paragraphmark_rpr = *subitr;
                }
        }

        if(ppr) //already have paragraph style info
            return;

        ppr=_ppr;

        //ADDME: We can probably optimize a bit by storing numbering info into the basestyle, and quickscanning for numPr
        //Attach to lists
        DocXParagraphWalker walk(GetDocXDoc());
        walk.SetParagraph(*this);
        if (walk.GetParaPap().listovr)
        {
                listovr = walk.GetParaPap().listovr;
                listlevel = walk.GetParaPap().listlevel;
                const_cast<ListOverride*>(walk.GetParaPap().listovr)->listparas.push_back(this);
        }

        contextualspacing = walk.GetParaPap().contextualspacing;
        myspacingtop = walk.GetParaPap().formatted.padding.top;
        myspacingbottom = walk.GetParaPap().formatted.padding.bottom;
}

FieldInfo DocXParagraphWalker::ProcessFieldChar(Blex::XML::Node node)
{
        std::string type = node.GetAttr(&xmlns_wordml,"fldCharType");
        if(type == "begin")
        {
                fieldstack.push_back(FieldData());
                return FieldInfo(FieldStates::Begin, fieldstack.back());
        }
        if(type == "separate")
        {
                if(fieldstack.empty())
                    return FieldInfo(FieldStates::Unknown, FieldData());
                DEBUGPRINT("Field separate: " << fieldstack.back().instruction);
                return FieldInfo(FieldStates::Separate, fieldstack.back());
        }
        if(type == "end")
        {
                if(fieldstack.empty())
                {
                        DEBUGPRINT("Field end rejected, fieldstack is empty");
                        return FieldInfo(FieldStates::Unknown, FieldData());
                }

                DEBUGPRINT("Field end: " << fieldstack.back().instruction);
                FieldData last = fieldstack.back();
                fieldstack.pop_back();
                return FieldInfo(FieldStates::End, last);
        }
        DEBUGPRINT("Field unknown type " << type);
        return FieldInfo(FieldStates::Unknown, FieldData());
}
void DocXParagraphWalker::ProcessFieldInstr(Blex::XML::Node node)
{
        if(!fieldstack.empty())
        {
                FieldData &field = fieldstack.back();
                std::string instrpart = node.GetAllChildrenContent();
                field.instruction += instrpart;
                DEBUGPRINT("Got field instruction '" << instrpart << "'");
                while(!field.instruction.empty() && Blex::IsWhitespace(field.instruction[0]))
                    field.instruction.erase(0,1); //delete first whistepace
                while(!field.instruction.empty() && Blex::IsWhitespace(field.instruction.end()[-1]))
                    field.instruction.resize(field.instruction.size()-1); //delete last whitespace
        }
        else
        {
                DEBUGPRINT("Ignoring field instruction, outside a field ('" << node.GetAllChildrenContent() << "')");
        }
}
void DocXParagraph::ProcessField(FieldData const &fld, OutputState &os, bool isstart) const
{
        if(Blex::StrLike(fld.instruction,"HYPERLINK *"))
        {
                if(isstart)
                {
                        Parsers::Hyperlink link = ParseFieldCodeHyperlink(fld.instruction);
                        if(!link.data.empty() && link.data[0]=='#')
                        {
                                std::string locationdata = std::string(link.data.begin()+1, link.data.end());
                                DocPart const *part = doc.FindByBookmark(locationdata);
                                std::string savetarget = link.target;
                                link = doc.GetHyperlink(part, locationdata);
                                link.target = savetarget;
                        }
                        if(link.target.empty())
                                link.target = GetDocXDoc().GetDefaultAnchorTarget();

                        DEBUGPRINT("Field-based hyperlink opening: " << link.data);
                        os.output.StartHyperlink(link);
                }
                else
                {
                        DEBUGPRINT("Field-based hyperlink closed");
                        os.output.EndHyperlink();
                }
                return;
        }
        if(Blex::StrLike(fld.instruction,"REF *"))
        {
                if(isstart)
                {
                        Parsers::Hyperlink link = ParseFieldCodeHyperlink(fld.instruction);

                        std::string locationdata = std::string(link.data.begin(), link.data.end());
                        DocPart const *part = doc.FindByBookmark(locationdata);
                        std::string savetarget = link.target;
                        link = doc.GetHyperlink(part, locationdata);
                        link.target = savetarget;

                        DEBUGPRINT("Field-based REF opening: " << link.data);
                        os.output.StartHyperlink(link);
                }
                else
                {
                        DEBUGPRINT("Field-based REF closed");
                        os.output.EndHyperlink();
                }
                return;
        }
}

//a run of text (a run is equivalent to a CHPX run in pre-2007, and is a set of characters with the same layout properties
void DocXParagraph::SendRun(DocXParagraphWalker &walker, OutputState &os, Blex::XML::Node run) const
{
        Chp run_chp = walker.GetCurChp();
        for(Blex::XML::NodeIterator runitr = run.GetChildNodeIterator(&xmlns_wordml); runitr; ++runitr)
        {
                if(runitr->LocalNameIs("rPr"))
                {
                        GetDocXDoc().ApplyChpProps(&run_chp, *runitr, true);
                }
                else if(runitr->LocalNameIs("fldChar"))
                {
                        FieldInfo fld = walker.ProcessFieldChar(*runitr);
                        if(fld.first==FieldStates::Separate)
                                ProcessField(fld.second, os, true);
                        else if(fld.first==FieldStates::End)
                                ProcessField(fld.second, os, false);
                }
                else if(runitr->LocalNameIs("instrText"))
                {
                        walker.ProcessFieldInstr(*runitr);
                }
                else if(runitr->LocalNameIs("t"))
                {
                        if(run_chp.pod.internal_bits & Chp::Vanish //marked as hidden
                           && (!basestyle->filter || !basestyle->filter->ShowHiddenAnyway()))  //profile doesn't override it
                                continue; //text is hidden

                        walker.eating_pagebreaks = false;

                        //FIXME: Take care of xml:space==preserve....
                        os.ApplyChp(run_chp, basestyle->filter);

                        //Flush text children
                        std::string text = runitr->GetAllChildrenContent();
                        if(run_chp.pod.internal_bits & Chp::Caps && !doc.ignore_allcaps)
                            Blex::ToUppercase(text.begin(), text.end());

                        os.output.WriteString(text.size(), &text[0]);
                }
                else if(runitr->LocalNameIs("tab"))
                {
                        walker.eating_pagebreaks = false;

                        os.ApplyChp(run_chp, basestyle->filter);
                        os.output.WriteChar(' ');
                }
                else if(runitr->LocalNameIs("br"))
                {
                        if(walker.eating_pagebreaks && runitr->GetAttr(&xmlns_wordml,"type") == "page")
                            continue;

                        walker.eating_pagebreaks = false;

                        os.ApplyChp(run_chp, basestyle->filter);
                        os.output.WriteChar('\n');
                }
                else if(runitr->LocalNameIs("pict"))
                {
                                                walker.eating_pagebreaks = false;

                        os.ApplyChp(run_chp, basestyle->filter);
                        SendPict(walker, os, *runitr);
                }
                else if(runitr->LocalNameIs("drawing"))
                {
                        walker.eating_pagebreaks = false;

                        os.ApplyChp(run_chp, basestyle->filter);
                        SendDrawing(walker, os, *runitr);
                }
                else if(runitr->LocalNameIs("noBreakHyphen"))
                {
                       os.output.WriteString(3, "\xE2\x80\x91");
                }
                else if(runitr->LocalNameIs("softHyphen"))
                {
                       os.output.WriteString(2, "\xC2\xAD");
                }
                else
                {
                        DEBUGPRINT("Unexpected node " << runitr->GetLocalName() << " in 'r' run");
                }
        }
}

void DocXParagraph::SendRuns(DocXParagraphWalker &walker, OutputState &os, Blex::XML::Node parent) const
{
        for (Blex::XML::NodeIterator cur = parent.GetChildNodeIterator(&xmlns_wordml); cur; ++cur)
        {
                if(cur->LocalNameIs("pPr"))
                    continue; //para props, skip
                else if(cur->LocalNameIs("r")) // a run! (or should we move the applying below to the walker?)
                    SendRun(walker, os, *cur);
                else if(cur->LocalNameIs("smartTag")) //we don't really care about the smarttag itself...
                    SendRuns(walker, os, *cur);
                else if(cur->LocalNameIs("ins"))
                {
                        if (doc.tcmode == DocBase::TCOriginal)
                            continue; //drop insertions
                        else
                            SendRuns(walker, os, *cur);
                }
                else if(cur->LocalNameIs("bookmarkStart"))
                {
                        std::string name = cur->GetAttr(&xmlns_wordml,"name");
                        DEBUGPRINT("Paragraph contains bookmark start for [" << name << "]");
                        if(name.empty() || name[0]=='_' || std::count(initialanchors.begin(), initialanchors.end(), name) != 0 )
                            continue;

                        os.output.SetAnchor(name);
                }
                else if(cur->LocalNameIs("hyperlink"))
                {
                        if(!os.output.AreHyperlinksAccepted())
                        {
                                SendRuns(walker, os, *cur);
                                continue;
                        }

                        std::string id = cur->GetAttr(&Parsers::Office::OOXML::xmlns_officedoc_relationships,"id");
                        std::string anchor = cur->GetAttr(&xmlns_wordml, "anchor");
                        std::string target = cur->GetAttr(&xmlns_wordml, "tgtFrame");

                        if(!id.empty())
                        {
                                Blex::XML::Node hyperlinkinfo = GetDocXDoc().GetPackageRef().GetRelNodeById(id);
                                if(hyperlinkinfo)
                                {
                                        std::string linkdata = hyperlinkinfo.GetAttr(0, "Target");
                                        DEBUGPRINT("Hyperlink rel [" << id << "] refers to " << linkdata);

                                        Parsers::Hyperlink link;
                                        link.target = target;
                                        link.data = linkdata;
                                        if(!anchor.empty())
                                        {
                                                link.data += '#';
                                                link.data += anchor;
                                        }
                                        ApplyWordLinkHack(&link); //allow #_blank
                                        if(link.target.empty())
                                                link.target = GetDocXDoc().GetDefaultAnchorTarget();
                                        os.output.StartHyperlink(link);
                                        SendRuns(walker, os, *cur);
                                        os.output.EndHyperlink();
                                        continue;
                                }
                        }

                        if(!anchor.empty())
                        {
                                DEBUGPRINT("Hyperlink anchor [" << anchor << "]");
                                //ADDME: Paragraphs that didn't generate an anchor by themselves, should've manually got one added
                                DocPart const *part = doc.FindByBookmark(anchor);

                                Parsers::Hyperlink link;
                                link.target = target;
                                if(part)
                                    link = doc.GetHyperlink(part, anchor);

                                os.output.StartHyperlink(link);
                                SendRuns(walker, os, *cur);
                                os.output.EndHyperlink();
                                continue;
                        }
                        SendRuns(walker, os, *cur);
                }
                else
                {
                        DEBUGPRINT("Unexpected node " << cur->GetLocalName() << " in paragraph");
                }
        }
}
void DocXParagraph::SendPict(DocXParagraphWalker &/*walker*/, OutputState &os, Blex::XML::Node parent) const
{
        for (Blex::XML::NodeIterator cur = parent.GetChildNodeIterator(NULL); cur; ++cur)
        {
                if(cur->LocalNameIs("shape") && cur->IsInNamespace(Parsers::Office::VML::xmlns_vml))
                {
                        Parsers::Office::VML::RenderVMLPicture(os.output, *cur, GetDocXDoc().GetPackageRef());
                }
        }
}

void DocXParagraph::SendDrawing(DocXParagraphWalker &/*walker*/, OutputState &os, Blex::XML::Node para) const
{
        Parsers::Office::DrawingML::RenderDrawingML(os.output, para, GetDocXDoc().GetPackageRef(), GetDocXDoc().GetMainDoc());
}

void DocXParagraph::Send(Parsers::FormattedOutputPtr const &siteoutput) const
{
        DEBUGPRINT("DocXParagraph Send " << basestyle->stylename);

        DocXParagraphWalker walker(GetDocXDoc());
        walker.SetParagraph(*this);

        FilteredOutput filtered(siteoutput, *basestyle->filter);
        OutputState os(doc, filtered);

        //Add to webhare.css if needed
        ParaCharStyle *style=const_cast<ParaCharStyle*>(basestyle);
        if (style->predefined_output_style == 0) //a predefined style was not requested yet..
            style->PredefineStyle(filtered);

        Parsers::ObjectType listtype = walker.GetParaPap().GetListType();

        StartPara(walker.GetParaPap(), filtered, listtype, style);

        if (listtype!=Parsers::NoList)
        {
                if (walker.GetParaPap().listovr)
                {
                        Chp listchp = walker.GetListBulletChp();
                        os.SetFormatting(listchp.font, listchp.formatted);
                        DoBullet(os
                                ,*walker.GetParaPap().listovr
                                ,walker.GetParaPap().listlevel
                                ,listcounters
                                //FIXME,*charproc.parawalker.GetListBulletChp().font
                                ,*listchp.font
                                );
                        os.SetFormatting(walker.GetCurChp().font, walker.GetCurChp().formatted);
                }
        }

        filtered.EnterParaText();
        walker.fieldstack.reserve(initialfieldstack.size());
        for(unsigned i=0;i<initialfieldstack.size();++i)
        {
                walker.fieldstack.push_back(initialfieldstack[i]);
                ProcessField(initialfieldstack[i], os, true);
        }

        for(std::vector<Blex::XML::Node>::const_iterator itr = paranodes.begin(); itr!=paranodes.end(); ++itr)
            SendRuns(walker, os, *itr);

        while(!walker.fieldstack.empty())
        {
                ProcessField(walker.fieldstack.back(), os, false);
                walker.fieldstack.pop_back();
        }
        filtered.EndParagraph();
}

std::pair<bool, unsigned> DocXParagraph::GetParagraphCollapseInfo() const
{
        //Grab all the text nodes
        for(std::vector<Blex::XML::Node>::const_iterator itr = paranodes.begin(); itr!=paranodes.end(); ++itr)
        {
                std::vector<Blex::XML::Node> textnodes = itr->GetElementsByTagNameNS(&xmlns_wordml, "t");
                for (unsigned i=0; i<textnodes.size(); ++i)
                {
                        //FIXME: Skip over paragraphs consisting of only spaces and NBSPs too
                        if(textnodes[i].GetFirstChild())
                            return std::make_pair(false,0);
                }

                std::vector<Blex::XML::Node> drawingnodes = itr->GetElementsByTagNameNS(&xmlns_wordml, "drawing");
                if(!drawingnodes.empty())
                        return std::make_pair(false,0);

                std::vector<Blex::XML::Node> vmldrawings = itr->GetElementsByTagNameNS(&xmlns_wordml, "pict");
                if(!vmldrawings.empty())
                        return std::make_pair(false,0);

        }

        //Calculate PAP (ADDME: get the maxheight of the entire paragraph, not just the style or paramark)
        DocXParagraphWalker walker(GetDocXDoc());
        walker.SetParagraph(*this);
        return std::make_pair(true, GetPapChpEmptyHeight(walker.GetParaPap(), walker.GetListBulletChp()));
}

DocXDoc::DocXDoc(int32_t unique_id, std::shared_ptr<Blex::RandomStream> const &docfile,Callbacks &callbacks)
: DocBase(&mynullstyle, unique_id, callbacks)
, default_character_style(NULL)
, default_table_style(NULL)
, mynullstyle(*this)
, packagestream(docfile)
, merge_with_next(NULL)
{
}

DocXDoc::~DocXDoc()
{
}

std::pair<unsigned, std::string> DocXDoc::ScanMetadata()
{
        documentpath = "word/document.xml";
        package.reset(Parsers::Office::OOXML::OOXMLPackage::Open(*packagestream));
        if(!package.get())
           throw std::runtime_error("The file does not appear to be Word document");

        //Read the stylesheet
        ReadFonts();
        ReadLists();
        ReadTheme();
        ReadStyles(); //styles can refer to lists, and to fonts

        std::unique_ptr<Blex::Stream> docpropscustomfile;
        docpropscustomfile.reset(package->OpenFile("docProps/custom.xml"));
        if(docpropscustomfile.get())
        {
                DEBUGPRINT("Opened customprops");
                Blex::XML::Document docpropscustom;
                if(docpropscustom.ReadFromStream(*docpropscustomfile))
                {
                        DEBUGPRINT("Parsed customprops");
                        /*
                        <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Base Target"><vt:lpwstr>_blank</vt:lpwstr></property></Properties>
                        */
                        for (Blex::XML::NodeIterator itr = docpropscustom.GetRoot().GetChildNodeIterator(&OOXML::xmlns_custom_properties); itr; ++itr)
                          if(itr->LocalNameIs("property"))
                          {
                                if(itr->GetAttr(0, "fmtid") == "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}"
                                   && itr->GetAttr(0, "name") == "Base Target")
                                {
                                        defaultanchortarget = itr->GetAllChildrenContent();
                                        DEBUGPRINT("Default anchor target: " << defaultanchortarget);
                                }
                          }
                }
        }

        //Open the main XML file
        /* FIXME: We should open the .rels file, and locate the word document (or any other data) through that file */
        std::unique_ptr<Blex::Stream> mainfile;
        mainfile.reset(package->OpenFile("word/document.xml"));
        if(!mainfile.get())
           throw std::runtime_error("Can not find the main word/document.xml stream");

        if (!maindoc.ReadFromStream(*mainfile))
           throw std::runtime_error("Can not parse the main word/document.xml stream");

        DEBUGPRINT("DOCX: Succesfully opened the main document!");

        return std::make_pair(0,"");
}

void DocXDoc::ReadFonts()
{
        std::unique_ptr<Blex::Stream> fontsfile;
        fontsfile.reset(package->OpenFileByType(documentpath, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable"));
        if(!fontsfile.get())
           throw std::runtime_error("Can not find the fonts stream");

        Blex::XML::Document fontsdoc;
        if(!fontsdoc.ReadFromStream(*fontsfile))
           throw std::runtime_error("Can not parse the fonts stream");

        //Grab all styles first (so we can properly follow 'based on' things)
        for (Blex::XML::NodeIterator itr = fontsdoc.GetRoot().GetChildNodeIterator(&xmlns_wordml); itr; ++itr)
          if(itr->LocalNameIs("font"))
        {
                Font newfont;
                newfont.name = itr->GetAttr(&xmlns_wordml, "name"); //unmodified name for lookups
                newfont.formatted.font_face = newfont.name;

                for (Blex::XML::NodeIterator subitr = itr->GetChildNodeIterator(&xmlns_wordml); subitr; ++subitr)
                {
                        //ADDME Altnames in <w:altName w:val="arial unicode" elemnts...
                        if(subitr->LocalNameIs("family"))
                        {
                                std::string val = subitr->GetAttr(&xmlns_wordml, "val");
                                /* auto: Specifies that information about a font's font family does not exist.
                                   decorative (Novelty Font): Specifies the Novelty font family.
                                   modern (Monospace Font) Specifies a monospace font with or without serifs (monospace fonts are usually modern).
                                   roman (Proportional Font With Serifs) Specifies a proportional font with serifs.
                                   script (Script Font) Specifies a script font designed to mimic the appearance of handwriting.
                                   swiss (Proportional Font Without Serifs) Specifies a proportional font without serifs. */
                                if(val=="roman")
                                    newfont.fontfamily=0;
                                else if(val=="swiss")
                                    newfont.fontfamily=2;
                                else if(val=="script")
                                    newfont.fontfamily=4;
                                else if(val=="decorative")
                                    newfont.fontfamily=5;
                                else if(val=="modern")
                                    newfont.fontfamily = 3;
                                else
                                    newfont.fontfamily = 0;
                        }
                        else if(subitr->LocalNameIs("altName"))
                        {
                                std::string val = subitr->GetAttr(&xmlns_wordml, "val");
                                newfont.formatted.font_face += ", " + val;
                        }
                        else if(subitr->LocalNameIs("charset"))
                        {
                                newfont.charset = GetS32HexAttr(*subitr, "val");
                        }
                }
                DEBUGPRINT("Font read: " << newfont.formatted.font_face);
                SetupFontInfo(&newfont);
                fonts.push_back(newfont);
        }
}

void DocXDoc::ApplyFontTheme(Blex::XML::Node schemenode)
{
        std::string basename = schemenode.LocalNameIs("majorFont") ? "major" : "minor";
        for (Blex::XML::NodeIterator itr = schemenode.GetChildNodeIterator(&Parsers::Office::DrawingML::xmlns_drawing_main); itr; ++itr)
        {
                if(itr->LocalNameIs("latin"))
                {
                        themefonts[basename + "Ascii"] = itr->GetAttr(NULL, "typeface");
                        themefonts[basename + "HAnsi"] = itr->GetAttr(NULL, "typeface");
                }
                else if(itr->LocalNameIs("ea"))
                {
                        themefonts[basename + "EastAsia"] = itr->GetAttr(NULL, "typeface");
                }
                else if(itr->LocalNameIs("cs"))
                {
                        themefonts[basename + "Bidi"] = itr->GetAttr(NULL, "typeface");
                }
                else
                {
                        DEBUGPRINT("Ignoring node " << itr->GetLocalName() << " in font theme");
                }
        }
}

void DocXDoc::ReadTheme()
{
        std::unique_ptr<Blex::Stream> themefile;
        themefile.reset(package->OpenFileByType(documentpath, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"));

        if(!themefile.get())
        {
                DEBUGPRINT("Cannot read theme file");
                return;
        }

        Blex::XML::Document themedoc;
        if(!themedoc.ReadFromStream(*themefile))
           throw std::runtime_error("Can not parse the theme document");

        /* we just use this to get the default latin font
           ADDME it seems a bit more complex in practice though:
           the settings subpart defines the themeFontLang element which also
           has something to do with this.. */

        for (Blex::XML::NodeIterator itr = themedoc.GetRoot().GetChildNodeIterator(&Parsers::Office::DrawingML::xmlns_drawing_main); itr; ++itr)
          if(itr->LocalNameIs("themeElements"))
        {
                for (Blex::XML::NodeIterator elementsitr = itr->GetChildNodeIterator(&Parsers::Office::DrawingML::xmlns_drawing_main); elementsitr; ++elementsitr)
                  if(elementsitr->LocalNameIs("fontScheme"))
                {
                        for (Blex::XML::NodeIterator schemeitr = elementsitr->GetChildNodeIterator(&Parsers::Office::DrawingML::xmlns_drawing_main); schemeitr; ++schemeitr)
                        {
                                if(schemeitr->LocalNameIs("majorFont")
                                   || schemeitr->LocalNameIs("minorFont"))
                                {
                                        ApplyFontTheme(*schemeitr);
                                }
                                else
                                {
                                        DEBUGPRINT("Ignoring node " << itr->GetLocalName() << " in fontScheme");
                                }
                        }
                }
        }
}

bool DocXDoc::ReadStyle(Blex::XML::Node node)
{
        std::string styleid = node.GetAttr(&xmlns_wordml, "styleId");
        bool customstyle = GetOnOffAttr(node, "customStyle", false);

        StylePtr style;
        DocXParaCharStyle *paracharstyle=0;

        std::string type = GetAttr(node, "type");
        bool isdefault = GetOnOffAttr(node,"default",false);
        if(type=="paragraph")
        {
                style.reset(new DocXParaCharStyle(*this));
                paracharstyle = static_cast<DocXParaCharStyle*>(style.get());
                style->type = StyleBase::ParagraphStyle;
        }
        else if(type == "character")
        {
                style.reset(new DocXParaCharStyle(*this));
                paracharstyle = static_cast<DocXParaCharStyle*>(style.get());
                style->type = StyleBase::CharacterStyle;
        }
        else if(type == "table")
        {
                style.reset(new DocXTableStyle);
                style->type = StyleBase::TableStyle;
        }
        else
        {
                DEBUGPRINT("Skipping " << type << " style " << styleid);
                return false;
        }

        style->styleid = styleid;

        for (Blex::XML::NodeIterator subitr = node.GetChildNodeIterator(&xmlns_wordml); subitr; ++subitr)
        {
                //ADDME: Table styles can have rPr too, should prolly process that as well

                if(subitr->LocalNameIs("pPr") && style->type == StyleBase::ParagraphStyle)
                    paracharstyle->docx_ppr = *subitr;
                else if(subitr->LocalNameIs("rPr") && (style->type == StyleBase::ParagraphStyle || style->type == StyleBase::CharacterStyle))
                    paracharstyle->docx_rpr = *subitr;
                else if(subitr->LocalNameIs("tblPr") && style->type == StyleBase::TableStyle)
                    static_cast<DocXTableStyle*>(style.get())->tblpr = *subitr;
                else if(subitr->LocalNameIs("basedOn"))
                    style->basestyleid = subitr->GetAttr(&xmlns_wordml, "val");
                else if(subitr->LocalNameIs("name"))
                    style->stylename = subitr->GetAttr(&xmlns_wordml, "val");
        }

        if(!customstyle)
        {
                Styles::Iterator styleinfo = Styles::Find(style->stylename);
                if(styleinfo != Styles::End())
                    style->mswordid = styleinfo->wordid;
                else
                    DEBUGPRINT("Cannot figure out the WordID for the builtin style " << styleid);
        }

        styles.push_back(style);
        return isdefault;
}

void DocXDoc::ReadDocDefaults(Blex::XML::Node node)
{
        for (Blex::XML::NodeIterator itr = node.GetChildNodeIterator(&xmlns_wordml);itr;++itr)
        {
                if(itr->LocalNameIs("pPrDefault"))
                {
                        for (Blex::XML::NodeIterator subitr = itr->GetChildNodeIterator(&xmlns_wordml);subitr;++subitr)
                        {
                                if(subitr->LocalNameIs("pPr"))
                                    document_default_pap.ApplyDocXProps(*this, *subitr);
                                else
                                    DEBUGPRINT("Unrecognized node in pPrDefault: " << subitr->GetLocalName());
                        }
                }
                else if(itr->LocalNameIs("rPrDefault"))
                {
                        for (Blex::XML::NodeIterator subitr = itr->GetChildNodeIterator(&xmlns_wordml);subitr;++subitr)
                        {
                                if(subitr->LocalNameIs("rPr"))
                                    ApplyChpProps(&document_default_chp, *subitr, false);
                                else
                                    DEBUGPRINT("Unrecognized node in rPrDefault: " << subitr->GetLocalName());
                        }
                }
                else
                {
                        DEBUGPRINT("Unrecognized node in docDEfaults: " << itr->GetLocalName());
                }
        }
}

void DocXDoc::ReadStyles()
{
        unsigned default_paragraph_style_num = std::numeric_limits<unsigned>::max();
        unsigned default_character_style_num = std::numeric_limits<unsigned>::max();
        unsigned default_table_style_num = std::numeric_limits<unsigned>::max();

        /* ADDME: We should open the .rels file, and locate the word document (or any other data) through that file */
        std::unique_ptr<Blex::Stream> stylesfile;
        stylesfile.reset(package->OpenFileByType(documentpath, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"));
        if(!stylesfile.get())
           throw std::runtime_error("Can not find the styles stream");

        if(!stylesdoc.ReadFromStream(*stylesfile))
           throw std::runtime_error("Can not parse the styles stream");

        //Grab all styles first (so we can properly follow 'based on' things)
        for (Blex::XML::NodeIterator itr = stylesdoc.GetRoot().GetChildNodeIterator(&xmlns_wordml);itr;++itr)
        {
                if(itr->LocalNameIs("style"))
                {
                        if(ReadStyle(*itr)) //is a default
                        {
                                StyleBase const &laststyle = *styles[styles.size()-1];
                                if(laststyle.type == StyleBase::ParagraphStyle)
                                    default_paragraph_style_num = styles.size()-1;
                                else if(laststyle.type == StyleBase::CharacterStyle)
                                    default_character_style_num = styles.size()-1;
                                else if(laststyle.type == StyleBase::TableStyle)
                                    default_table_style_num = styles.size()-1;
                        }
                }
                else if(itr->LocalNameIs("docDefaults"))
                {
                        ReadDocDefaults(*itr);
                }
        }
        LinkStyleHistories();
        CacheParagaphStyles();

        if(default_paragraph_style_num!=std::numeric_limits<unsigned>::max())
            default_paragraph_style = static_cast<ParaCharStyle*>(styles[default_paragraph_style_num].get());
        if(default_character_style_num!=std::numeric_limits<unsigned>::max())
            default_character_style = static_cast<ParaCharStyle*>(styles[default_character_style_num].get());
        if(default_table_style_num!=std::numeric_limits<unsigned>::max())
            default_table_style = static_cast<DocXTableStyle*>(styles[default_table_style_num].get());
}

ListDataPtr DocXDoc::ReadAbstractNumbering(Blex::XML::Node node) const
{
        ListDataPtr abstract(new ListData);
        //int32_t num = GetS32Attr(node, "abstractNumId");
        for (Blex::XML::NodeIterator itr = node.GetChildNodeIterator(&xmlns_wordml);itr;++itr)
        {
                if(itr->LocalNameIs("nsid"))
                {
                        abstract->unique_list_id = GetS32HexAttr(*itr, "val");
                }
                else if(itr->LocalNameIs("tmpl"))
                {
                        abstract->unique_template_code = GetS32HexAttr(*itr, "val");
                }
                else if(itr->LocalNameIs("lvl"))
                {
                        int32_t ilvl = GetS32Attr(*itr, "ilvl");

                        std::shared_ptr<DocXListLevel> dll;
                        dll.reset(new DocXListLevel(*this, ilvl));

                        abstract->levels[ilvl] = dll;
                        for (Blex::XML::NodeIterator subitr = itr->GetChildNodeIterator(&xmlns_wordml);subitr;++subitr)
                        {
                                if(subitr->LocalNameIs("start"))
                                {
                                        dll->startat = GetS32Attr(*subitr, "val");
                                }
                                else if(subitr->LocalNameIs("lvlText"))
                                {
                                        std::string val = GetAttr(*subitr, "val");
                                        dll->lvltext.clear();
                                        Blex::UTF8Decode(val.begin(), val.end(), std::back_inserter(dll->lvltext));
                                }
                                else if(subitr->LocalNameIs("lvlRestart"))
                                {
                                        dll->restartafter = GetS32Attr(*subitr, "val");
                                }
                                else if(subitr->LocalNameIs("numFmt"))
                                {
                                        dll->nfc = GetST_NumberFormat(*subitr, "val");
                                }
                                else if(subitr->LocalNameIs("pPr"))
                                {
                                        dll->ppr = *subitr;
                                }
                                else if(subitr->LocalNameIs("isLgl"))
                                {
                                        dll->legal = true;
                                }
                                else if(subitr->LocalNameIs("rPr"))
                                {
                                        dll->rpr = *subitr;
                                }
                        }
                }
        }
        return abstract;
}

Parsers::Office::OOXML::OOXMLPackageRef DocXDoc::GetPackageRef() const
{
        return Parsers::Office::OOXML::OOXMLPackageRef(*package, documentpath);
}

void DocXDoc::ReadLists()
{
        /* ADDME: We should open the .rels file, and locate the word document (or any other data) through that file */
        std::unique_ptr<Blex::Stream> numberingfile;
        numberingfile.reset(package->OpenFileByType(documentpath, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering"));
        if(!numberingfile.get())
        {
                DEBUGPRINT("No numbering data stream - harmless if the file contains no lists");
                return;
        }

        if(!numberingdoc.ReadFromStream(*numberingfile))
           throw std::runtime_error("Can not parse the numbering stream");

        std::map<int32_t, ListDataPtr> abstract_nums;

        for (Blex::XML::NodeIterator itr = numberingdoc.GetRoot().GetChildNodeIterator(&xmlns_wordml);itr;++itr)
        {
                if(itr->LocalNameIs("abstractNum"))
                {
                        //FIXME Parse w:lvl etc
                        int32_t num = GetS32Attr(*itr, "abstractNumId");
                        abstract_nums[num] = ReadAbstractNumbering(*itr);
                        DEBUGONLY(Parsers::Office::Word::DumpAbstractNumbering(*abstract_nums[num]));
                }
                else if(itr->LocalNameIs("num"))
                {
                        ListOverridePtr ovr(new ListOverride);
                        int32_t num = GetS32Attr(*itr, "numId");

                        for(Blex::XML::NodeIterator subitr = itr->GetChildNodeIterator(&xmlns_wordml);subitr;++subitr)
                        {
                                if(subitr->LocalNameIs("abstractNumId"))
                                {
                                        ovr->abstract = abstract_nums[GetS32Attr(*subitr, "val")];
                                }
                        }

                        if(!ovr->abstract)
                        {
                                DEBUGPRINT("DOCX: Skipping numbering numId " << num << " because it has no abstract");
                                continue;
                        }
                        numberings[num] = ovr;
                }


        }
}

DocXTableHolder::DocXTableHolder(DocPart *parent, DocXDoc const &doc, DocXTable *table)
: DocPart(doc, parent, NULL)
{
        this->table=table;
}

void DocXTableHolder::Send(Parsers::FormattedOutputPtr const &siteoutput) const //ADDME Merge with BiffParagraph version...
{
        Parsers::Table tableformat = table->tableformat;
        tableformat.tablepadding.top += add_top_padding;
        tableformat.tablepadding.bottom += add_bottom_padding;

        bool tableopen = false;
        for (unsigned i=0;i<table->rows.size();++i)
          for (unsigned j=0;j<table->rows[i].cells.size();++j)
        {
                TableDocPart::Cell const &cellinfo = table->rows[i].cells[j];
                if(tableformat.GetFormatting(cellinfo.offset,i).type != Parsers::Table::Data)
                    continue; //overlapped cell

                if(!tableopen)
                {
                        siteoutput->StartTable(tableformat);
                        tableopen=true;
                }
                else
                {
                        siteoutput->NextCell();
                }

                for(DocPart const *part=cellinfo.firstpart;part;part=part->next)
                  if(part->master==part)
                     part->Send(siteoutput);
        }
        if(tableopen)
            siteoutput->EndTable();
}


void DocXParaCharStyle::ApplyStyle(Pap *pap, Chp * chp) const
{
        if(docx_ppr && pap)
            pap->ApplyDocXProps(docx, docx_ppr);
        if(docx_rpr && chp)
            docx.ApplyChpProps(chp, docx_rpr, false);
}

DocXListLevel::DocXListLevel(DocXDoc const &parent, unsigned level)
: ListLevel(level)
, parent(parent)
{
}

void DocXListLevel::ApplyPap(Pap *pap) const
{
        if(ppr)
            pap->ApplyDocXProps(parent, ppr);
}
void DocXListLevel::ApplyChp(Pap const * /*pap*/, Chp *chp) const
{
        if(rpr)
            parent.ApplyChpProps(chp, rpr, true);
}

} // End of namespace DocX
} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
