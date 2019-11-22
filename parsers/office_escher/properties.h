#ifndef blex_parsers_office_escher_properties
#define blex_parsers_office_escher_properties

#include <drawlib/drawlibv2/drawobject.h>

#define NUM_PROPERTY_SETS 14

namespace Parsers {
namespace Office {
namespace Escher {

// Defined in escher.h
class EscherDocument;
class SchemeColors;
class msoBlip;

///////////////////////////////////////////////////////////////
// First some definitions for some specific properties follow:

// Note: This table is a duplicate of the palette table in word.cpp,
// in the 'publishing' project.
// ADDME: Cleanup.
extern const DrawLib::Pixel32 windows_palette[16];

// MSOTXFL -- text flow
/**
 * The text direction, read from property 'txflTextFlow' (136).
 */
typedef enum
{
        msotxflHorzN,           // Horizontal non-@
        msotxflTtoBA,           // Top to Bottom @-font
        msotxflBtoT,            // Bottom to Top non-@
        msotxflTtoBN,           // Top to Bottom non-@
        msotxflHorzA,           // Horizontal @-font
        msotxflVertN           // Vertical, non-@
}
MSOTXFL;

/**
 * The constants in this enum, are the bitpositions in the highest
 * byte of all values of shape-properties, representing a color.
 * (This is copy-pasted from the MS Escher documentation.)
 */
typedef enum
{
        msocolorFlagPaletteIndex,  // PALETTEINDEX macro
        msocolorFlagPaletteRGB,    // PALETTERGB macro
        msocolorFlagSystemRGB,     // MSOSYSTEMRGB
        msocolorFlagSchemeIndex,   // MSOSCHEMECOLOR
        msocolorFlagSysIndex      // MSOSYSCOLOR
}
MSOCOLORINDEX;


/**
 * This enum contains all constants used, to read / calculate colors.
 * (This is copy-pasted from the MS Escher documentation.)
 */
typedef enum
{
        msosyscolorButtonFace,          // COLOR_BTNFACE
        msosyscolorWindowText,          // COLOR_WINDOWTEXT
        msosyscolorMenu,                // COLOR_MENU
        msosyscolorHighlight,           // COLOR_HIGHLIGHT
        msosyscolorHighlightText,       // COLOR_HIGHLIGHTTEXT
        msosyscolorCaptionText,         // COLOR_CAPTIONTEXT
        msosyscolorActiveCaption,       // COLOR_ACTIVECAPTION
        msosyscolorButtonHighlight,     // COLOR_BTNHIGHLIGHT
        msosyscolorButtonShadow,        // COLOR_BTNSHADOW
        msosyscolorButtonText,          // COLOR_BTNTEXT
        msosyscolorGrayText,            // COLOR_GRAYTEXT
        msosyscolorInactiveCaption,     // COLOR_INACTIVECAPTION
        msosyscolorInactiveCaptionText, // COLOR_INACTIVECAPTIONTEXT
        msosyscolorInfoBackground,      // COLOR_INFOBK
        msosyscolorInfoText,            // COLOR_INFOTEXT
        msosyscolorMenuText,            // COLOR_MENUTEXT
        msosyscolorScrollbar,           // COLOR_SCROLLBAR
        msosyscolorWindow,              // COLOR_WINDOW
        msosyscolorWindowFrame,         // COLOR_WINDOWFRAME
        msosyscolor3DLight,             // COLOR_3DLIGHT
        msosyscolorMax,                 // Count of system colors

        msocolorFillColor =0xF0,  // Use the fillColor property
        msocolorLineOrFillColor,  // Use the line color only if there is a line
        msocolorLineColor,        // Use the lineColor property
        msocolorShadowColor,      // Use the shadow color
        msocolorThis,             // Use this color (only valid as described below)
        msocolorFillBackColor,    // Use the fillBackColor property
        msocolorLineBackColor,    // Use the lineBackColor property
        msocolorFillThenLine,     // Use the fillColor unless no fill and line
        msocolorIndexMask =0xFF,  // Extract the color index

        msocolorProcessMask      =0xFFFF00, // All the processing bits
        msocolorProcessShift =8,            // To extract the processing value
        msocolorModificationMask =0x0F00,   // Just the function
        msocolorModFlagMask      =0xF000,   // Just the additional flags
        msocolorDarken           =0x0100,   // Darken color by parameter/255
        msocolorLighten          =0x0200,   // Lighten color by parameter/255
        msocolorAdd              =0x0300,   // Add grey level RGB(param,param,param)
        msocolorSubtract         =0x0400,   // Subtract grey level RGB(p,p,p)
        msocolorReverseSubtract  =0x0500,   // Subtract from grey level RGB(p,p,p)
        /* In the following "black" means maximum component value, white minimum.
           The operation is per component, to guarantee white combine with
        msocolorGray */
        msocolorBlackWhite       =0x0600,   // Black if < uParam, else white (>=)
        msocolorInvert           =0x2000,   // Invert color (at the *end*)
        msocolorInvert128        =0x4000,   // Invert by toggling the top bit
        msocolorGray             =0x8000,   // Make the color gray (before the above!)
        msocolorBParamMask       =0xFF0000, // Parameter used as above
        msocolorBParamShift =16            // To extract the parameter value
}
MSOSYSCOLORINDEX;


/**
 * The type of the 'fill type' property (384) of all shapes.
 */
typedef enum
{
        msofillSolid,             // Fill with a solid color
        msofillPattern,           // Fill with a pattern (bitmap)
        msofillTexture,           // A texture (pattern with its own color map)
        msofillPicture,           // Center a picture in the shape
        msofillShade,             // Shade from start to end points
        msofillShadeCenter,       // Shade from bounding rectangle to end point
        msofillShadeShape,        // Shade from shape outline to end point
        msofillShadeScale,        // Similar to msofillShade, but the fillAngle
                                  // is additionally scaled by the aspect ratio of
                                  // the shape. If shape is square, it is the
                                  // same as msofillShade.
        msofillShadeTitle,        // special type - shade to title ---  for PP
        msofillBackground         // Use the background fill color/pattern
} MSOFILLTYPE;

/**
 * Type of the (out)line fill, from property 452.
 */
typedef enum
{
        msolineSolidType,         // Fill with a solid color (default)
        msolinePattern,           // Fill with a pattern (bitmap)
        msolineTexture,           // A texture (pattern with its own color map)
        msolinePicture            // Center a picture in the shape
} MSOLINETYPE;

/**
 * Type of the line-dashing style, from property 462.
 */
typedef enum
{
        msolineSolid,              // Solid (continuous) pen
        msolineDashSys,            // PS_DASH system   dash style
        msolineDotSys,             // PS_DOT system   dash style
        msolineDashDotSys,         // PS_DASHDOT system dash style
        msolineDashDotDotSys,      // PS_DASHDOTDOT system dash style
        msolineDotGEL,             // square dot style
        msolineDashGEL,            // dash style
        msolineLongDashGEL,        // long dash style
        msolineDashDotGEL,         // dash short dash
        msolineLongDashDotGEL,     // long dash short dash
        msolineLongDashDotDotGEL   // long dash short dash short dash
} MSOLINEDASHING;



/**
 * Line end effect type (type of arrow head). Used by properties
 * 'lineStartArrowhead' (464) and 'lineEndArrowhead' (465).
 */
typedef enum
{
        msolineNoEnd,
        msolineArrowEnd,
        msolineArrowStealthEnd,
        msolineArrowDiamondEnd,
        msolineArrowOvalEnd,
        msolineArrowOpenEnd
} MSOLINEEND;

/**
 * Width of an arrowhead. Used by properties
 * 'lineStartArrowWidth' (466) and 'lineEndArrowWidth' (468).
 */
typedef enum
{
        msolineNarrowArrow,
        msolineMediumWidthArrow,
        msolineWideArrow
} MSOLINEENDWIDTH;

/**
 * Length of an arrowhead. Used by properties
 * 'lineStartArrowLength' (467) and 'lineEndArrowLength' (469).
 */
typedef enum
{
        msolineShortArrow,
        msolineMediumLenArrow,
        msolineLongArrow
} MSOLINEENDLENGTH;

/**
 * How lines are joined drawing polygons for shapes.
 * Used by property 'lineJoinStyle' (470).
 */
typedef enum
{
        msolineJoinBevel,     // Join edges by a straight line
        msolineJoinMiter,     // Extend edges until they join
        msolineJoinRound      // Draw an arc between the two edges (default)
} MSOLINEJOIN;

/**
 * How lines are ended drawing polygons for shapes.
 * Used by property 'lineEndCapStyle' (471).
 * (applies to ends of dash segments too)
 */
typedef enum
{
        msolineEndCapRound,   // Rounded ends - the default
        msolineEndCapSquare,  // Square protrudes by half line width
        msolineEndCapFlat     // Line ends at end point (default)
} MSOLINECAP;



/**
 * Utility class, to read various items from a 'std::vector<uint8_t>'.
 */
class RawDataReader
{
        /** Contains the raw data to read from. */
        std::vector<uint8_t> const &data;
        /** The read-index in the raw data. */
        uint32_t index;

public:
        /** Constructor, setting index to 0. */
        RawDataReader(std::vector<uint8_t> const &_data)
        : data(_data), index(0) {}

