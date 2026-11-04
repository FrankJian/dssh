#import <AppKit/AppKit.h>
#include "dssh_chrome.h"
#include "dssh_visibility_state.h"
#include "dssh_chrome_visual.h"
#ifdef DSSH_CHROME_TESTING
#include <stdlib.h>
#include <string.h>
#endif

static DsshChromePalette chromePalette(void)
{
#ifdef DSSH_CHROME_TESTING
    const char* theme = getenv("DSSH_RDP_CHROME_THEME");
    if (theme) return strcmp(theme, "light") == 0 ? dssh_chrome_light : dssh_chrome_dark;
#endif
    return SDL_GetSystemTheme() == SDL_SYSTEM_THEME_LIGHT ? dssh_chrome_light : dssh_chrome_dark;
}
static NSColor* chromeColor(unsigned rgb)
{
    return [NSColor colorWithSRGBRed:((rgb >> 16) & 255) / 255.0
        green:((rgb >> 8) & 255) / 255.0 blue:(rgb & 255) / 255.0 alpha:1];
}
typedef struct ChromeDrawing { __unsafe_unretained NSBezierPath* path; NSRect rect; } ChromeDrawing;
static void chromeLine(void* context, float x1, float y1, float x2, float y2)
{
    ChromeDrawing* draw = context;
    [draw->path moveToPoint:NSMakePoint(draw->rect.origin.x + x1 * draw->rect.size.width / 24,
        NSMaxY(draw->rect) - y1 * draw->rect.size.height / 24)];
    [draw->path lineToPoint:NSMakePoint(draw->rect.origin.x + x2 * draw->rect.size.width / 24,
        NSMaxY(draw->rect) - y2 * draw->rect.size.height / 24)];
}
static void drawGlyph(int glyph, NSRect rect, NSColor* color)
{
    NSBezierPath* path = [NSBezierPath bezierPath];
    path.lineWidth = 1.35;
    path.lineCapStyle = NSLineCapStyleRound;
    path.lineJoinStyle = NSLineJoinStyleRound;
    ChromeDrawing drawing = {path, rect};
    dssh_chrome_glyph(glyph, chromeLine, &drawing);
    [color setStroke]; [path stroke];
}

@interface DsshBarButton : NSButton
@property(nonatomic, assign) int glyph;
@property(nonatomic, assign) BOOL hovered;
@property(nonatomic, strong) NSTrackingArea* hoverArea;
@end
@implementation DsshBarButton
- (void)updateTrackingAreas
{
    if (self.hoverArea) [self removeTrackingArea:self.hoverArea];
    self.hoverArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect
        options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect owner:self userInfo:nil];
    [self addTrackingArea:self.hoverArea]; [super updateTrackingAreas];
}
- (void)mouseEntered:(NSEvent*)event { (void)event; self.hovered = YES; self.needsDisplay = YES; }
- (void)mouseExited:(NSEvent*)event { (void)event; self.hovered = NO; self.needsDisplay = YES; }
- (void)drawRect:(NSRect)dirty
{
    (void)dirty;
    const DsshChromePalette p = chromePalette();
    const BOOL hot = self.hovered || self.highlighted;
    const BOOL close = self.tag == DSSH_CHROME_CLOSE;
    NSBezierPath* shape = [NSBezierPath bezierPathWithRoundedRect:NSInsetRect(self.bounds, 1, 1) xRadius:4 yRadius:4];
    if (hot) { [chromeColor(close ? p.dangerHover : (self.highlighted ? p.pressed : p.hover)) setFill]; [shape fill]; }
    if (self.window.firstResponder == self) { [chromeColor(p.accent) setStroke]; shape.lineWidth = 1; [shape stroke]; }
    drawGlyph(self.glyph, NSMakeRect(NSMidX(self.bounds) - 9, NSMidY(self.bounds) - 9, 18, 18),
        chromeColor(close ? (hot ? p.onAccent : p.danger) : p.text));
}
@end

@interface DsshConnectionBar : NSObject
@property(nonatomic, assign) SDL_Window* desktop;
@property(nonatomic, weak) NSWindow* owner;
@property(nonatomic, strong) NSPanel* panel;
@property(nonatomic, strong) NSTextField* title;
@property(nonatomic, strong) NSArray<DsshBarButton*>* buttons;
@property(nonatomic, assign) DsshChromeReveal reveal;
@property(nonatomic, assign) DsshChromePosition position;
@property(nonatomic, assign) BOOL dragging;
@property(nonatomic, assign) NSPoint grab;
- (void)beginDragAt:(NSPoint)mouse;
- (void)dragTo:(NSPoint)mouse;
- (void)endDrag;
- (void)tick:(NSTimer*)timer;
- (void)layout;
- (void)action:(NSButton*)sender;
@end

