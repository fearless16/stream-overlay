// Pure YouTube initial-data helpers. Kept separate from the server so the
// provider response shape can be tested without opening ports or polling.

function extractInitialData(source) {
  const match = String(source || '').match(/(?:var\s+)?(?:window\[")?ytInitialData(?:"\])?\s*=\s*({[\s\S]+?});\s*(?:\n|<)/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (_) { return null; }
}

function getLiveChatContinuations(data) {
  const renderers = [
    data?.contents?.liveChatRenderer,
    data?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer,
  ];
  return renderers.find(renderer => Array.isArray(renderer?.continuations))?.continuations || null;
}

function getContinuationToken(continuations) {
  const first = Array.isArray(continuations) ? continuations[0] : null;
  if (!first) return null;
  const value = Object.values(first)[0];
  return value?.continuation || null;
}

function getContinuationTimeout(continuations) {
  const first = Array.isArray(continuations) ? continuations[0] : null;
  if (!first) return 0;
  const value = Object.values(first)[0];
  return value?.timeoutMs || 0;
}

module.exports = {
  extractInitialData,
  getLiveChatContinuations,
  getContinuationToken,
  getContinuationTimeout,
};
