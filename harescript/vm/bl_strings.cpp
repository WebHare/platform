#include <harescript/vm/allincludes.h>


#include <blex/docfile.h>
#include "baselibs.h"
#include "hsvm_context.h"

namespace //anonymous
{

struct EntityTextMap
{
        const char *name;
        const char *text;
};

/** HTML living standard entity references, retrieved from https://html.spec.whatwg.org/entities.json at 2018-12-03
*/
static const EntityTextMap entitymap[] =
    { { "AElig", u8"\u00C6" }
    , { "AMP", u8"&" }
    , { "Aacute", u8"\u00C1" }
    , { "Abreve", u8"\u0102" }
    , { "Acirc", u8"\u00C2" }
    , { "Acy", u8"\u0410" }
    , { "Afr", u8"\U0001D504" }
    , { "Agrave", u8"\u00C0" }
    , { "Alpha", u8"\u0391" }
    , { "Amacr", u8"\u0100" }
    , { "And", u8"\u2A53" }
    , { "Aogon", u8"\u0104" }
    , { "Aopf", u8"\U0001D538" }
    , { "ApplyFunction", u8"\u2061" }
    , { "Aring", u8"\u00C5" }
    , { "Ascr", u8"\U0001D49C" }
    , { "Assign", u8"\u2254" }
    , { "Atilde", u8"\u00C3" }
    , { "Auml", u8"\u00C4" }
    , { "Backslash", u8"\u2216" }
    , { "Barv", u8"\u2AE7" }
    , { "Barwed", u8"\u2306" }
    , { "Bcy", u8"\u0411" }
    , { "Because", u8"\u2235" }
    , { "Bernoullis", u8"\u212C" }
    , { "Beta", u8"\u0392" }
    , { "Bfr", u8"\U0001D505" }
    , { "Bopf", u8"\U0001D539" }
    , { "Breve", u8"\u02D8" }
    , { "Bscr", u8"\u212C" }
    , { "Bumpeq", u8"\u224E" }
    , { "CHcy", u8"\u0427" }
    , { "COPY", u8"\u00A9" }
    , { "Cacute", u8"\u0106" }
    , { "Cap", u8"\u22D2" }
    , { "CapitalDifferentialD", u8"\u2145" }
    , { "Cayleys", u8"\u212D" }
    , { "Ccaron", u8"\u010C" }
    , { "Ccedil", u8"\u00C7" }
    , { "Ccirc", u8"\u0108" }
    , { "Cconint", u8"\u2230" }
    , { "Cdot", u8"\u010A" }
    , { "Cedilla", u8"\u00B8" }
    , { "CenterDot", u8"\u00B7" }
    , { "Cfr", u8"\u212D" }
    , { "Chi", u8"\u03A7" }
    , { "CircleDot", u8"\u2299" }
    , { "CircleMinus", u8"\u2296" }
    , { "CirclePlus", u8"\u2295" }
    , { "CircleTimes", u8"\u2297" }
    , { "ClockwiseContourIntegral", u8"\u2232" }
    , { "CloseCurlyDoubleQuote", u8"\u201D" }
    , { "CloseCurlyQuote", u8"\u2019" }
    , { "Colon", u8"\u2237" }
    , { "Colone", u8"\u2A74" }
    , { "Congruent", u8"\u2261" }
    , { "Conint", u8"\u222F" }
    , { "ContourIntegral", u8"\u222E" }
    , { "Copf", u8"\u2102" }
    , { "Coproduct", u8"\u2210" }
    , { "CounterClockwiseContourIntegral", u8"\u2233" }
    , { "Cross", u8"\u2A2F" }
    , { "Cscr", u8"\U0001D49E" }
    , { "Cup", u8"\u22D3" }
    , { "CupCap", u8"\u224D" }
    , { "DD", u8"\u2145" }
    , { "DDotrahd", u8"\u2911" }
    , { "DJcy", u8"\u0402" }
    , { "DScy", u8"\u0405" }
    , { "DZcy", u8"\u040F" }
    , { "Dagger", u8"\u2021" }
    , { "Darr", u8"\u21A1" }
    , { "Dashv", u8"\u2AE4" }
    , { "Dcaron", u8"\u010E" }
    , { "Dcy", u8"\u0414" }
    , { "Del", u8"\u2207" }
    , { "Delta", u8"\u0394" }
    , { "Dfr", u8"\U0001D507" }
    , { "DiacriticalAcute", u8"\u00B4" }
    , { "DiacriticalDot", u8"\u02D9" }
    , { "DiacriticalDoubleAcute", u8"\u02DD" }
    , { "DiacriticalGrave", u8"`" }
    , { "DiacriticalTilde", u8"\u02DC" }
    , { "Diamond", u8"\u22C4" }
    , { "DifferentialD", u8"\u2146" }
    , { "Dopf", u8"\U0001D53B" }
    , { "Dot", u8"\u00A8" }
    , { "DotDot", u8"\u20DC" }
    , { "DotEqual", u8"\u2250" }
    , { "DoubleContourIntegral", u8"\u222F" }
    , { "DoubleDot", u8"\u00A8" }
    , { "DoubleDownArrow", u8"\u21D3" }
    , { "DoubleLeftArrow", u8"\u21D0" }
    , { "DoubleLeftRightArrow", u8"\u21D4" }
    , { "DoubleLeftTee", u8"\u2AE4" }
    , { "DoubleLongLeftArrow", u8"\u27F8" }
    , { "DoubleLongLeftRightArrow", u8"\u27FA" }
    , { "DoubleLongRightArrow", u8"\u27F9" }
    , { "DoubleRightArrow", u8"\u21D2" }
    , { "DoubleRightTee", u8"\u22A8" }
    , { "DoubleUpArrow", u8"\u21D1" }
    , { "DoubleUpDownArrow", u8"\u21D5" }
    , { "DoubleVerticalBar", u8"\u2225" }
    , { "DownArrow", u8"\u2193" }
    , { "DownArrowBar", u8"\u2913" }
    , { "DownArrowUpArrow", u8"\u21F5" }
    , { "DownBreve", u8"\u0311" }
    , { "DownLeftRightVector", u8"\u2950" }
    , { "DownLeftTeeVector", u8"\u295E" }
    , { "DownLeftVector", u8"\u21BD" }
    , { "DownLeftVectorBar", u8"\u2956" }
    , { "DownRightTeeVector", u8"\u295F" }
    , { "DownRightVector", u8"\u21C1" }
    , { "DownRightVectorBar", u8"\u2957" }
    , { "DownTee", u8"\u22A4" }
    , { "DownTeeArrow", u8"\u21A7" }
    , { "Downarrow", u8"\u21D3" }
    , { "Dscr", u8"\U0001D49F" }
    , { "Dstrok", u8"\u0110" }
    , { "ENG", u8"\u014A" }
    , { "ETH", u8"\u00D0" }
    , { "Eacute", u8"\u00C9" }
    , { "Ecaron", u8"\u011A" }
    , { "Ecirc", u8"\u00CA" }
    , { "Ecy", u8"\u042D" }
    , { "Edot", u8"\u0116" }
    , { "Efr", u8"\U0001D508" }
    , { "Egrave", u8"\u00C8" }
    , { "Element", u8"\u2208" }
    , { "Emacr", u8"\u0112" }
    , { "EmptySmallSquare", u8"\u25FB" }
    , { "EmptyVerySmallSquare", u8"\u25AB" }
    , { "Eogon", u8"\u0118" }
    , { "Eopf", u8"\U0001D53C" }
    , { "Epsilon", u8"\u0395" }
    , { "Equal", u8"\u2A75" }
    , { "EqualTilde", u8"\u2242" }
    , { "Equilibrium", u8"\u21CC" }
    , { "Escr", u8"\u2130" }
    , { "Esim", u8"\u2A73" }
    , { "Eta", u8"\u0397" }
    , { "Euml", u8"\u00CB" }
    , { "Exists", u8"\u2203" }
    , { "ExponentialE", u8"\u2147" }
    , { "Fcy", u8"\u0424" }
    , { "Ffr", u8"\U0001D509" }
    , { "FilledSmallSquare", u8"\u25FC" }
    , { "FilledVerySmallSquare", u8"\u25AA" }
    , { "Fopf", u8"\U0001D53D" }
    , { "ForAll", u8"\u2200" }
    , { "Fouriertrf", u8"\u2131" }
    , { "Fscr", u8"\u2131" }
    , { "GJcy", u8"\u0403" }
    , { "GT", u8">" }
    , { "Gamma", u8"\u0393" }
    , { "Gammad", u8"\u03DC" }
    , { "Gbreve", u8"\u011E" }
    , { "Gcedil", u8"\u0122" }
    , { "Gcirc", u8"\u011C" }
    , { "Gcy", u8"\u0413" }
    , { "Gdot", u8"\u0120" }
    , { "Gfr", u8"\U0001D50A" }
    , { "Gg", u8"\u22D9" }
    , { "Gopf", u8"\U0001D53E" }
    , { "GreaterEqual", u8"\u2265" }
    , { "GreaterEqualLess", u8"\u22DB" }
    , { "GreaterFullEqual", u8"\u2267" }
    , { "GreaterGreater", u8"\u2AA2" }
    , { "GreaterLess", u8"\u2277" }
    , { "GreaterSlantEqual", u8"\u2A7E" }
    , { "GreaterTilde", u8"\u2273" }
    , { "Gscr", u8"\U0001D4A2" }
    , { "Gt", u8"\u226B" }
    , { "HARDcy", u8"\u042A" }
    , { "Hacek", u8"\u02C7" }
    , { "Hat", u8"^" }
    , { "Hcirc", u8"\u0124" }
    , { "Hfr", u8"\u210C" }
    , { "HilbertSpace", u8"\u210B" }
    , { "Hopf", u8"\u210D" }
    , { "HorizontalLine", u8"\u2500" }
    , { "Hscr", u8"\u210B" }
    , { "Hstrok", u8"\u0126" }
    , { "HumpDownHump", u8"\u224E" }
    , { "HumpEqual", u8"\u224F" }
    , { "IEcy", u8"\u0415" }
    , { "IJlig", u8"\u0132" }
    , { "IOcy", u8"\u0401" }
    , { "Iacute", u8"\u00CD" }
    , { "Icirc", u8"\u00CE" }
    , { "Icy", u8"\u0418" }
    , { "Idot", u8"\u0130" }
    , { "Ifr", u8"\u2111" }
    , { "Igrave", u8"\u00CC" }
    , { "Im", u8"\u2111" }
    , { "Imacr", u8"\u012A" }
    , { "ImaginaryI", u8"\u2148" }
    , { "Implies", u8"\u21D2" }
    , { "Int", u8"\u222C" }
    , { "Integral", u8"\u222B" }
    , { "Intersection", u8"\u22C2" }
    , { "InvisibleComma", u8"\u2063" }
    , { "InvisibleTimes", u8"\u2062" }
    , { "Iogon", u8"\u012E" }
    , { "Iopf", u8"\U0001D540" }
    , { "Iota", u8"\u0399" }
    , { "Iscr", u8"\u2110" }
    , { "Itilde", u8"\u0128" }
    , { "Iukcy", u8"\u0406" }
    , { "Iuml", u8"\u00CF" }
    , { "Jcirc", u8"\u0134" }
    , { "Jcy", u8"\u0419" }
    , { "Jfr", u8"\U0001D50D" }
    , { "Jopf", u8"\U0001D541" }
    , { "Jscr", u8"\U0001D4A5" }
    , { "Jsercy", u8"\u0408" }
    , { "Jukcy", u8"\u0404" }
    , { "KHcy", u8"\u0425" }
    , { "KJcy", u8"\u040C" }
    , { "Kappa", u8"\u039A" }
    , { "Kcedil", u8"\u0136" }
    , { "Kcy", u8"\u041A" }
    , { "Kfr", u8"\U0001D50E" }
    , { "Kopf", u8"\U0001D542" }
    , { "Kscr", u8"\U0001D4A6" }
    , { "LJcy", u8"\u0409" }
    , { "LT", u8"<" }
    , { "Lacute", u8"\u0139" }
    , { "Lambda", u8"\u039B" }
    , { "Lang", u8"\u27EA" }
    , { "Laplacetrf", u8"\u2112" }
    , { "Larr", u8"\u219E" }
    , { "Lcaron", u8"\u013D" }
    , { "Lcedil", u8"\u013B" }
    , { "Lcy", u8"\u041B" }
    , { "LeftAngleBracket", u8"\u27E8" }
    , { "LeftArrow", u8"\u2190" }
    , { "LeftArrowBar", u8"\u21E4" }
    , { "LeftArrowRightArrow", u8"\u21C6" }
    , { "LeftCeiling", u8"\u2308" }
    , { "LeftDoubleBracket", u8"\u27E6" }
    , { "LeftDownTeeVector", u8"\u2961" }
    , { "LeftDownVector", u8"\u21C3" }
    , { "LeftDownVectorBar", u8"\u2959" }
    , { "LeftFloor", u8"\u230A" }
    , { "LeftRightArrow", u8"\u2194" }
    , { "LeftRightVector", u8"\u294E" }
    , { "LeftTee", u8"\u22A3" }
    , { "LeftTeeArrow", u8"\u21A4" }
    , { "LeftTeeVector", u8"\u295A" }
    , { "LeftTriangle", u8"\u22B2" }
    , { "LeftTriangleBar", u8"\u29CF" }
    , { "LeftTriangleEqual", u8"\u22B4" }
    , { "LeftUpDownVector", u8"\u2951" }
    , { "LeftUpTeeVector", u8"\u2960" }
    , { "LeftUpVector", u8"\u21BF" }
    , { "LeftUpVectorBar", u8"\u2958" }
    , { "LeftVector", u8"\u21BC" }
    , { "LeftVectorBar", u8"\u2952" }
    , { "Leftarrow", u8"\u21D0" }
    , { "Leftrightarrow", u8"\u21D4" }
    , { "LessEqualGreater", u8"\u22DA" }
    , { "LessFullEqual", u8"\u2266" }
    , { "LessGreater", u8"\u2276" }
    , { "LessLess", u8"\u2AA1" }
    , { "LessSlantEqual", u8"\u2A7D" }
    , { "LessTilde", u8"\u2272" }
    , { "Lfr", u8"\U0001D50F" }
    , { "Ll", u8"\u22D8" }
    , { "Lleftarrow", u8"\u21DA" }
    , { "Lmidot", u8"\u013F" }
    , { "LongLeftArrow", u8"\u27F5" }
    , { "LongLeftRightArrow", u8"\u27F7" }
    , { "LongRightArrow", u8"\u27F6" }
    , { "Longleftarrow", u8"\u27F8" }
    , { "Longleftrightarrow", u8"\u27FA" }
    , { "Longrightarrow", u8"\u27F9" }
    , { "Lopf", u8"\U0001D543" }
    , { "LowerLeftArrow", u8"\u2199" }
    , { "LowerRightArrow", u8"\u2198" }
    , { "Lscr", u8"\u2112" }
    , { "Lsh", u8"\u21B0" }
    , { "Lstrok", u8"\u0141" }
    , { "Lt", u8"\u226A" }
    , { "Map", u8"\u2905" }
    , { "Mcy", u8"\u041C" }
    , { "MediumSpace", u8"\u205F" }
    , { "Mellintrf", u8"\u2133" }
    , { "Mfr", u8"\U0001D510" }
    , { "MinusPlus", u8"\u2213" }
    , { "Mopf", u8"\U0001D544" }
    , { "Mscr", u8"\u2133" }
    , { "Mu", u8"\u039C" }
    , { "NJcy", u8"\u040A" }
    , { "Nacute", u8"\u0143" }
    , { "Ncaron", u8"\u0147" }
    , { "Ncedil", u8"\u0145" }
    , { "Ncy", u8"\u041D" }
    , { "NegativeMediumSpace", u8"\u200B" }
    , { "NegativeThickSpace", u8"\u200B" }
    , { "NegativeThinSpace", u8"\u200B" }
    , { "NegativeVeryThinSpace", u8"\u200B" }
    , { "NestedGreaterGreater", u8"\u226B" }
    , { "NestedLessLess", u8"\u226A" }
    , { "NewLine", u8"\n" }
    , { "Nfr", u8"\U0001D511" }
    , { "NoBreak", u8"\u2060" }
    , { "NonBreakingSpace", u8"\u00A0" }
    , { "Nopf", u8"\u2115" }
    , { "Not", u8"\u2AEC" }
    , { "NotCongruent", u8"\u2262" }
    , { "NotCupCap", u8"\u226D" }
    , { "NotDoubleVerticalBar", u8"\u2226" }
    , { "NotElement", u8"\u2209" }
    , { "NotEqual", u8"\u2260" }
    , { "NotEqualTilde", u8"\u2242\u0338" }
    , { "NotExists", u8"\u2204" }
    , { "NotGreater", u8"\u226F" }
    , { "NotGreaterEqual", u8"\u2271" }
    , { "NotGreaterFullEqual", u8"\u2267\u0338" }
    , { "NotGreaterGreater", u8"\u226B\u0338" }
    , { "NotGreaterLess", u8"\u2279" }
    , { "NotGreaterSlantEqual", u8"\u2A7E\u0338" }
    , { "NotGreaterTilde", u8"\u2275" }
    , { "NotHumpDownHump", u8"\u224E\u0338" }
    , { "NotHumpEqual", u8"\u224F\u0338" }
    , { "NotLeftTriangle", u8"\u22EA" }
    , { "NotLeftTriangleBar", u8"\u29CF\u0338" }
    , { "NotLeftTriangleEqual", u8"\u22EC" }
    , { "NotLess", u8"\u226E" }
    , { "NotLessEqual", u8"\u2270" }
    , { "NotLessGreater", u8"\u2278" }
    , { "NotLessLess", u8"\u226A\u0338" }
    , { "NotLessSlantEqual", u8"\u2A7D\u0338" }
    , { "NotLessTilde", u8"\u2274" }
    , { "NotNestedGreaterGreater", u8"\u2AA2\u0338" }
    , { "NotNestedLessLess", u8"\u2AA1\u0338" }
    , { "NotPrecedes", u8"\u2280" }
    , { "NotPrecedesEqual", u8"\u2AAF\u0338" }
    , { "NotPrecedesSlantEqual", u8"\u22E0" }
    , { "NotReverseElement", u8"\u220C" }
    , { "NotRightTriangle", u8"\u22EB" }
    , { "NotRightTriangleBar", u8"\u29D0\u0338" }
    , { "NotRightTriangleEqual", u8"\u22ED" }
    , { "NotSquareSubset", u8"\u228F\u0338" }
    , { "NotSquareSubsetEqual", u8"\u22E2" }
    , { "NotSquareSuperset", u8"\u2290\u0338" }
    , { "NotSquareSupersetEqual", u8"\u22E3" }
    , { "NotSubset", u8"\u2282\u20D2" }
    , { "NotSubsetEqual", u8"\u2288" }
    , { "NotSucceeds", u8"\u2281" }
    , { "NotSucceedsEqual", u8"\u2AB0\u0338" }
    , { "NotSucceedsSlantEqual", u8"\u22E1" }
    , { "NotSucceedsTilde", u8"\u227F\u0338" }
    , { "NotSuperset", u8"\u2283\u20D2" }
    , { "NotSupersetEqual", u8"\u2289" }
    , { "NotTilde", u8"\u2241" }
    , { "NotTildeEqual", u8"\u2244" }
    , { "NotTildeFullEqual", u8"\u2247" }
    , { "NotTildeTilde", u8"\u2249" }
    , { "NotVerticalBar", u8"\u2224" }
    , { "Nscr", u8"\U0001D4A9" }
    , { "Ntilde", u8"\u00D1" }
    , { "Nu", u8"\u039D" }
    , { "OElig", u8"\u0152" }
    , { "Oacute", u8"\u00D3" }
    , { "Ocirc", u8"\u00D4" }
    , { "Ocy", u8"\u041E" }
    , { "Odblac", u8"\u0150" }
    , { "Ofr", u8"\U0001D512" }
    , { "Ograve", u8"\u00D2" }
    , { "Omacr", u8"\u014C" }
    , { "Omega", u8"\u03A9" }
    , { "Omicron", u8"\u039F" }
    , { "Oopf", u8"\U0001D546" }
    , { "OpenCurlyDoubleQuote", u8"\u201C" }
    , { "OpenCurlyQuote", u8"\u2018" }
    , { "Or", u8"\u2A54" }
    , { "Oscr", u8"\U0001D4AA" }
    , { "Oslash", u8"\u00D8" }
    , { "Otilde", u8"\u00D5" }
    , { "Otimes", u8"\u2A37" }
    , { "Ouml", u8"\u00D6" }
    , { "OverBar", u8"\u203E" }
    , { "OverBrace", u8"\u23DE" }
    , { "OverBracket", u8"\u23B4" }
    , { "OverParenthesis", u8"\u23DC" }
    , { "PartialD", u8"\u2202" }
    , { "Pcy", u8"\u041F" }
    , { "Pfr", u8"\U0001D513" }
    , { "Phi", u8"\u03A6" }
    , { "Pi", u8"\u03A0" }
    , { "PlusMinus", u8"\u00B1" }
    , { "Poincareplane", u8"\u210C" }
    , { "Popf", u8"\u2119" }
    , { "Pr", u8"\u2ABB" }
    , { "Precedes", u8"\u227A" }
    , { "PrecedesEqual", u8"\u2AAF" }
    , { "PrecedesSlantEqual", u8"\u227C" }
    , { "PrecedesTilde", u8"\u227E" }
    , { "Prime", u8"\u2033" }
    , { "Product", u8"\u220F" }
    , { "Proportion", u8"\u2237" }
    , { "Proportional", u8"\u221D" }
    , { "Pscr", u8"\U0001D4AB" }
    , { "Psi", u8"\u03A8" }
    , { "QUOT", u8"\"" }
    , { "Qfr", u8"\U0001D514" }
    , { "Qopf", u8"\u211A" }
    , { "Qscr", u8"\U0001D4AC" }
    , { "RBarr", u8"\u2910" }
    , { "REG", u8"\u00AE" }
    , { "Racute", u8"\u0154" }
    , { "Rang", u8"\u27EB" }
    , { "Rarr", u8"\u21A0" }
    , { "Rarrtl", u8"\u2916" }
    , { "Rcaron", u8"\u0158" }
    , { "Rcedil", u8"\u0156" }
    , { "Rcy", u8"\u0420" }
    , { "Re", u8"\u211C" }
    , { "ReverseElement", u8"\u220B" }
    , { "ReverseEquilibrium", u8"\u21CB" }
    , { "ReverseUpEquilibrium", u8"\u296F" }
    , { "Rfr", u8"\u211C" }
    , { "Rho", u8"\u03A1" }
    , { "RightAngleBracket", u8"\u27E9" }
    , { "RightArrow", u8"\u2192" }
    , { "RightArrowBar", u8"\u21E5" }
    , { "RightArrowLeftArrow", u8"\u21C4" }
    , { "RightCeiling", u8"\u2309" }
    , { "RightDoubleBracket", u8"\u27E7" }
    , { "RightDownTeeVector", u8"\u295D" }
    , { "RightDownVector", u8"\u21C2" }
    , { "RightDownVectorBar", u8"\u2955" }
    , { "RightFloor", u8"\u230B" }
    , { "RightTee", u8"\u22A2" }
    , { "RightTeeArrow", u8"\u21A6" }
    , { "RightTeeVector", u8"\u295B" }
    , { "RightTriangle", u8"\u22B3" }
    , { "RightTriangleBar", u8"\u29D0" }
    , { "RightTriangleEqual", u8"\u22B5" }
    , { "RightUpDownVector", u8"\u294F" }
    , { "RightUpTeeVector", u8"\u295C" }
    , { "RightUpVector", u8"\u21BE" }
    , { "RightUpVectorBar", u8"\u2954" }
    , { "RightVector", u8"\u21C0" }
    , { "RightVectorBar", u8"\u2953" }
    , { "Rightarrow", u8"\u21D2" }
    , { "Ropf", u8"\u211D" }
    , { "RoundImplies", u8"\u2970" }
    , { "Rrightarrow", u8"\u21DB" }
    , { "Rscr", u8"\u211B" }
    , { "Rsh", u8"\u21B1" }
    , { "RuleDelayed", u8"\u29F4" }
    , { "SHCHcy", u8"\u0429" }
    , { "SHcy", u8"\u0428" }
    , { "SOFTcy", u8"\u042C" }
    , { "Sacute", u8"\u015A" }
    , { "Sc", u8"\u2ABC" }
    , { "Scaron", u8"\u0160" }
    , { "Scedil", u8"\u015E" }
    , { "Scirc", u8"\u015C" }
    , { "Scy", u8"\u0421" }
    , { "Sfr", u8"\U0001D516" }
    , { "ShortDownArrow", u8"\u2193" }
    , { "ShortLeftArrow", u8"\u2190" }
    , { "ShortRightArrow", u8"\u2192" }
    , { "ShortUpArrow", u8"\u2191" }
    , { "Sigma", u8"\u03A3" }
    , { "SmallCircle", u8"\u2218" }
    , { "Sopf", u8"\U0001D54A" }
    , { "Sqrt", u8"\u221A" }
    , { "Square", u8"\u25A1" }
    , { "SquareIntersection", u8"\u2293" }
    , { "SquareSubset", u8"\u228F" }
    , { "SquareSubsetEqual", u8"\u2291" }
    , { "SquareSuperset", u8"\u2290" }
    , { "SquareSupersetEqual", u8"\u2292" }
    , { "SquareUnion", u8"\u2294" }
    , { "Sscr", u8"\U0001D4AE" }
    , { "Star", u8"\u22C6" }
    , { "Sub", u8"\u22D0" }
    , { "Subset", u8"\u22D0" }
    , { "SubsetEqual", u8"\u2286" }
    , { "Succeeds", u8"\u227B" }
    , { "SucceedsEqual", u8"\u2AB0" }
    , { "SucceedsSlantEqual", u8"\u227D" }
    , { "SucceedsTilde", u8"\u227F" }
    , { "SuchThat", u8"\u220B" }
    , { "Sum", u8"\u2211" }
    , { "Sup", u8"\u22D1" }
    , { "Superset", u8"\u2283" }
    , { "SupersetEqual", u8"\u2287" }
    , { "Supset", u8"\u22D1" }
    , { "THORN", u8"\u00DE" }
    , { "TRADE", u8"\u2122" }
    , { "TSHcy", u8"\u040B" }
    , { "TScy", u8"\u0426" }
    , { "Tab", u8"\t" }
    , { "Tau", u8"\u03A4" }
    , { "Tcaron", u8"\u0164" }
    , { "Tcedil", u8"\u0162" }
    , { "Tcy", u8"\u0422" }
    , { "Tfr", u8"\U0001D517" }
    , { "Therefore", u8"\u2234" }
    , { "Theta", u8"\u0398" }
    , { "ThickSpace", u8"\u205F\u200A" }
    , { "ThinSpace", u8"\u2009" }
    , { "Tilde", u8"\u223C" }
    , { "TildeEqual", u8"\u2243" }
    , { "TildeFullEqual", u8"\u2245" }
    , { "TildeTilde", u8"\u2248" }
    , { "Topf", u8"\U0001D54B" }
    , { "TripleDot", u8"\u20DB" }
    , { "Tscr", u8"\U0001D4AF" }
    , { "Tstrok", u8"\u0166" }
    , { "Uacute", u8"\u00DA" }
    , { "Uarr", u8"\u219F" }
    , { "Uarrocir", u8"\u2949" }
    , { "Ubrcy", u8"\u040E" }
    , { "Ubreve", u8"\u016C" }
    , { "Ucirc", u8"\u00DB" }
    , { "Ucy", u8"\u0423" }
    , { "Udblac", u8"\u0170" }
    , { "Ufr", u8"\U0001D518" }
    , { "Ugrave", u8"\u00D9" }
    , { "Umacr", u8"\u016A" }
    , { "UnderBar", u8"_" }
    , { "UnderBrace", u8"\u23DF" }
    , { "UnderBracket", u8"\u23B5" }
    , { "UnderParenthesis", u8"\u23DD" }
    , { "Union", u8"\u22C3" }
    , { "UnionPlus", u8"\u228E" }
    , { "Uogon", u8"\u0172" }
    , { "Uopf", u8"\U0001D54C" }
    , { "UpArrow", u8"\u2191" }
    , { "UpArrowBar", u8"\u2912" }
    , { "UpArrowDownArrow", u8"\u21C5" }
    , { "UpDownArrow", u8"\u2195" }
    , { "UpEquilibrium", u8"\u296E" }
    , { "UpTee", u8"\u22A5" }
    , { "UpTeeArrow", u8"\u21A5" }
    , { "Uparrow", u8"\u21D1" }
    , { "Updownarrow", u8"\u21D5" }
    , { "UpperLeftArrow", u8"\u2196" }
    , { "UpperRightArrow", u8"\u2197" }
    , { "Upsi", u8"\u03D2" }
    , { "Upsilon", u8"\u03A5" }
    , { "Uring", u8"\u016E" }
    , { "Uscr", u8"\U0001D4B0" }
    , { "Utilde", u8"\u0168" }
    , { "Uuml", u8"\u00DC" }
    , { "VDash", u8"\u22AB" }
    , { "Vbar", u8"\u2AEB" }
    , { "Vcy", u8"\u0412" }
    , { "Vdash", u8"\u22A9" }
    , { "Vdashl", u8"\u2AE6" }
    , { "Vee", u8"\u22C1" }
    , { "Verbar", u8"\u2016" }
    , { "Vert", u8"\u2016" }
    , { "VerticalBar", u8"\u2223" }
    , { "VerticalLine", u8"|" }
    , { "VerticalSeparator", u8"\u2758" }
    , { "VerticalTilde", u8"\u2240" }
    , { "VeryThinSpace", u8"\u200A" }
    , { "Vfr", u8"\U0001D519" }
    , { "Vopf", u8"\U0001D54D" }
    , { "Vscr", u8"\U0001D4B1" }
    , { "Vvdash", u8"\u22AA" }
    , { "Wcirc", u8"\u0174" }
    , { "Wedge", u8"\u22C0" }
    , { "Wfr", u8"\U0001D51A" }
    , { "Wopf", u8"\U0001D54E" }
    , { "Wscr", u8"\U0001D4B2" }
    , { "Xfr", u8"\U0001D51B" }
    , { "Xi", u8"\u039E" }
    , { "Xopf", u8"\U0001D54F" }
    , { "Xscr", u8"\U0001D4B3" }
    , { "YAcy", u8"\u042F" }
    , { "YIcy", u8"\u0407" }
    , { "YUcy", u8"\u042E" }
    , { "Yacute", u8"\u00DD" }
    , { "Ycirc", u8"\u0176" }
    , { "Ycy", u8"\u042B" }
    , { "Yfr", u8"\U0001D51C" }
    , { "Yopf", u8"\U0001D550" }
    , { "Yscr", u8"\U0001D4B4" }
    , { "Yuml", u8"\u0178" }
    , { "ZHcy", u8"\u0416" }
    , { "Zacute", u8"\u0179" }
    , { "Zcaron", u8"\u017D" }
    , { "Zcy", u8"\u0417" }
    , { "Zdot", u8"\u017B" }
    , { "ZeroWidthSpace", u8"\u200B" }
    , { "Zeta", u8"\u0396" }
    , { "Zfr", u8"\u2128" }
    , { "Zopf", u8"\u2124" }
    , { "Zscr", u8"\U0001D4B5" }
    , { "aacute", u8"\u00E1" }
    , { "abreve", u8"\u0103" }
    , { "ac", u8"\u223E" }
    , { "acE", u8"\u223E\u0333" }
    , { "acd", u8"\u223F" }
    , { "acirc", u8"\u00E2" }
    , { "acute", u8"\u00B4" }
    , { "acy", u8"\u0430" }
    , { "aelig", u8"\u00E6" }
    , { "af", u8"\u2061" }
    , { "afr", u8"\U0001D51E" }
    , { "agrave", u8"\u00E0" }
    , { "alefsym", u8"\u2135" }
    , { "aleph", u8"\u2135" }
    , { "alpha", u8"\u03B1" }
    , { "amacr", u8"\u0101" }
    , { "amalg", u8"\u2A3F" }
    , { "amp", u8"&" }
    , { "and", u8"\u2227" }
    , { "andand", u8"\u2A55" }
    , { "andd", u8"\u2A5C" }
    , { "andslope", u8"\u2A58" }
    , { "andv", u8"\u2A5A" }
    , { "ang", u8"\u2220" }
    , { "ange", u8"\u29A4" }
    , { "angle", u8"\u2220" }
    , { "angmsd", u8"\u2221" }
    , { "angmsdaa", u8"\u29A8" }
    , { "angmsdab", u8"\u29A9" }
    , { "angmsdac", u8"\u29AA" }
    , { "angmsdad", u8"\u29AB" }
    , { "angmsdae", u8"\u29AC" }
    , { "angmsdaf", u8"\u29AD" }
    , { "angmsdag", u8"\u29AE" }
    , { "angmsdah", u8"\u29AF" }
    , { "angrt", u8"\u221F" }
    , { "angrtvb", u8"\u22BE" }
    , { "angrtvbd", u8"\u299D" }
    , { "angsph", u8"\u2222" }
    , { "angst", u8"\u00C5" }
    , { "angzarr", u8"\u237C" }
    , { "aogon", u8"\u0105" }
    , { "aopf", u8"\U0001D552" }
    , { "ap", u8"\u2248" }
    , { "apE", u8"\u2A70" }
    , { "apacir", u8"\u2A6F" }
    , { "ape", u8"\u224A" }
    , { "apid", u8"\u224B" }
    , { "apos", u8"\'" }
    , { "approx", u8"\u2248" }
    , { "approxeq", u8"\u224A" }
    , { "aring", u8"\u00E5" }
    , { "ascr", u8"\U0001D4B6" }
    , { "ast", u8"*" }
    , { "asymp", u8"\u2248" }
    , { "asympeq", u8"\u224D" }
    , { "atilde", u8"\u00E3" }
    , { "auml", u8"\u00E4" }
    , { "awconint", u8"\u2233" }
    , { "awint", u8"\u2A11" }
    , { "bNot", u8"\u2AED" }
    , { "backcong", u8"\u224C" }
    , { "backepsilon", u8"\u03F6" }
    , { "backprime", u8"\u2035" }
    , { "backsim", u8"\u223D" }
    , { "backsimeq", u8"\u22CD" }
    , { "barvee", u8"\u22BD" }
    , { "barwed", u8"\u2305" }
    , { "barwedge", u8"\u2305" }
    , { "bbrk", u8"\u23B5" }
    , { "bbrktbrk", u8"\u23B6" }
    , { "bcong", u8"\u224C" }
    , { "bcy", u8"\u0431" }
    , { "bdquo", u8"\u201E" }
    , { "becaus", u8"\u2235" }
    , { "because", u8"\u2235" }
    , { "bemptyv", u8"\u29B0" }
    , { "bepsi", u8"\u03F6" }
    , { "bernou", u8"\u212C" }
    , { "beta", u8"\u03B2" }
    , { "beth", u8"\u2136" }
    , { "between", u8"\u226C" }
    , { "bfr", u8"\U0001D51F" }
    , { "bigcap", u8"\u22C2" }
    , { "bigcirc", u8"\u25EF" }
    , { "bigcup", u8"\u22C3" }
    , { "bigodot", u8"\u2A00" }
    , { "bigoplus", u8"\u2A01" }
    , { "bigotimes", u8"\u2A02" }
    , { "bigsqcup", u8"\u2A06" }
    , { "bigstar", u8"\u2605" }
    , { "bigtriangledown", u8"\u25BD" }
    , { "bigtriangleup", u8"\u25B3" }
    , { "biguplus", u8"\u2A04" }
    , { "bigvee", u8"\u22C1" }
    , { "bigwedge", u8"\u22C0" }
    , { "bkarow", u8"\u290D" }
    , { "blacklozenge", u8"\u29EB" }
    , { "blacksquare", u8"\u25AA" }
    , { "blacktriangle", u8"\u25B4" }
    , { "blacktriangledown", u8"\u25BE" }
    , { "blacktriangleleft", u8"\u25C2" }
    , { "blacktriangleright", u8"\u25B8" }
    , { "blank", u8"\u2423" }
    , { "blk12", u8"\u2592" }
    , { "blk14", u8"\u2591" }
    , { "blk34", u8"\u2593" }
    , { "block", u8"\u2588" }
    , { "bne", u8"=\u20E5" }
    , { "bnequiv", u8"\u2261\u20E5" }
    , { "bnot", u8"\u2310" }
    , { "bopf", u8"\U0001D553" }
    , { "bot", u8"\u22A5" }
    , { "bottom", u8"\u22A5" }
    , { "bowtie", u8"\u22C8" }
    , { "boxDL", u8"\u2557" }
    , { "boxDR", u8"\u2554" }
    , { "boxDl", u8"\u2556" }
    , { "boxDr", u8"\u2553" }
    , { "boxH", u8"\u2550" }
    , { "boxHD", u8"\u2566" }
    , { "boxHU", u8"\u2569" }
    , { "boxHd", u8"\u2564" }
    , { "boxHu", u8"\u2567" }
    , { "boxUL", u8"\u255D" }
    , { "boxUR", u8"\u255A" }
    , { "boxUl", u8"\u255C" }
    , { "boxUr", u8"\u2559" }
    , { "boxV", u8"\u2551" }
    , { "boxVH", u8"\u256C" }
    , { "boxVL", u8"\u2563" }
    , { "boxVR", u8"\u2560" }
    , { "boxVh", u8"\u256B" }
    , { "boxVl", u8"\u2562" }
    , { "boxVr", u8"\u255F" }
    , { "boxbox", u8"\u29C9" }
    , { "boxdL", u8"\u2555" }
    , { "boxdR", u8"\u2552" }
    , { "boxdl", u8"\u2510" }
    , { "boxdr", u8"\u250C" }
    , { "boxh", u8"\u2500" }
    , { "boxhD", u8"\u2565" }
    , { "boxhU", u8"\u2568" }
    , { "boxhd", u8"\u252C" }
    , { "boxhu", u8"\u2534" }
    , { "boxminus", u8"\u229F" }
    , { "boxplus", u8"\u229E" }
    , { "boxtimes", u8"\u22A0" }
    , { "boxuL", u8"\u255B" }
    , { "boxuR", u8"\u2558" }
    , { "boxul", u8"\u2518" }
    , { "boxur", u8"\u2514" }
    , { "boxv", u8"\u2502" }
    , { "boxvH", u8"\u256A" }
    , { "boxvL", u8"\u2561" }
    , { "boxvR", u8"\u255E" }
    , { "boxvh", u8"\u253C" }
    , { "boxvl", u8"\u2524" }
    , { "boxvr", u8"\u251C" }
    , { "bprime", u8"\u2035" }
    , { "breve", u8"\u02D8" }
    , { "brvbar", u8"\u00A6" }
    , { "bscr", u8"\U0001D4B7" }
    , { "bsemi", u8"\u204F" }
    , { "bsim", u8"\u223D" }
    , { "bsime", u8"\u22CD" }
    , { "bsol", u8"\\" }
    , { "bsolb", u8"\u29C5" }
    , { "bsolhsub", u8"\u27C8" }
    , { "bull", u8"\u2022" }
    , { "bullet", u8"\u2022" }
    , { "bump", u8"\u224E" }
    , { "bumpE", u8"\u2AAE" }
    , { "bumpe", u8"\u224F" }
    , { "bumpeq", u8"\u224F" }
    , { "cacute", u8"\u0107" }
    , { "cap", u8"\u2229" }
    , { "capand", u8"\u2A44" }
    , { "capbrcup", u8"\u2A49" }
    , { "capcap", u8"\u2A4B" }
    , { "capcup", u8"\u2A47" }
    , { "capdot", u8"\u2A40" }
    , { "caps", u8"\u2229\uFE00" }
    , { "caret", u8"\u2041" }
    , { "caron", u8"\u02C7" }
    , { "ccaps", u8"\u2A4D" }
    , { "ccaron", u8"\u010D" }
    , { "ccedil", u8"\u00E7" }
    , { "ccirc", u8"\u0109" }
    , { "ccups", u8"\u2A4C" }
    , { "ccupssm", u8"\u2A50" }
    , { "cdot", u8"\u010B" }
    , { "cedil", u8"\u00B8" }
    , { "cemptyv", u8"\u29B2" }
    , { "cent", u8"\u00A2" }
    , { "centerdot", u8"\u00B7" }
    , { "cfr", u8"\U0001D520" }
    , { "chcy", u8"\u0447" }
    , { "check", u8"\u2713" }
    , { "checkmark", u8"\u2713" }
    , { "chi", u8"\u03C7" }
    , { "cir", u8"\u25CB" }
    , { "cirE", u8"\u29C3" }
    , { "circ", u8"\u02C6" }
    , { "circeq", u8"\u2257" }
    , { "circlearrowleft", u8"\u21BA" }
    , { "circlearrowright", u8"\u21BB" }
    , { "circledR", u8"\u00AE" }
    , { "circledS", u8"\u24C8" }
    , { "circledast", u8"\u229B" }
    , { "circledcirc", u8"\u229A" }
    , { "circleddash", u8"\u229D" }
    , { "cire", u8"\u2257" }
    , { "cirfnint", u8"\u2A10" }
    , { "cirmid", u8"\u2AEF" }
    , { "cirscir", u8"\u29C2" }
    , { "clubs", u8"\u2663" }
    , { "clubsuit", u8"\u2663" }
    , { "colon", u8":" }
    , { "colone", u8"\u2254" }
    , { "coloneq", u8"\u2254" }
    , { "comma", u8"," }
    , { "commat", u8"@" }
    , { "comp", u8"\u2201" }
    , { "compfn", u8"\u2218" }
    , { "complement", u8"\u2201" }
    , { "complexes", u8"\u2102" }
    , { "cong", u8"\u2245" }
    , { "congdot", u8"\u2A6D" }
    , { "conint", u8"\u222E" }
    , { "copf", u8"\U0001D554" }
    , { "coprod", u8"\u2210" }
    , { "copy", u8"\u00A9" }
    , { "copysr", u8"\u2117" }
    , { "crarr", u8"\u21B5" }
    , { "cross", u8"\u2717" }
    , { "cscr", u8"\U0001D4B8" }
    , { "csub", u8"\u2ACF" }
    , { "csube", u8"\u2AD1" }
    , { "csup", u8"\u2AD0" }
    , { "csupe", u8"\u2AD2" }
    , { "ctdot", u8"\u22EF" }
    , { "cudarrl", u8"\u2938" }
    , { "cudarrr", u8"\u2935" }
    , { "cuepr", u8"\u22DE" }
    , { "cuesc", u8"\u22DF" }
    , { "cularr", u8"\u21B6" }
    , { "cularrp", u8"\u293D" }
    , { "cup", u8"\u222A" }
    , { "cupbrcap", u8"\u2A48" }
    , { "cupcap", u8"\u2A46" }
    , { "cupcup", u8"\u2A4A" }
    , { "cupdot", u8"\u228D" }
    , { "cupor", u8"\u2A45" }
    , { "cups", u8"\u222A\uFE00" }
    , { "curarr", u8"\u21B7" }
    , { "curarrm", u8"\u293C" }
    , { "curlyeqprec", u8"\u22DE" }
    , { "curlyeqsucc", u8"\u22DF" }
    , { "curlyvee", u8"\u22CE" }
    , { "curlywedge", u8"\u22CF" }
    , { "curren", u8"\u00A4" }
    , { "curvearrowleft", u8"\u21B6" }
    , { "curvearrowright", u8"\u21B7" }
    , { "cuvee", u8"\u22CE" }
    , { "cuwed", u8"\u22CF" }
    , { "cwconint", u8"\u2232" }
    , { "cwint", u8"\u2231" }
    , { "cylcty", u8"\u232D" }
    , { "dArr", u8"\u21D3" }
    , { "dHar", u8"\u2965" }
    , { "dagger", u8"\u2020" }
    , { "daleth", u8"\u2138" }
    , { "darr", u8"\u2193" }
    , { "dash", u8"\u2010" }
    , { "dashv", u8"\u22A3" }
    , { "dbkarow", u8"\u290F" }
    , { "dblac", u8"\u02DD" }
    , { "dcaron", u8"\u010F" }
    , { "dcy", u8"\u0434" }
    , { "dd", u8"\u2146" }
    , { "ddagger", u8"\u2021" }
    , { "ddarr", u8"\u21CA" }
    , { "ddotseq", u8"\u2A77" }
    , { "deg", u8"\u00B0" }
    , { "delta", u8"\u03B4" }
    , { "demptyv", u8"\u29B1" }
    , { "dfisht", u8"\u297F" }
    , { "dfr", u8"\U0001D521" }
    , { "dharl", u8"\u21C3" }
    , { "dharr", u8"\u21C2" }
    , { "diam", u8"\u22C4" }
    , { "diamond", u8"\u22C4" }
    , { "diamondsuit", u8"\u2666" }
    , { "diams", u8"\u2666" }
    , { "die", u8"\u00A8" }
    , { "digamma", u8"\u03DD" }
    , { "disin", u8"\u22F2" }
    , { "div", u8"\u00F7" }
    , { "divide", u8"\u00F7" }
    , { "divideontimes", u8"\u22C7" }
    , { "divonx", u8"\u22C7" }
    , { "djcy", u8"\u0452" }
    , { "dlcorn", u8"\u231E" }
    , { "dlcrop", u8"\u230D" }
    , { "dollar", u8"$" }
    , { "dopf", u8"\U0001D555" }
    , { "dot", u8"\u02D9" }
    , { "doteq", u8"\u2250" }
    , { "doteqdot", u8"\u2251" }
    , { "dotminus", u8"\u2238" }
    , { "dotplus", u8"\u2214" }
    , { "dotsquare", u8"\u22A1" }
    , { "doublebarwedge", u8"\u2306" }
    , { "downarrow", u8"\u2193" }
    , { "downdownarrows", u8"\u21CA" }
    , { "downharpoonleft", u8"\u21C3" }
    , { "downharpoonright", u8"\u21C2" }
    , { "drbkarow", u8"\u2910" }
    , { "drcorn", u8"\u231F" }
    , { "drcrop", u8"\u230C" }
    , { "dscr", u8"\U0001D4B9" }
    , { "dscy", u8"\u0455" }
    , { "dsol", u8"\u29F6" }
    , { "dstrok", u8"\u0111" }
    , { "dtdot", u8"\u22F1" }
    , { "dtri", u8"\u25BF" }
    , { "dtrif", u8"\u25BE" }
    , { "duarr", u8"\u21F5" }
    , { "duhar", u8"\u296F" }
    , { "dwangle", u8"\u29A6" }
    , { "dzcy", u8"\u045F" }
    , { "dzigrarr", u8"\u27FF" }
    , { "eDDot", u8"\u2A77" }
    , { "eDot", u8"\u2251" }
    , { "eacute", u8"\u00E9" }
    , { "easter", u8"\u2A6E" }
    , { "ecaron", u8"\u011B" }
    , { "ecir", u8"\u2256" }
    , { "ecirc", u8"\u00EA" }
    , { "ecolon", u8"\u2255" }
    , { "ecy", u8"\u044D" }
    , { "edot", u8"\u0117" }
    , { "ee", u8"\u2147" }
    , { "efDot", u8"\u2252" }
    , { "efr", u8"\U0001D522" }
    , { "eg", u8"\u2A9A" }
    , { "egrave", u8"\u00E8" }
    , { "egs", u8"\u2A96" }
    , { "egsdot", u8"\u2A98" }
    , { "el", u8"\u2A99" }
    , { "elinters", u8"\u23E7" }
    , { "ell", u8"\u2113" }
    , { "els", u8"\u2A95" }
    , { "elsdot", u8"\u2A97" }
    , { "emacr", u8"\u0113" }
    , { "empty", u8"\u2205" }
    , { "emptyset", u8"\u2205" }
    , { "emptyv", u8"\u2205" }
    , { "emsp13", u8"\u2004" }
    , { "emsp14", u8"\u2005" }
    , { "emsp", u8"\u2003" }
    , { "eng", u8"\u014B" }
    , { "ensp", u8"\u2002" }
    , { "eogon", u8"\u0119" }
    , { "eopf", u8"\U0001D556" }
    , { "epar", u8"\u22D5" }
    , { "eparsl", u8"\u29E3" }
    , { "eplus", u8"\u2A71" }
    , { "epsi", u8"\u03B5" }
    , { "epsilon", u8"\u03B5" }
    , { "epsiv", u8"\u03F5" }
    , { "eqcirc", u8"\u2256" }
    , { "eqcolon", u8"\u2255" }
    , { "eqsim", u8"\u2242" }
    , { "eqslantgtr", u8"\u2A96" }
    , { "eqslantless", u8"\u2A95" }
    , { "equals", u8"=" }
    , { "equest", u8"\u225F" }
    , { "equiv", u8"\u2261" }
    , { "equivDD", u8"\u2A78" }
    , { "eqvparsl", u8"\u29E5" }
    , { "erDot", u8"\u2253" }
    , { "erarr", u8"\u2971" }
    , { "escr", u8"\u212F" }
    , { "esdot", u8"\u2250" }
    , { "esim", u8"\u2242" }
    , { "eta", u8"\u03B7" }
    , { "eth", u8"\u00F0" }
    , { "euml", u8"\u00EB" }
    , { "euro", u8"\u20AC" }
    , { "excl", u8"!" }
    , { "exist", u8"\u2203" }
    , { "expectation", u8"\u2130" }
    , { "exponentiale", u8"\u2147" }
    , { "fallingdotseq", u8"\u2252" }
    , { "fcy", u8"\u0444" }
    , { "female", u8"\u2640" }
    , { "ffilig", u8"\uFB03" }
    , { "fflig", u8"\uFB00" }
    , { "ffllig", u8"\uFB04" }
    , { "ffr", u8"\U0001D523" }
    , { "filig", u8"\uFB01" }
    , { "fjlig", u8"fj" }
    , { "flat", u8"\u266D" }
    , { "fllig", u8"\uFB02" }
    , { "fltns", u8"\u25B1" }
    , { "fnof", u8"\u0192" }
    , { "fopf", u8"\U0001D557" }
    , { "forall", u8"\u2200" }
    , { "fork", u8"\u22D4" }
    , { "forkv", u8"\u2AD9" }
    , { "fpartint", u8"\u2A0D" }
    , { "frac12", u8"\u00BD" }
    , { "frac13", u8"\u2153" }
    , { "frac14", u8"\u00BC" }
    , { "frac15", u8"\u2155" }
    , { "frac16", u8"\u2159" }
    , { "frac18", u8"\u215B" }
    , { "frac23", u8"\u2154" }
    , { "frac25", u8"\u2156" }
    , { "frac34", u8"\u00BE" }
    , { "frac35", u8"\u2157" }
    , { "frac38", u8"\u215C" }
    , { "frac45", u8"\u2158" }
    , { "frac56", u8"\u215A" }
    , { "frac58", u8"\u215D" }
    , { "frac78", u8"\u215E" }
    , { "frasl", u8"\u2044" }
    , { "frown", u8"\u2322" }
    , { "fscr", u8"\U0001D4BB" }
    , { "gE", u8"\u2267" }
    , { "gEl", u8"\u2A8C" }
    , { "gacute", u8"\u01F5" }
    , { "gamma", u8"\u03B3" }
    , { "gammad", u8"\u03DD" }
    , { "gap", u8"\u2A86" }
    , { "gbreve", u8"\u011F" }
    , { "gcirc", u8"\u011D" }
    , { "gcy", u8"\u0433" }
    , { "gdot", u8"\u0121" }
    , { "ge", u8"\u2265" }
    , { "gel", u8"\u22DB" }
    , { "geq", u8"\u2265" }
    , { "geqq", u8"\u2267" }
    , { "geqslant", u8"\u2A7E" }
    , { "ges", u8"\u2A7E" }
    , { "gescc", u8"\u2AA9" }
    , { "gesdot", u8"\u2A80" }
    , { "gesdoto", u8"\u2A82" }
    , { "gesdotol", u8"\u2A84" }
    , { "gesl", u8"\u22DB\uFE00" }
    , { "gesles", u8"\u2A94" }
    , { "gfr", u8"\U0001D524" }
    , { "gg", u8"\u226B" }
    , { "ggg", u8"\u22D9" }
    , { "gimel", u8"\u2137" }
    , { "gjcy", u8"\u0453" }
    , { "gl", u8"\u2277" }
    , { "glE", u8"\u2A92" }
    , { "gla", u8"\u2AA5" }
    , { "glj", u8"\u2AA4" }
    , { "gnE", u8"\u2269" }
    , { "gnap", u8"\u2A8A" }
    , { "gnapprox", u8"\u2A8A" }
    , { "gne", u8"\u2A88" }
    , { "gneq", u8"\u2A88" }
    , { "gneqq", u8"\u2269" }
    , { "gnsim", u8"\u22E7" }
    , { "gopf", u8"\U0001D558" }
    , { "grave", u8"`" }
    , { "gscr", u8"\u210A" }
    , { "gsim", u8"\u2273" }
    , { "gsime", u8"\u2A8E" }
    , { "gsiml", u8"\u2A90" }
    , { "gt", u8">" }
    , { "gtcc", u8"\u2AA7" }
    , { "gtcir", u8"\u2A7A" }
    , { "gtdot", u8"\u22D7" }
    , { "gtlPar", u8"\u2995" }
    , { "gtquest", u8"\u2A7C" }
    , { "gtrapprox", u8"\u2A86" }
    , { "gtrarr", u8"\u2978" }
    , { "gtrdot", u8"\u22D7" }
    , { "gtreqless", u8"\u22DB" }
    , { "gtreqqless", u8"\u2A8C" }
    , { "gtrless", u8"\u2277" }
    , { "gtrsim", u8"\u2273" }
    , { "gvertneqq", u8"\u2269\uFE00" }
    , { "gvnE", u8"\u2269\uFE00" }
    , { "hArr", u8"\u21D4" }
    , { "hairsp", u8"\u200A" }
    , { "half", u8"\u00BD" }
    , { "hamilt", u8"\u210B" }
    , { "hardcy", u8"\u044A" }
    , { "harr", u8"\u2194" }
    , { "harrcir", u8"\u2948" }
    , { "harrw", u8"\u21AD" }
    , { "hbar", u8"\u210F" }
    , { "hcirc", u8"\u0125" }
    , { "hearts", u8"\u2665" }
    , { "heartsuit", u8"\u2665" }
    , { "hellip", u8"\u2026" }
    , { "hercon", u8"\u22B9" }
    , { "hfr", u8"\U0001D525" }
    , { "hksearow", u8"\u2925" }
    , { "hkswarow", u8"\u2926" }
    , { "hoarr", u8"\u21FF" }
    , { "homtht", u8"\u223B" }
    , { "hookleftarrow", u8"\u21A9" }
    , { "hookrightarrow", u8"\u21AA" }
    , { "hopf", u8"\U0001D559" }
    , { "horbar", u8"\u2015" }
    , { "hscr", u8"\U0001D4BD" }
    , { "hslash", u8"\u210F" }
    , { "hstrok", u8"\u0127" }
    , { "hybull", u8"\u2043" }
    , { "hyphen", u8"\u2010" }
    , { "iacute", u8"\u00ED" }
    , { "ic", u8"\u2063" }
    , { "icirc", u8"\u00EE" }
    , { "icy", u8"\u0438" }
    , { "iecy", u8"\u0435" }
    , { "iexcl", u8"\u00A1" }
    , { "iff", u8"\u21D4" }
    , { "ifr", u8"\U0001D526" }
    , { "igrave", u8"\u00EC" }
    , { "ii", u8"\u2148" }
    , { "iiiint", u8"\u2A0C" }
    , { "iiint", u8"\u222D" }
    , { "iinfin", u8"\u29DC" }
    , { "iiota", u8"\u2129" }
    , { "ijlig", u8"\u0133" }
    , { "imacr", u8"\u012B" }
    , { "image", u8"\u2111" }
    , { "imagline", u8"\u2110" }
    , { "imagpart", u8"\u2111" }
    , { "imath", u8"\u0131" }
    , { "imof", u8"\u22B7" }
    , { "imped", u8"\u01B5" }
    , { "in", u8"\u2208" }
    , { "incare", u8"\u2105" }
    , { "infin", u8"\u221E" }
    , { "infintie", u8"\u29DD" }
    , { "inodot", u8"\u0131" }
    , { "int", u8"\u222B" }
    , { "intcal", u8"\u22BA" }
    , { "integers", u8"\u2124" }
    , { "intercal", u8"\u22BA" }
    , { "intlarhk", u8"\u2A17" }
    , { "intprod", u8"\u2A3C" }
    , { "iocy", u8"\u0451" }
    , { "iogon", u8"\u012F" }
    , { "iopf", u8"\U0001D55A" }
    , { "iota", u8"\u03B9" }
    , { "iprod", u8"\u2A3C" }
    , { "iquest", u8"\u00BF" }
    , { "iscr", u8"\U0001D4BE" }
    , { "isin", u8"\u2208" }
    , { "isinE", u8"\u22F9" }
    , { "isindot", u8"\u22F5" }
    , { "isins", u8"\u22F4" }
    , { "isinsv", u8"\u22F3" }
    , { "isinv", u8"\u2208" }
    , { "it", u8"\u2062" }
    , { "itilde", u8"\u0129" }
    , { "iukcy", u8"\u0456" }
    , { "iuml", u8"\u00EF" }
    , { "jcirc", u8"\u0135" }
    , { "jcy", u8"\u0439" }
    , { "jfr", u8"\U0001D527" }
    , { "jmath", u8"\u0237" }
    , { "jopf", u8"\U0001D55B" }
    , { "jscr", u8"\U0001D4BF" }
    , { "jsercy", u8"\u0458" }
    , { "jukcy", u8"\u0454" }
    , { "kappa", u8"\u03BA" }
    , { "kappav", u8"\u03F0" }
    , { "kcedil", u8"\u0137" }
    , { "kcy", u8"\u043A" }
    , { "kfr", u8"\U0001D528" }
    , { "kgreen", u8"\u0138" }
    , { "khcy", u8"\u0445" }
    , { "kjcy", u8"\u045C" }
    , { "kopf", u8"\U0001D55C" }
    , { "kscr", u8"\U0001D4C0" }
    , { "lAarr", u8"\u21DA" }
    , { "lArr", u8"\u21D0" }
    , { "lAtail", u8"\u291B" }
    , { "lBarr", u8"\u290E" }
    , { "lE", u8"\u2266" }
    , { "lEg", u8"\u2A8B" }
    , { "lHar", u8"\u2962" }
    , { "lacute", u8"\u013A" }
    , { "laemptyv", u8"\u29B4" }
    , { "lagran", u8"\u2112" }
    , { "lambda", u8"\u03BB" }
    , { "lang", u8"\u27E8" }
    , { "langd", u8"\u2991" }
    , { "langle", u8"\u27E8" }
    , { "lap", u8"\u2A85" }
    , { "laquo", u8"\u00AB" }
    , { "larr", u8"\u2190" }
    , { "larrb", u8"\u21E4" }
    , { "larrbfs", u8"\u291F" }
    , { "larrfs", u8"\u291D" }
    , { "larrhk", u8"\u21A9" }
    , { "larrlp", u8"\u21AB" }
    , { "larrpl", u8"\u2939" }
    , { "larrsim", u8"\u2973" }
    , { "larrtl", u8"\u21A2" }
    , { "lat", u8"\u2AAB" }
    , { "latail", u8"\u2919" }
    , { "late", u8"\u2AAD" }
    , { "lates", u8"\u2AAD\uFE00" }
    , { "lbarr", u8"\u290C" }
    , { "lbbrk", u8"\u2772" }
    , { "lbrace", u8"{" }
    , { "lbrack", u8"[" }
    , { "lbrke", u8"\u298B" }
    , { "lbrksld", u8"\u298F" }
    , { "lbrkslu", u8"\u298D" }
    , { "lcaron", u8"\u013E" }
    , { "lcedil", u8"\u013C" }
    , { "lceil", u8"\u2308" }
    , { "lcub", u8"{" }
    , { "lcy", u8"\u043B" }
    , { "ldca", u8"\u2936" }
    , { "ldquo", u8"\u201C" }
    , { "ldquor", u8"\u201E" }
    , { "ldrdhar", u8"\u2967" }
    , { "ldrushar", u8"\u294B" }
    , { "ldsh", u8"\u21B2" }
    , { "le", u8"\u2264" }
    , { "leftarrow", u8"\u2190" }
    , { "leftarrowtail", u8"\u21A2" }
    , { "leftharpoondown", u8"\u21BD" }
    , { "leftharpoonup", u8"\u21BC" }
    , { "leftleftarrows", u8"\u21C7" }
    , { "leftrightarrow", u8"\u2194" }
    , { "leftrightarrows", u8"\u21C6" }
    , { "leftrightharpoons", u8"\u21CB" }
    , { "leftrightsquigarrow", u8"\u21AD" }
    , { "leftthreetimes", u8"\u22CB" }
    , { "leg", u8"\u22DA" }
    , { "leq", u8"\u2264" }
    , { "leqq", u8"\u2266" }
    , { "leqslant", u8"\u2A7D" }
    , { "les", u8"\u2A7D" }
    , { "lescc", u8"\u2AA8" }
    , { "lesdot", u8"\u2A7F" }
    , { "lesdoto", u8"\u2A81" }
    , { "lesdotor", u8"\u2A83" }
    , { "lesg", u8"\u22DA\uFE00" }
    , { "lesges", u8"\u2A93" }
    , { "lessapprox", u8"\u2A85" }
    , { "lessdot", u8"\u22D6" }
    , { "lesseqgtr", u8"\u22DA" }
    , { "lesseqqgtr", u8"\u2A8B" }
    , { "lessgtr", u8"\u2276" }
    , { "lesssim", u8"\u2272" }
    , { "lfisht", u8"\u297C" }
    , { "lfloor", u8"\u230A" }
    , { "lfr", u8"\U0001D529" }
    , { "lg", u8"\u2276" }
    , { "lgE", u8"\u2A91" }
    , { "lhard", u8"\u21BD" }
    , { "lharu", u8"\u21BC" }
    , { "lharul", u8"\u296A" }
    , { "lhblk", u8"\u2584" }
    , { "ljcy", u8"\u0459" }
    , { "ll", u8"\u226A" }
    , { "llarr", u8"\u21C7" }
    , { "llcorner", u8"\u231E" }
    , { "llhard", u8"\u296B" }
    , { "lltri", u8"\u25FA" }
    , { "lmidot", u8"\u0140" }
    , { "lmoust", u8"\u23B0" }
    , { "lmoustache", u8"\u23B0" }
    , { "lnE", u8"\u2268" }
    , { "lnap", u8"\u2A89" }
    , { "lnapprox", u8"\u2A89" }
    , { "lne", u8"\u2A87" }
    , { "lneq", u8"\u2A87" }
    , { "lneqq", u8"\u2268" }
    , { "lnsim", u8"\u22E6" }
    , { "loang", u8"\u27EC" }
    , { "loarr", u8"\u21FD" }
    , { "lobrk", u8"\u27E6" }
    , { "longleftarrow", u8"\u27F5" }
    , { "longleftrightarrow", u8"\u27F7" }
    , { "longmapsto", u8"\u27FC" }
    , { "longrightarrow", u8"\u27F6" }
    , { "looparrowleft", u8"\u21AB" }
    , { "looparrowright", u8"\u21AC" }
    , { "lopar", u8"\u2985" }
    , { "lopf", u8"\U0001D55D" }
    , { "loplus", u8"\u2A2D" }
    , { "lotimes", u8"\u2A34" }
    , { "lowast", u8"\u2217" }
    , { "lowbar", u8"_" }
    , { "loz", u8"\u25CA" }
    , { "lozenge", u8"\u25CA" }
    , { "lozf", u8"\u29EB" }
    , { "lpar", u8"(" }
    , { "lparlt", u8"\u2993" }
    , { "lrarr", u8"\u21C6" }
    , { "lrcorner", u8"\u231F" }
    , { "lrhar", u8"\u21CB" }
    , { "lrhard", u8"\u296D" }
    , { "lrm", u8"\u200E" }
    , { "lrtri", u8"\u22BF" }
    , { "lsaquo", u8"\u2039" }
    , { "lscr", u8"\U0001D4C1" }
    , { "lsh", u8"\u21B0" }
    , { "lsim", u8"\u2272" }
    , { "lsime", u8"\u2A8D" }
    , { "lsimg", u8"\u2A8F" }
    , { "lsqb", u8"[" }
    , { "lsquo", u8"\u2018" }
    , { "lsquor", u8"\u201A" }
    , { "lstrok", u8"\u0142" }
    , { "lt", u8"<" }
    , { "ltcc", u8"\u2AA6" }
    , { "ltcir", u8"\u2A79" }
    , { "ltdot", u8"\u22D6" }
    , { "lthree", u8"\u22CB" }
    , { "ltimes", u8"\u22C9" }
    , { "ltlarr", u8"\u2976" }
    , { "ltquest", u8"\u2A7B" }
    , { "ltrPar", u8"\u2996" }
    , { "ltri", u8"\u25C3" }
    , { "ltrie", u8"\u22B4" }
    , { "ltrif", u8"\u25C2" }
    , { "lurdshar", u8"\u294A" }
    , { "luruhar", u8"\u2966" }
    , { "lvertneqq", u8"\u2268\uFE00" }
    , { "lvnE", u8"\u2268\uFE00" }
    , { "mDDot", u8"\u223A" }
    , { "macr", u8"\u00AF" }
    , { "male", u8"\u2642" }
    , { "malt", u8"\u2720" }
    , { "maltese", u8"\u2720" }
    , { "map", u8"\u21A6" }
    , { "mapsto", u8"\u21A6" }
    , { "mapstodown", u8"\u21A7" }
    , { "mapstoleft", u8"\u21A4" }
    , { "mapstoup", u8"\u21A5" }
    , { "marker", u8"\u25AE" }
    , { "mcomma", u8"\u2A29" }
    , { "mcy", u8"\u043C" }
    , { "mdash", u8"\u2014" }
    , { "measuredangle", u8"\u2221" }
    , { "mfr", u8"\U0001D52A" }
    , { "mho", u8"\u2127" }
    , { "micro", u8"\u00B5" }
    , { "mid", u8"\u2223" }
    , { "midast", u8"*" }
    , { "midcir", u8"\u2AF0" }
    , { "middot", u8"\u00B7" }
    , { "minus", u8"\u2212" }
    , { "minusb", u8"\u229F" }
    , { "minusd", u8"\u2238" }
    , { "minusdu", u8"\u2A2A" }
    , { "mlcp", u8"\u2ADB" }
    , { "mldr", u8"\u2026" }
    , { "mnplus", u8"\u2213" }
    , { "models", u8"\u22A7" }
    , { "mopf", u8"\U0001D55E" }
    , { "mp", u8"\u2213" }
    , { "mscr", u8"\U0001D4C2" }
    , { "mstpos", u8"\u223E" }
    , { "mu", u8"\u03BC" }
    , { "multimap", u8"\u22B8" }
    , { "mumap", u8"\u22B8" }
    , { "nGg", u8"\u22D9\u0338" }
    , { "nGt", u8"\u226B\u20D2" }
    , { "nGtv", u8"\u226B\u0338" }
    , { "nLeftarrow", u8"\u21CD" }
    , { "nLeftrightarrow", u8"\u21CE" }
    , { "nLl", u8"\u22D8\u0338" }
    , { "nLt", u8"\u226A\u20D2" }
    , { "nLtv", u8"\u226A\u0338" }
    , { "nRightarrow", u8"\u21CF" }
    , { "nVDash", u8"\u22AF" }
    , { "nVdash", u8"\u22AE" }
    , { "nabla", u8"\u2207" }
    , { "nacute", u8"\u0144" }
    , { "nang", u8"\u2220\u20D2" }
    , { "nap", u8"\u2249" }
    , { "napE", u8"\u2A70\u0338" }
    , { "napid", u8"\u224B\u0338" }
    , { "napos", u8"\u0149" }
    , { "napprox", u8"\u2249" }
    , { "natur", u8"\u266E" }
    , { "natural", u8"\u266E" }
    , { "naturals", u8"\u2115" }
    , { "nbsp", u8"\u00A0" }
    , { "nbump", u8"\u224E\u0338" }
    , { "nbumpe", u8"\u224F\u0338" }
    , { "ncap", u8"\u2A43" }
    , { "ncaron", u8"\u0148" }
    , { "ncedil", u8"\u0146" }
    , { "ncong", u8"\u2247" }
    , { "ncongdot", u8"\u2A6D\u0338" }
    , { "ncup", u8"\u2A42" }
    , { "ncy", u8"\u043D" }
    , { "ndash", u8"\u2013" }
    , { "ne", u8"\u2260" }
    , { "neArr", u8"\u21D7" }
    , { "nearhk", u8"\u2924" }
    , { "nearr", u8"\u2197" }
    , { "nearrow", u8"\u2197" }
    , { "nedot", u8"\u2250\u0338" }
    , { "nequiv", u8"\u2262" }
    , { "nesear", u8"\u2928" }
    , { "nesim", u8"\u2242\u0338" }
    , { "nexist", u8"\u2204" }
    , { "nexists", u8"\u2204" }
    , { "nfr", u8"\U0001D52B" }
    , { "ngE", u8"\u2267\u0338" }
    , { "nge", u8"\u2271" }
    , { "ngeq", u8"\u2271" }
    , { "ngeqq", u8"\u2267\u0338" }
    , { "ngeqslant", u8"\u2A7E\u0338" }
    , { "nges", u8"\u2A7E\u0338" }
    , { "ngsim", u8"\u2275" }
    , { "ngt", u8"\u226F" }
    , { "ngtr", u8"\u226F" }
    , { "nhArr", u8"\u21CE" }
    , { "nharr", u8"\u21AE" }
    , { "nhpar", u8"\u2AF2" }
    , { "ni", u8"\u220B" }
    , { "nis", u8"\u22FC" }
    , { "nisd", u8"\u22FA" }
    , { "niv", u8"\u220B" }
    , { "njcy", u8"\u045A" }
    , { "nlArr", u8"\u21CD" }
    , { "nlE", u8"\u2266\u0338" }
    , { "nlarr", u8"\u219A" }
    , { "nldr", u8"\u2025" }
    , { "nle", u8"\u2270" }
    , { "nleftarrow", u8"\u219A" }
    , { "nleftrightarrow", u8"\u21AE" }
    , { "nleq", u8"\u2270" }
    , { "nleqq", u8"\u2266\u0338" }
    , { "nleqslant", u8"\u2A7D\u0338" }
    , { "nles", u8"\u2A7D\u0338" }
    , { "nless", u8"\u226E" }
    , { "nlsim", u8"\u2274" }
    , { "nlt", u8"\u226E" }
    , { "nltri", u8"\u22EA" }
    , { "nltrie", u8"\u22EC" }
    , { "nmid", u8"\u2224" }
    , { "nopf", u8"\U0001D55F" }
    , { "not", u8"\u00AC" }
    , { "notin", u8"\u2209" }
    , { "notinE", u8"\u22F9\u0338" }
    , { "notindot", u8"\u22F5\u0338" }
    , { "notinva", u8"\u2209" }
    , { "notinvb", u8"\u22F7" }
    , { "notinvc", u8"\u22F6" }
    , { "notni", u8"\u220C" }
    , { "notniva", u8"\u220C" }
    , { "notnivb", u8"\u22FE" }
    , { "notnivc", u8"\u22FD" }
    , { "npar", u8"\u2226" }
    , { "nparallel", u8"\u2226" }
    , { "nparsl", u8"\u2AFD\u20E5" }
    , { "npart", u8"\u2202\u0338" }
    , { "npolint", u8"\u2A14" }
    , { "npr", u8"\u2280" }
    , { "nprcue", u8"\u22E0" }
    , { "npre", u8"\u2AAF\u0338" }
    , { "nprec", u8"\u2280" }
    , { "npreceq", u8"\u2AAF\u0338" }
    , { "nrArr", u8"\u21CF" }
    , { "nrarr", u8"\u219B" }
    , { "nrarrc", u8"\u2933\u0338" }
    , { "nrarrw", u8"\u219D\u0338" }
    , { "nrightarrow", u8"\u219B" }
    , { "nrtri", u8"\u22EB" }
    , { "nrtrie", u8"\u22ED" }
    , { "nsc", u8"\u2281" }
    , { "nsccue", u8"\u22E1" }
    , { "nsce", u8"\u2AB0\u0338" }
    , { "nscr", u8"\U0001D4C3" }
    , { "nshortmid", u8"\u2224" }
    , { "nshortparallel", u8"\u2226" }
    , { "nsim", u8"\u2241" }
    , { "nsime", u8"\u2244" }
    , { "nsimeq", u8"\u2244" }
    , { "nsmid", u8"\u2224" }
    , { "nspar", u8"\u2226" }
    , { "nsqsube", u8"\u22E2" }
    , { "nsqsupe", u8"\u22E3" }
    , { "nsub", u8"\u2284" }
    , { "nsubE", u8"\u2AC5\u0338" }
    , { "nsube", u8"\u2288" }
    , { "nsubset", u8"\u2282\u20D2" }
    , { "nsubseteq", u8"\u2288" }
    , { "nsubseteqq", u8"\u2AC5\u0338" }
    , { "nsucc", u8"\u2281" }
    , { "nsucceq", u8"\u2AB0\u0338" }
    , { "nsup", u8"\u2285" }
    , { "nsupE", u8"\u2AC6\u0338" }
    , { "nsupe", u8"\u2289" }
    , { "nsupset", u8"\u2283\u20D2" }
    , { "nsupseteq", u8"\u2289" }
    , { "nsupseteqq", u8"\u2AC6\u0338" }
    , { "ntgl", u8"\u2279" }
    , { "ntilde", u8"\u00F1" }
    , { "ntlg", u8"\u2278" }
    , { "ntriangleleft", u8"\u22EA" }
    , { "ntrianglelefteq", u8"\u22EC" }
    , { "ntriangleright", u8"\u22EB" }
    , { "ntrianglerighteq", u8"\u22ED" }
    , { "nu", u8"\u03BD" }
    , { "num", u8"#" }
    , { "numero", u8"\u2116" }
    , { "numsp", u8"\u2007" }
    , { "nvDash", u8"\u22AD" }
    , { "nvHarr", u8"\u2904" }
    , { "nvap", u8"\u224D\u20D2" }
    , { "nvdash", u8"\u22AC" }
    , { "nvge", u8"\u2265\u20D2" }
    , { "nvgt", u8">\u20D2" }
    , { "nvinfin", u8"\u29DE" }
    , { "nvlArr", u8"\u2902" }
    , { "nvle", u8"\u2264\u20D2" }
    , { "nvlt", u8"<\u20D2" }
    , { "nvltrie", u8"\u22B4\u20D2" }
    , { "nvrArr", u8"\u2903" }
    , { "nvrtrie", u8"\u22B5\u20D2" }
    , { "nvsim", u8"\u223C\u20D2" }
    , { "nwArr", u8"\u21D6" }
    , { "nwarhk", u8"\u2923" }
    , { "nwarr", u8"\u2196" }
    , { "nwarrow", u8"\u2196" }
    , { "nwnear", u8"\u2927" }
    , { "oS", u8"\u24C8" }
    , { "oacute", u8"\u00F3" }
    , { "oast", u8"\u229B" }
    , { "ocir", u8"\u229A" }
    , { "ocirc", u8"\u00F4" }
    , { "ocy", u8"\u043E" }
    , { "odash", u8"\u229D" }
    , { "odblac", u8"\u0151" }
    , { "odiv", u8"\u2A38" }
    , { "odot", u8"\u2299" }
    , { "odsold", u8"\u29BC" }
    , { "oelig", u8"\u0153" }
    , { "ofcir", u8"\u29BF" }
    , { "ofr", u8"\U0001D52C" }
    , { "ogon", u8"\u02DB" }
    , { "ograve", u8"\u00F2" }
    , { "ogt", u8"\u29C1" }
    , { "ohbar", u8"\u29B5" }
    , { "ohm", u8"\u03A9" }
    , { "oint", u8"\u222E" }
    , { "olarr", u8"\u21BA" }
    , { "olcir", u8"\u29BE" }
    , { "olcross", u8"\u29BB" }
    , { "oline", u8"\u203E" }
    , { "olt", u8"\u29C0" }
    , { "omacr", u8"\u014D" }
    , { "omega", u8"\u03C9" }
    , { "omicron", u8"\u03BF" }
    , { "omid", u8"\u29B6" }
    , { "ominus", u8"\u2296" }
    , { "oopf", u8"\U0001D560" }
    , { "opar", u8"\u29B7" }
    , { "operp", u8"\u29B9" }
    , { "oplus", u8"\u2295" }
    , { "or", u8"\u2228" }
    , { "orarr", u8"\u21BB" }
    , { "ord", u8"\u2A5D" }
    , { "order", u8"\u2134" }
    , { "orderof", u8"\u2134" }
    , { "ordf", u8"\u00AA" }
    , { "ordm", u8"\u00BA" }
    , { "origof", u8"\u22B6" }
    , { "oror", u8"\u2A56" }
    , { "orslope", u8"\u2A57" }
    , { "orv", u8"\u2A5B" }
    , { "oscr", u8"\u2134" }
    , { "oslash", u8"\u00F8" }
    , { "osol", u8"\u2298" }
    , { "otilde", u8"\u00F5" }
    , { "otimes", u8"\u2297" }
    , { "otimesas", u8"\u2A36" }
    , { "ouml", u8"\u00F6" }
    , { "ovbar", u8"\u233D" }
    , { "par", u8"\u2225" }
    , { "para", u8"\u00B6" }
    , { "parallel", u8"\u2225" }
    , { "parsim", u8"\u2AF3" }
    , { "parsl", u8"\u2AFD" }
    , { "part", u8"\u2202" }
    , { "pcy", u8"\u043F" }
    , { "percnt", u8"%" }
    , { "period", u8"." }
    , { "permil", u8"\u2030" }
    , { "perp", u8"\u22A5" }
    , { "pertenk", u8"\u2031" }
    , { "pfr", u8"\U0001D52D" }
    , { "phi", u8"\u03C6" }
    , { "phiv", u8"\u03D5" }
    , { "phmmat", u8"\u2133" }
    , { "phone", u8"\u260E" }
    , { "pi", u8"\u03C0" }
    , { "pitchfork", u8"\u22D4" }
    , { "piv", u8"\u03D6" }
    , { "planck", u8"\u210F" }
    , { "planckh", u8"\u210E" }
    , { "plankv", u8"\u210F" }
    , { "plus", u8"+" }
    , { "plusacir", u8"\u2A23" }
    , { "plusb", u8"\u229E" }
    , { "pluscir", u8"\u2A22" }
    , { "plusdo", u8"\u2214" }
    , { "plusdu", u8"\u2A25" }
    , { "pluse", u8"\u2A72" }
    , { "plusmn", u8"\u00B1" }
    , { "plussim", u8"\u2A26" }
    , { "plustwo", u8"\u2A27" }
    , { "pm", u8"\u00B1" }
    , { "pointint", u8"\u2A15" }
    , { "popf", u8"\U0001D561" }
    , { "pound", u8"\u00A3" }
    , { "pr", u8"\u227A" }
    , { "prE", u8"\u2AB3" }
    , { "prap", u8"\u2AB7" }
    , { "prcue", u8"\u227C" }
    , { "pre", u8"\u2AAF" }
    , { "prec", u8"\u227A" }
    , { "precapprox", u8"\u2AB7" }
    , { "preccurlyeq", u8"\u227C" }
    , { "preceq", u8"\u2AAF" }
    , { "precnapprox", u8"\u2AB9" }
    , { "precneqq", u8"\u2AB5" }
    , { "precnsim", u8"\u22E8" }
    , { "precsim", u8"\u227E" }
    , { "prime", u8"\u2032" }
    , { "primes", u8"\u2119" }
    , { "prnE", u8"\u2AB5" }
    , { "prnap", u8"\u2AB9" }
    , { "prnsim", u8"\u22E8" }
    , { "prod", u8"\u220F" }
    , { "profalar", u8"\u232E" }
    , { "profline", u8"\u2312" }
    , { "profsurf", u8"\u2313" }
    , { "prop", u8"\u221D" }
    , { "propto", u8"\u221D" }
    , { "prsim", u8"\u227E" }
    , { "prurel", u8"\u22B0" }
    , { "pscr", u8"\U0001D4C5" }
    , { "psi", u8"\u03C8" }
    , { "puncsp", u8"\u2008" }
    , { "qfr", u8"\U0001D52E" }
    , { "qint", u8"\u2A0C" }
    , { "qopf", u8"\U0001D562" }
    , { "qprime", u8"\u2057" }
    , { "qscr", u8"\U0001D4C6" }
    , { "quaternions", u8"\u210D" }
    , { "quatint", u8"\u2A16" }
    , { "quest", u8"?" }
    , { "questeq", u8"\u225F" }
    , { "quot", u8"\"" }
    , { "rAarr", u8"\u21DB" }
    , { "rArr", u8"\u21D2" }
    , { "rAtail", u8"\u291C" }
    , { "rBarr", u8"\u290F" }
    , { "rHar", u8"\u2964" }
    , { "race", u8"\u223D\u0331" }
    , { "racute", u8"\u0155" }
    , { "radic", u8"\u221A" }
    , { "raemptyv", u8"\u29B3" }
    , { "rang", u8"\u27E9" }
    , { "rangd", u8"\u2992" }
    , { "range", u8"\u29A5" }
    , { "rangle", u8"\u27E9" }
    , { "raquo", u8"\u00BB" }
    , { "rarr", u8"\u2192" }
    , { "rarrap", u8"\u2975" }
    , { "rarrb", u8"\u21E5" }
    , { "rarrbfs", u8"\u2920" }
    , { "rarrc", u8"\u2933" }
    , { "rarrfs", u8"\u291E" }
    , { "rarrhk", u8"\u21AA" }
    , { "rarrlp", u8"\u21AC" }
    , { "rarrpl", u8"\u2945" }
    , { "rarrsim", u8"\u2974" }
    , { "rarrtl", u8"\u21A3" }
    , { "rarrw", u8"\u219D" }
    , { "ratail", u8"\u291A" }
    , { "ratio", u8"\u2236" }
    , { "rationals", u8"\u211A" }
    , { "rbarr", u8"\u290D" }
    , { "rbbrk", u8"\u2773" }
    , { "rbrace", u8"}" }
    , { "rbrack", u8"]" }
    , { "rbrke", u8"\u298C" }
    , { "rbrksld", u8"\u298E" }
    , { "rbrkslu", u8"\u2990" }
    , { "rcaron", u8"\u0159" }
    , { "rcedil", u8"\u0157" }
    , { "rceil", u8"\u2309" }
    , { "rcub", u8"}" }
    , { "rcy", u8"\u0440" }
    , { "rdca", u8"\u2937" }
    , { "rdldhar", u8"\u2969" }
    , { "rdquo", u8"\u201D" }
    , { "rdquor", u8"\u201D" }
    , { "rdsh", u8"\u21B3" }
    , { "real", u8"\u211C" }
    , { "realine", u8"\u211B" }
    , { "realpart", u8"\u211C" }
    , { "reals", u8"\u211D" }
    , { "rect", u8"\u25AD" }
    , { "reg", u8"\u00AE" }
    , { "rfisht", u8"\u297D" }
    , { "rfloor", u8"\u230B" }
    , { "rfr", u8"\U0001D52F" }
    , { "rhard", u8"\u21C1" }
    , { "rharu", u8"\u21C0" }
    , { "rharul", u8"\u296C" }
    , { "rho", u8"\u03C1" }
    , { "rhov", u8"\u03F1" }
    , { "rightarrow", u8"\u2192" }
    , { "rightarrowtail", u8"\u21A3" }
    , { "rightharpoondown", u8"\u21C1" }
    , { "rightharpoonup", u8"\u21C0" }
    , { "rightleftarrows", u8"\u21C4" }
    , { "rightleftharpoons", u8"\u21CC" }
    , { "rightrightarrows", u8"\u21C9" }
    , { "rightsquigarrow", u8"\u219D" }
    , { "rightthreetimes", u8"\u22CC" }
    , { "ring", u8"\u02DA" }
    , { "risingdotseq", u8"\u2253" }
    , { "rlarr", u8"\u21C4" }
    , { "rlhar", u8"\u21CC" }
    , { "rlm", u8"\u200F" }
    , { "rmoust", u8"\u23B1" }
    , { "rmoustache", u8"\u23B1" }
    , { "rnmid", u8"\u2AEE" }
    , { "roang", u8"\u27ED" }
    , { "roarr", u8"\u21FE" }
    , { "robrk", u8"\u27E7" }
    , { "ropar", u8"\u2986" }
    , { "ropf", u8"\U0001D563" }
    , { "roplus", u8"\u2A2E" }
    , { "rotimes", u8"\u2A35" }
    , { "rpar", u8")" }
    , { "rpargt", u8"\u2994" }
    , { "rppolint", u8"\u2A12" }
    , { "rrarr", u8"\u21C9" }
    , { "rsaquo", u8"\u203A" }
    , { "rscr", u8"\U0001D4C7" }
    , { "rsh", u8"\u21B1" }
    , { "rsqb", u8"]" }
    , { "rsquo", u8"\u2019" }
    , { "rsquor", u8"\u2019" }
    , { "rthree", u8"\u22CC" }
    , { "rtimes", u8"\u22CA" }
    , { "rtri", u8"\u25B9" }
    , { "rtrie", u8"\u22B5" }
    , { "rtrif", u8"\u25B8" }
    , { "rtriltri", u8"\u29CE" }
    , { "ruluhar", u8"\u2968" }
    , { "rx", u8"\u211E" }
    , { "sacute", u8"\u015B" }
    , { "sbquo", u8"\u201A" }
    , { "sc", u8"\u227B" }
    , { "scE", u8"\u2AB4" }
    , { "scap", u8"\u2AB8" }
    , { "scaron", u8"\u0161" }
    , { "sccue", u8"\u227D" }
    , { "sce", u8"\u2AB0" }
    , { "scedil", u8"\u015F" }
    , { "scirc", u8"\u015D" }
    , { "scnE", u8"\u2AB6" }
    , { "scnap", u8"\u2ABA" }
    , { "scnsim", u8"\u22E9" }
    , { "scpolint", u8"\u2A13" }
    , { "scsim", u8"\u227F" }
    , { "scy", u8"\u0441" }
    , { "sdot", u8"\u22C5" }
    , { "sdotb", u8"\u22A1" }
    , { "sdote", u8"\u2A66" }
    , { "seArr", u8"\u21D8" }
    , { "searhk", u8"\u2925" }
    , { "searr", u8"\u2198" }
    , { "searrow", u8"\u2198" }
    , { "sect", u8"\u00A7" }
    , { "semi", u8";" }
    , { "seswar", u8"\u2929" }
    , { "setminus", u8"\u2216" }
    , { "setmn", u8"\u2216" }
    , { "sext", u8"\u2736" }
    , { "sfr", u8"\U0001D530" }
    , { "sfrown", u8"\u2322" }
    , { "sharp", u8"\u266F" }
    , { "shchcy", u8"\u0449" }
    , { "shcy", u8"\u0448" }
    , { "shortmid", u8"\u2223" }
    , { "shortparallel", u8"\u2225" }
    , { "shy", u8"\u00AD" }
    , { "sigma", u8"\u03C3" }
    , { "sigmaf", u8"\u03C2" }
    , { "sigmav", u8"\u03C2" }
    , { "sim", u8"\u223C" }
    , { "simdot", u8"\u2A6A" }
    , { "sime", u8"\u2243" }
    , { "simeq", u8"\u2243" }
    , { "simg", u8"\u2A9E" }
    , { "simgE", u8"\u2AA0" }
    , { "siml", u8"\u2A9D" }
    , { "simlE", u8"\u2A9F" }
    , { "simne", u8"\u2246" }
    , { "simplus", u8"\u2A24" }
    , { "simrarr", u8"\u2972" }
    , { "slarr", u8"\u2190" }
    , { "smallsetminus", u8"\u2216" }
    , { "smashp", u8"\u2A33" }
    , { "smeparsl", u8"\u29E4" }
    , { "smid", u8"\u2223" }
    , { "smile", u8"\u2323" }
    , { "smt", u8"\u2AAA" }
    , { "smte", u8"\u2AAC" }
    , { "smtes", u8"\u2AAC\uFE00" }
    , { "softcy", u8"\u044C" }
    , { "sol", u8"/" }
    , { "solb", u8"\u29C4" }
    , { "solbar", u8"\u233F" }
    , { "sopf", u8"\U0001D564" }
    , { "spades", u8"\u2660" }
    , { "spadesuit", u8"\u2660" }
    , { "spar", u8"\u2225" }
    , { "sqcap", u8"\u2293" }
    , { "sqcaps", u8"\u2293\uFE00" }
    , { "sqcup", u8"\u2294" }
    , { "sqcups", u8"\u2294\uFE00" }
    , { "sqsub", u8"\u228F" }
    , { "sqsube", u8"\u2291" }
    , { "sqsubset", u8"\u228F" }
    , { "sqsubseteq", u8"\u2291" }
    , { "sqsup", u8"\u2290" }
    , { "sqsupe", u8"\u2292" }
    , { "sqsupset", u8"\u2290" }
    , { "sqsupseteq", u8"\u2292" }
    , { "squ", u8"\u25A1" }
    , { "square", u8"\u25A1" }
    , { "squarf", u8"\u25AA" }
    , { "squf", u8"\u25AA" }
    , { "srarr", u8"\u2192" }
    , { "sscr", u8"\U0001D4C8" }
    , { "ssetmn", u8"\u2216" }
    , { "ssmile", u8"\u2323" }
    , { "sstarf", u8"\u22C6" }
    , { "star", u8"\u2606" }
    , { "starf", u8"\u2605" }
    , { "straightepsilon", u8"\u03F5" }
    , { "straightphi", u8"\u03D5" }
    , { "strns", u8"\u00AF" }
    , { "sub", u8"\u2282" }
    , { "subE", u8"\u2AC5" }
    , { "subdot", u8"\u2ABD" }
    , { "sube", u8"\u2286" }
    , { "subedot", u8"\u2AC3" }
    , { "submult", u8"\u2AC1" }
    , { "subnE", u8"\u2ACB" }
    , { "subne", u8"\u228A" }
    , { "subplus", u8"\u2ABF" }
    , { "subrarr", u8"\u2979" }
    , { "subset", u8"\u2282" }
    , { "subseteq", u8"\u2286" }
    , { "subseteqq", u8"\u2AC5" }
    , { "subsetneq", u8"\u228A" }
    , { "subsetneqq", u8"\u2ACB" }
    , { "subsim", u8"\u2AC7" }
    , { "subsub", u8"\u2AD5" }
    , { "subsup", u8"\u2AD3" }
    , { "succ", u8"\u227B" }
    , { "succapprox", u8"\u2AB8" }
    , { "succcurlyeq", u8"\u227D" }
    , { "succeq", u8"\u2AB0" }
    , { "succnapprox", u8"\u2ABA" }
    , { "succneqq", u8"\u2AB6" }
    , { "succnsim", u8"\u22E9" }
    , { "succsim", u8"\u227F" }
    , { "sum", u8"\u2211" }
    , { "sung", u8"\u266A" }
    , { "sup1", u8"\u00B9" }
    , { "sup2", u8"\u00B2" }
    , { "sup3", u8"\u00B3" }
    , { "sup", u8"\u2283" }
    , { "supE", u8"\u2AC6" }
    , { "supdot", u8"\u2ABE" }
    , { "supdsub", u8"\u2AD8" }
    , { "supe", u8"\u2287" }
    , { "supedot", u8"\u2AC4" }
    , { "suphsol", u8"\u27C9" }
    , { "suphsub", u8"\u2AD7" }
    , { "suplarr", u8"\u297B" }
    , { "supmult", u8"\u2AC2" }
    , { "supnE", u8"\u2ACC" }
    , { "supne", u8"\u228B" }
    , { "supplus", u8"\u2AC0" }
    , { "supset", u8"\u2283" }
    , { "supseteq", u8"\u2287" }
    , { "supseteqq", u8"\u2AC6" }
    , { "supsetneq", u8"\u228B" }
    , { "supsetneqq", u8"\u2ACC" }
    , { "supsim", u8"\u2AC8" }
    , { "supsub", u8"\u2AD4" }
    , { "supsup", u8"\u2AD6" }
    , { "swArr", u8"\u21D9" }
    , { "swarhk", u8"\u2926" }
    , { "swarr", u8"\u2199" }
    , { "swarrow", u8"\u2199" }
    , { "swnwar", u8"\u292A" }
    , { "szlig", u8"\u00DF" }
    , { "target", u8"\u2316" }
    , { "tau", u8"\u03C4" }
    , { "tbrk", u8"\u23B4" }
    , { "tcaron", u8"\u0165" }
    , { "tcedil", u8"\u0163" }
    , { "tcy", u8"\u0442" }
    , { "tdot", u8"\u20DB" }
    , { "telrec", u8"\u2315" }
    , { "tfr", u8"\U0001D531" }
    , { "there4", u8"\u2234" }
    , { "therefore", u8"\u2234" }
    , { "theta", u8"\u03B8" }
    , { "thetasym", u8"\u03D1" }
    , { "thetav", u8"\u03D1" }
    , { "thickapprox", u8"\u2248" }
    , { "thicksim", u8"\u223C" }
    , { "thinsp", u8"\u2009" }
    , { "thkap", u8"\u2248" }
    , { "thksim", u8"\u223C" }
    , { "thorn", u8"\u00FE" }
    , { "tilde", u8"\u02DC" }
    , { "times", u8"\u00D7" }
    , { "timesb", u8"\u22A0" }
    , { "timesbar", u8"\u2A31" }
    , { "timesd", u8"\u2A30" }
    , { "tint", u8"\u222D" }
    , { "toea", u8"\u2928" }
    , { "top", u8"\u22A4" }
    , { "topbot", u8"\u2336" }
    , { "topcir", u8"\u2AF1" }
    , { "topf", u8"\U0001D565" }
    , { "topfork", u8"\u2ADA" }
    , { "tosa", u8"\u2929" }
    , { "tprime", u8"\u2034" }
    , { "trade", u8"\u2122" }
    , { "triangle", u8"\u25B5" }
    , { "triangledown", u8"\u25BF" }
    , { "triangleleft", u8"\u25C3" }
    , { "trianglelefteq", u8"\u22B4" }
    , { "triangleq", u8"\u225C" }
    , { "triangleright", u8"\u25B9" }
    , { "trianglerighteq", u8"\u22B5" }
    , { "tridot", u8"\u25EC" }
    , { "trie", u8"\u225C" }
    , { "triminus", u8"\u2A3A" }
    , { "triplus", u8"\u2A39" }
    , { "trisb", u8"\u29CD" }
    , { "tritime", u8"\u2A3B" }
    , { "trpezium", u8"\u23E2" }
    , { "tscr", u8"\U0001D4C9" }
    , { "tscy", u8"\u0446" }
    , { "tshcy", u8"\u045B" }
    , { "tstrok", u8"\u0167" }
    , { "twixt", u8"\u226C" }
    , { "twoheadleftarrow", u8"\u219E" }
    , { "twoheadrightarrow", u8"\u21A0" }
    , { "uArr", u8"\u21D1" }
    , { "uHar", u8"\u2963" }
    , { "uacute", u8"\u00FA" }
    , { "uarr", u8"\u2191" }
    , { "ubrcy", u8"\u045E" }
    , { "ubreve", u8"\u016D" }
    , { "ucirc", u8"\u00FB" }
    , { "ucy", u8"\u0443" }
    , { "udarr", u8"\u21C5" }
    , { "udblac", u8"\u0171" }
    , { "udhar", u8"\u296E" }
    , { "ufisht", u8"\u297E" }
    , { "ufr", u8"\U0001D532" }
    , { "ugrave", u8"\u00F9" }
    , { "uharl", u8"\u21BF" }
    , { "uharr", u8"\u21BE" }
    , { "uhblk", u8"\u2580" }
    , { "ulcorn", u8"\u231C" }
    , { "ulcorner", u8"\u231C" }
    , { "ulcrop", u8"\u230F" }
    , { "ultri", u8"\u25F8" }
    , { "umacr", u8"\u016B" }
    , { "uml", u8"\u00A8" }
    , { "uogon", u8"\u0173" }
    , { "uopf", u8"\U0001D566" }
    , { "uparrow", u8"\u2191" }
    , { "updownarrow", u8"\u2195" }
    , { "upharpoonleft", u8"\u21BF" }
    , { "upharpoonright", u8"\u21BE" }
    , { "uplus", u8"\u228E" }
    , { "upsi", u8"\u03C5" }
    , { "upsih", u8"\u03D2" }
    , { "upsilon", u8"\u03C5" }
    , { "upuparrows", u8"\u21C8" }
    , { "urcorn", u8"\u231D" }
    , { "urcorner", u8"\u231D" }
    , { "urcrop", u8"\u230E" }
    , { "uring", u8"\u016F" }
    , { "urtri", u8"\u25F9" }
    , { "uscr", u8"\U0001D4CA" }
    , { "utdot", u8"\u22F0" }
    , { "utilde", u8"\u0169" }
    , { "utri", u8"\u25B5" }
    , { "utrif", u8"\u25B4" }
    , { "uuarr", u8"\u21C8" }
    , { "uuml", u8"\u00FC" }
    , { "uwangle", u8"\u29A7" }
    , { "vArr", u8"\u21D5" }
    , { "vBar", u8"\u2AE8" }
    , { "vBarv", u8"\u2AE9" }
    , { "vDash", u8"\u22A8" }
    , { "vangrt", u8"\u299C" }
    , { "varepsilon", u8"\u03F5" }
    , { "varkappa", u8"\u03F0" }
    , { "varnothing", u8"\u2205" }
    , { "varphi", u8"\u03D5" }
    , { "varpi", u8"\u03D6" }
    , { "varpropto", u8"\u221D" }
    , { "varr", u8"\u2195" }
    , { "varrho", u8"\u03F1" }
    , { "varsigma", u8"\u03C2" }
    , { "varsubsetneq", u8"\u228A\uFE00" }
    , { "varsubsetneqq", u8"\u2ACB\uFE00" }
    , { "varsupsetneq", u8"\u228B\uFE00" }
    , { "varsupsetneqq", u8"\u2ACC\uFE00" }
    , { "vartheta", u8"\u03D1" }
    , { "vartriangleleft", u8"\u22B2" }
    , { "vartriangleright", u8"\u22B3" }
    , { "vcy", u8"\u0432" }
    , { "vdash", u8"\u22A2" }
    , { "vee", u8"\u2228" }
    , { "veebar", u8"\u22BB" }
    , { "veeeq", u8"\u225A" }
    , { "vellip", u8"\u22EE" }
    , { "verbar", u8"|" }
    , { "vert", u8"|" }
    , { "vfr", u8"\U0001D533" }
    , { "vltri", u8"\u22B2" }
    , { "vnsub", u8"\u2282\u20D2" }
    , { "vnsup", u8"\u2283\u20D2" }
    , { "vopf", u8"\U0001D567" }
    , { "vprop", u8"\u221D" }
    , { "vrtri", u8"\u22B3" }
    , { "vscr", u8"\U0001D4CB" }
    , { "vsubnE", u8"\u2ACB\uFE00" }
    , { "vsubne", u8"\u228A\uFE00" }
    , { "vsupnE", u8"\u2ACC\uFE00" }
    , { "vsupne", u8"\u228B\uFE00" }
    , { "vzigzag", u8"\u299A" }
    , { "wcirc", u8"\u0175" }
    , { "wedbar", u8"\u2A5F" }
    , { "wedge", u8"\u2227" }
    , { "wedgeq", u8"\u2259" }
    , { "weierp", u8"\u2118" }
    , { "wfr", u8"\U0001D534" }
    , { "wopf", u8"\U0001D568" }
    , { "wp", u8"\u2118" }
    , { "wr", u8"\u2240" }
    , { "wreath", u8"\u2240" }
    , { "wscr", u8"\U0001D4CC" }
    , { "xcap", u8"\u22C2" }
    , { "xcirc", u8"\u25EF" }
    , { "xcup", u8"\u22C3" }
    , { "xdtri", u8"\u25BD" }
    , { "xfr", u8"\U0001D535" }
    , { "xhArr", u8"\u27FA" }
    , { "xharr", u8"\u27F7" }
    , { "xi", u8"\u03BE" }
    , { "xlArr", u8"\u27F8" }
    , { "xlarr", u8"\u27F5" }
    , { "xmap", u8"\u27FC" }
    , { "xnis", u8"\u22FB" }
    , { "xodot", u8"\u2A00" }
    , { "xopf", u8"\U0001D569" }
    , { "xoplus", u8"\u2A01" }
    , { "xotime", u8"\u2A02" }
    , { "xrArr", u8"\u27F9" }
    , { "xrarr", u8"\u27F6" }
    , { "xscr", u8"\U0001D4CD" }
    , { "xsqcup", u8"\u2A06" }
    , { "xuplus", u8"\u2A04" }
    , { "xutri", u8"\u25B3" }
    , { "xvee", u8"\u22C1" }
    , { "xwedge", u8"\u22C0" }
    , { "yacute", u8"\u00FD" }
    , { "yacy", u8"\u044F" }
    , { "ycirc", u8"\u0177" }
    , { "ycy", u8"\u044B" }
    , { "yen", u8"\u00A5" }
    , { "yfr", u8"\U0001D536" }
    , { "yicy", u8"\u0457" }
    , { "yopf", u8"\U0001D56A" }
    , { "yscr", u8"\U0001D4CE" }
    , { "yucy", u8"\u044E" }
    , { "yuml", u8"\u00FF" }
    , { "zacute", u8"\u017A" }
    , { "zcaron", u8"\u017E" }
    , { "zcy", u8"\u0437" }
    , { "zdot", u8"\u017C" }
    , { "zeetrf", u8"\u2128" }
    , { "zeta", u8"\u03B6" }
    , { "zfr", u8"\U0001D537" }
    , { "zhcy", u8"\u0436" }
    , { "zigrarr", u8"\u21DD" }
    , { "zopf", u8"\U0001D56B" }
    , { "zscr", u8"\U0001D4CF" }
    , { "zwj", u8"\u200D" }
    , { "zwnj", u8"\u200C" }
    };


struct EntityTextMapCompare
{
        bool operator()(EntityTextMap const &left, Blex::StringPair const &right)
        {
                size_t strlen_left = strlen(left.name);
                return Blex::StrCompare(left.name, left.name + strlen_left, right.begin, right.end) < 0;
        }
};


void DecodeEntityToUtf8(std::string &entity)
{
        // Entity has format &data (last ; is omitted)
        // Allowed formats: &#nr;, &#xhexnr; and &name;

        if (entity.size() < 2)
        {
                entity.clear();
                return;
        }

        std::string::iterator it = entity.begin() + 1;
        if (*it == '#') // Numeric character reference
        {
                  ++it;
                  unsigned radix = 10;
                  if (it != entity.end() && (*it == 'x' || *it == 'X'))
                  {
                          ++it;
                          radix = 16;
                  }
                  if (it == entity.end())
                  {
                          // Missing entity number
                          entity.clear();
                  }
                  else
                  {
                          std::pair< uint32_t, std::string::iterator > parseresult = Blex::DecodeUnsignedNumber<uint32_t>(it, entity.end(), radix);
                          if (parseresult.second != entity.end())
                          {
                                  // Invalid characters in entity nr
                                  entity.clear();
                          }
                          else
                          {
                                  //Encode it to UTF8
                                  Blex::CreateEntity(parseresult.first, &entity);
                          }
                  }
        }
        else
        {
                unsigned entity_count = sizeof(entitymap) / sizeof(EntityTextMap);
                Blex::StringPair compareto(entity.begin() + 1, entity.end());
                auto pos = std::lower_bound(entitymap, entitymap + entity_count, compareto, EntityTextMapCompare());
                if (pos != entitymap + entity_count && compareto == pos->name)
                {
                        entity = pos->text;
                }
                else
                {
                        entity.clear();
                }
        }
}

/// HTML decoder object
template <class OutputIterator> class DecoderHtml
{
        enum DecodeState
        {
                Text,
                Entity,
                InTag,
                InTagDQuote,
                InTagSQuote
        };

        std::string entity;
        DecodeState state;

        public:
        OutputIterator output;

        DecoderHtml (OutputIterator _output)
        : state(Text)
        , output(_output)
        { }

        void operator() (char inputbyte)
        {
                switch(state)
                {
                case Text:
                        if(inputbyte == '&')
                        {
                                state = Entity;
                                entity.push_back(inputbyte);
                        }
                        else if(inputbyte == '<')
                        {
                                state = InTag;
                                entity.push_back(inputbyte);
                        }
                        else
                        {
                                *output++=inputbyte;
                        }
                        return;
                case Entity:
                        if(inputbyte==';')
                        {
                                DecodeEntityToUtf8(entity);
                                output=std::copy(entity.begin(),entity.end(),output);
                                entity.clear();
                                state = Text;
                                return;
                        }
                        entity.push_back(inputbyte);
                        return;
                case InTag:
                        if(inputbyte=='>')
                        {
                                //FIXME allow more variants of <br> <br/> <br />
                                if(entity.size() >= 3
                                   && entity[0]=='<'
                                   && (entity[1]&0xDF)=='B'
                                   && (entity[2]&0xDF)=='R'
                                   && (entity.size()==3
                                       || (entity.size()==4 && entity[3]==' ')
                                       || (entity.size()==4 && entity[3]=='/')
                                       || (entity.size()==5 && entity[3]==' ' && entity[4]=='/')
                                      )
                                  )
                                {
                                        *output++ = '\n';
                                }
                                entity.clear();
                                state = Text;
                                return;
                        }

                        if(inputbyte=='\'')
                                state = InTagSQuote;
                        else if(inputbyte=='\"')
                                state = InTagDQuote;
                        entity.push_back(inputbyte);
                        return;
                case InTagSQuote:
                        if(inputbyte=='\'')
                                state = InTag;
                        entity.push_back(inputbyte);
                        return;
                case InTagDQuote:
                        if(inputbyte=='\"')
                                state = InTag;
                        entity.push_back(inputbyte);
                        return;
                }
        }
};

template <class InputIterator, class OutputIterator> OutputIterator DecodeHtml(InputIterator begin,InputIterator end, OutputIterator output)
{
        DecoderHtml<OutputIterator &> out(output);
        std::for_each(begin,end,out);
        return out.output;
}

/// Value decoder object
template <class OutputIterator> class DecoderValue
{
        enum DecodeState
        {
                Text,
                Entity
        };

        std::string entity;
        DecodeState state;

        public:
        OutputIterator output;

        DecoderValue (OutputIterator _output)
        : state(Text)
        , output(_output)
        { }

        void operator() (char inputbyte)
        {
                switch(state)
                {
                case Text:
                        if(inputbyte == '&')
                        {
                                state = Entity;
                                entity.push_back(inputbyte);
                        }
                        else
                        {
                                *output++=inputbyte;
                        }
                        return;
                case Entity:
                        if(inputbyte==';')
                        {
                                DecodeEntityToUtf8(entity);
                                output=std::copy(entity.begin(),entity.end(),output);
                                entity.clear();
                                state = Text;
                                return;
                        }
                        entity.push_back(inputbyte);
                        return;
                }
        }
};

template <class InputIterator, class OutputIterator> OutputIterator DecodeValue(InputIterator begin,InputIterator end, OutputIterator output)
{
        DecoderValue<OutputIterator &> out(output);
        std::for_each(begin,end,out);
        return out.output;
}


} //end anonymous namespace

