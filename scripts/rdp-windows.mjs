import { win32 } from "node:path";

// FreeRDP and every native dependency run in a separate, fully static worker.
// Do not mix x64-windows-static-md (/MD) with FreeRDP's static runtime (/MT).
export const WINDOWS_TRIPLET = "x64-windows-static";
export const WINDOWS_CRT = "MultiThreaded$<$<CONFIG:Debug>:Debug>";

export function windowsCmakeArguments(vcpkgRoot) {
  if (!vcpkgRoot) throw new Error(`Set VCPKG_ROOT; install sdl3, sdl3-ttf, openssl and json-c using vcpkg (${WINDOWS_TRIPLET}).`);
  return [
    `-DCMAKE_TOOLCHAIN_FILE=${win32.join(vcpkgRoot, "scripts", "buildsystems", "vcpkg.cmake")}`,
    `-DVCPKG_TARGET_TRIPLET:STRING=${WINDOWS_TRIPLET}`,
    `-DCMAKE_MSVC_RUNTIME_LIBRARY:STRING=${WINDOWS_CRT}`,
    "-DWITH_SDL_LINK_SHARED=OFF",
  ];
}

export function validateWindowsRuntime(cache) {
  const entries = new Map(cache.split(/\r?\n/).flatMap((line) => {
    const match = /^([^#/:][^:]*):[^=]+=(.*)$/.exec(line);
    return match ? [[match[1], match[2]]] : [];
  }));
  const expected = {
    VCPKG_TARGET_TRIPLET: WINDOWS_TRIPLET,
    CMAKE_MSVC_RUNTIME_LIBRARY: WINDOWS_CRT,
    BUILD_SHARED_LIBS: "OFF",
    WITH_SDL_LINK_SHARED: "OFF",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (entries.get(key) !== value) {
      throw new Error(`RDP Windows runtime mismatch: ${key}=${entries.get(key) ?? "<missing>"}; expected ${value}. Reconfigure with the fully static Windows triplet and /MT runtime.`);
    }
  }
}
