export const objects = [
  "lamp","chair","desk","mirror","toaster","umbrella","mug","helmet",
  "broom","bucket","backpack","pillow","blanket","shelf","vase","clock",
  "keyboard","flashlight","ladder","remote","candle","shovel","pliers",
  "radio","binoculars","necklace","ring","bracelet","glasses",
];

export function generateObject() {
  return objects[Math.floor(Math.random() * objects.length)];
}