        /** Constructor, also given an the index. */
        RawDataReader(std::vector<uint8_t> const &_data, uint32_t _index)
        : data(_data), index(_index) {}

        /** Reads 2 bytes (LSB) as one number. */
        uint16_t ReadU16();
        /** Reads 4 bytes (LSB) as a 16:16 floating point. */
        float Read16_16();

        /** Reads 4 bytes (LSB) as one number. */
        uint32_t ReadU32();

        /** Reads 4 bytes (LSB) as a color. */
        DrawLib::Pixel32 ReadColor();

        /** Returns the current index. */
        uint32_t GetIndex() const
        {
                return index;
        }

        /** Returns the amount of bytes left in the data. */
        uint32_t GetBytesLeft() const
        {
                return data.size() - index;
        }
};

/**
 * Represents and loads the content of property 'fillShadeColors' (407),
 * containing an array of colors, together with a
 * position, in 16:16 notation in [0.0 - 1.0].
 */
class IMsoColorsArray
{
        /** The number of point-position combinations in this array. */
        unsigned length;
        unsigned unknown1;
        unsigned unknown2;

        /** Represents a color, together with its position. */
        struct ColorAndPosition
        {
                /** The color. */
                DrawLib::Pixel32 color;
                /** The posdition, expected to be in [0.0 - 1.0]. */
                float position;

