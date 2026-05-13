//logic.js
import { allData } from './Data/mainData.js';
import { genFunctions } from './Utilities/generators.js';

const { Saryn, isReligiousClass } = allData;
const {
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
} = genFunctions;

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function generateChar() {
  const nameData = generateName();

  if (nameData.prefix === "Mor" && nameData.suffix === "draga") {
    return Saryn;
  }

  const god = generateGod();

  const character = {
    name: nameData.name,
    gender: generateGender(),
    species: generateSpecies(),
    charClass: generateClass(),
    weapon: generateWeapon(),
    background: generateBackground(),
    trait: generateTrait(),
    love: generateLove(),
    flaw: generateFlaw(),
    god,
  };

  if (isReligiousClass(character.charClass)) {
    character.charClass += " of " + god;
  }

  return character;
}
