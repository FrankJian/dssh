// Duo SSH adapter for the pinned FreeRDP SDL3 client. No secrets in argv/files.
#pragma once
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <string>
#include <thread>
#include <vector>
#include <exception>
#include <filesystem>
#include <new>
#include <system_error>
#include "dssh_visibility.h"
#include "dssh_window.hpp"
#include <winpr/crypto.h>
#include <winpr/ssl.h>
#if defined(_WIN32)
#include <fcntl.h>
#include <io.h>
#include <crtdbg.h>
#endif

inline void dssh_status(const char* status)
{
    std::printf("DSSH_RDP_V1 %s\n", status);
    std::fflush(stdout);
}

// Never print exception::what(), CRT expressions or credential-bearing arguments.
inline void dssh_install_failure_handlers()
{
    std::set_terminate([] {
        uint32_t code = 0xd5500010;
        if (auto exception = std::current_exception())
        {
            try { std::rethrow_exception(exception); }
            catch (const std::bad_alloc&) { code = 0xd5500011; }
            catch (const std::filesystem::filesystem_error&) { code = 0xd5500012; }
            catch (const std::system_error&) { code = 0xd5500013; }
            catch (...) {}
        }
        std::printf("DSSH_RDP_V1 error %u\n", code);
        std::fflush(stdout);
        std::_Exit(190);
    });
#if defined(_WIN32)
    _set_invalid_parameter_handler([](const wchar_t*, const wchar_t*, const wchar_t*, unsigned int, uintptr_t) {
        dssh_status("error 3578789908"); // 0xd5500014: Windows CRT invalid parameter.
        std::_Exit(190);
    });
#endif
}

// Public test vectors verify the exact primitives needed by NTLM/CredSSP.
// This probe never accepts or prints user credentials.
inline int dssh_crypto_self_test(bool announce = true)
{
    std::ignore = WLog_SetLogLevel(WLog_GetRoot(), WLOG_OFF);
    if (!winpr_InitializeSSL(WINPR_SSL_INIT_DEFAULT)) return 180;
    unsigned char digest[16] = {};
    const unsigned char md4[] = {0xa4,0x48,0x01,0x7a,0xaf,0x21,0xd8,0x52,0x5f,0xc1,0x0a,0xe8,0x7a,0xa6,0x72,0x9d};
    if (!winpr_Digest(WINPR_MD_MD4, "abc", 3, digest, sizeof(digest)) || std::memcmp(digest, md4, sizeof(md4)))
    { dssh_status("crypto-md4-unavailable"); return 181; }
    auto cipher = winpr_RC4_New("Key", 3);
    if (!cipher) { dssh_status("crypto-rc4-unavailable"); return 182; }
    unsigned char encrypted[9] = {};
    const unsigned char rc4[] = {0xbb,0xf3,0x16,0xe8,0xd9,0x40,0xaf,0x0a,0xd3};
    const bool valid = winpr_RC4_Update(cipher, sizeof(encrypted), "Plaintext", encrypted) && !std::memcmp(encrypted, rc4, sizeof(rc4));
    winpr_RC4_Free(cipher);
    if (!valid) { dssh_status("crypto-rc4-unavailable"); return 182; }
    if (announce) dssh_status("crypto-ok");
    return 0;
}

inline uint32_t dssh_read_u32()
{
    unsigned char bytes[4] = {};
    if (std::fread(bytes, 1, 4, stdin) != 4) std::_Exit(120);
    return (uint32_t(bytes[0]) << 24) | (uint32_t(bytes[1]) << 16) |
           (uint32_t(bytes[2]) << 8) | uint32_t(bytes[3]);
}

inline bool dssh_arguments(int& argc, char**& argv, std::vector<std::string>& storage,
                           std::vector<char*>& pointers)
{
    if (argc != 2 || std::strcmp(argv[1], "--dssh-worker-v1") != 0) return false;
#if defined(_WIN32)
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    dssh_status("ready");
    dssh_install_failure_handlers();
    const auto count = dssh_read_u32();
    if (count == 0 || count > 64) return false;
    storage.reserve(count + 1);
    storage.emplace_back("dssh-rdp-client");
    size_t total = 0;
    for (uint32_t i = 0; i < count; i++)
    {
        const auto length = dssh_read_u32();
        total += length;
        if (length == 0 || length > 8192 || total > 65536) return false;
        std::string value(length, '\0');
        if (std::fread(value.data(), 1, length, stdin) != length ||
            value.find('\0') != std::string::npos) return false;
        if (value == "/dssh-initially-hidden") { dssh_request_desktop_lock(true); continue; }
        storage.push_back(std::move(value));
    }
    for (auto& value : storage) pointers.push_back(value.data());
    argc = static_cast<int>(pointers.size());
    argv = pointers.data();
    // The pipe stays open for control messages. EOF also handles parent crashes.
    std::thread([] {
        for (;;)
        {
            const int command = std::getchar();
            if (command == EOF) std::_Exit(0);
            SDL_Event event = {};
            if (command == 'q') event.type = SDL_EVENT_QUIT;
            else if (command == 'f') event.type = SDL_EVENT_USER;
            else if (command == 'h' || command == 'u') {
                dssh_request_desktop_lock(command == 'h');
                event.type = SDL_EVENT_USER;
                event.user.code = DSSH_DESKTOP_VISIBILITY;
            }
            else std::_Exit(121);
            SDL_PushEvent(&event);
        }
    }).detach();
    return true;
}

inline void dssh_focus_windows()
{
    if (dssh_desktop_locked()) return;
    int count = 0;
    auto windows = SDL_GetWindows(&count);
    if (!windows) return;
    for (int i = 0; i < count; i++)
    {
        dssh_focus_desktop_window(windows[i]);
    }
    SDL_free(windows);
}

inline void dssh_wipe_arguments(std::vector<std::string>& storage)
{
    for (auto& value : storage)
    {
        volatile char* bytes = value.data();
        for (size_t i = 0; i < value.size(); i++) bytes[i] = 0;
    }
}