                /**
                 * Constructs this record, reading from raw data from the given position.
                 * It wil read the next 8 bytes.
                 * @param data A vector containing the raw data.
                 * @param index The index to read from.
                 */
                ColorAndPosition(RawDataReader &data);
        };
        /** Vector containing 'length' 'ColorAndPosition' objects. */
        std::vector<ColorAndPosition> color_and_positions;

public:
        /**
         * Constructs this record, reading from raw data.
         * @param data A vector containing the raw data.
         */
        IMsoColorsArray(std::vector<uint8_t> const &data);

        /**
         * Gets a shaded color.
         * @param i The position in [0.0 - 1.0].
         */
        DrawLib::Pixel32 GetShadedColor(float i) const;
};


/**
 * Represents and loads the content of property 'pVertices' (325),
 * containing an array of points (x and y, 2 bytes each).
 */
class IMsoVerticesArray
{
public:
        /**
         * Contains the vertices containing the raw data from the properties or
         * scaled and translated coordinates.
         */
        std::vector<DrawLib::FPPoint> vertices;

        /**
         * Constructs this record, reading from raw data.
         * @param data A vector containing the raw data.
         */
        IMsoVerticesArray(std::vector<uint8_t> const &data);

        /**
         * Translates and scales the points to relative positions in the
         * given box. So that the points within the box map to ([-1.0, 1.0], [-1.0, 1.0]).
         */
        void MakeRelativeToBox(
                float left, float top, float right, float bottom);
};


/**
 * Represents and loads the content of a property of type 'IMsoArray',
 * assumed to contain an array of points (x and y, 2 bytes each), and
 * stores it as an array of integer points.
 */
class IMsoArray
{
public:
        /**
         * Contains the points containing the raw data from the property.
         */
        std::vector<DrawLib::IPoint> points;

        /**
         * Constructs this record, reading from raw data.
         * @param data A vector containing the raw data.
         */
        IMsoArray(std::vector<uint8_t> const &data);