namespace HareScript {
namespace Baselibs {


/* Create an encoder/decoder Harescript function template, because the # of
   encoding functions is growing immensely..

   below is an example of such a function, expanded:

   void EncodeUrl(VirtualMachine *vm)
  {
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str=stackm.GetString(HSVM_Arg(0));

        std::string coded;
        coded.reserve(str.size());
        Blex::EncodeUrl(str.begin,str.end,back_inserter(coded));

        stackm.SetSTLString(id_set,coded);
  }
*/
template < std::back_insert_iterator<Blex::PodVector<char> > (*codefunc)(char const *,char const*,std::back_insert_iterator<Blex::PodVector<char> >) >
  void HarescriptCodeFunc(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str=stackm.GetString(HSVM_Arg(0));
        Blex::PodVector<char> &scratchpad=SystemContext(vm->GetContextKeeper())->scratchpad;

        scratchpad.resize(0);
        scratchpad.reserve(str.size());
        codefunc(str.begin,str.end,std::back_inserter(scratchpad));

        if (str.size() == scratchpad.size() && std::equal(str.begin,str.end,scratchpad.begin()))
            stackm.CopyFrom(id_set,HSVM_Arg(0));
        else
            stackm.SetString(id_set,scratchpad.begin(),scratchpad.end());
}


void InitStrings(BuiltinFunctionsRegistrator &bifreg)
{
        /* ADDME: is there a workaround to make this code work?
         *

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEHTML",HarescriptCodeFunc< Blex::EncodeHtml<char const*, std::back_insert_iterator<std::vector<char> > > >));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEJAVA",HarescriptCodeFunc< Blex::EncodeJava<char const*, std::back_insert_iterator<std::vector<char> > > >));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEURL",HarescriptCodeFunc< Blex::EncodeUrl<char const*, std::back_insert_iterator<std::vector<char> > > >));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEVALUE",HarescriptCodeFunc< Blex::EncodeValue<char const*, std::back_insert_iterator<std::vector<char> > > >));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEBASE16",HarescriptCodeFunc< Blex::EncodeBase16<char const*, std::back_insert_iterator<std::vector<char> > > >));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEHTML",HarescriptCodeFunc< Blex::DecodeHtml<char const*, std::back_insert_iterator<std::vector<char> > > >));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEJAVA",HarescriptCodeFunc< Blex::DecodeJava<char const*, std::back_insert_iterator<std::vector<char> > > >));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEURL",HarescriptCodeFunc< Blex::DecodeUrl<char const*, std::back_insert_iterator<std::vector<char> > > >));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEVALUE",HarescriptCodeFunc< Blex::DecodeValue<char const*, std::back_insert_iterator<std::vector<char> > > >));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEBASE16",HarescriptCodeFunc< Blex::DecodeBase16<char const*, std::back_insert_iterator<std::vector<char> > > >));
        */

        BuiltinFunctionPtr he = HarescriptCodeFunc< Blex::EncodeHtml<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;
        BuiltinFunctionPtr je = HarescriptCodeFunc< Blex::EncodeJava<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;
        BuiltinFunctionPtr ue = HarescriptCodeFunc< Blex::EncodeUrl<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;
        BuiltinFunctionPtr ve = HarescriptCodeFunc< Blex::EncodeValue<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;
        BuiltinFunctionPtr be = HarescriptCodeFunc< Blex::EncodeBase16<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;
        BuiltinFunctionPtr be64 = HarescriptCodeFunc< Blex::EncodeBase64<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;
        BuiltinFunctionPtr ufse = HarescriptCodeFunc< Blex::EncodeUFS<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;
        BuiltinFunctionPtr hd = HarescriptCodeFunc< DecodeHtml<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;
        BuiltinFunctionPtr jd = HarescriptCodeFunc< Blex::DecodeJava<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;
        BuiltinFunctionPtr ud = HarescriptCodeFunc< Blex::DecodeUrl<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;
        BuiltinFunctionPtr vd = HarescriptCodeFunc< DecodeValue<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;
        BuiltinFunctionPtr bd = HarescriptCodeFunc< Blex::DecodeBase16<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;
        BuiltinFunctionPtr bd64 = HarescriptCodeFunc< Blex::DecodeBase64<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;
        BuiltinFunctionPtr ufsd = HarescriptCodeFunc< Blex::DecodeUFS<char const*, std::back_insert_iterator<Blex::PodVector<char> > > >;

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEBASE16::S:S",bd));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEBASE64::S:S",bd64));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEUFS::S:S",ufsd));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEHTML::S:S",hd));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEJAVA::S:S",jd));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEURL::S:S",ud));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEVALUE::S:S",vd));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEBASE16::S:S",be));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEBASE64::S:S",be64));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEUFS::S:S",ufse));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEHTML::S:S",he));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEJAVA::S:S",je));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEURL::S:S",ue));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEVALUE::S:S",ve));
}

} // End of namespace Baselibs
} // End of namespace HareScript
