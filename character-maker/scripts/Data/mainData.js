import { namePrefix, nameSuffix, preTitles, titles, numbers } from './nameData.js';
import { races } from './raceData.js';
import { classes, isReligiousClass } from './classData.js';
import { religiousFoci } from './religionData.js';
import { weapons } from './weaponData.js';
import { backgrounds } from './backgroundData.js';
import { traits } from './traitData.js';
import { objects, generateObject } from './objectsData.js';
import { Saryn } from './specialCharactersData.js';
import { animals, generateAnimal } from './animalData.js';
import { loveType } from './preferenceData.js';
import { flaws } from './flaws.js';

export const allData = {
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
  flaws,
};