        /** Returns the number of points in this array. */
        unsigned GetLength() const
        {
                return points.size();
        }
};


/**
 * The class representing all properties, found in one escher-container,
 * like a 'ShapeContainer' or a 'DggContainer'.
 */
class Properties
{
        struct ShapeContainerBooleanPropertySetData;
public:
        /** Sums all property identifiers, found in the documentation. */
        enum PropertyID {
                // Transform:
                rotation = 4,                   /**< fixed point: 16.16 degrees */


                // Protection:
                fLockRotation = 119,            /**< No rotation */
                fLockAspectRatio,               /**< Don't allow changes in aspect ratio */
                fLockPosition,                  /**< Don't allow the shape to be moved */
                fLockAgainstSelect,             /**< Shape may not be selected */
                fLockCropping,                  /**< No cropping this shape */
                fLockVertices,                  /**< Edit Points not allowed */
                fLockText,                      /**< Do not edit text */
                fLockAdjustHandles,             /**< Do not adjust */
                fLockAgainstGrouping,           /**< Do not group this shape */


                // Text:
                lTxid = 128,                    /**< id for the text, value determined by the host */
                dxTextLeft,                     /**< margins relative to shape's inscribed text rectangle (in EMUs) */
                dyTextTop,
                dxTextRight,
                dyTextBottom,
                WrapText,                       /**< Wrap text at shape margins */
                scaleText,                      /**< Text zoom/scale (used if fFitTextToShape) */
                anchorText,                     /**< How to anchor the text */
                txflTextFlow,                   /**< Text flow */
                cdirFont,                       /**< Font rotation */
                hspNext,                        /**< ID of the next shape (used by Word for linked textboxes) */
                txdir,                          /**< Bi-Di Text direction */
                fSelectText = 187,              /**< TRUE if single click selects text, FALSE if two clicks */
                fAutoTextMargin,                /**< use host's margin calculations */
                fRotateText,                    /**< Rotate text with shape */
                fFitShapeToText,                /**< Size shape to fit text size */
                fFitTextToShape,                /**< Size text to fit shape size */


                // GeoText:
                gtextUNICODE = 192,             /**< UNICODE text string */
                gtextRTF,                       /**< RTF text string */
                gtextAlign,                     /**< alignment on curve */
                gtextSize,                      /**< default point size */
                gtextSpacing,                   /**< fixed point 16.16 */
                gtextFont,                      /**< font family name */
                gtextFReverseRows = 240,        /**< Reverse row order */
                fGtext,                         /**< Has text effect */
                gtextFVertical,                 /**< Rotate characters */
                gtextFKern,                     /**< Kern characters */
                gtextFTight,                    /**< Tightening or tracking */
                gtextFStretch,                  /**< Stretch to fit shape */
                gtextFShrinkFit,                /**< Char bounding box */
                gtextFBestFit,                  /**< Scale text-on-path */
                gtextFNormalize,                /**< Stretch char height */
                gtextFDxMeasure,                /**< Do not measure along path */
                gtextFBold,                     /**< Bold font */
                gtextFItalic,                   /**< Italic font */
                gtextFUnderline,                /**< Underline font */
                gtextFShadow,                   /**< Shadow font */
                gtextFSmallcaps,                /**< Small caps font */
                gtextFStrikethrough,            /**< Strike through font */


                // Blip:
                cropFromTop = 256,              /**< 16.16 fraction times total image width or height, as appropriate. */
                cropFromBottom,
                cropFromLeft,
                cropFromRight,
                pib,                            /**< Blip to display */
                pibName,                        /**< Blip file name */
                pibFlags,                       /**< Blip flags */
                pictureTransparent,             /**< transparent color (none if ~0UL) */
                pictureContrast,                /**< contrast setting */
                pictureBrightness,              /**< brightness setting */
                pictureGamma,                   /**< 16.16 gamma */
                pictureId,                      /**< Host-defined ID for OLE objects (usually a pointer) */
                pictureDblCrMod,                /**< Modification used if shape has double shadow */
                pictureFillCrMod,
                pictureLineCrMod,
                pibPrint,                       /**< Blip to display when printing */
                pibPrintName,                   /**< Blip file name */
                pibPrintFlags,                  /**< Blip flags */
                fNoHitTestPicture = 316,        /**< Do not hit test the picture */
                pictureGray,                    /**< grayscale display */
                pictureBiLevel,                 /**< bi-level display */
                pictureActive,                  /**< Server is active (OLE objects only) */


