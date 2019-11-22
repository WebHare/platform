#include <ap/libwebhare/allincludes.h>

//---------------------------------------------------------------------------

#include "wordstyles.h"
namespace Parsers {
namespace Office {
namespace Word {

namespace Styles
{

const Style wordstyles[]={
{"Normal",   0,0},
{"Heading 1",1,1},
{"Heading 2",2,2},
{"Heading 3",3,3},
{"Heading 4",4,4},
{"Heading 5",5,5},
{"Heading 6",6,6},
{"Heading 7",7,7},
{"Heading 8",8,8},
{"Heading 9",9,9},
{"Index 1",10,0},
{"Index 2",11,0},
{"Index 3",12,0},
{"Index 4",13,0},
{"Index 5",14,0},
{"Index 6",15,0},
{"Index 7",16,0},
{"Index 8",17,0},
{"Index 9",18,0},
{"TOC 1",19,0},
{"TOC 2",20,0},
{"TOC 3",21,0},
{"TOC 4",22,0},
{"TOC 5",23,0},
{"TOC 6",24,0},
{"TOC 7",25,0},
{"TOC 8",26,0},
{"TOC 9",27,0},
{"Normal Indent",28,0},
{"Footnote Text",29,0},
{"Annotation Text",30,0},
{"Header",31,0},
{"Footer",32,0},
{"Index Heading",33,0},
{"Caption",34,0},
{"Table of Figures",35,0},
{"Envelope Address",36,0},
{"Envelope Return",37,0},
{"Footnote Reference",38,0},
{"Annotation Reference",39,0},
{"Line Number",40,0},
{"Page Number",41,0},
{"Endnote Reference",42,0},
{"Endnote Text",43,0},
{"Table of Authorities",44,0},
{"Macro Text",45,0},
{"TOA Heading",46,0},
{"List",47,0},
{"List 2",50,0},
{"List 3",51,0},
{"List 4",52,0},
{"List 5",53,0},
{"List Bullet",48,0},
{"List Bullet 2",54,0},
{"List Bullet 3",55,0},
{"List Bullet 4",56,0},
{"List Bullet 5",57,0},
{"List Number",49,0},
{"List Number 2",58,0},
{"List Number 3",59,0},
{"List Number 4",60,0},
{"List Number 5",61,0},
{"Title",62,1},
{"Closing",63,0},
{"Signature",64,0},
{"Default Paragraph Font",65,0},
{"Body Text",66,0},
{"Body Text Indent",67,0},
{"List Continue",68,0},
{"List Continue 2",69,0},
{"List Continue 3",70,0},
{"List Continue 4",71,0},
{"List Continue 5",72,0},
{"Message Header",73,0},
{"Subtitle",74,2},
{"Salutation",75,0},
{"Date",76,0},
{"Body Text First Indent",77,0},
{"Body Text First Indent 2",78,0},
{"Note Heading",79,0},
{"Body Text 2",80,0},
{"Body Text 3",81,0},
{"Body Text Indent 2",82,0},
{"Body Text Indent 3",83,0},
{"Block Text",84,0},
{"Hyperlink",85,0},
{"Followed Hyperlink",86,0},
{"Strong",87,0},
{"Emphasis",88,0},
{"Document Map",89,0},
{"Plain Text",90,0} };

Iterator Begin()
{
        return wordstyles;}

Iterator End()
{
        return wordstyles + sizeof(wordstyles)/sizeof(*wordstyles);
}

Iterator Find(signed wordid)
{
        //ADDME: Binary find?
        Iterator itr=Begin(), end_itr = End();
        while (itr != end_itr && itr->wordid != wordid)
            ++itr;
        return itr;
}

Iterator Find(std::string const &name)
{
        Iterator itr=Begin(), end_itr = End();
        if(name.empty())
            return End();

        while (itr != end_itr && Blex::StrCaseCompare(itr->name, name) != 0)
            ++itr;
        return itr;
}


}  //end namespace Styles

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers






