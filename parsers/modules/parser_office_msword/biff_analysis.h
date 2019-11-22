#ifndef blex_parsers_office_msword_biff_analysis
#define blex_parsers_office_msword_biff_analysis

#include <stack>
#include "biff.h"

namespace Parsers {
namespace Office {
namespace Word {

struct BiffTable : TableDocPart
{
        std::vector<Tap> rowtaps;

        void DumpTable();
        /** Normalize tabs and transmit table settings to the table object */
        void PostProcessTable();
        void RefitWidths(unsigned row);

        /** Collapse all widths closer than 'range' to each other */
        void CollapseWidths(Widths *widths,unsigned range);
};

class BiffParaAnalyzer
{
        public:
        BiffParaAnalyzer(BiffDoc &biffdoc);
        ~BiffParaAnalyzer();

        void ParagraphsRead(void);

        private:
        struct Paragraph //used by paragraph reader
        {
                Fc limitfc;
                StyleId basestyle;
                GrpprlPointer grpprlptr;
        };
        struct ParagraphMerger //used by paragraph reader
        {
                GrpprlPointer grpprlptr;
                StyleId basestyle;
        };

        void OpenTable();
        void NextRow();
        void NextCell();
        void CloseTable();
        void StoreRowProperties();
        void AddBiffParagraph(Cp startcp, Cp limitcp, ComplexRecord const *endpiece, ParaCharStyle const *style, GrpprlPointer grpprlptr);

        BiffDoc &biffdoc;
        ///Currently open tables
        std::stack< BiffTable* > tablestack;
        ///Current 'last parts', used for updating 'next'. lastpart.size() == tablestack.size() + 1
        std::vector< DocPart* > lastpart;
        ///Need to merge with next paragraph
        BiffParagraph* merge_with_next;

        Pap mypap;
        Tap mytap;
};

class TableScanner
{
        public:
        TableScanner(BiffDoc const &scanner);

        void ScanTable(TableDocPart *part);

        private:
        void ProcessRow(unsigned row, BiffTable *bifftable);
        /** Calculate colspan and rowspans for a row and send them to the
            table object
        */

        BiffDoc const &doc;


        /** Find the depth of a specific word cell
            @param startrow Row to start the search from
            @param col Column to search the bottom for
            @return Word X,Y coordinates of the bottom cell*/
        std::pair<unsigned,unsigned> FindDepth(BiffTable const *bifftable, unsigned startrow, unsigned col);
};


} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers


#endif
