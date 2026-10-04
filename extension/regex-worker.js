self.onmessage = ({ data }) => {
  try {
    const re = new RegExp(data.pattern, data.flags);
    const start = performance.now();
    for (const char of ['a', '1', ' ', 'a1']) {
      const text = char.repeat(2000).slice(0, 1999) + '!';
      re.lastIndex = 0;
      text.replace(re, '');
    }
    self.postMessage({ elapsed: performance.now() - start });
  } catch (error) { self.postMessage({ error: error.message }); }
};
self.postMessage({ ready: true });