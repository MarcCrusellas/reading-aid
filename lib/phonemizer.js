// lib/phonemizer.js
// Wrapper around @echogarden/espeak-ng-emscripten exposing:
//   phonemize(text, lang) -> Promise<string>  (IPA transcription)
//
// This build uses Embind (an eSpeakNGWorker class), NOT ccall.
// Place this file next to espeak-ng.js and espeak-ng.data.

let workerPromise = null;

// App language codes -> espeak-ng voice names
const VOICE = {
  'fr': 'fr', 'es': 'es', 'en-us': 'en-us', 'en-gb': 'en-gb',
  'it': 'it', 'de': 'de', 'pt': 'pt', 'ca': 'ca',
};

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const url = new URL('./espeak-ng.js', import.meta.url).href;
      const factory = (await import(url)).default;
      const Module = await factory({
        locateFile: (path) => new URL('./' + path, import.meta.url).href,
      });
      // The data file (espeak-ng.data) preloads automatically via Emscripten FS.
      const worker = new Module.eSpeakNGWorker();
      return { Module, worker };
    })();
  }
  return workerPromise;
}

export async function phonemize(text, lang = 'fr') {
  const { Module, worker } = await getWorker();
  const voice = VOICE[lang] || lang || 'fr';

  // set_voice(name, lang, gender, age, variant)
  try { worker.set_voice(voice, voice, 0, 0, 0); }
  catch (e) { try { worker.set_voice(voice); } catch (e2) {} }

  // synth_ipa_ writes IPA to a virtual file; read it back via FS.
  const vfile = 'ipa_' + Math.random().toString(36).slice(2);
  let ipa = '';
  const code = worker.synth_ipa_(text, vfile);
  if (code === 0 || code === undefined) {
    try { ipa = Module.FS.readFile(vfile, { encoding: 'utf8' }); } catch (e) {}
    try { Module.FS.unlink(vfile); } catch (e) {}
  }

  ipa = (ipa || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return ipa;
}
