export const animals = [
  "duck","cat","wolf","armadillo","ferret","goose","pangolin","rat","frog",
  "bear","snake","alligator","spider","sasquatch","deer","moose","stag","elk",
  "crocodile","horse","donkey","leopard","rabbit","snow Leopard","lion","hyena",
  "dingo","beetle","monkey","gorilla","chimpanzee","ant","worm","lizard",
  "spiney toad","geko","octopus","eagle","falcon","ostritch","emu","kiwi",
  "dolphin","shark","alpaca","llama","sheep","goat","cow","chicken","giraffe",
  "rhino","hippo","buffalo","reindeer","pig","boar","tiger",
];

export function generateAnimal() {
  return animals[Math.floor(Math.random() * animals.length)];
}
