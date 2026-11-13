import { findHint } from './puzzle.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ hint: findHint(data.positions), version: data.version }); }
  catch (error) { self.postMessage({ error: error.message, version: data.version }); }
};