// Buttons retain their own hit testing; the title and background drag the bar.
@interface DsshBarTitle : NSTextField
@end
@implementation DsshBarTitle
- (NSView*)hitTest:(NSPoint)point { (void)point; return nil; }
@end

@interface DsshBarSurface : NSView
@property(nonatomic, weak) DsshConnectionBar* bar;
@end
@implementation DsshBarSurface
- (void)drawRect:(NSRect)dirty
{
    (void)dirty;
    const DsshChromePalette p = chromePalette();
    NSBezierPath* shape = [NSBezierPath bezierPathWithRoundedRect:NSInsetRect(self.bounds, 0.5, 0.5) xRadius:5 yRadius:5];
    [chromeColor(p.surface) setFill]; [shape fill];
    [chromeColor(p.border) setStroke]; shape.lineWidth = 1; [shape stroke];
    drawGlyph(DSSH_GLYPH_GRIP, NSMakeRect(6, NSMidY(self.bounds) - 8, 12, 16), chromeColor(p.muted));
    drawGlyph(DSSH_GLYPH_MONITOR, NSMakeRect(26, NSMidY(self.bounds) - 8, 16, 16), chromeColor(p.accent));
    const CGFloat separator = NSMaxX(self.bounds) - 153;
    [chromeColor(p.border) setFill]; NSRectFill(NSMakeRect(separator, 11, 1, self.bounds.size.height - 22));
}
- (void)mouseDown:(NSEvent*)event { [self.bar beginDragAt:[self.window convertPointToScreen:event.locationInWindow]]; }
- (void)mouseDragged:(NSEvent*)event { [self.bar dragTo:[self.window convertPointToScreen:event.locationInWindow]]; }
- (void)mouseUp:(NSEvent*)event { (void)event; [self.bar endDrag]; }
@end

@implementation DsshConnectionBar
- (void)beginDragAt:(NSPoint)mouse
{
    if (dssh_desktop_locked()) return;
    self.grab = NSMakePoint(mouse.x - NSMinX(self.panel.frame), NSMaxY(self.panel.frame) - mouse.y);
    self.dragging = YES;
}
- (void)dragTo:(NSPoint)mouse
{
    if (!self.dragging || dssh_desktop_locked()) return;
    NSRect content = [self.owner convertRectToScreen:[self.owner.contentView convertRect:self.owner.contentView.bounds toView:nil]];
    DsshChromePosition position = self.position;
    dssh_chrome_move(&position, mouse.x - self.grab.x - NSMinX(content),
        NSMaxY(content) - mouse.y - self.grab.y,
        content.size.width - self.panel.frame.size.width, content.size.height - self.panel.frame.size.height);
    self.position = position;
    [self tick:nil];
}
- (void)endDrag
{
    self.dragging = NO;
}

- (void)action:(NSButton*)sender
{
    dssh_chrome_action(self.desktop, (int)sender.tag);
    [self.owner makeKeyWindow];
}
- (void)tick:(NSTimer*)timer
{
    (void)timer;
    NSWindow* owner = self.owner;
    if (!owner) { [self.panel orderOut:nil]; return; }
    NSRect content = [owner convertRectToScreen:[owner.contentView convertRect:owner.contentView.bounds toView:nil]];
    const CGFloat width = MAX(1, MIN(440, content.size.width - 16));
    SDL_FRect local = dssh_chrome_frame(self.position, content.size.width, content.size.height, width, 40);
    NSRect frame = NSMakeRect(NSMinX(content) + local.x, NSMaxY(content) - local.y - local.h, local.w, local.h);
    NSPoint mouse = [NSEvent mouseLocation];
    const BOOL active = owner.visible && !owner.miniaturized && NSApp.active;
    if (!active) {
        [self endDrag];
        for (DsshBarButton* button in self.buttons) button.hovered = NO;
    }
    const BOOL atEdge = mouse.x >= NSMinX(content) && mouse.x < NSMaxX(content) &&
        mouse.y <= NSMaxY(content) && mouse.y >= NSMaxY(content) - 4;
    DsshChromeReveal state = self.reveal;
    BOOL visible = dssh_chrome_reveal(&state, active, atEdge || self.dragging, NSPointInRect(mouse, frame), SDL_GetTicks());
#ifdef DSSH_CHROME_TESTING
    // The test-only preview pins the controls for visual/accessibility review.
    // Production visibility always follows the pointer and foreground state.
    if (getenv("DSSH_RDP_CHROME_PREVIEW_PIN")) visible = YES;
#endif
    self.reveal = state;
    if (!visible) { [self.panel orderOut:nil]; return; }
    [self.panel setFrame:frame display:YES];
    [self layout];
    [self.panel orderFront:nil];
}
- (void)layout
{
    const CGFloat width = self.panel.contentView.bounds.size.width;
    const CGFloat buttonWidth = MIN(32, MAX(1, (width - 16) / 4));
    const CGFloat start = width - buttonWidth * 4 - 18;
    self.title.frame = NSMakeRect(50, 12, MAX(0, start - 62), 16);
    self.title.textColor = chromeColor(chromePalette().text);
    for (NSUInteger index = 0; index < self.buttons.count; index++)
        self.buttons[index].frame = NSMakeRect(start + index * (buttonWidth + 2) + (index == 3 ? 4 : 0), 4, buttonWidth, 32);
    const SDL_WindowFlags flags = SDL_GetWindowFlags(self.desktop);
    self.buttons[1].title = (flags & (SDL_WINDOW_FULLSCREEN | SDL_WINDOW_MAXIMIZED)) ? @"还原" : @"最大化";
    self.buttons[2].title = (flags & SDL_WINDOW_FULLSCREEN) ? @"退出全屏" : @"全屏";
    self.buttons[1].glyph = (flags & (SDL_WINDOW_FULLSCREEN | SDL_WINDOW_MAXIMIZED)) ? DSSH_GLYPH_RESTORE : DSSH_GLYPH_MAXIMIZE;
    self.buttons[2].glyph = (flags & SDL_WINDOW_FULLSCREEN) ? DSSH_GLYPH_COLLAPSE : DSSH_GLYPH_EXPAND;
    for (DsshBarButton* button in self.buttons) {
        button.toolTip = button.title; button.accessibilityLabel = button.title; button.needsDisplay = YES;
    }
    self.panel.contentView.needsDisplay = YES;
}
@end

