#pragma once
#include <SDL3/SDL.h>
#include <freerdp/scancode.h>
#include <array>
#include <initializer_list>

// IMEs and focus changes can swallow a modifier's key-down while a later
// letter still carries it in ev.mod. Reconcile the event's own snapshot before
// sending the letter. Never sample the current global state of a later event.
template <typename Send>
bool dssh_reconcile_modifiers(SDL_Keymod& sent, SDL_Keymod snapshot,
                              UINT32 current, bool down, Send send)
{
    struct Modifier { SDL_Keymod bit; UINT32 scan; };
    constexpr std::array<Modifier, 8> modifiers = {{
        {SDL_KMOD_LCTRL, RDP_SCANCODE_LCONTROL}, {SDL_KMOD_RCTRL, RDP_SCANCODE_RCONTROL},
        {SDL_KMOD_LSHIFT, RDP_SCANCODE_LSHIFT}, {SDL_KMOD_RSHIFT, RDP_SCANCODE_RSHIFT},
        {SDL_KMOD_LALT, RDP_SCANCODE_LMENU}, {SDL_KMOD_RALT, RDP_SCANCODE_RMENU},
        {SDL_KMOD_LGUI, RDP_SCANCODE_LWIN}, {SDL_KMOD_RGUI, RDP_SCANCODE_RWIN}
    }};
    for (const auto& modifier : modifiers) {
        if (modifier.scan == current) {
            // The caller forwards this actual modifier event exactly once.
            sent = down ? (sent | modifier.bit) : (sent & ~modifier.bit);
            return true;
        }
    }
    // Release obsolete keys before pressing newly held modifiers (AltGr and
    // left/right Ctrl transitions must not temporarily leave both sides held).
    for (bool press : {false, true}) {
        for (const auto& modifier : modifiers) {
            const bool was = (sent & modifier.bit) != 0;
            const bool now = (snapshot & modifier.bit) != 0;
            if (was == now || now != press) continue;
            if (!send(now, modifier.scan)) return false;
            sent = now ? (sent | modifier.bit) : (sent & ~modifier.bit);
        }
    }
    return true;
}
