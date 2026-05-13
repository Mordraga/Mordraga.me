//utilities.js
export function getRandom(arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    console.warn("getRandom: Invalid or empty array");
    return null;
  }
  return arr[Math.floor(Math.random() * arr.length)];
}

export function coinFlip() {
  return Math.random() < 0.5;
}

export function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
