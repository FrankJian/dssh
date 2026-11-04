#import <AppKit/AppKit.h>
#include "dssh_chrome.h"
#ifdef DSSH_CHROME_TESTING
#include <stdlib.h>
#endif

@interface DsshConnectionBar : NSObject
@property(nonatomic, assign) SDL_Window* desktop;
@property(nonatomic, weak) NSWindow* owner;
@property(nonatomic, strong) NSPanel* panel;
@property(nonatomic, strong) NSTextField* title;
@property(nonatomic, strong) NSArray<NSButton*>* buttons;
@property(nonatomic, assign) DsshChromeReveal reveal;
- (void)tick:(NSTimer*)timer;
- (void)action:(NSButton*)sender;
@end

@implementation DsshConnectionBar
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
    const CGFloat width = MAX(1, MIN(460, content.size.width - 16));
    NSRect frame = NSMakeRect(NSMidX(content) - width / 2, NSMaxY(content) - 38, width, 38);
    NSPoint mouse = [NSEvent mouseLocation];
    const BOOL active = owner.visible && !owner.miniaturized && NSApp.active;
    const BOOL atEdge = mouse.x >= NSMinX(content) && mouse.x < NSMaxX(content) &&
        mouse.y <= NSMaxY(content) && mouse.y >= NSMaxY(content) - 4;
    DsshChromeReveal state = self.reveal;
    BOOL visible = dssh_chrome_reveal(&state, active, atEdge, NSPointInRect(mouse, frame), SDL_GetTicks());
#ifdef DSSH_CHROME_TESTING
    // The test-only preview pins the controls for visual/accessibility review.
    // Production visibility always follows the pointer and foreground state.
    if (getenv("DSSH_RDP_CHROME_PREVIEW_PIN")) visible = YES;
#endif
    self.reveal = state;
    if (!visible) { [self.panel orderOut:nil]; return; }
    [self.panel setFrame:frame display:YES];
    const CGFloat buttonWidth = MIN(72, MAX(1, width / 5));
    const CGFloat start = width - buttonWidth * 4 - 4;
    self.title.frame = NSMakeRect(10, 10, MAX(0, start - 16), 18);
    for (NSUInteger index = 0; index < self.buttons.count; index++)
        self.buttons[index].frame = NSMakeRect(start + index * buttonWidth, 5, buttonWidth, 28);
    const SDL_WindowFlags flags = SDL_GetWindowFlags(self.desktop);
    self.buttons[1].title = (flags & (SDL_WINDOW_FULLSCREEN | SDL_WINDOW_MAXIMIZED)) ? @"还原" : @"最大化";
    self.buttons[2].title = (flags & SDL_WINDOW_FULLSCREEN) ? @"退出全屏" : @"全屏";
    [self.panel orderFront:nil];
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
        bar.panel = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 460, 38)
            styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
            backing:NSBackingStoreBuffered defer:NO];
        bar.panel.title = @"远程桌面控制栏";
        bar.panel.level = NSFloatingWindowLevel;
        bar.panel.collectionBehavior = NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorCanJoinAllSpaces;
        bar.panel.hasShadow = NO;
        bar.panel.releasedWhenClosed = NO;
        bar.panel.backgroundColor = NSColor.windowBackgroundColor;
        bar.panel.animationBehavior = NSWindowAnimationBehaviorNone;
        const char* title = SDL_GetWindowTitle(window);
        bar.title = [NSTextField labelWithString:title ? [NSString stringWithUTF8String:title] : @"Duo SSH"];
        bar.title.font = [NSFont systemFontOfSize:12];
        bar.title.lineBreakMode = NSLineBreakByTruncatingTail;
        [bar.panel.contentView addSubview:bar.title];
        NSMutableArray* buttons = [NSMutableArray array];
        NSArray* labels = @[@"最小化", @"最大化", @"全屏", @"关闭"];
        for (NSUInteger index = 0; index < labels.count; index++) {
            NSButton* button = [NSButton buttonWithTitle:labels[index] target:bar action:@selector(action:)];
            button.tag = DSSH_CHROME_MINIMIZE + index;
            button.bezelStyle = NSBezelStyleTexturedRounded;
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