static NSMutableDictionary<NSNumber*, DsshConnectionBar*>* bars;

void dssh_chrome_attach(SDL_Window* window)
{
    if (!window) return;
    @autoreleasepool {
        if (!bars) bars = [NSMutableDictionary dictionary];
        NSNumber* key = @(SDL_GetWindowID(window));
        if (bars[key]) return;
        NSWindow* owner = (__bridge NSWindow*)SDL_GetPointerProperty(SDL_GetWindowProperties(window), SDL_PROP_WINDOW_COCOA_WINDOW_POINTER, NULL);
        if (!owner) return;
        DsshConnectionBar* bar = [[DsshConnectionBar alloc] init];
        bar.desktop = window; bar.owner = owner;
        bar.position = (DsshChromePosition){0.5f, 0};
        bar.panel = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 440, 40)
            styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
            backing:NSBackingStoreBuffered defer:NO];
        DsshBarSurface* surface = [[DsshBarSurface alloc] initWithFrame:NSMakeRect(0, 0, 440, 40)];
        surface.bar = bar;
        bar.panel.contentView = surface;
        bar.panel.title = @"远程桌面控制栏";
        bar.panel.level = NSFloatingWindowLevel;
        bar.panel.collectionBehavior = NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorCanJoinAllSpaces;
        bar.panel.hasShadow = NO;
        bar.panel.releasedWhenClosed = NO;
        bar.panel.opaque = NO;
        bar.panel.backgroundColor = NSColor.clearColor;
        bar.panel.animationBehavior = NSWindowAnimationBehaviorNone;
        const char* title = SDL_GetWindowTitle(window);
        bar.title = [DsshBarTitle labelWithString:title ? [NSString stringWithUTF8String:title] : @"Duo SSH"];
        bar.title.font = [NSFont systemFontOfSize:12 weight:NSFontWeightMedium];
        bar.title.toolTip = bar.title.stringValue;
        surface.toolTip = @"拖动以移动控制栏";
        bar.title.lineBreakMode = NSLineBreakByTruncatingTail;
        [bar.panel.contentView addSubview:bar.title];
        NSMutableArray* buttons = [NSMutableArray array];
        NSArray* labels = @[@"最小化", @"最大化", @"全屏", @"关闭"];
        for (NSUInteger index = 0; index < labels.count; index++) {
            DsshBarButton* button = [DsshBarButton buttonWithTitle:labels[index] target:bar action:@selector(action:)];
            button.tag = DSSH_CHROME_MINIMIZE + index;
            button.bordered = NO;
            button.focusRingType = NSFocusRingTypeNone;
            const int glyphs[] = {DSSH_GLYPH_MINIMIZE, DSSH_GLYPH_MAXIMIZE, DSSH_GLYPH_EXPAND, DSSH_GLYPH_CLOSE};
            button.glyph = glyphs[index];
            button.toolTip = labels[index];
            button.font = [NSFont systemFontOfSize:11];
            button.accessibilityLabel = labels[index];
            [bar.panel.contentView addSubview:button];
            [buttons addObject:button];
        }
        bar.buttons = buttons;
        [owner addChildWindow:bar.panel ordered:NSWindowAbove];
        [bar.panel orderOut:nil];
        bars[key] = bar;
    }
}