                // Geometry:
                geoLeft = 320,                  /**< Defines the G (geometry) coordinate space. */
                geoTop,
                geoRight,
                geoBottom,
                shapePath,
                pVertices,                      /**< An array of points, in G units. */
                pSegmentInfo,
                adjustValue,                    /**< Adjustment values corresponding to the positions of */
                adjust2Value,                   /**< the adjust handles of the. */
                adjust3Value,                   /**< The number of values used and their allowable ranges */
                adjust4Value,                   /**< vary from shape type to shape type. */
                adjust5Value,
                adjust6Value,
                adjust7Value,
                adjust8Value,
                adjust9Value,
                adjust10Value,
                fShadowOK = 378,                /**< TRUE Shadow may be set */
                f3DOK,                          /**< 3D may be set */
                fLineOK,                        /**< Line style may be set */
                fGtextOK,                       /**< Text effect (WordArt) supported */
                fFillShadeShapeOK,
                fFillOK,                        /**< OK to fill the shape through the UI or VBA? */


                // Fill Style:
                fillType = 384,                 /**< Type of fill */
                fillColor,                      /**< Foreground color */
                fillOpacity,                    /**< Fixed 16.16 */
                fillBackColor,                  /**< Background color */
                fillBackOpacity,                /**< Shades only */
                fillCrMod,                      /**< Modification for BW views */
                fillBlip,                       /**< Pattern/texture */
                fillBlipName,                   /**< Blip file name */
                fillBlipFlags,                  /**< Blip flags */
                fillWidth,                      /**< How big (A units) to make a metafile texture. */
                fillHeight,
                fillAngle,                      /**< Fade angle - degrees in 16.16 */
                fillFocus,                      /**< Linear shaded fill focus percent */
                fillToLeft,                     /**< Fraction 16.16 */
                fillToTop,                      /**< Fraction 16.16 */
                fillToRight,                    /**< Fraction 16.16 */
                fillToBottom,                   /**< Fraction 16.16 */
                fillRectLeft,                   /**< For shaded fills, use the specified */
                fillRectTop,                    /**< rectangle instead of the shape's bounding */
                fillRectRight,                  /**< rect to define how large the fade is going to be. */
                fillRectBottom,
                fillDztype,
                fillShadePreset,                /**< Special shades */
                fillShadeColors,                /**< a preset array of colors */
                fillOriginX,
                fillOriginY,
                fillShapeOriginX,
                fillShapeOriginY,
                fillShadeType,                  /**< Type of shading, if a shaded (gradient) fill. */
                fFilled = 443,                  /**< Is shape filled? */
                fHitTestFill,                   /**< Should we hit test fill? */
                fillShape,                      /**< Register pattern on shape */
                fillUseRect,                    /**< Use the large rect? */
                fNoFillHitTest,                 /**< Hit test a shape as though filled */


                // Line Style:
                lineColor = 448,                /**< Color of line */
                lineOpacity,                    /**< Not implemented */
                lineBackColor,                  /**< Background color */
                lineCrMod,                      /**< Modification for BW views */
                lineType,                       /**< Type of line */
                lineFillBlip,                   /**< Pattern/texture */
                lineFillBlipName,               /**< Blip file name */
                lineFillBlipFlags,              /**< Blip flags */
                lineFillWidth,                  /**< How big (A units) to make a metafile texture. */
                lineFillHeight,
                lineFillDztype,                 /**< How to interpret fillWidth/Height numbers. */
                lineWidth,                      /**< A units; 1pt == 12700 EMUs */
                lineMiterLimit,                 /**< ratio (16.16) of width */
                lineStyle,                      /**< Draw parallel lines? */
                lineDashing,                    /**< Can be overridden by: */
                lineDashStyle,                  /**< As Win32 ExtCreatePen */
                lineStartArrowhead,             /**< Arrow at start */
                lineEndArrowhead,               /**< Arrow at end */
                lineStartArrowWidth,            /**< Arrow at start */
                lineStartArrowLength,           /**< Arrow at end */
                lineEndArrowWidth,              /**< Arrow at start */
                lineEndArrowLength,             /**< Arrow at end */
                lineJoinStyle,                  /**< How to join lines */
                lineEndCapStyle,                /**< How to end lines */
                fArrowheadsOK = 507,            /**< Allow arrowheads if prop. is set */
                fLine,                          /**< Any line? */
                fHitTestLine,                   /**< Should we hit test lines? */
                lineFillShape,                  /**< Register pattern on shape */
                fNoLineDrawDash,                /**< Draw a dashed line if no line */


