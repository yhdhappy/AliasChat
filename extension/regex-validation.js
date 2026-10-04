(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.mask2aiRegex = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const validatePattern = (entry, createWorker = () => new Worker('regex-worker.js')) => {
    const flags = 'g' + (entry.flags || '').replace(/g/g, '');
    new RegExp(entry.pattern, flags);
    return new Promise((resolve, reject) => {
      const worker = createWorker();
      let timer = setTimeout(() => finish(new Error('Regex validation worker did not start')), 5000);
      const finish = error => {
        clearTimeout(timer);
        worker.terminate();
        error ? reject(error) : resolve();
      };
      worker.onerror = () => finish(new Error('Could not validate custom regex'));
      worker.onmessage = ({ data }) => {
        if (data.ready) {
          clearTimeout(timer);
          timer = setTimeout(() => finish(new Error('Custom regex exceeded the 100ms safety limit')), 100);
          worker.postMessage({ pattern: entry.pattern, flags });
        } else finish(data.error ? new Error(data.error) : data.elapsed > 100 ? new Error('Custom regex exceeded the 100ms safety limit') : null);
      };
    });
  };
  const validateExtras = async (config, createWorker) => {
    for (const entry of config.extra || []) await validatePattern(entry, createWorker);
  };
  return { validatePattern, validateExtras };
});