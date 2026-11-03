#include "dssh_keyboard.hpp"
#include <vector>
#include <utility>
#include <cstdio>

using Key = std::pair<bool, UINT32>;
int main()
{
    SDL_Keymod sent = SDL_KMOD_NONE;
    std::vector<Key> events;
    auto key = [&](SDL_Keymod mods, UINT32 scan, bool down = true) {
        if (!dssh_reconcile_modifiers(sent, mods, scan, down,
                [&](bool pressed, UINT32 modifier) { events.emplace_back(pressed, modifier); return true; })) return false;
        events.emplace_back(down, scan);
        return true;
    };
    // IME swallowed Ctrl-down: the remote must see Ctrl before C, not plain C.
    if (!key(SDL_KMOD_LCTRL, RDP_SCANCODE_KEY_C)) return 1;
    if (events != std::vector<Key>{{true, RDP_SCANCODE_LCONTROL}, {true, RDP_SCANCODE_KEY_C}}) return 2;
    events.clear();
    // Repeated letters and Ctrl+V/A/X must not repeatedly press Ctrl.
    for (auto scan : {RDP_SCANCODE_KEY_C, RDP_SCANCODE_KEY_V, RDP_SCANCODE_KEY_A, RDP_SCANCODE_KEY_X})
        if (!key(SDL_KMOD_LCTRL, scan)) return 3;
    if (events.size() != 4) return 4;
    events.clear();
    // A swallowed release must not turn later ordinary typing into shortcuts.
    if (!key(SDL_KMOD_NONE, RDP_SCANCODE_KEY_C)) return 5;
    if (events != std::vector<Key>{{false, RDP_SCANCODE_LCONTROL}, {true, RDP_SCANCODE_KEY_C}}) return 6;
    events.clear();
    // A real modifier event is forwarded exactly once, including right Ctrl.
    if (!key(SDL_KMOD_RCTRL, RDP_SCANCODE_RCONTROL) || !key(SDL_KMOD_RCTRL, RDP_SCANCODE_KEY_C)) return 7;
    if (events != std::vector<Key>{{true, RDP_SCANCODE_RCONTROL}, {true, RDP_SCANCODE_KEY_C}}) return 8;
    if (!key(SDL_KMOD_NONE, RDP_SCANCODE_RCONTROL, false) || sent != SDL_KMOD_NONE) return 9;
    events.clear();
    // Shift combinations, AltGr and a modifier held before window focus.
    if (!key(SDL_KMOD_LCTRL | SDL_KMOD_LSHIFT, RDP_SCANCODE_KEY_V)) return 10;
    if (events.size() != 3 || events[0] != Key{true, RDP_SCANCODE_LCONTROL} || events[1] != Key{true, RDP_SCANCODE_LSHIFT}) return 11;
    events.clear();
    if (!key(SDL_KMOD_LCTRL | SDL_KMOD_RALT, RDP_SCANCODE_KEY_A)) return 12;
    if (events != std::vector<Key>{{false, RDP_SCANCODE_LSHIFT}, {true, RDP_SCANCODE_RMENU}, {true, RDP_SCANCODE_KEY_A}}) return 13;
    SDL_Keymod failedState = SDL_KMOD_NONE;
    if (dssh_reconcile_modifiers(failedState, SDL_KMOD_LCTRL, RDP_SCANCODE_KEY_C, true,
            [](bool, UINT32) { return false; }) || failedState != SDL_KMOD_NONE) return 14;
    std::puts("Keyboard shortcut modifier recovery passed");
    return 0;
}
