// ui.js
import { generateChar } from './logic.js';
import { saveCharacter, getSavedCharacters, deleteCharacter } from './saving.js';
import { genFunctions } from './Utilities/generators.js';

const {
  generateName,
  generateGender,
  generateSpecies,
  generateClass,
  generateWeapon,
  generateBackground,
  generateTrait,
  generateLove,
  generateFlaw,
  generateGod,
} = genFunctions;

let currentCharacter = null;

function capitalizeFirstLetter(string) {
  return string
    .split(' ')
    .map((word, index) => {
      if (index === 0 || word.toLowerCase() !== 'the') {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      } else {
        return word.toLowerCase();
      }
    })
    .join(' ');
}

const toggleInfoHandler = () => {
  const info = document.getElementById('additionalInfo');
  info.classList.toggle('expanded');
};

document.getElementById('toggleButton').addEventListener('click', toggleInfoHandler);

function updateUI(character) {
  const characterProperties = {
    name: "nameDisplay",
    species: "raceDisplay",
    charClass: "classDisplay",
    weapon: "weaponDisplay",
    background: "backgroundDisplay",
    trait: "traitDisplay",
    gender: "genderDisplay",
    love: "sexualityDisplay",
    flaw: "flawDisplay",
    god: "godDisplay",
  };

  Object.keys(characterProperties).forEach((key) => {
    const elementId = characterProperties[key];
    const value = character[key];
    const displayValue = key === "god" ? capitalizeFirstLetter(value) : value;
    document.getElementById(elementId).innerText = `${capitalizeFirstLetter(elementId.replace('Display', ''))}: ${displayValue}`;
  });
}

function setupGenerateButton() {
  document.getElementById("generateBtn").addEventListener("click", function () {
    currentCharacter = generateChar();
    updateUI(currentCharacter);
  });
}

function setupSaveButton() {
  document.getElementById("saveCharacterBtn").addEventListener("click", function () {
    const character = {
      name: document.getElementById("nameDisplay").innerText.replace("Name: ", ""),
      gender: document.getElementById("genderDisplay").innerText.replace("Gender: ", ""),
      species: document.getElementById("raceDisplay").innerText.replace("Race: ", ""),
      charClass: document.getElementById("classDisplay").innerText.replace("Class: ", ""),
      weapon: document.getElementById("weaponDisplay").innerText.replace("Weapon: ", ""),
      background: document.getElementById("backgroundDisplay").innerText.replace("Background: ", ""),
      trait: document.getElementById("traitDisplay").innerText.replace("Trait: ", ""),
    };
    saveCharacter(character);
    alert("Character saved!");
  });
}

function displaySavedCharacters() {
  const list = document.getElementById("savedCharacterList");
  list.innerHTML = "";
  const characters = getSavedCharacters();

  if (characters.length === 0) {
    list.innerHTML = "<li>No saved characters yet.</li>";
    return;
  }

  characters.forEach((char, index) => {
    const card = document.createElement("div");
    card.classList.add("savedCharacterCard");
    card.setAttribute("data-index", index);

    const cardHeader = document.createElement("div");
    cardHeader.classList.add("cardHeader");
    cardHeader.textContent = `${char.name} - ${char.gender} ${char.species} ${char.charClass}`;
    card.appendChild(cardHeader);

    const cardDetails = document.createElement("div");
    cardDetails.classList.add("cardDetails");
    cardDetails.style.display = "none";
    cardDetails.innerHTML = `
      <p><strong>Weapon:</strong> ${char.weapon}</p>
      <p><strong>Background:</strong> ${char.background}</p>
      <p><strong>Trait:</strong> ${char.trait}</p>
    `;
    card.appendChild(cardDetails);

    card.addEventListener("click", () => {
      const details = card.querySelector(".cardDetails");
      details.style.display = details.style.display === "none" ? "block" : "none";
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete Character";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteCharacter(index);
      displaySavedCharacters();
    });
    card.appendChild(deleteBtn);

    list.appendChild(card);
  });
}

function setupViewSavedButton() {
  document.getElementById("viewSavedBtn").addEventListener("click", function () {
    const savedPanel = document.getElementById("savedCharactersPanel");
    savedPanel.style.display = savedPanel.style.display === "none" ? "block" : "none";
    displaySavedCharacters();
  });
}

function setupRerollHandlers() {
  const rerollMap = {
    nameDisplay: { key: "name", generate: () => {
      const { name, prefix, suffix } = generateName();
      currentCharacter.prefix = prefix;
      currentCharacter.suffix = suffix;
      return name;
    }, label: "Name" },
    raceDisplay:       { key: "species",   generate: generateSpecies,   label: "Race" },
    classDisplay:      { key: "charClass", generate: generateClass,     label: "Class" },
    weaponDisplay:     { key: "weapon",    generate: generateWeapon,    label: "Weapon" },
    backgroundDisplay: { key: "background",generate: generateBackground,label: "Background" },
    traitDisplay:      { key: "trait",     generate: generateTrait,     label: "Trait" },
    genderDisplay:     { key: "gender",    generate: generateGender,    label: "Gender" },
    sexualityDisplay:  { key: "love",      generate: generateLove,      label: "Preference" },
    flawDisplay:       { key: "flaw",      generate: generateFlaw,      label: "Flaw" },
    godDisplay:        { key: "god",       generate: generateGod,       label: "God" },
  };

  Object.entries(rerollMap).forEach(([elementId, { key, generate, label }]) => {
    document.getElementById(elementId).addEventListener("click", () => {
      if (!currentCharacter) return;
      const newValue = generate();
      currentCharacter[key] = newValue;
      document.getElementById(elementId).innerText = `${label}: ${newValue}`;
    });
  });
}

function initUI() {
  setupGenerateButton();
  setupSaveButton();
  setupViewSavedButton();
  setupRerollHandlers();
}

document.addEventListener("DOMContentLoaded", initUI);