                // Shadow Style:
                shadowType = 512,               /**< Type of effect */
                shadowColor,                    /**< Foreground color */
                shadowHighlight,                /**< Embossed color */
                shadowCrMod,                    /**< Modification for BW views */
                shadowOpacity,                  /**< Fixed 16.16 */
                shadowOffsetX,                  /**< Offset shadow */
                shadowOffsetY,                  /**< Offset shadow */
                shadowSecondOffsetX,            /**< Double offset shadow */
                shadowSecondOffsetY,            /**< Double offset shadow */
                shadowScaleXToX,                /**< 16.16 */
                shadowScaleYToX,                /**< 16.16 */
                shadowScaleXToY,                /**< 16.16 */
                shadowScaleYToY,                /**< 16.16 */
                shadowPerspectiveX,             /**< 16.16 / weight */
                shadowPerspectiveY,             /**< 16.16 / weight */
                shadowWeight,                   /**< scaling factor */
                shadowOriginX,
                shadowOriginY,
                fShadow = 574,                  /**< Any shadow? */
                fshadowObscured,                /**< Excel5-style shadow */


                // Perspective Style:
                perspectiveType = 576,          /**< Where transform applies */
                perspectiveOffsetX,             /**< The LONG values define a transformation matrix, */
                perspectiveOffsetY,             /**< effectively, each value is scaled by the perspectiveWeight parameter. */
                perspectiveScaleXToX,
                perspectiveScaleYToX,
                perspectiveScaleXToY,
                perspectiveScaleYToY,
                perspectivePerspectiveX,
                perspectivePerspectiveY,
                perspectiveWeight,              /**< Scaling factor */
                perspectiveOriginX,
                perspectiveOriginY,
                fPerspective = 639,             /**< On/off */


                // 3D Object:
                c3DSpecularAmt = 640,           /**< Fixed-point 16.16 */
                c3DDiffuseAmt,                  /**< Fixed-point 16.16 */
                c3DShininess,                   /**< Default gives OK results */
                c3DEdgeThickness,               /**< Specular edge thickness */
                c3DExtrudeForward,              /**< Distance of extrusion in EMUs */
                c3DExtrudeBackward,
                c3DExtrudePlane,                /**< Extrusion direction */
                c3DExtrusionColor,              /**< Basic color of extruded part of shape; the lighting model used will determine the exact shades used when rendering. */
                c3DCrMod,                       /**< Modification for BW views */
                f3D = 700,                      /**< Does this shape have a 3D effect? */
                fc3DMetallic,                   /**< Use metallic specularity? */
                fc3DUseExtrusionColor,
                fc3DLightFace,


                // 3D Style:
                c3DYRotationAngle = 704,        /**< degrees (16.16) about y axis */
                c3DXRotationAngle,              /**< degrees (16.16) about x axis */
                c3DRotationAxisX,               /**< These specify the rotation axis; only their relative magnitudes matter. */
                c3DRotationAxisY,
                c3DRotationAxisZ,
                c3DRotationAngle,               /**< degrees (16.16) about axis */
                c3DRotationCenterX,             /**< rotation center x (16.16 or g-units) */
                c3DRotationCenterY,             /**< rotation center y (16.16 or g-units) */
                c3DRotationCenterZ,             /**< rotation center z (absolute (emus)) */
                c3DRenderMode,                  /**< Full,wireframe, or bcube */
                c3DTolerance,                   /**< pixels (16.16) */
                c3DXViewpoint,                  /**< X view point (emus) */
                c3DYViewpoint,                  /**< Y view point (emus) */
                c3DZViewpoint,                  /**< Z view distance (emus) */
                c3DOriginX,
                c3DOriginY,
                c3DSkewAngle,                   /**< degree (16.16) skew angle */
                c3DSkewAmount,                  /**< Percentage skew amount */
                c3DAmbientIntensity,            /**< Fixed point intensity */
                c3DKeyX,                        /**< Key light source direc- */
                c3DKeyY,                        /**< tion; only their relative */
                c3DKeyZ,                        /**< magnitudes matter */
                c3DKeyIntensity,                /**< Fixed point intensity */
                c3DFillX,                       /**< Fill light source direc- */
                c3DFillY,                       /**< tion; only their relative */
                c3DFillZ,                       /**< magnitudes matter */
                c3DFillIntensity,               /**< Fixed point intensity */
                fc3DConstrainRotation = 763,
                fc3DRotationCenterAuto,
                fc3DParallel,                   /**< Parallel projection? */
                fc3DKeyHarsh,                   /**< Is key lighting harsh? */
                fc3DFillHarsh,                  /**< Is fill lighting harsh? */


