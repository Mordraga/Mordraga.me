//generators.js
import {allData} from '../Data/mainData.js';
import {getRandom, coinFlip, capitalize} from './utilities.js';

const {
  namePrefix,
  nameSuffix,
  preTitles,
  titles,
  numbers,
  races,
  classes,
  religiousFoci,
  weapons,
  backgrounds,
  traits,
  objects,
  generateObject,
  Saryn,
  animals,
  generateAnimal,
  isReligiousClass,
  loveType,
  flaws
} = allData;

function generateName() {
  const prefix = getRandom(namePrefix);
  const suffix = getRandom(nameSuffix);
  const preTitle = getRandom(preTitles);
  const title = getRandom(titles);
  const number = getRandom(numbers);

  const modType = Math.floor(Math.random() * 3);
  const useApostrophe = (prefix !== "Mor" || suffix !== "draga") && coinFlip() ? "'" : "";

  let name;
  if (modType === 0) {
    name = `${preTitle} ${prefix}${useApostrophe}${suffix}`;
  } else if (modType === 1) {
    name = `${prefix}${useApostrophe}${suffix} ${title}`;
  } else {
    name = `${prefix}${useApostrophe}${suffix} ${number}`;
  }

  return { name, prefix, suffix };
}

function generateGender() {
  const result = Math.floor(Math.random() * 3) + 1;
  return result === 1 ? "Male" : result === 2 ? "Female" : "Nonbinary";
}

function generateSpecies() {
  const race = getRandom(races);
  if (race.includes("${animal}")) {
    const animal = generateAnimal();
    return race.replace(/\$\{animal\}/g, capitalize(animal));
  }
  return race;
}

function generateClass() { return getRandom(classes); }
function generateWeapon() { return getRandom(weapons); }
function generateBackground() { return getRandom(backgrounds); }
function generateGod() { return getRandom(religiousFoci); }

function generateTrait() {
  let trait = getRandom(traits);
  if (trait.includes("${animal}")) {
    trait = trait.replace(/\$\{animal\}/g, generateAnimal());
  }
  if (trait.includes("${objects}")) {
    trait = trait.replace(/\$\{objects\}/g, generateObject());
  }
  return trait;
}

function generateLove() { return getRandom(loveType); }
function generateFlaw() { return getRandom(flaws); }

export const genFunctions = {
  generateName,
  generateGender,
  generateSpecies,
  generateClass,
  generateWeapon,
  generateBackground,
  generateGod,
  generateTrait,
  generateLove,
  generateFlaw,
};
