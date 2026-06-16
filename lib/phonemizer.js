// lib/phonemizer.js
// Thin wrapper around @echogarden/espeak-ng-emscripten that exposes
//   phonemize(text, lang) -> Promise<string>  (IPA transcription)
//
// Place this file in the SAME folder as espeak-ng.js and espeak-ng.data.
// The app imports it as: import { phonemize } from './lib/phonemizer.js'

let modPromise = null;

// Map the app's language codes to espeak-ng voice names.
const VOICE = {
  'fr': 'fr',
  'es': 'es',
  'en-us': 'en-us',
  'en-gb': 'en-gb',
  'it': 'it',
  'de': 'de',
  'pt': 'pt',
  'ca': 'ca',
};

async function getModule() {
  if (!modPromise) {
    modPromise = (async () => {
      // espeak-ng.js sits next to this file; resolve relative to this module.
      const url = new URL('./espeak-ng.js', import.meta.url).href;
      const factory = (await import(url)).default;
      // Emscripten factory. It locates espeak-ng.data relative to espeak-ng.js automatically.
      const Module = await factory({
        locateFile: (path) => new URL('./' + path, import.meta.url).href,
      });
      // Initialise espeak-ng: 1 = AUDIO_OUTPUT_SYNCHRONOUS (we only need text), path=NULL, options=0
      // ccall signature: espeak_Initialize(output, buflength, path, options)
      Module.ccall('espeak_ng_InitializePath', null, ['string'], [null]);
      Module.ccall('espeak_ng_Initialize', 'number', ['number'], [0]);
      return Module;
    })();
  }
  return modPromise;
}

export async function phonemize(text, lang = 'fr') {
  const Module = await getModule();
  const voice = VOICE[lang] || lang || 'fr';

  // Set the voice/language
  Module.ccall('espeak_ng_SetVoiceByName', 'number', ['string'], [voice]);

  // espeak_TextToPhonemes consumes a pointer-to-pointer; easiest reliable path
  // is the espeak_ng_TextToPhonemesWithTerminator or the classic espeak_TextToPhonemes.
  // We use espeak_TextToPhonemes via a helper that returns IPA (phonememode with bit 0x02 = IPA).
  const textmode = 1;          // espeakCHARS_UTF8
  const phonememode = (0x02 << 8) | 0x02; // IPA output + separate phonemes with spaces

  // Allocate the input string and a char** holder
  const strPtr = Module.allocateUTF8 ? Module.allocateUTF8(text) : allocUtf8(Module, text);
  const ptrPtr = Module._malloc(4);
  Module.setValue(ptrPtr, strPtr, 'i32');

  let out = '';
  // espeak_TextToPhonemes(const void **textptr, int textmode, int phonememode)
  // returns const char* of phonemes for the first "clause"; call repeatedly until input consumed.
  let guard = 0;
  while (Module.getValue(ptrPtr, 'i32') !== 0 && guard < 200) {
    const resPtr = Module.ccall(
      'espeak_TextToPhonemes',
      'number',
      ['number', 'number', 'number'],
      [ptrPtr, textmode, phonememode]
    );
    if (resPtr) out += Module.UTF8ToString(resPtr) + ' ';
    guard++;
  }

  Module._free(ptrPtr);
  // strPtr is owned by espeak after the call in some builds; freeing can crash, so we leave it.

  return out.trim();
}

// Fallback UTF8 allocator for builds without allocateUTF8
function allocUtf8(Module, str) {
  const bytes = new TextEncoder().encode(str + '\0');
  const ptr = Module._malloc(bytes.length);
  Module.HEAPU8.set(bytes, ptr);
  return ptr;
}
