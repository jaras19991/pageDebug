// Bounded FIFO buffer for recorder entries (ES module, D6). Evicts the oldest
// entries until both limits hold: `maxItems` entries and `maxChars` total chars
// (as reported by the caller per entry). `truncated` turns true on the first
// eviction and stays true until `clear()`.

export function createBuffer({ maxItems = Infinity, maxChars = Infinity } = {}) {
  let entries = [];
  let sizes = [];
  let head = 0;
  let totalChars = 0;
  let truncated = false;

  function evictOldest() {
    totalChars -= sizes[head];
    entries[head] = undefined;
    head += 1;
    truncated = true;
    // Compact lazily so eviction stays O(1) amortized.
    if (head > 1024 && head * 2 > entries.length) {
      entries = entries.slice(head);
      sizes = sizes.slice(head);
      head = 0;
    }
  }

  return {
    push(entry, chars = 0) {
      const size = typeof chars === 'number' && chars > 0 && Number.isFinite(chars) ? chars : 0;
      entries.push(entry);
      sizes.push(size);
      totalChars += size;
      while (entries.length - head > 0 && (entries.length - head > maxItems || totalChars > maxChars)) {
        evictOldest();
      }
    },
    items() {
      return entries.slice(head);
    },
    get truncated() {
      return truncated;
    },
    get size() {
      return entries.length - head;
    },
    get chars() {
      return totalChars;
    },
    clear() {
      entries = [];
      sizes = [];
      head = 0;
      totalChars = 0;
      truncated = false;
    },
  };
}
