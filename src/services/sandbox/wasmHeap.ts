import { readFile } from "node:fs/promises";

import {
  RELEASE_SYNC,
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSWASMModule,
} from "quickjs-emscripten";

const WASM_PAGE_BYTES = 64 * 1024;

// The QuickJS build declares this much linear memory up front: static data, the
// C stack and a first slice of heap. Instantiation fails if we offer less.
const BASE_HEAP_BYTES = 16 * 1024 * 1024;

// Reading and compiling the .wasm file is most of what it costs to build an
// instance. Do it once and hand the compiled module to every later instance.
let compiledWasm: Promise<WebAssembly.Module | undefined> | undefined;

function maximumPages(guestHeapBytes: number): number {
  return Math.ceil((BASE_HEAP_BYTES + guestHeapBytes) / WASM_PAGE_BYTES);
}

/**
 * Creates a QuickJS WebAssembly instance whose linear memory cannot grow past
 * `guestHeapBytes` on top of the fixed base.
 *
 * QuickJS's own memory limit does not hold here: the Emscripten build cannot
 * see how big an allocation is and counts each malloc as a few bytes, so
 * "x".repeat(1e6) walks past it. The WebAssembly memory maximum does hold;
 * when it is reached malloc fails and QuickJS raises "out of memory".
 *
 * Every call returns an independent instance.
 */
export async function createCappedModule(guestHeapBytes: number): Promise<QuickJSWASMModule> {
  const wasmMemory = new WebAssembly.Memory({
    initial: BASE_HEAP_BYTES / WASM_PAGE_BYTES,
    maximum: maximumPages(guestHeapBytes),
  });
  const wasmModule = await compiledWasm;

  if (wasmModule) {
    return newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmMemory, wasmModule }));
  }

  // The first instance takes the slow path, which also tells us where the
  // library keeps its .wasm file so the compiled module can be reused after it.
  let wasmPath: string | undefined;
  const module = await newQuickJSWASMModuleFromVariant(
    newVariant(RELEASE_SYNC, {
      wasmMemory,
      locateFile: (fileName, prefix) => {
        wasmPath = `${prefix}${fileName}`;
        return wasmPath;
      },
    }),
  );

  if (wasmPath && !compiledWasm) {
    compiledWasm = readFile(wasmPath)
      .then((bytes) => WebAssembly.compile(bytes))
      .catch(() => undefined);
  }

  return module;
}

/**
 * True when the instance has grown to its cap, down to the last page. Whatever
 * a run died of at that point, it died of running out of memory.
 */
export function isHeapExhausted(module: QuickJSWASMModule, guestHeapBytes: number): boolean {
  const capBytes = maximumPages(guestHeapBytes) * WASM_PAGE_BYTES;

  return module.getWasmMemory().buffer.byteLength >= capBytes - WASM_PAGE_BYTES;
}
