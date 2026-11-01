#import <AppKit/AppKit.h>
#include "dssh_icon_data.hpp"

void dssh_set_application_icon(void)
{
    @autoreleasepool
    {
        NSData* data = [NSData dataWithBytes:dssh_icon_png length:sizeof(dssh_icon_png)];
        NSImage* image = [[NSImage alloc] initWithData:data];
        if (image) [NSApp setApplicationIconImage:image];
    }
}