                // Shape:
                hspMaster = 769,                /**< master shape */
                cxstyle = 771,                  /**< Type of connector */
                bWMode,                         /**<  Settings for modifications to be made when in different forms of black-and-white mode. */
                bWModePureBW,
                bWModeBW,
                fOleIcon = 826,                 /**< For OLE objects, whether the object is in icon form */
                fPreferRelativeResize,          /**< For UI only. Prefer relative resizing. */
                fLockShapeType,                 /**< Lock the shape type (don't allow Change Shape) */
                fDeleteAttachedObject = 830,
                fBackground,                    /**< If TRUE, this is the background shape. */


                // Callout:
                spcot = 832,                    /**< Callout type */
                dxyCalloutGap,                  /**< Distance from box to first point.(EMUs) */
                spcoa,                          /**< Callout angle */
                spcod,                          /**< Callout drop type */
                dxyCalloutDropSpecified,        /**< if msospcodSpecified, the actual drop distance */
                dxyCalloutLengthSpecified,      /**< if fCalloutLengthSpecified, the actual distance */
                fCallout = 889,                 /**< Is the shape a callout? */
                fCalloutAccentBar,              /**< does callout have accent bar */
                fCalloutTextBorder,             /**< does callout have a text border */
                fCalloutMinusX,
                fCalloutMinusY,
                fCalloutDropAuto,               /**< If true, then we occasionally invert the drop distance */
                fCalloutLengthSpecified,        /**< if true, we look at dxyCalloutLengthSpecified */


                // Group Shape:
                wzName = 896,                   /**< Shape Name (present only if explicitly set) */
                wzDescription,                  /**< alternate text */
                pihlShape,                      /**< The hyperlink in the shape. */
                pWrapPolygonVertices,           /**< The polygon that text will be wrapped around (Word) */
                dxWrapDistLeft,                 /**< Left wrapping distance from text (Word) */
                dyWrapDistTop,                  /**< Top wrapping distance from text (Word) */
                dxWrapDistRight,                /**< Right wrapping distance from text (Word) */
                dyWrapDistBottom,               /**< Bottom wrapping distance from text (Word) */
                lidRegroup,                     /**< Regroup ID */
                fEditedWrap = 953,              /**< Has the wrap polygon been edited? */
                fBehindDocument,                /**< Word-only (shape is behind text) */
                fOnDblClickNotify,              /**< Notify client on a double click */
                fIsButton,                      /**< A button shape (i.e., clicking performs an action). Set for shapes with attached hyperlinks or macros. */
                fOneD,                          /**< 1D adjustment */
                fHidden,                        /**< Do not display */
                fPrint                          /**< Print this shape */
        };

private:
        /** All combined-boolean properties values, one per property set. */
        uint16_t boolean_property_set_values[NUM_PROPERTY_SETS];
        /** Indicate of all boolean properties values, one per property set, if
            the corresponding bit is set and thus not a default value. */
        uint16_t boolean_property_set_set   [NUM_PROPERTY_SETS];

        /** Represents a single property value. */
        struct Property
        {
                enum Types
                {
                        Normal,
                        Blip,
                        Complex
                };

                Types type;
                uint32_t value;           //if type==Normal, propertie's value. if type==Blip, blip id
                std::vector<uint8_t> complex;  //the complex data itself

                bool is_default;

                /**
                 * Normal constructor.
                 */
                Property()
                : is_default(false)
                {
                }
                /**
                 * Constructor. Only use to create a default property!
                 */
                Property(Types _type, uint32_t _value)
                : type (_type )
                , value(_value)
                , is_default(true)
                {
                }
        };

