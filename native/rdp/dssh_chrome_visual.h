#pragma once
#include "dssh_chrome_palette.h"

// The outlined glyphs share the 24px coordinate system of src/ui/Icon.tsx.
// Native controls retain native accessibility and input; only drawing changes.
enum DsshChromeGlyph {
    DSSH_GLYPH_MINIMIZE, DSSH_GLYPH_MAXIMIZE, DSSH_GLYPH_RESTORE,
    DSSH_GLYPH_EXPAND, DSSH_GLYPH_COLLAPSE, DSSH_GLYPH_CLOSE,
    DSSH_GLYPH_GRIP, DSSH_GLYPH_MONITOR
};
typedef void (*DsshChromeLine)(void*, float, float, float, float);
static inline void dssh_chrome_glyph(int glyph, DsshChromeLine line, void* context)
{
#define L(a,b,c,d) line(context,a,b,c,d)
    switch (glyph) {
        case DSSH_GLYPH_MINIMIZE: L(6,12,18,12); break;
        case DSSH_GLYPH_MAXIMIZE:
            L(5.5f,5.5f,18.5f,5.5f); L(18.5f,5.5f,18.5f,18.5f);
            L(18.5f,18.5f,5.5f,18.5f); L(5.5f,18.5f,5.5f,5.5f); break;
        case DSSH_GLYPH_RESTORE:
            L(5,9,15,9); L(15,9,15,19); L(15,19,5,19); L(5,19,5,9);
            L(9,9,9,5); L(9,5,19,5); L(19,5,19,15); L(19,15,15,15); break;
        case DSSH_GLYPH_EXPAND:
            L(9,4,4,4); L(4,4,4,9); L(15,4,20,4); L(20,4,20,9);
            L(4,15,4,20); L(4,20,9,20); L(20,15,20,20); L(20,20,15,20); break;
        case DSSH_GLYPH_COLLAPSE:
            L(4,9,9,9); L(9,9,9,4); L(15,4,15,9); L(15,9,20,9);
            L(4,15,9,15); L(9,15,9,20); L(15,20,15,15); L(15,15,20,15); break;
        case DSSH_GLYPH_CLOSE: L(6,6,18,18); L(18,6,6,18); break;
        case DSSH_GLYPH_GRIP:
            L(8,5,8,6); L(16,5,16,6); L(8,11.5f,8,12.5f);
            L(16,11.5f,16,12.5f); L(8,18,8,19); L(16,18,16,19); break;
        case DSSH_GLYPH_MONITOR:
            L(3,4,21,4); L(21,4,21,16); L(21,16,3,16); L(3,16,3,4);
            L(12,16,12,20); L(8,20,16,20); break;
    }
#undef L
}
