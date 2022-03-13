
var Module = (() => {
    return (
  function(Module) {
    Module = Module || {};
  
  var Module = typeof Module != "undefined" ? Module : {};
  
  var readyPromiseResolve, readyPromiseReject;
  
  Module["ready"] = new Promise(function(resolve, reject) {
   readyPromiseResolve = resolve;
   readyPromiseReject = reject;
  });
  
  var moduleOverrides = Object.assign({}, Module);
  
  var arguments_ = [];
  
  Object.assign(Module, moduleOverrides);
  
  moduleOverrides = null;
  
  var wasmMemory;
  
  var ABORT = false;
  
  var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder("utf8") : undefined;
  
  function UTF8ArrayToString(heap, idx, maxBytesToRead) {
   var endIdx = idx + maxBytesToRead;
   var endPtr = idx;
   while (heap[endPtr] && !(endPtr >= endIdx)) ++endPtr;
   if (endPtr - idx > 16 && heap.subarray && UTF8Decoder) {
    return UTF8Decoder.decode(heap.subarray(idx, endPtr));
   } else {
    var str = "";
    while (idx < endPtr) {
     var u0 = heap[idx++];
     if (!(u0 & 128)) {
      str += String.fromCharCode(u0);
      continue;
     }
     var u1 = heap[idx++] & 63;
     if ((u0 & 224) == 192) {
      str += String.fromCharCode((u0 & 31) << 6 | u1);
      continue;
     }
     var u2 = heap[idx++] & 63;
     if ((u0 & 240) == 224) {
      u0 = (u0 & 15) << 12 | u1 << 6 | u2;
     } else {
      u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heap[idx++] & 63;
     }
     if (u0 < 65536) {
      str += String.fromCharCode(u0);
     } else {
      var ch = u0 - 65536;
      str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
     }
    }
   }
   return str;
  }
  
  function UTF8ToString(ptr, maxBytesToRead) {
   return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
  }
  
  function stringToUTF8Array(str, heap, outIdx, maxBytesToWrite) {
   if (!(maxBytesToWrite > 0)) return 0;
   var startIdx = outIdx;
   var endIdx = outIdx + maxBytesToWrite - 1;
   for (var i = 0; i < str.length; ++i) {
    var u = str.charCodeAt(i);
    if (u >= 55296 && u <= 57343) {
     var u1 = str.charCodeAt(++i);
     u = 65536 + ((u & 1023) << 10) | u1 & 1023;
    }
    if (u <= 127) {
     if (outIdx >= endIdx) break;
     heap[outIdx++] = u;
    } else if (u <= 2047) {
     if (outIdx + 1 >= endIdx) break;
     heap[outIdx++] = 192 | u >> 6;
     heap[outIdx++] = 128 | u & 63;
    } else if (u <= 65535) {
     if (outIdx + 2 >= endIdx) break;
     heap[outIdx++] = 224 | u >> 12;
     heap[outIdx++] = 128 | u >> 6 & 63;
     heap[outIdx++] = 128 | u & 63;
    } else {
     if (outIdx + 3 >= endIdx) break;
     heap[outIdx++] = 240 | u >> 18;
     heap[outIdx++] = 128 | u >> 12 & 63;
     heap[outIdx++] = 128 | u >> 6 & 63;
     heap[outIdx++] = 128 | u & 63;
    }
   }
   heap[outIdx] = 0;
   return outIdx - startIdx;
  }
  
  function lengthBytesUTF8(str) {
   var len = 0;
   for (var i = 0; i < str.length; ++i) {
    var u = str.charCodeAt(i);
    if (u >= 55296 && u <= 57343) u = 65536 + ((u & 1023) << 10) | str.charCodeAt(++i) & 1023;
    if (u <= 127) ++len; else if (u <= 2047) len += 2; else if (u <= 65535) len += 3; else len += 4;
   }
   return len;
  }
  
  function allocateUTF8(str) {
   var size = lengthBytesUTF8(str) + 1;
   var ret = _malloc(size);
   if (ret) stringToUTF8Array(str, HEAP8, ret, size);
   return ret;
  }
  
  var buffer, HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
  
  function updateGlobalBufferAndViews(buf) {
   buffer = buf;
   Module["HEAP8"] = HEAP8 = new Int8Array(buf);
   Module["HEAP16"] = HEAP16 = new Int16Array(buf);
   Module["HEAP32"] = HEAP32 = new Int32Array(buf);
   Module["HEAPU8"] = HEAPU8 = new Uint8Array(buf);
   Module["HEAPU16"] = HEAPU16 = new Uint16Array(buf);
   Module["HEAPU32"] = HEAPU32 = new Uint32Array(buf);
   Module["HEAPF32"] = HEAPF32 = new Float32Array(buf);
   Module["HEAPF64"] = HEAPF64 = new Float64Array(buf);
  }
  
  var wasmTable;
  
  var __ATPRERUN__ = [];
  
  var __ATINIT__ = [];
  
  var __ATPOSTRUN__ = [];
  
  function preRun() {
   callRuntimeCallbacks(__ATPRERUN__);
  }
  
  function initRuntime() {
   callRuntimeCallbacks(__ATINIT__);
  }
  
  function postRun() {
   callRuntimeCallbacks(__ATPOSTRUN__);
  }
  
  function addOnInit(cb) {
   __ATINIT__.unshift(cb);
  }
  
  var runDependencies = 0;
  
  var runDependencyWatcher = null;
  
  var dependenciesFulfilled = null;
  
  function addRunDependency(id) {
   runDependencies++;
  }
  
  function removeRunDependency(id) {
   runDependencies--;
   if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
     clearInterval(runDependencyWatcher);
     runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
     var callback = dependenciesFulfilled;
     dependenciesFulfilled = null;
     callback();
    }
   }
  }
  
  Module["preloadedImages"] = {};
  
  Module["preloadedAudios"] = {};
  
  function abort(what) {
    what = "Aborted(" + what + ")";
   ABORT = true;
   EXITSTATUS = 1;
   what += ". Build with -s ASSERTIONS=1 for more info.";
   var e = new Error(what);
   readyPromiseReject(e);
   throw e;
  }
  
  function createWasm() {
   var info = {
    "a": asmLibraryArg
   };
   function receiveInstance(instance, module) {
    var exports = instance.exports;
    Module["asm"] = exports;
    wasmMemory = Module["asm"]["m"];
    updateGlobalBufferAndViews(wasmMemory.buffer);
    wasmTable = Module["asm"]["q"];
    addOnInit(Module["asm"]["n"]);
    removeRunDependency("wasm-instantiate");
   }
   addRunDependency("wasm-instantiate");
   if (Module["instantiateWasm"]) {
    try {
     var exports = Module["instantiateWasm"](info, receiveInstance);
     return exports;
    } catch (e) {
     err("Module.instantiateWasm callback failed with error: " + e);
     return false;
    }
   }
   throw new Error('missing instantiateWasm');
  }
  
  function _dispatch(action, key, args) {
   return Module.dispatch(action, key, args);
  }

  function _dynamicImport(ctx, argc, argv, resolveFunc, rejectFunc, basename, filename) {
    return Module.dynamicImport(ctx, argc, argv, resolveFunc, rejectFunc, basename, filename);
  }

  function _getModuleContent(ctx, module_name) {
    return Module.getModuleContent(ctx, module_name);
  }
  
  function _setPromiseCallbacks(key, promiseId, resolve, reject) {
   return Module.setPromiseCallbacks(key, promiseId, resolve, reject);
  }
  
  function callRuntimeCallbacks(callbacks) {
   while (callbacks.length > 0) {
    var callback = callbacks.shift();
    if (typeof callback == "function") {
     callback(Module);
     continue;
    }
    var func = callback.func;
    if (typeof func == "number") {
     if (callback.arg === undefined) {
      getWasmTableEntry(func)();
     } else {
      getWasmTableEntry(func)(callback.arg);
     }
    } else {
     func(callback.arg === undefined ? null : callback.arg);
    }
   }
  }
  
  var wasmTableMirror = [];
  
  function getWasmTableEntry(funcPtr) {
   var func = wasmTableMirror[funcPtr];
   if (!func) {
    if (funcPtr >= wasmTableMirror.length) wasmTableMirror.length = funcPtr + 1;
    wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr);
   }
   return func;
  }
  
  function ___assert_fail(condition, filename, line, func) {
   abort("Assertion failed: " + UTF8ToString(condition) + ", at: " + [ filename ? UTF8ToString(filename) : "unknown filename", line, func ? UTF8ToString(func) : "unknown function" ]);
  }
  
  function __localtime_js(time, tmPtr) {
   var date = new Date(HEAP32[time >> 2] * 1e3);
   HEAP32[tmPtr >> 2] = date.getSeconds();
   HEAP32[tmPtr + 4 >> 2] = date.getMinutes();
   HEAP32[tmPtr + 8 >> 2] = date.getHours();
   HEAP32[tmPtr + 12 >> 2] = date.getDate();
   HEAP32[tmPtr + 16 >> 2] = date.getMonth();
   HEAP32[tmPtr + 20 >> 2] = date.getFullYear() - 1900;
   HEAP32[tmPtr + 24 >> 2] = date.getDay();
   var start = new Date(date.getFullYear(), 0, 1);
   var yday = (date.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24) | 0;
   HEAP32[tmPtr + 28 >> 2] = yday;
   HEAP32[tmPtr + 36 >> 2] = -(date.getTimezoneOffset() * 60);
   var summerOffset = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
   var winterOffset = start.getTimezoneOffset();
   var dst = (summerOffset != winterOffset && date.getTimezoneOffset() == Math.min(winterOffset, summerOffset)) | 0;
   HEAP32[tmPtr + 32 >> 2] = dst;
  }
  
  function _tzset_impl(timezone, daylight, tzname) {
   var currentYear = new Date().getFullYear();
   var winter = new Date(currentYear, 0, 1);
   var summer = new Date(currentYear, 6, 1);
   var winterOffset = winter.getTimezoneOffset();
   var summerOffset = summer.getTimezoneOffset();
   var stdTimezoneOffset = Math.max(winterOffset, summerOffset);
   HEAP32[timezone >> 2] = stdTimezoneOffset * 60;
   HEAP32[daylight >> 2] = Number(winterOffset != summerOffset);
   function extractZone(date) {
    var match = date.toTimeString().match(/\(([A-Za-z ]+)\)$/);
    return match ? match[1] : "GMT";
   }
   var winterName = extractZone(winter);
   var summerName = extractZone(summer);
   var winterNamePtr = allocateUTF8(winterName);
   var summerNamePtr = allocateUTF8(summerName);
   if (summerOffset < winterOffset) {
    HEAP32[tzname >> 2] = winterNamePtr;
    HEAP32[tzname + 4 >> 2] = summerNamePtr;
   } else {
    HEAP32[tzname >> 2] = summerNamePtr;
    HEAP32[tzname + 4 >> 2] = winterNamePtr;
   }
  }
  
  function __tzset_js(timezone, daylight, tzname) {
   if (__tzset_js.called) return;
   __tzset_js.called = true;
   _tzset_impl(timezone, daylight, tzname);
  }
  
  function _abort() {
   abort("");
  }
  
  function _emscripten_memcpy_big(dest, src, num) {
   HEAPU8.copyWithin(dest, src, src + num);
  }
  
  function _emscripten_get_heap_max() {
   return 2147483648;
  }
  
  function emscripten_realloc_buffer(size) {
   try {
    wasmMemory.grow(size - buffer.byteLength + 65535 >>> 16);
    updateGlobalBufferAndViews(wasmMemory.buffer);
    return 1;
   } catch (e) {}
  }
  
  function _emscripten_resize_heap(requestedSize) {
   var oldSize = HEAPU8.length;
   requestedSize = requestedSize >>> 0;
   var maxHeapSize = _emscripten_get_heap_max();
   if (requestedSize > maxHeapSize) {
    return false;
   }
   let alignUp = (x, multiple) => x + (multiple - x % multiple) % multiple;
   for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
    var overGrownHeapSize = oldSize * (1 + .2 / cutDown);
    overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
    var newSize = Math.min(maxHeapSize, alignUp(Math.max(requestedSize, overGrownHeapSize), 65536));
    var replacement = emscripten_realloc_buffer(newSize);
    if (replacement) {
     return true;
    }
   }
   return false;
  }

  function _fd_write(fd, iov, iovcnt, pnum) {
    var num = 0;
    for (var i = 0; i < iovcnt; i++) {
     var ptr = HEAP32[iov >> 2];
     var len = HEAP32[iov + 4 >> 2];
     iov += 8;
     if (typeof process !== 'undefined') {
      process.stdout.write(UTF8ToString(ptr, len))
     }
     num += len;
    }
    HEAP32[pnum >> 2] = num;
  }
  
  function _gettimeofday(ptr) {
   var now = Date.now();
   HEAP32[ptr >> 2] = now / 1e3 | 0;
   HEAP32[ptr + 4 >> 2] = now % 1e3 * 1e3 | 0;
   return 0;
  }

  var asmLibraryArg = {
    "a": ___assert_fail,
    "k": _dispatch,
    "h": _dynamicImport,
    "i": _getModuleContent,
    "e": __localtime_js,
    "j": _setPromiseCallbacks,
    "f": __tzset_js,
    "b": _abort,
    "g": _emscripten_memcpy_big,
    "l": _emscripten_resize_heap,
    "d": _fd_write,
    "c": _gettimeofday
   };
   
   var asm = createWasm();
   
   var ___wasm_call_ctors = Module["___wasm_call_ctors"] = function() {
    return (___wasm_call_ctors = Module["___wasm_call_ctors"] = Module["asm"]["n"]).apply(null, arguments);
   };
   
   var _malloc = Module["_malloc"] = function() {
    return (_malloc = Module["_malloc"] = Module["asm"]["o"]).apply(null, arguments);
   };
   
   var _free = Module["_free"] = function() {
    return (_free = Module["_free"] = Module["asm"]["p"]).apply(null, arguments);
   };
   
   var _newContext = Module["_newContext"] = function() {
    return (_newContext = Module["_newContext"] = Module["asm"]["r"]).apply(null, arguments);
   };
   
   var _freeContext = Module["_freeContext"] = function() {
    return (_freeContext = Module["_freeContext"] = Module["asm"]["s"]).apply(null, arguments);
   };
   
   var _doDynamicImport = Module["_doDynamicImport"] = function() {
    return (_doDynamicImport = Module["_doDynamicImport"] = Module["asm"]["t"]).apply(null, arguments);
   };
   
   var _pathJoin = Module["_pathJoin"] = function() {
    return (_pathJoin = Module["_pathJoin"] = Module["asm"]["u"]).apply(null, arguments);
   };
   
   var _eval = Module["_eval"] = function() {
    return (_eval = Module["_eval"] = Module["asm"]["v"]).apply(null, arguments);
   };
   
   var _load = Module["_load"] = function() {
    return (_load = Module["_load"] = Module["asm"]["w"]).apply(null, arguments);
   };
   
   var _call = Module["_call"] = function() {
    return (_call = Module["_call"] = Module["asm"]["x"]).apply(null, arguments);
   };
   
   var _freeJsValue = Module["_freeJsValue"] = function() {
    return (_freeJsValue = Module["_freeJsValue"] = Module["asm"]["y"]).apply(null, arguments);
   };

  Module["UTF8ToString"] = UTF8ToString;
  Module["allocateUTF8"] = allocateUTF8;
  
  var calledRun;
  
  dependenciesFulfilled = function runCaller() {
   if (!calledRun) run();
   if (!calledRun) dependenciesFulfilled = runCaller;
  };
  
  function run(args) {
   args = args || arguments_;
   if (runDependencies > 0) {
    return;
   }
   preRun();
   if (runDependencies > 0) {
    return;
   }
   function doRun() {
    if (calledRun) return;
    calledRun = true;
    Module["calledRun"] = true;
    if (ABORT) return;
    initRuntime();
    readyPromiseResolve(Module);
    postRun();
   }
   {
    doRun();
   }
  }
  
  Module["run"] = run;
  
  run();
  
  
    return Module.ready
  }
  );
  })();
  if (typeof exports === 'object' && typeof module === 'object')
    module.exports = Module;
  else if (typeof define === 'function' && define['amd'])
    define([], function() { return Module; });
  else if (typeof exports === 'object')
    exports["Module"] = Module;
  