        /** All other properties. */
        typedef std::map<PropertyID,Property> PropertyMap;
        PropertyMap properties;

        //SchemeColors const *schemeColors;

public:
        /**
         * Creates a Properties object, containing pure default property values.
         */
         Properties(EscherDocument const* document);
        /** Simple destructor. */
        ~Properties();

/*        void SetSchemeColors(SchemeColors const *_schemeColors)
        {
                schemeColors = _schemeColors;
        }
*/
        PropertyMap const & GetProperties() const
        {
                return properties;
        }

private:
        void InsertNormalDefault(PropertyID PID, uint32_t value)
        {
                properties[PID] = Property(Property::Normal, value);
        }

public:
        /**
         * Parses the raw property data and stores the values, overwriting the default values.
         *
         * @param data A pointer into the raw properties data.
         * @param length The total length of the property data.
         */
        void ProcessData(Blex::RandomStream &props);

        /**
         * Read the properties which are colors, evaluates their dependicies and
         * stores them in field 'colors'.
         */
        DrawLib::Pixel32 GetColor(PropertyID PID, SchemeColors const *schemeColors) const;
private:
        /**
         * Read the properties which are combined-booleans, overwrites the default values and
         * stores them in field 'boolean_property_set_values'. It stores what bits are
         * overridden in 'boolean_property_set_set'.
         */
        void EvaluateBooleans();

        /**
         * Internal funtion to get a property.
         * @return The property, or NULL if not found.
         */
        Property const * GetAsProperty(PropertyID PID) const;

public:
        /**
         * Retrieves a property with the given PID.
         *
         * @param PID The PID of the property.
         * May not be one of a color type property.
         * @param is_default_value When not NULL, this boolean gets overwritten.
         * In this case it is set to TRUE if and only if the property was not found
         * in the list of properties parsed by this object and thus still contains
         * the default value.
         * @return The (raw) value of the property.
         */
        uint32_t Get(PropertyID PID, bool *is_default_value = NULL) const;

        /**
         * Retrieves a property with the given PID.
         *
         * @param PID The PID of the property. Should be one of a EMU type property.
         * May not be one of a color type property.
         * @param defaultvalue Value to return if this property does not exist
         * @return The value of the property interpeted as EMUs in pixel units.
         */
        float GetAsPixelsFromEMUs(PropertyID PID, float defaultvalue) const;

        /**
         * Retrieves a property with the given PID.
         *
         * @param PID The PID of the property. Should be one of a 16:16 type property.
         * May not be one of a color type property.
         * @param is_default_value When not NULL, this boolean gets overwritten.
         * In this case it is set to TRUE if and only if the property was not found
         * in the list of properties parsed by this object and thus still contains
         * the default value.
         * @return The value of the property interpeted as 16:16 as float.
         */
        float GetAsFloatFrom16_16(PropertyID PID, float defaultvalue) const;

        /**
         * Retrieves a property with the given PID.
         *
         * @param PID The PID of the property. Must be one of a boolean type property.
         * @param is_default_value When not NULL, this boolean gets overwritten.
         * In this case it is set to TRUE if and only if the property was not found
         * in the list of properties parsed by this object and thus still contains
         * the default value.
         * @return The value of the boolean, read from a combined-booleans property value.
         */
        bool GetAsBoolean(PropertyID PID, bool *is_default_value = NULL) const;

        /**
         * Retrieves a property with the given PID.
         *
         * @param PID The PID of the property. Must be one of a complex type property.
         * May not be one of a color type property.
         * @return A copy of the complex data of the property.
         */
        std::vector<uint8_t> GetComplex(PropertyID PID) const;

        /**
         * Retrieves a BLIP pointed to by the property (from 'properties')
         * with the given identifier. It is used by the shape-type-specific
         * implementation classes, subclass of 'EscherShape'.
         *
         * @param PID The identifier of the property.
         * @return The BLIP or NULL of none found.
         */
        msoBlip const * GetPropertyAsBlip(int PID) const;
public:
        void Dump(std::string indent_string, std::ostream &output) const;
private:
        int PropertyToText(std::ostream &output, PropertyID id) const;

        /** To get the inherited master property */
        EscherDocument const* document;
};

} //end namespace Escher
} //end namespace Office
} //end namespace Parsers


#endif