void dssh_chrome_detach(SDL_Window* window)
{
    if (!window) return;
    @autoreleasepool {
        NSNumber* key = @(SDL_GetWindowID(window));
        DsshConnectionBar* bar = bars[key];
        if (!bar) return;
        [bar.owner removeChildWindow:bar.panel];
        [bar.panel orderOut:nil];
        [bar.panel close];
        [bars removeObjectForKey:key];
    }
}

void dssh_chrome_tick(void)
{
    static Uint64 previous = 0;
    const Uint64 now = SDL_GetTicks();
    if (now - previous < 50) return;
    previous = now;
    @autoreleasepool {
        for (DsshConnectionBar* bar in bars.allValues) [bar tick:nil];
    }
}

void dssh_chrome_hide_all(void)
{
    for (DsshConnectionBar* bar in bars.allValues) {
        DsshChromeReveal reveal = bar.reveal;
        reveal.visible = false;
        [bar endDrag];
        bar.reveal = reveal;
        [bar.panel orderOut:nil];
    }
}

bool dssh_chrome_set_locked(bool locked)
{
    static BOOL suspended = NO;
    static NSApplicationActivationPolicy original;
    if (locked) {
        if (!suspended) {
            original = NSApp.activationPolicy;
            suspended = YES;
        }
        if (!NSApp.hidden) [NSApp hide:nil];
        if (NSApp.activationPolicy != NSApplicationActivationPolicyProhibited)
            [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
        dssh_chrome_hide_all();
        if (!NSApp.hidden || NSApp.activationPolicy != NSApplicationActivationPolicyProhibited) return false;
        for (DsshConnectionBar* bar in bars.allValues) if (bar.panel.visible) return false;
    } else if (suspended) {
        if (![NSApp setActivationPolicy:original]) return false;
        [NSApp unhideWithoutActivation];
        suspended = NO;
    }
    return true;
}

#ifdef DSSH_CHROME_TESTING
bool dssh_chrome_test_drag(SDL_Window* window)
{
    DsshConnectionBar* bar = bars[@(SDL_GetWindowID(window))];
    if (!bar) return false;
    NSRect content = [bar.owner convertRectToScreen:[bar.owner.contentView convertRect:bar.owner.contentView.bounds toView:nil]];
    SDL_FRect frame = dssh_chrome_frame(bar.position, content.size.width, content.size.height, 440, 40);
    [bar.panel setFrame:NSMakeRect(NSMinX(content) + frame.x, NSMaxY(content) - frame.y - frame.h, frame.w, frame.h) display:NO];
    [bar layout];
    const char* output = getenv("DSSH_RDP_CHROME_ARTIFACT");
    if (output) {
        // Render this fixture's own native views, never capture the user's desktop.
        NSView* view = bar.panel.contentView;
        NSBitmapImageRep* bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
        [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
        [[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}]
            writeToFile:[NSString stringWithUTF8String:output] atomically:YES];
    }
    const DsshChromePosition before = bar.position;
    NSPoint start = NSMakePoint(NSMinX(bar.panel.frame) + 10, NSMaxY(bar.panel.frame) - 10);
    DsshBarSurface* surface = (DsshBarSurface*)bar.panel.contentView;
    NSEvent* down = [NSEvent mouseEventWithType:NSEventTypeLeftMouseDown
        location:[bar.panel convertPointFromScreen:start] modifierFlags:0 timestamp:0
        windowNumber:bar.panel.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];
    [surface mouseDown:down];
    NSEvent* move = [NSEvent mouseEventWithType:NSEventTypeLeftMouseDragged
        location:[bar.panel convertPointFromScreen:NSMakePoint(start.x + 60, start.y - 40)]
        modifierFlags:0 timestamp:0 windowNumber:bar.panel.windowNumber context:nil
        eventNumber:1 clickCount:1 pressure:1];
    [surface mouseDragged:move];
    [surface mouseUp:move];
    return !bar.dragging && bar.position.x > before.x && bar.position.y > before.y;
}
bool dssh_chrome_test_visible(SDL_Window* window)
{
    return bars[@(SDL_GetWindowID(window))].panel.visible;
}
bool dssh_chrome_test_click(SDL_Window* window, int action)
{
    DsshConnectionBar* bar = bars[@(SDL_GetWindowID(window))];
    const int index = action - DSSH_CHROME_MINIMIZE;
    if (!bar || index < 0 || index >= 4) return false;
    [bar.buttons[index] performClick:nil];
    return true;
}
#endif
